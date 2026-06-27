import { createId, type IdPrefix } from "./id.js";
import { compileContract } from "./contract/compileContract.js";
import { effectiveProfileToSubagent, resolveEffectiveProfilesByStep } from "./contract/agentProfiles.js";
import { runSkillProfilePreflight, type SkillAvailabilityProvider } from "./codex/skillPreflight.js";
import { evalScriptAst, type ScriptAst } from "./script/evalScript.js";
import { validateOutputAgainstSchema } from "./script/validateOutput.js";
import type { CodexSessionBridge, CodexSessionRef } from "./codex/sessionBridge.js";
import type {
  EffectiveAgentProfile,
  FormalLoopContract,
  FormalLoopContractInput,
  LegacyVerificationPolicy,
  PhaseStep,
  Step,
  VerificationPolicyV2
} from "./contract/types.js";
import { validateContract } from "./contract/validateContract.js";
import type { AgentRequest, AgentResult, EngineEvent, EngineEventInput, Executor } from "./engine/types.js";
import { buildWorkflowExecutionPlan, LoopRunner, type LoopRunResult, type LoopVerifier } from "./runner/loopRunner.js";
import { runContractVerification } from "./runner/contractVerification.js";
import { shouldRepair } from "./runner/repair.js";
import type { VerificationDecision, VerificationDecisionStatus } from "./runner/verifier.js";
import {
  recordedRubricAgentResultToValidatorResult,
  runVerificationV2,
  type RecordedRubricAgentResultInput,
  type VerificationResultV2
} from "./runner/verificationV2.js";
import type {
  ArtifactRef,
  CodexProjectRef,
  EventKind,
  HumanRequest,
  LoopContract,
  LoopMemory,
  LoopMemoryWindow,
  LoopOperationalState,
  LoopPausedReason,
  LoopRun,
  LoopWorkspaceFile,
  RunAttempt,
  RunDetail,
  LoopState,
  MemoryCommit,
  RunEvent,
  RunStatus,
  VerificationResult,
  VerificationStatus,
  WorkflowContext,
  WorkflowVerificationState,
  WorkflowTaskRun,
  WorkflowRevision,
  SkillPreflightReport
} from "./types.js";
import type { LoopStore } from "./store.js";
import { loopWorkspaceFiles } from "./workspaceFiles.js";
import { deleteLoopWorkspaceDirectory, syncLoopWorkspaceDirectory } from "./workspaceDirectory.js";
import { compileExecutionGraph } from "./workflowGraph/compileGraph.js";
import {
  createInitialNodeRuns,
  findNodeIdForStep,
  updateNodeRunForTaskResult,
  updateNodeRunForTaskRunning,
  updateNodeRunForTaskSession,
  updateNodeRunForTaskWaitingForSession
} from "./workflowGraph/nodeRuns.js";
import {
  advanceContainerNodeRuns,
  buildPipelineInputSnapshot,
  deriveRunnableNodeIds,
  startAncestorContainerNodeRuns,
  workflowNodesComplete
} from "./workflowGraph/scheduler.js";
import type { ExecutionGraphNode, ExecutionGraphSnapshot, WorkflowNodeRun } from "./workflowGraph/types.js";

export interface LoopServiceOptions {
  store: LoopStore;
  now?: () => string;
  createId?: (prefix: IdPrefix) => string;
  previewBaseUrl?: string;
  codexProjects?: CodexProjectRef[];
  sessionBridge?: CodexSessionBridge;
  skillAvailabilityProvider?: SkillAvailabilityProvider;
}

export const DEFAULT_LOOP_MEMORY_READ_LIMIT = 80;
export const MAX_LOOP_MEMORY_READ_LIMIT = 200;

export interface ReadLoopMemoryInput {
  limit?: number;
  offset?: number;
}

export type CreateLoopContractInput = Omit<FormalLoopContractInput, "id" | "body"> & {
  id?: string;
  body?: FormalLoopContractInput["body"];
  script?: ScriptAst;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
};

export interface ExecuteWorkflowAttemptInput {
  attemptId?: string;
  executor?: Executor;
  verifier?: LoopVerifier;
}

export interface ProposeWorkflowRevisionInput {
  runId: string;
  attemptId: string;
  authorSessionId?: string;
  authorThreadId?: string;
  reason?: string;
  rationale?: string;
  contract?: CreateLoopContractInput;
  patch?: Partial<CreateLoopContractInput>;
}

export interface RejectWorkflowRevisionInput {
  runId: string;
  attemptId: string;
  reason: string;
}

export interface PromoteWorkflowRevisionInput {
  runId: string;
  attemptId: string;
}

export interface StartAttemptInput {
  summary?: string;
}

export interface StartCodexSessionRunInput {
  goal?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
  allowDegradedProfiles?: boolean;
}

export interface OpenCodexSessionResult {
  runId: string;
  status: "ready" | "unavailable";
  message: string;
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
  launchRequest?: CodexSessionLaunchRequest;
  recordThread?: {
    tool: "record_codex_thread";
    runId: string;
    threadUrlTemplate: "codex://thread/{threadId}";
  };
}

export interface CreateNewLoopSessionInput {
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface CodexSessionLaunch {
  run: LoopRun;
  attempt: RunAttempt;
  prompt: string;
  launchRequest: CodexSessionLaunchRequest;
}

export interface CodexSessionLaunchRequest {
  runId: string;
  attemptId: string;
  workflowContextId: string;
  loopId: string;
  title: string;
  prompt: string;
  workflowRuntime?: "dittosloop-local-workflow";
  workflowContractId?: string;
  workflowPlan?: WorkflowLaunchPlan;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface WorkflowLaunchPlanStep {
  id: string;
  kind: "agent" | "task" | "parallel" | "phase";
  runtime?: "codex";
  label: string;
  depth: number;
  phaseId?: string;
  prompt?: string;
  sessionPolicy?: "new";
  agentProfile?: EffectiveAgentProfile;
  subagent?: FormalLoopContract["body"]["steps"][number] extends infer TStep
    ? TStep extends { subagent?: infer TSubagent }
      ? TSubagent
      : never
    : never;
}

export interface WorkflowLaunchPlan {
  runtime: "dittosloop-local-workflow";
  contractId: string;
  goal: string;
  steps: WorkflowLaunchPlanStep[];
  verification: FormalLoopContract["verification"] | LegacyVerificationPolicy;
  repairPolicy: FormalLoopContract["repairPolicy"];
  stopPolicy: FormalLoopContract["stopPolicy"];
  budgetUsd?: FormalLoopContract["budgetUsd"];
  escalation?: FormalLoopContract["escalation"];
}

export interface NewLoopSessionLaunch {
  prompt: string;
  launchRequest: {
    title: string;
    prompt: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
    workflowRuntime: "dittosloop-loop-creator";
  };
}

export interface RecordCodexThreadInput {
  threadId: string;
  threadTitle?: string;
  threadUrl?: string;
}

type ImmediatePausedReason = Extract<LoopPausedReason, "budget" | "escalation">;
const VERIFICATION_INPUT_KIND_FIELD = "__dittosLoopVerificationInputKind";

type VerificationInputKind = "legacy" | "v2";
type VerificationPolicyWithInputKind = FormalLoopContract["verification"] & {
  [VERIFICATION_INPUT_KIND_FIELD]?: VerificationInputKind;
};

export interface RecordSessionResultInput {
  workflowContextId?: string;
  attemptId?: string;
  taskRunId?: string;
  sessionId?: string;
  stepId?: string;
  idempotencyKey?: string;
  status: "passed" | "failed" | "needs_human";
  pausedReason?: ImmediatePausedReason;
  summary: string;
  result?: string;
  checks?: VerificationResult["checks"];
  humanQuestion?: string;
}

export interface RecordValidatorResultInput {
  workflowContextId?: string;
  attemptId?: string;
  sessionId?: string;
  validatorId: string;
  idempotencyKey?: string;
  result: RecordedRubricAgentResultInput & {
    type: "rubric_agent";
    criteriaResults?: Array<{
      criterionId: string;
      status: VerificationDecisionStatus;
      score?: number;
      maxScore?: number;
      evidence?: string;
    }>;
  };
}

export interface CompleteAttemptInput {
  status?: Extract<RunAttempt["status"], "completed" | "failed">;
  summary?: string;
}

export interface AppendEventInput {
  kind?: EventKind;
  message: string;
  data?: Record<string, unknown>;
}

export interface RecordVerificationInput {
  attemptId?: string;
  status: VerificationStatus;
  summary: string;
  checks?: VerificationResult["checks"];
  repair?: boolean;
}

export interface RecordHumanRequestInput {
  question: string;
}

export interface ResolveHumanRequestInput {
  response: string;
  summary?: string;
}

export interface MarkRunRepairingInput {
  reason?: string;
}

export interface CommitMemoryInput {
  runId?: string;
  summary: string;
}

export interface AddArtifactInput {
  title: string;
  path?: string;
  url?: string;
  kind?: string;
}

export interface CompleteRunInput {
  status?: Extract<RunStatus, "completed" | "failed">;
  pausedReason?: ImmediatePausedReason;
}

export interface PauseLoopInput {
  reason?: LoopPausedReason;
}

export interface LoopStatusUpdate {
  loop: LoopContract;
  state: LoopOperationalState;
}

export type Snapshot = LoopState & {
  previewUrl: string;
  codexProjects: CodexProjectRef[];
};

export class LoopService {
  private readonly now: () => string;
  private readonly nextId: (prefix: IdPrefix) => string;
  private previewBaseUrl: string;

  constructor(private readonly options: LoopServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.nextId = options.createId ?? createId;
    this.previewBaseUrl = options.previewBaseUrl ?? "http://127.0.0.1:47888";
  }

  async createLoopContract(input: CreateLoopContractInput): Promise<FormalLoopContract> {
    const timestamp = this.now();
    const resolvedInput = resolveScriptContractInput(input);
    const contract = compileContractWithVerificationInputKind(
      normalizeFormalContractInput(resolvedInput, resolvedInput.id ?? this.nextId("loop")),
      timestamp
    );

    validateContract(contract);

    await this.options.store.updateState((state) => ({
      ...state,
      formalContracts: [...(state.formalContracts ?? []), contract],
      loops: [...state.loops.filter((loop) => loop.id !== contract.id), formalContractToLoop(contract)]
    }));

    return contract;
  }

  createNewLoopSessionLaunch(input: CreateNewLoopSessionInput = {}): NewLoopSessionLaunch {
    const project = normalizeProjectBinding(input);
    const prompt = buildNewLoopSessionPrompt(project);

    return {
      prompt,
      launchRequest: {
        title: "DittosLoop: 新建 Live Loop",
        prompt,
        workflowRuntime: "dittosloop-loop-creator",
        ...project
      }
    };
  }

  async listLoops(): Promise<LoopContract[]> {
    const state = await this.options.store.readState();

    return state.loops;
  }

  async pauseLoop(loopId: string, input: PauseLoopInput = {}): Promise<LoopStatusUpdate> {
    const timestamp = this.now();
    let update: LoopStatusUpdate | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const nextLoops = state.loops.map((candidate) =>
        candidate.id === loopId ? { ...candidate, status: "paused" as const, updatedAt: timestamp } : candidate
      );
      const nextContracts = state.formalContracts.map((contract) =>
        contract.id === loopId ? { ...contract, status: "paused" as const, updatedAt: timestamp } : contract
      );
      const nextState = {
        ...state,
        loops: nextLoops,
        formalContracts: nextContracts
      };
      const operationalState = buildLoopOperationalState(nextState, loopId, {
        paused: true,
        pausedReason: input.reason,
        clearPausedReason: input.reason === undefined
      });
      const updatedLoop = nextLoops.find((candidate) => candidate.id === loop.id)!;
      update = { loop: updatedLoop, state: operationalState };

      return {
        ...nextState,
        loopStates: upsertLoopOperationalState(nextState.loopStates, operationalState)
      };
    });

    return update!;
  }

  async resumeLoop(loopId: string): Promise<LoopStatusUpdate> {
    const timestamp = this.now();
    let update: LoopStatusUpdate | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const nextLoops = state.loops.map((candidate) =>
        candidate.id === loopId ? { ...candidate, status: "active" as const, updatedAt: timestamp } : candidate
      );
      const nextContracts = state.formalContracts.map((contract) =>
        contract.id === loopId ? { ...contract, status: "active" as const, updatedAt: timestamp } : contract
      );
      const nextState = {
        ...state,
        loops: nextLoops,
        formalContracts: nextContracts
      };
      const operationalState = buildLoopOperationalState(nextState, loopId, {
        paused: false,
        clearPausedReason: true,
        consecutiveFailures: 0
      });
      const updatedLoop = nextLoops.find((candidate) => candidate.id === loop.id)!;
      update = { loop: updatedLoop, state: operationalState };

      return {
        ...nextState,
        loopStates: upsertLoopOperationalState(nextState.loopStates, operationalState)
      };
    });

    return update!;
  }

  async deleteLoop(loopId: string): Promise<LoopContract> {
    let deletedLoop: LoopContract | undefined;

    await this.options.store.updateState((state) => {
      deletedLoop = requireLoop(state, loopId);
      const deletedRunIds = new Set(state.runs.filter((run) => run.loopId === loopId).map((run) => run.id));

      return {
        ...state,
        loops: state.loops.filter((loop) => loop.id !== loopId),
        formalContracts: state.formalContracts.filter((contract) => contract.id !== loopId),
        workflowRevisions: state.workflowRevisions.filter((revision) => revision.loopId !== loopId),
        workflowContexts: state.workflowContexts.filter((context) => context.loopId !== loopId),
        runs: state.runs.filter((run) => run.loopId !== loopId),
        attempts: state.attempts.filter((attempt) => !deletedRunIds.has(attempt.runId)),
        events: state.events.filter((event) => !deletedRunIds.has(event.runId)),
        verificationResults: state.verificationResults.filter((result) => !deletedRunIds.has(result.runId)),
        humanRequests: state.humanRequests.filter((request) => !deletedRunIds.has(request.runId)),
        memoryCommits: state.memoryCommits.filter(
          (commit) => commit.loopId !== loopId && (!commit.runId || !deletedRunIds.has(commit.runId))
        ),
        loopMemories: state.loopMemories.filter((memory) => memory.loopId !== loopId),
        artifacts: state.artifacts.filter((artifact) => !deletedRunIds.has(artifact.runId))
      };
    });

    await deleteLoopWorkspaceDirectory(this.options.store.dataDir, loopId);

    return deletedLoop!;
  }

  async executeWorkflowAttempt(runId: string, input: ExecuteWorkflowAttemptInput = {}): Promise<LoopRun> {
    const initialState = await this.options.store.readState();
    const run = requireRun(initialState, runId);
    const attemptsForRun = initialState.attempts.filter((attempt) => attempt.runId === runId);
    const attempt = input.attemptId
      ? requireAttempt(initialState, input.attemptId)
      : attemptsForRun.find((candidate) => candidate.status === "running") ?? attemptsForRun.at(-1);
    if (!attempt) {
      throw new Error(`No attempt found for run: ${runId}`);
    }
    if (attempt.runId !== runId) {
      throw new Error(`Attempt does not belong to run: ${attempt.id}`);
    }
    const existingContext = initialState.workflowContexts.find(
      (context) => context.runId === runId && context.attemptId === attempt.id
    );
    if (existingContext?.status === "completed") {
      return run;
    }
    if (existingContext?.status === "failed") {
      throw new Error(`Workflow context already failed: ${existingContext.id}`);
    }
    if (existingContext && hasOpenWorkflowSessions(existingContext)) {
      return run;
    }

    const activeContract = existingContext?.contractSnapshot ?? requireFormalContract(initialState, run.loopId);
    const workflowContext = await this.prepareWorkflowContext(run.id, attempt.id, activeContract);
    const contract = workflowContext.contractSnapshot ?? activeContract;
    const usesV2Verification = usesVerificationV2Runtime(contract.verification);
    const usesExternalV2Verification = usesExternalV2ValidatorWriteback(contract.verification);
    const runnerContract = usesV2Verification ? contract : legacyCompatibleRunnerContract(contract);
    const attemptNumber = Math.max(1, attemptsForRun.findIndex((candidate) => candidate.id === attempt.id) + 1);
    if (
      usesExternalV2Verification &&
      !hasRemainingExecutableSteps(contract, workflowContext) &&
      !hasOpenWorkflowSessions(workflowContext) &&
      pendingRubricAgentValidatorIds(contract.verification, workflowContext).length > 0
    ) {
      await this.startPendingRubricAgentValidators(run, workflowContext, contract.verification);
      return (await this.getRunDetail(runId)).run;
    }
    if (
      !input.executor &&
      workflowContext.executionGraphSnapshot &&
      workflowContext.nodeRuns &&
      canUseGraphScheduler(workflowContext.executionGraphSnapshot)
    ) {
      return this.executeGraphWorkflowAttempt(run, attempt, workflowContext, contract, input);
    }
    const engineEvents: EngineEvent[] = [];
    const runner = new LoopRunner({
      executor: input.executor ?? this.createWorkflowContextExecutor(run, attempt.id, workflowContext.id),
      verifier: input.verifier,
      now: this.now,
      completedStepOutputs: completedWorkflowStepOutputs(workflowContext)
    });

    let result: LoopRunResult;
    try {
      result = await runner.run({
        contract: runnerContract,
        runId,
        attemptId: attempt.id,
        attemptNumber,
        emit: (event) => engineEvents.push(event)
      });
    } catch (error) {
      if (isCodexSessionPendingError(error)) {
        await this.recordEngineEvents(runId, engineEvents.filter((event) => !isPendingSessionFailureEvent(event)));
        await this.suspendWorkflowContextForSession(workflowContext.id, error.session);
        return this.markRunWaitingForCodexSession(runId, error.session);
      }

      await this.recordEngineEvents(runId, engineEvents);
      await this.failWorkflowContext(workflowContext.id, error instanceof Error ? error.message : String(error));
      await this.completeAttempt(attempt.id, {
        status: "failed",
        summary: error instanceof Error ? error.message : String(error)
      });
      await this.completeRun(runId, { status: "failed" });
      throw error;
    }

    let finalRun = await this.recordCompletedCodexSessions(runId, engineEvents);
    await this.recordEngineEvents(runId, engineEvents);
    if (usesV2Verification && isVerificationResultV2(result.verification)) {
      return this.finalizeV2Verification(runId, workflowContext.id, result.verification);
    }

    await this.recordVerification(runId, {
      attemptId: attempt.id,
      status: verificationDecisionToResultStatus(result.verification.status),
      summary: result.verification.summary,
      checks: verificationDecisionChecksToResults(runnerContract, result.verification),
      repair: result.shouldRepair
    });

    if (result.shouldRepair) {
      await this.markWorkflowContextRepairing(workflowContext.id, result.verification.repairInstructions ?? result.verification.summary);
      return (await this.getRunDetail(runId)).run;
    }

    if (result.verification.status === "passed") {
      await this.completeWorkflowContext(workflowContext.id);
      await this.completeAttempt(attempt.id, {
        status: "completed",
        summary: result.verification.summary
      });
      finalRun = await this.completeRun(runId, { status: "completed" });
      return finalRun;
    }

    if (result.verification.status === "needs_human") {
      await this.completeWorkflowContext(workflowContext.id);
      await this.completeAttempt(attempt.id, {
        status: "completed",
        summary: result.verification.summary
      });
      await this.recordHumanRequest(runId, {
        question: result.verification.humanQuestion ?? result.verification.summary
      });
      return (await this.getRunDetail(runId)).run;
    }

    await this.failWorkflowContext(workflowContext.id, result.verification.summary);
    await this.completeAttempt(attempt.id, {
      status: "failed",
      summary: result.verification.summary
    });
    finalRun = await this.completeRun(runId, { status: "failed" });
    return finalRun;
  }

  private async executeGraphWorkflowAttempt(
    run: LoopRun,
    attempt: RunAttempt,
    workflowContext: WorkflowContext,
    contract: FormalLoopContract,
    input: ExecuteWorkflowAttemptInput
  ): Promise<LoopRun> {
    let sequence = latestEngineEventSequence((await this.getRunDetail(run.id)).events);
    const nextEngineEvent = <TEvent extends EngineEvent>(
      event: Omit<TEvent, "runId" | "createdAt" | "sequence">
    ): TEvent => ({
      ...event,
      runId: run.id,
      createdAt: this.now(),
      sequence: ++sequence
    } as TEvent);

    let currentRun = run;
    let currentContext = await this.markWorkflowContextSchedulerMode(workflowContext.id);

    while (true) {
      currentContext = await this.advanceGraphWorkflowContainers(currentContext.id, nextEngineEvent);
      const state = await this.options.store.readState();
      currentRun = requireRun(state, run.id);
      currentContext = requireWorkflowContext(state, currentContext.id);
      if (!currentContext.executionGraphSnapshot || !currentContext.nodeRuns) {
        return currentRun;
      }
      if (currentContext.status === "completed") {
        return currentRun;
      }
      if (currentContext.status === "failed") {
        throw new Error(`Workflow context already failed: ${currentContext.id}`);
      }
      if (hasOpenWorkflowSessions(currentContext)) {
        return currentRun;
      }

      const snapshot = currentContext.executionGraphSnapshot;
      const runnableNodeIds = deriveRunnableNodeIds(snapshot, currentContext.nodeRuns);
      const runnableTaskNodes = runnableNodeIds
        .map((nodeId) => snapshot.nodes.find((node) => node.nodeId === nodeId))
        .filter((node): node is ExecutionGraphNode => {
          return node !== undefined && (node.kind === "task" || node.kind === "human");
        });
      if (runnableTaskNodes.length > 0) {
        const bridge = this.options.sessionBridge;
        if (!bridge) {
          throw new Error("No workflow executor or Codex session bridge is configured.");
        }

        let sawPendingSession = false;
        for (const runnableTaskNode of runnableTaskNodes) {
          currentContext = await this.startGraphWorkflowContainersForNode(
            currentContext.id,
            runnableTaskNode.nodeId,
            nextEngineEvent
          );
          if (!currentContext.nodeRuns) {
            return currentRun;
          }
          const inputSnapshot = buildPipelineInputSnapshot(snapshot, currentContext.nodeRuns, runnableTaskNode.nodeId);
          if (inputSnapshot) {
            currentContext = await this.recordWorkflowNodeInputSnapshot(currentContext.id, runnableTaskNode.nodeId, inputSnapshot);
          }

          const request = await this.buildGraphAgentRequest(currentRun, attempt, currentContext, contract, runnableTaskNode);
          await this.recordEngineEvents(run.id, [
            nextEngineEvent<Extract<EngineEvent, { type: "agent_started" }>>({
              type: "agent_started",
              label: request.label,
              prompt: request.prompt,
              stepId: request.stepId,
              nodeId: runnableTaskNode.nodeId,
              phaseId: request.phaseId,
              pipeline: request.pipeline,
              human: request.human
            })
          ]);

          try {
            const result = await this.runCodexSessionStep(bridge, currentRun, request, {
              attemptId: attempt.id,
              workflowContextId: currentContext.id
            });
            const session = result.data?.session;
            const agentDoneEvent = nextEngineEvent<Extract<EngineEvent, { type: "agent_done" }>>({
              type: "agent_done",
              label: request.label,
              result: result.text,
              stepId: request.stepId,
              nodeId: runnableTaskNode.nodeId,
              phaseId: request.phaseId,
              pipeline: request.pipeline,
              human: request.human,
              session
            });
            await this.recordEngineEvents(run.id, [agentDoneEvent]);
            await this.recordCompletedCodexSessions(run.id, [agentDoneEvent]);
          } catch (error) {
            if (isCodexSessionPendingError(error)) {
              currentRun = await this.markRunWaitingForCodexSession(run.id, error.session);
              sawPendingSession = true;
              const pendingState = await this.options.store.readState();
              currentContext = requireWorkflowContext(pendingState, currentContext.id);
              continue;
            }

            const message = error instanceof Error ? error.message : String(error);
            await this.recordEngineEvents(run.id, [
              nextEngineEvent<Extract<EngineEvent, { type: "agent_failed" }>>({
                type: "agent_failed",
                label: request.label,
                stepId: request.stepId,
                phaseId: request.phaseId,
                error: message
              })
            ]);
            await this.failWorkflowContext(currentContext.id, message);
            await this.completeAttempt(attempt.id, { status: "failed", summary: message });
            await this.completeRun(run.id, { status: "failed" });
            throw error;
          }

          const taskState = await this.options.store.readState();
          currentRun = requireRun(taskState, run.id);
          currentContext = requireWorkflowContext(taskState, currentContext.id);
        }

        if (sawPendingSession || hasOpenWorkflowSessions(currentContext)) {
          return currentRun;
        }

        continue;
      }

      const runsByNodeId = new Map(currentContext.nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
      if (workflowNodesComplete(snapshot, runsByNodeId)) {
        return this.verifyGraphWorkflowCompletion(currentRun, attempt, currentContext, contract, input, nextEngineEvent);
      }

      return currentRun;
    }
  }

  private async markWorkflowContextSchedulerMode(workflowContextId: string): Promise<WorkflowContext> {
    const timestamp = this.now();
    let nextContext: WorkflowContext | undefined;

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      if (context.schedulerMode === "scheduler") {
        nextContext = context;
        return state;
      }

      nextContext = {
        ...context,
        schedulerMode: "scheduler",
        updatedAt: timestamp
      };

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });

    return nextContext!;
  }

  private async advanceGraphWorkflowContainers(
    workflowContextId: string,
    nextEngineEvent: <TEvent extends EngineEvent>(event: Omit<TEvent, "runId" | "createdAt" | "sequence">) => TEvent
  ): Promise<WorkflowContext> {
    const timestamp = this.now();
    let nextContext: WorkflowContext | undefined;
    let transitionEvents: EngineEvent[] = [];

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      if (!context.executionGraphSnapshot || !context.nodeRuns) {
        nextContext = context;
        return state;
      }

      const previousNodeRuns = context.nodeRuns;
      const nodeRuns = advanceContainerNodeRuns(context.executionGraphSnapshot, context.nodeRuns, timestamp);
      transitionEvents = containerTransitionEngineEvents(
        context.executionGraphSnapshot,
        previousNodeRuns,
        nodeRuns,
        nextEngineEvent
      );
      nextContext = {
        ...context,
        nodeRuns,
        updatedAt: timestamp
      };

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });

    if (transitionEvents.length > 0 && nextContext) {
      await this.recordEngineEvents(nextContext.runId, transitionEvents);
    }

    return nextContext!;
  }

  private async startGraphWorkflowContainersForNode(
    workflowContextId: string,
    nodeId: string,
    nextEngineEvent: <TEvent extends EngineEvent>(event: Omit<TEvent, "runId" | "createdAt" | "sequence">) => TEvent
  ): Promise<WorkflowContext> {
    const timestamp = this.now();
    let nextContext: WorkflowContext | undefined;
    let transitionEvents: EngineEvent[] = [];

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      if (!context.executionGraphSnapshot || !context.nodeRuns) {
        nextContext = context;
        return state;
      }

      const previousNodeRuns = context.nodeRuns;
      const nodeRuns = startAncestorContainerNodeRuns(
        context.executionGraphSnapshot,
        context.nodeRuns,
        nodeId,
        timestamp
      );
      transitionEvents = containerTransitionEngineEvents(
        context.executionGraphSnapshot,
        previousNodeRuns,
        nodeRuns,
        nextEngineEvent
      );
      nextContext = {
        ...context,
        nodeRuns,
        updatedAt: timestamp
      };

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });

    if (transitionEvents.length > 0 && nextContext) {
      await this.recordEngineEvents(nextContext.runId, transitionEvents);
    }

    return nextContext!;
  }

  private async recordWorkflowNodeInputSnapshot(
    workflowContextId: string,
    nodeId: string,
    inputSnapshot: Record<string, unknown>
  ): Promise<WorkflowContext> {
    const timestamp = this.now();
    let nextContext: WorkflowContext | undefined;

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      if (!context.nodeRuns) {
        nextContext = context;
        return state;
      }

      nextContext = {
        ...context,
        nodeRuns: context.nodeRuns.map((nodeRun) =>
          nodeRun.nodeId === nodeId
            ? {
                ...nodeRun,
                inputSnapshot,
                updatedAt: timestamp
              }
            : nodeRun
        ),
        updatedAt: timestamp
      };

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });

    return nextContext!;
  }

  private async buildGraphAgentRequest(
    run: LoopRun,
    attempt: RunAttempt,
    context: WorkflowContext,
    contract: FormalLoopContract,
    node: ExecutionGraphNode
  ): Promise<AgentRequest> {
    const effectiveProfilesByStep = resolveEffectiveProfilesByStep(contract);
    const agentProfile = node.sourceStepId ? effectiveProfilesByStep.get(node.sourceStepId) : undefined;
    const phaseId = node.phaseNodeId
      ? context.executionGraphSnapshot?.nodes.find((candidate) => candidate.nodeId === node.phaseNodeId)?.sourceStepId
      : undefined;
    const pipeline = context.executionGraphSnapshot?.edges.some(
      (edge) => edge.kind === "pipeline_data" && edge.toNodeId === node.nodeId
    ) || undefined;
    const request: AgentRequest = {
      prompt: node.prompt ?? node.label,
      label: node.label,
      stepId: node.sourceStepId,
      phaseId,
      pipeline,
      human: node.kind === "human" || node.human === true ? true : undefined,
      subagent: node.subagent ?? effectiveProfileToSubagent(agentProfile),
      agentProfile,
      attemptId: attempt.id,
      workflowContextId: context.id,
      workflowRuntime: "dittosloop-local-workflow",
      workflowContractId: contract.id,
      workflowPlan: buildWorkflowExecutionPlan(contract)
    };
    if (!pipeline) {
      return request;
    }

    return {
      ...request,
      prompt: await this.injectPipelinePromptContext(context.id, request)
    };
  }

  private async verifyGraphWorkflowCompletion(
    run: LoopRun,
    attempt: RunAttempt,
    context: WorkflowContext,
    contract: FormalLoopContract,
    input: ExecuteWorkflowAttemptInput,
    nextEngineEvent: <TEvent extends EngineEvent>(event: Omit<TEvent, "runId" | "createdAt" | "sequence">) => TEvent
  ): Promise<LoopRun> {
    if (
      usesExternalV2ValidatorWriteback(contract.verification) &&
      pendingRubricAgentValidatorIds(contract.verification, context).length > 0
    ) {
      await this.startPendingRubricAgentValidators(run, context, contract.verification);
      return (await this.getRunDetail(run.id)).run;
    }

    const usesV2Verification = usesVerificationV2Runtime(contract.verification);
    const verificationContract = usesV2Verification ? contract : legacyCompatibleRunnerContract(contract);
    const engineEvents: EngineEvent[] = [];
    const emitRuntimeEvent = (event: EngineEventInput): void => {
      engineEvents.push(nextEngineEvent(event as Omit<EngineEvent, "runId" | "createdAt" | "sequence">));
    };
    emitRuntimeEvent({ type: "verification_started", attemptId: attempt.id });
    const verification = await runContractVerification({
      contract: verificationContract,
      result: completedWorkflowStepOutputs(context),
      runId: run.id,
      attemptId: attempt.id,
      now: this.now,
      verifier: input.verifier,
      emit: emitRuntimeEvent
    });
    emitRuntimeEvent({ type: "verification_done", attemptId: attempt.id, decision: verification });
    const attemptNumber = Math.max(1, (await this.getRunDetail(run.id)).attempts.findIndex((candidate) => candidate.id === attempt.id) + 1);
    const shouldRepairRun = shouldRepair(verification, contract.repairPolicy, attemptNumber);
    const finalStatus = verification.status === "passed"
      ? "completed"
      : verification.status === "needs_human"
        ? "waiting_for_human"
        : "failed";
    if (shouldRepairRun) {
      emitRuntimeEvent({
        type: "repair_started",
        attemptId: attempt.id,
        reason: verification.repairInstructions ?? verification.summary
      });
    } else {
      if (verification.status === "needs_human") {
        emitRuntimeEvent({
          type: "human_request",
          question: verification.humanQuestion ?? verification.summary
        });
      }
      emitRuntimeEvent({
        type: "run_done",
        status: finalStatus,
        summary: verification.summary
      });
    }
    await this.recordEngineEvents(run.id, engineEvents);

    if (usesV2Verification && isVerificationResultV2(verification)) {
      return this.finalizeV2Verification(run.id, context.id, verification);
    }

    await this.recordVerification(run.id, {
      attemptId: attempt.id,
      status: verificationDecisionToResultStatus(verification.status),
      summary: verification.summary,
      checks: verificationDecisionChecksToResults(verificationContract, verification),
      repair: shouldRepairRun
    });

    if (shouldRepairRun) {
      await this.markWorkflowContextRepairing(context.id, verification.repairInstructions ?? verification.summary);
      return (await this.getRunDetail(run.id)).run;
    }

    if (verification.status === "passed") {
      await this.completeWorkflowContext(context.id);
      await this.completeAttempt(attempt.id, {
        status: "completed",
        summary: verification.summary
      });
      return this.completeRun(run.id, { status: "completed" });
    }

    if (verification.status === "needs_human") {
      await this.completeWorkflowContext(context.id);
      await this.completeAttempt(attempt.id, {
        status: "completed",
        summary: verification.summary
      });
      await this.recordHumanRequest(run.id, {
        question: verification.humanQuestion ?? verification.summary
      });
      return (await this.getRunDetail(run.id)).run;
    }

    await this.failWorkflowContext(context.id, verification.summary);
    await this.completeAttempt(attempt.id, {
      status: "failed",
      summary: verification.summary
    });
    return this.completeRun(run.id, { status: "failed" });
  }

  private createWorkflowContextExecutor(run: LoopRun, attemptId: string, workflowContextId: string): Executor {
    const bridge = this.options.sessionBridge;
    if (!bridge) {
      throw new Error("No workflow executor or Codex session bridge is configured.");
    }

    return {
      run: async (request) => {
        const prompt = request.pipeline
          ? await this.injectPipelinePromptContext(workflowContextId, request)
          : request.prompt;
        return this.runCodexSessionStep(
          bridge,
          run,
          {
            ...request,
            prompt,
            attemptId,
            workflowContextId
          },
          {
            attemptId,
            workflowContextId
          }
        );
      }
    };
  }

  // For a pipeline phase, thread the prior sibling step's memoized output into the next
  // child's prompt context. Reads the prior output from the persisted WorkflowContext and
  // the sibling ordering from the contractSnapshot (the replay boundary).
  private async injectPipelinePromptContext(workflowContextId: string, request: AgentRequest): Promise<string> {
    if (!request.stepId || !request.phaseId) {
      return request.prompt;
    }
    const state = await this.options.store.readState();
    const context = findWorkflowContextById(state, workflowContextId);
    if (!context) {
      return request.prompt;
    }
    const contract = context.contractSnapshot;
    const phase = contract ? findPipelinePhase(contract.body.steps, request.phaseId) : undefined;
    if (!phase) {
      return request.prompt;
    }
    const prevStepId = previousPipelineSiblingId(phase, request.stepId);
    if (!prevStepId) {
      return request.prompt;
    }
    const priorOutput = context.steps[prevStepId]?.output;
    if (priorOutput === undefined) {
      return request.prompt;
    }
    return `${request.prompt}\n\n[pipeline] Prior step (${prevStepId}) output:\n${priorOutput}`;
  }

  private async runCodexSessionStep(
    bridge: CodexSessionBridge,
    run: LoopRun,
    request: AgentRequest,
    workflowContext?: { attemptId: string; workflowContextId: string }
  ): Promise<AgentResult> {
    const taskRunId = workflowContext
      ? await this.markWorkflowTaskRunning(workflowContext.workflowContextId, {
          attemptId: workflowContext.attemptId,
          runId: run.id,
          stepId: request.stepId,
          phaseId: request.phaseId,
          label: request.label,
          prompt: request.prompt,
          subagent: request.subagent,
          agentProfile: request.agentProfile,
          profilePreflight: profilePreflightForStep(run.codexSession?.profilePreflight, request.stepId, request.agentProfile)
        })
      : undefined;
    const createdSession = await bridge.createSession({
      runId: run.id,
      attemptId: request.attemptId,
      workflowContextId: request.workflowContextId,
      stepId: request.stepId,
      phaseId: request.phaseId,
      title: request.label ?? request.stepId ?? "Codex workflow step",
      prompt: request.prompt,
      subagent: request.subagent,
      agentProfile: request.agentProfile,
      workflowRuntime: request.workflowRuntime,
      workflowContractId: request.workflowContractId,
      workflowPlan: request.workflowPlan,
      projectId: run.codexProjectId,
      projectLabel: run.projectLabel,
      projectPath: run.projectPath
    });
    const session: CodexSessionRef = {
      ...createdSession,
      subagent: createdSession.subagent ?? request.subagent,
      agentProfile: createdSession.agentProfile ?? request.agentProfile
    };
    if (workflowContext && taskRunId) {
      await this.attachWorkflowTaskSession(workflowContext.workflowContextId, taskRunId, session);
    }
    const result = await bridge.readResult(session.sessionId);

    if (!result) {
      if (workflowContext && taskRunId) {
        await this.suspendWorkflowTaskForSession(workflowContext.workflowContextId, taskRunId, session);
      }
      throw new CodexSessionPendingError(session);
    }

    if (result.status === "failed") {
      if (workflowContext && taskRunId) {
        await this.failWorkflowTask(workflowContext.workflowContextId, taskRunId, result.text || `Codex session failed: ${session.sessionId}`);
      }
      throw new Error(result.text || `Codex session failed: ${session.sessionId}`);
    }

    if (workflowContext && taskRunId) {
      await this.completeWorkflowTask(workflowContext.workflowContextId, taskRunId, result.text);
    }

    return {
      text: result.text,
      data: {
        session: {
          ...session,
          status: result.status,
          threadId: result.threadId,
          threadTitle: result.threadTitle,
          threadUrl: result.threadUrl
        }
      }
    };
  }

  private async markRunWaitingForCodexSession(runId: string, session: CodexSessionRef): Promise<LoopRun> {
    const timestamp = this.now();
    let updatedRun: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const pendingSubagent: CodexSessionSubagent = {
        role: session.title,
        status: "requested",
        sessionId: session.sessionId,
        stepId: session.stepId,
        phaseId: session.phaseId,
        threadId: undefined,
        threadTitle: undefined,
        threadUrl: undefined,
        prompt: session.prompt,
        subagent: session.subagent,
        agentProfile: session.agentProfile,
        profilePreflight: profilePreflightForStep(run.codexSession?.profilePreflight, session.stepId, session.agentProfile)
      };
      const existingSubagents = run.codexSession?.subagents ?? [];
      let matchedSubagent = false;
      const subagents = existingSubagents.length
        ? existingSubagents.map((subagent) => {
            const matches =
              (session.stepId && subagent.stepId === session.stepId) ||
              (!subagent.stepId && subagent.role === session.title && subagent.prompt === session.prompt);
            if (!matches) return subagent;
            matchedSubagent = true;
            return {
              ...subagent,
              ...pendingSubagent
            };
          })
        : [];
      if (!matchedSubagent) {
        subagents.push(pendingSubagent);
      }

      updatedRun = {
        ...run,
        status: "running",
        codexSession: {
          mode: "new_session",
          status: codexSessionStatusForPendingWorkflowSession(run.codexSession),
          threadId: run.codexSession?.threadId,
          threadTitle: run.codexSession?.threadTitle,
          threadUrl: run.codexSession?.threadUrl,
          codexProjectId: session.projectId ?? run.codexSession?.codexProjectId ?? run.codexProjectId,
          projectLabel: session.projectLabel ?? run.codexSession?.projectLabel ?? run.projectLabel,
          projectPath: session.projectPath ?? run.codexSession?.projectPath ?? run.projectPath,
          subagents,
          profilePreflight: run.codexSession?.profilePreflight,
          prompt: session.prompt ?? run.codexSession?.prompt ?? run.goal
        },
        updatedAt: timestamp
      };

      return {
        ...state,
        runs: updateRun(state.runs, runId, updatedRun),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            "Codex session requested; waiting for worker result",
            timestamp,
            { codexSession: session }
          )
        ]
      };
    });

    return updatedRun!;
  }

  async startCodexSessionRun(loopId: string, input: StartCodexSessionRunInput = {}): Promise<CodexSessionLaunch> {
    const timestamp = this.now();
    const initialState = await this.options.store.readState();
    const initialLoop = requireLoop(initialState, loopId);
    const initialLoopState = initialState.loopStates.find((candidate) => candidate.loopId === loopId);
    if (initialLoopState?.paused || initialLoop.status === "paused") {
      throw new Error(`Loop is paused: ${loopId}`);
    }
    if (initialLoopState?.running) {
      throw new Error(`Loop is already running: ${loopId}`);
    }
    const launchContract = initialState.formalContracts.find((contract) => contract.id === loopId);
    const profilePreflight = launchContract
      ? await runSkillProfilePreflight(launchContract, {
          provider: this.options.skillAvailabilityProvider,
          allowDegradedProfiles: input.allowDegradedProfiles
        })
      : undefined;
    if (profilePreflight?.status === "blocked") {
      throw new Error(profilePreflight.blockers[0] ?? `Agent profile skill preflight blocked run ${loopId}`);
    }
    let launch: CodexSessionLaunch | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const loopState = state.loopStates.find((candidate) => candidate.loopId === loopId);
      if (loopState?.paused || loop.status === "paused") {
        throw new Error(`Loop is paused: ${loopId}`);
      }
      if (loopState?.running) {
        throw new Error(`Loop is already running: ${loopId}`);
      }

      const goal = input.goal ?? `Run ${loop.title}`;
      const runId = this.nextId("run");
      const attemptId = this.nextId("attempt");
      const workflowContextId = this.nextId("workflow");
      const graphSnapshotId = launchContract ? this.nextId("graph") : undefined;
      const memoryWindow = loopMemoryWindow(state, loopId);
      const prompt = buildCodexSessionPrompt(loop, goal, launchContract, {
        runId,
        attemptId,
        workflowContextId
      }, memoryWindow, profilePreflight);
      const workflowLaunch = launchContract ? buildWorkflowLaunch(launchContract) : {};
      const attemptSummary = `Request a new Codex session for ${loop.title}`;
      const project = runProjectBinding(input, loop);
      const run: LoopRun = {
        id: runId,
        loopId,
        status: "running",
        goal,
        trigger: "manual",
        ...project,
        codexSession: {
          mode: "new_session",
          status: "requested",
          ...project,
          subagents: codexSessionSubagentsForContract(launchContract, prompt, "requested", profilePreflight),
          ...(profilePreflight ? { profilePreflight } : {}),
          prompt
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const attempt: RunAttempt = {
        id: attemptId,
        runId: run.id,
        status: "running",
        summary: attemptSummary,
        createdAt: timestamp
      };
      const workflowContext = createWorkflowContext({
        id: workflowContextId,
        run,
        attempt,
        contract: launchContract,
        graphSnapshotId,
        timestamp
      });

      launch = {
        run,
        attempt,
        prompt,
        launchRequest: {
          runId: run.id,
          attemptId: attempt.id,
          workflowContextId: workflowContext.id,
          loopId,
          title: `DittosLoop: ${loop.title}`,
          prompt,
          ...workflowLaunch,
          ...project
        }
      };

      return {
        ...state,
        runs: [...state.runs, run],
        attempts: [...state.attempts, attempt],
        workflowContexts: [...state.workflowContexts, workflowContext],
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), run.id, "run_created", "Requested a host-created Codex session for this loop run", timestamp, {
            codexSession: run.codexSession
          }),
          lifecycleEvent(this.nextId("event"), run.id, "attempt_started", attemptSummary, timestamp, {
            attemptId: attempt.id,
            ...project
          })
        ],
        loops: bindLoopProject(state.loops, loopId, project, timestamp)
      };
    });

    return launch!;
  }

  async openCodexSession(runId: string): Promise<OpenCodexSessionResult> {
    const timestamp = this.now();
    let result: OpenCodexSessionResult | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const codexSession = run.codexSession;
      if (!codexSession) {
        result = {
          runId,
          status: "unavailable",
          message: "This run has no Codex session request."
        };
        return state;
      }

      const threadUrl = codexSession.threadUrl ?? codexThreadUrl(codexSession.threadId);
      if (!threadUrl) {
        result = {
          runId,
          status: "unavailable",
          message: "The Codex session has not been created by the host yet.",
          launchRequest: codexSessionLaunchRequestForRun(state, run),
          recordThread: recordCodexThreadInstruction(runId)
        };
        return state;
      }

      result = {
        runId,
        status: "ready",
        message: "Codex session is ready to open.",
        threadId: codexSession.threadId,
        threadTitle: codexSession.threadTitle,
        threadUrl
      };
      const normalizedRun =
        codexSession.threadUrl === threadUrl
          ? run
          : {
              ...run,
              updatedAt: timestamp,
              codexSession: normalizeCodexSessionThreadUrl(codexSession, threadUrl)
            };

      return {
        ...state,
        runs: normalizedRun === run ? state.runs : updateRun(state.runs, runId, normalizedRun),
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), runId, "note", "Codex session open requested", timestamp, {
            codexThread: {
              threadId: codexSession.threadId,
              threadTitle: codexSession.threadTitle,
              threadUrl
            }
          })
        ]
      };
    });

    return result!;
  }

  async startAttempt(runId: string, input: StartAttemptInput = {}): Promise<RunAttempt> {
    const timestamp = this.now();
    const attempt: RunAttempt = {
      id: this.nextId("attempt"),
      runId,
      status: "running",
      summary: input.summary,
      createdAt: timestamp
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        attempts: [...state.attempts, attempt],
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), runId, "attempt_started", input.summary ?? "Attempt started", timestamp)
        ]
      };
    });

    return attempt;
  }

  async recordCodexThread(runId: string, input: RecordCodexThreadInput): Promise<LoopRun> {
    const timestamp = this.now();
    let updatedRun: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      if (!run.codexSession) {
        throw new Error(`Run has no Codex session request: ${runId}`);
      }

      const codexThread = {
        threadId: input.threadId,
        threadTitle: input.threadTitle,
        threadUrl: input.threadUrl ?? codexThreadUrl(input.threadId)
      };
      updatedRun = {
        ...run,
        updatedAt: timestamp,
        codexSession: {
          ...run.codexSession,
          status: "started",
          ...codexThread,
          subagents:
            run.codexSession.subagents && run.codexSession.subagents.length > 0
              ? run.codexSession.subagents.map((subagent) => ({
                    ...subagent,
                    status:
                      subagent.status === "requested" || subagent.status === "running"
                        ? "running"
                        : subagent.status,
                    ...codexThread
                  })
                )
              : [
                  {
                    role: "loop-runner",
                    status: "running",
                    ...codexThread
                  }
                ]
        }
      };

      return {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            "Codex thread created and attached to this run",
            timestamp,
            { codexThread }
          )
        ]
      };
    });

    return updatedRun!;
  }

  async recordSessionResult(runId: string, input: RecordSessionResultInput): Promise<LoopRun> {
    const timestamp = this.now();
    if ((input.pausedReason as LoopPausedReason | undefined) === "failures") {
      throw new Error("Failure pauses are derived from stopPolicy");
    }
    if (input.pausedReason && input.status !== "failed") {
      throw new Error("pausedReason can only be recorded for failed session results");
    }
    let updatedRun: LoopRun | undefined;
    let shouldContinueWorkflow = false;
    let continuationAttemptId: string | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      if (!run.codexSession) {
        throw new Error(`Run has no Codex session request: ${runId}`);
      }

      const attemptsForRun = state.attempts.filter((attempt) => attempt.runId === runId);
      const requestedAttempt = input.attemptId ? requireAttempt(state, input.attemptId) : undefined;
      if (requestedAttempt && requestedAttempt.runId !== runId) {
        throw new Error(`Attempt does not belong to run: ${requestedAttempt.id}`);
      }
      const fallbackAttempt = requestedAttempt ?? attemptsForRun.at(-1);
      const targetContext = findWorkflowContextForSessionResult(state, runId, fallbackAttempt?.id, input);
      if (targetContext && requestedAttempt && targetContext.attemptId !== requestedAttempt.id) {
        throw new Error(`Workflow context does not belong to attempt: ${targetContext.id}`);
      }
      const targetAttempt = targetContext ? requireAttempt(state, targetContext.attemptId) : fallbackAttempt;
      if (targetAttempt && targetAttempt.runId !== runId) {
        throw new Error(`Attempt does not belong to run: ${targetAttempt.id}`);
      }
      const attemptId = targetAttempt?.id ?? this.nextId("attempt");
      if (targetContext && input.idempotencyKey && targetContext.idempotencyKeys.includes(input.idempotencyKey)) {
        updatedRun = run;
        return state;
      }
      const targetTaskRun = targetContext ? validateWorkflowSessionResultTarget(targetContext, input) : undefined;
      const resultInput = targetTaskRun ? normalizeWorkflowSessionResultInput(input, targetTaskRun) : input;

      const subagentStatus: NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number]["status"] =
        resultInput.status === "failed" ? "failed" : resultInput.status === "needs_human" ? "running" : "completed";
      const isTargeted = Boolean(
        resultInput.workflowContextId ||
          resultInput.attemptId ||
          resultInput.taskRunId ||
          resultInput.sessionId ||
          resultInput.stepId
      );
      const isWorkflowTaskResult = Boolean(targetContext && hasWorkflowTaskLocator(resultInput));
      const targetContract = targetContext
        ? targetContext.contractSnapshot ??
          state.formalContracts.find((candidate) => candidate.id === (targetContext.contractId ?? run.loopId))
        : undefined;

      // Enforce the target step's outputSchema (from contractSnapshot, the replay boundary)
      // for passed results BEFORE mutating any state. A non-conforming result is rejected and
      // the WorkflowContext is left untouched.
      if (resultInput.status === "passed" && targetContext && targetContract) {
        const validationStepId = resultInput.stepId ?? targetTaskRun?.stepId;
        const outputSchema = validationStepId
          ? findStepOutputSchema(targetContract.body.steps, validationStepId)
          : undefined;
        if (outputSchema && resultInput.result !== undefined) {
          validateOutputAgainstSchema(resultInput.result, outputSchema);
        }
      }

      const workflowContextAfterTaskResult = targetContext
        ? completeWorkflowContextFromSessionResult(targetContext, resultInput, timestamp, { finalize: false })
        : undefined;
      const graphTaskNodeTransition = workflowTaskNodeTransition({
        before: targetContext,
        after: workflowContextAfterTaskResult,
        input: resultInput,
        targetTaskRun
      });
      const graphTaskNodeTransitionEvents = graphTaskNodeTransition
        ? [
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "note",
              workflowNodeTransitionMessage(graphTaskNodeTransition),
              timestamp,
              {
                attemptId,
                workflowContextId: workflowContextAfterTaskResult?.id,
                nodeTransition: graphTaskNodeTransition
              }
            )
          ]
        : [];
      const shouldSynthesizeWorkflowEngineEvents = !targetContext?.executionGraphSnapshot;
      const hasRemainingWorkflowSteps = Boolean(
        targetContract &&
        workflowContextAfterTaskResult &&
        hasRemainingExecutableSteps(targetContract, workflowContextAfterTaskResult)
      );
      const hasPendingWorkflowSessions = Boolean(workflowContextAfterTaskResult?.pendingSessionIds.length);
      const shouldPreserveLegacyMigratedCompletion = Boolean(
        targetContract &&
        targetContext?.executionGraphSnapshot &&
        verificationInputKindMarker(targetContract.verification) === undefined &&
        hasDefaultLegacyMigrationShape(targetContract.verification)
      );
      const shouldContinueGraphWorkflow = Boolean(
        targetContext?.executionGraphSnapshot &&
        !shouldPreserveLegacyMigratedCompletion &&
        resultInput.status === "passed" &&
        isWorkflowTaskResult &&
        workflowContextAfterTaskResult &&
        !hasPendingWorkflowSessions
      );
      const shouldContinueThisWorkflow = Boolean(
        resultInput.status === "passed" &&
        isWorkflowTaskResult &&
        !hasPendingWorkflowSessions &&
        (hasRemainingWorkflowSteps || shouldContinueGraphWorkflow)
      );
      const shouldWaitForPendingWorkflowSessions = Boolean(
        resultInput.status === "passed" &&
        isWorkflowTaskResult &&
        hasRemainingWorkflowSteps &&
        hasPendingWorkflowSessions
      );
      const codexSession = {
        ...run.codexSession,
        status:
          shouldContinueThisWorkflow || shouldWaitForPendingWorkflowSessions
            ? run.codexSession.status === "failed" || run.codexSession.status === "unavailable"
              ? run.codexSession.status
              : "started" as const
          : resultInput.status === "failed"
            ? "failed" as const
            : resultInput.status === "passed"
              ? "completed" as const
              : run.codexSession.status === "requested"
                ? "started" as const
                : run.codexSession.status,
        subagents: updateCodexSessionSubagentsForResult(
          run.codexSession.subagents,
          resultInput,
          subagentStatus,
          isTargeted
        )
      };

      if ((shouldContinueThisWorkflow || shouldWaitForPendingWorkflowSessions) && workflowContextAfterTaskResult) {
        const workflowProgressEvents = shouldWaitForPendingWorkflowSessions && shouldSynthesizeWorkflowEngineEvents
          ? workflowTaskResultEngineEvents({
              events: state.events,
              run,
              runId,
              timestamp,
              input: resultInput
            })
          : [];
        shouldContinueWorkflow = shouldContinueThisWorkflow;
        continuationAttemptId = shouldContinueThisWorkflow ? attemptId : undefined;
        updatedRun = {
          ...run,
          status: "running",
          codexSession,
          updatedAt: timestamp,
          completedAt: undefined
        };

        return {
          ...state,
          runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
          attempts: targetAttempt
            ? state.attempts.map((attempt) =>
                attempt.id === targetAttempt.id
                  ? {
                      ...attempt,
                      status: "running" as const,
                      completedAt: undefined
                    }
                  : attempt
              )
            : state.attempts,
          workflowContexts: state.workflowContexts.map((context) =>
            context.id === workflowContextAfterTaskResult.id ? workflowContextAfterTaskResult : context
          ),
          events: [
            ...state.events,
            ...graphTaskNodeTransitionEvents,
            ...workflowProgressEvents.map((engineEvent) =>
              lifecycleEvent(
                this.nextId("event"),
                runId,
                "note",
                engineEventToMessage(engineEvent),
                engineEvent.createdAt,
                { engineEvent }
              )
            ),
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "note",
              shouldContinueThisWorkflow
                ? "Codex task result recorded; continuing workflow"
                : "Codex task result recorded; waiting for pending workflow sessions",
              timestamp,
              {
                attemptId,
                workflowContextId: workflowContextAfterTaskResult.id,
                pendingSessionIds: workflowContextAfterTaskResult.pendingSessionIds,
                sessionResult: {
                  status: resultInput.status,
                  summary: resultInput.summary,
                  result: resultInput.result
                }
              }
            )
          ]
        };
      }

      if (
        targetContract &&
        usesVerificationV2Runtime(targetContract.verification) &&
        resultInput.status === "passed" &&
        isWorkflowTaskResult &&
        workflowContextAfterTaskResult &&
        !hasRemainingWorkflowSteps &&
        !hasPendingWorkflowSessions
      ) {
        shouldContinueWorkflow = true;
        continuationAttemptId = attemptId;
        updatedRun = {
          ...run,
          status: "running",
          codexSession: {
            ...codexSession,
            status:
              codexSession.status === "failed" || codexSession.status === "unavailable"
                ? codexSession.status
                : "started"
          },
          updatedAt: timestamp,
          completedAt: undefined
        };

        return {
          ...state,
          runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
          attempts: targetAttempt
            ? state.attempts.map((attempt) =>
                attempt.id === targetAttempt.id
                  ? {
                      ...attempt,
                      status: "running" as const,
                      completedAt: undefined
                    }
                  : attempt
              )
            : state.attempts,
          workflowContexts: state.workflowContexts.map((context) =>
            context.id === workflowContextAfterTaskResult.id
              ? {
                  ...workflowContextAfterTaskResult,
                  verification: startWorkflowVerificationState(
                    workflowContextAfterTaskResult.verification,
                    timestamp
                  )
                }
              : context
          ),
          events: [
            ...state.events,
            ...graphTaskNodeTransitionEvents,
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "note",
              "Codex task result recorded; starting v2 verification",
              timestamp,
              {
                attemptId,
                workflowContextId: workflowContextAfterTaskResult.id,
                sessionResult: {
                  status: resultInput.status,
                  summary: resultInput.summary,
                  result: resultInput.result
                }
              }
            )
          ]
        };
      }

      const verification: VerificationResult = {
        id: this.nextId("verification"),
        runId,
        attemptId,
        status: resultInput.status === "needs_human" ? "skipped" : resultInput.status,
        summary: resultInput.summary,
        checks: resultInput.checks ?? [],
        createdAt: timestamp
      };
      const runStatus: RunStatus =
        resultInput.status === "passed" ? "completed" : resultInput.status === "needs_human" ? "waiting_for_human" : "failed";
      const attemptStatus: RunAttempt["status"] =
        resultInput.status === "failed" ? "failed" : resultInput.status === "needs_human" ? "running" : "completed";
      updatedRun = {
        ...run,
        status: runStatus,
        codexSession,
        updatedAt: timestamp,
        ...(runStatus === "completed" || runStatus === "failed" ? { completedAt: timestamp } : {}),
        ...(resultInput.pausedReason ? { pausedReason: resultInput.pausedReason } : {})
      };

      const attempts = targetAttempt
        ? state.attempts.map((attempt) =>
            attempt.id === targetAttempt.id
              ? {
                  ...attempt,
                  status: attemptStatus,
                  summary: resultInput.summary,
                  ...(attemptStatus === "running" ? { completedAt: undefined } : { completedAt: timestamp })
                }
              : attempt
          )
        : [
            ...state.attempts,
            {
              id: attemptId,
              runId,
              status: attemptStatus,
              summary: resultInput.summary,
              createdAt: timestamp,
              ...(attemptStatus === "running" ? {} : { completedAt: timestamp })
            }
          ];
      const humanRequest = resultInput.status === "needs_human"
        ? {
            id: this.nextId("human"),
            runId,
            attemptId,
            workflowContextId: targetContext?.id,
            taskRunId: targetTaskRun?.id,
            sessionId: resultInput.sessionId,
            stepId: resultInput.stepId,
            question: resultInput.humanQuestion ?? resultInput.summary,
            status: "open" as const,
            createdAt: timestamp
          }
        : undefined;
      const workflowCompletionEvents = shouldSynthesizeWorkflowEngineEvents
        ? workflowCompletionEngineEvents({
            events: state.events,
            run,
            runId,
            attemptId,
            timestamp,
            input: resultInput,
            verification
          })
        : [];
      const workflowContexts = targetContext
        ? state.workflowContexts.map((context) =>
            context.id === targetContext.id
              ? completeWorkflowContextFromSessionResult(context, resultInput, timestamp, { finalize: true })
              : context
          )
        : state.workflowContexts;

      const nextState = {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
        attempts,
        workflowContexts,
        verificationResults: [...state.verificationResults, verification],
        humanRequests: humanRequest ? [...state.humanRequests, humanRequest] : state.humanRequests,
        events: [
          ...state.events,
          ...graphTaskNodeTransitionEvents,
          ...workflowCompletionEvents.map((engineEvent) =>
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "note",
              engineEventToMessage(engineEvent),
              engineEvent.createdAt,
              { engineEvent }
            )
          ),
          lifecycleEvent(this.nextId("event"), runId, "verification_recorded", resultInput.summary, timestamp, {
            attemptId,
            verificationId: verification.id,
            sessionResult: {
              status: resultInput.status,
              summary: resultInput.summary,
              result: resultInput.result
            }
          }),
          ...(attemptStatus === "running"
            ? []
            : [
                lifecycleEvent(this.nextId("event"), runId, "attempt_completed", resultInput.summary, timestamp, {
                  attemptId,
                  verificationId: verification.id
                })
              ]),
          ...(runStatus === "completed" || runStatus === "failed"
            ? [
                lifecycleEvent(
                  this.nextId("event"),
                  runId,
                  "run_completed",
                  `Codex session result ${resultInput.status}`,
                  timestamp,
                  {
                    attemptId,
                    verificationId: verification.id
                  }
                )
              ]
            : []),
          ...(humanRequest
            ? [
                lifecycleEvent(
                  this.nextId("event"),
                  runId,
                  "human_request",
                  humanRequest.question,
                  timestamp,
                  { requestId: humanRequest.id }
                )
              ]
            : [])
        ]
      };

      const terminalState = runStatus === "completed" || runStatus === "failed"
        ? applyTerminalRunState(
            nextState,
            run.loopId,
            terminalRunStateOverridesForPausedReason(state, run.loopId, resultInput.pausedReason)
          )
        : nextState;

      if (runStatus !== "failed") {
        return terminalState;
      }

      return resultInput.pausedReason
        ? applyImmediateStopPolicy(terminalState, run.loopId, resultInput.pausedReason, timestamp)
        : applyFailureStopPolicy(terminalState, run.loopId, timestamp);
    });

    if (shouldContinueWorkflow && continuationAttemptId) {
      return this.executeWorkflowAttempt(runId, { attemptId: continuationAttemptId });
    }

    return updatedRun!;
  }

  async completeAttempt(attemptId: string, input: CompleteAttemptInput = {}): Promise<RunAttempt> {
    const timestamp = this.now();
    const status = input.status ?? "completed";
    let completedAttempt: RunAttempt | undefined;

    await this.options.store.updateState((state) => {
      const attempt = requireAttempt(state, attemptId);
      const summary = input.summary ?? attempt.summary;

      if (attempt.completedAt) {
        if (attempt.status === status && attempt.summary === summary) {
          completedAttempt = attempt;
          return state;
        }

        throw new Error(`Attempt already completed: ${attemptId}`);
      }

      completedAttempt = {
        ...attempt,
        status,
        summary,
        completedAt: timestamp
      };

      return {
        ...state,
        attempts: state.attempts.map((candidate) => (candidate.id === attemptId ? completedAttempt! : candidate)),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            attempt.runId,
            "attempt_completed",
            completedAttempt.summary ?? `Attempt ${status}`,
            timestamp
          )
        ]
      };
    });

    return completedAttempt!;
  }

  async appendEvent(runId: string, input: AppendEventInput): Promise<RunEvent> {
    const event: RunEvent = {
      id: this.nextId("event"),
      runId,
      kind: input.kind ?? "note",
      message: input.message,
      createdAt: this.now(),
      data: input.data
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        events: [...state.events, event]
      };
    });

    return event;
  }

  async recordValidatorResult(runId: string, input: RecordValidatorResultInput): Promise<VerificationResultV2> {
    const timestamp = this.now();
    if (!input.idempotencyKey) {
      throw new Error("Validator results require an idempotencyKey");
    }
    const idempotencyKey = input.idempotencyKey;

    let contextAfterWrite: WorkflowContext | undefined;
    let policy: FormalLoopContract["verification"] | undefined;
    let duplicateResultId: string | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const context = findWorkflowContextForValidatorResult(state, runId, input);
      if (input.attemptId && context.attemptId !== input.attemptId) {
        throw new Error(`Workflow context does not belong to attempt: ${context.id}`);
      }
      if (input.sessionId && context.taskRuns.some((taskRun) => taskRun.sessionId === input.sessionId)) {
        throw new Error("Validator result session cannot be a workflow task session");
      }
      const attempt = requireAttempt(state, context.attemptId);
      if (attempt.runId !== runId) {
        throw new Error(`Attempt does not belong to run: ${attempt.id}`);
      }

      const contract = context.contractSnapshot ??
        state.formalContracts.find((candidate) => candidate.id === (context.contractId ?? run.loopId));
      if (!contract) {
        throw new Error(`Loop contract not found: ${context.contractId ?? run.loopId}`);
      }
      if (!usesExternalV2ValidatorWriteback(contract.verification)) {
        throw new Error("Validator results can only be recorded for verification v2 workflows");
      }
      const validator = contract.verification.validators.find((candidate) => candidate.id === input.validatorId);
      if (!validator) {
        throw new Error(`Validator not found: ${input.validatorId}`);
      }
      if (validator.type !== input.result.type) {
        throw new Error(`Validator result type does not match validator: ${input.validatorId}`);
      }

      const verification = context.verification ?? createWorkflowVerificationState(timestamp);
      if (verification.idempotencyKeys.includes(idempotencyKey)) {
        duplicateResultId = verification.resultId;
        contextAfterWrite = context;
        policy = contract.verification;
        return state;
      }
      if (!workflowVerificationAcceptsValidatorWriteback(context, verification)) {
        throw new Error("Workflow verification has not started");
      }
      if (verification.validatorResults.some((result) => result.validatorId === input.validatorId)) {
        throw new Error(`Validator result already recorded: ${input.validatorId}`);
      }

      const validatorResult = recordedRubricAgentResultToValidatorResult(
        validator,
        normalizeRecordedRubricAgentInput(input.result)
      );
      const validatorResults = [...verification.validatorResults, validatorResult];
      const pendingValidatorIds = pendingRubricAgentValidatorIds(contract.verification, {
        ...context,
        verification: {
          ...verification,
          validatorResults
        }
      }).filter((validatorId) => validatorId !== input.validatorId);
      const nextVerification: WorkflowVerificationState = {
        ...verification,
        status: pendingValidatorIds.length > 0 ? "waiting_for_validator" : "running",
        validatorResults,
        pendingValidatorIds,
        idempotencyKeys: appendUnique(verification.idempotencyKeys, idempotencyKey),
        updatedAt: timestamp
      };
      contextAfterWrite = {
        ...context,
        verification: nextVerification,
        updatedAt: timestamp
      };
      policy = contract.verification;

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, context.id, contextAfterWrite!),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            `Validator result recorded: ${input.validatorId}`,
            timestamp,
            {
              attemptId: context.attemptId,
              workflowContextId: context.id,
              validatorId: input.validatorId
            }
          )
        ]
      };
    });

    if (duplicateResultId) {
      const state = await this.options.store.readState();
      const existing = state.verificationResults.find((result) => result.id === duplicateResultId);
      if (existing && isVerificationResultV2(existing)) {
        return existing;
      }
    }

    if (!contextAfterWrite?.verification || !policy) {
      throw new Error("Validator result was not recorded");
    }

    if (contextAfterWrite.verification.pendingValidatorIds.length > 0) {
      return pendingVerificationResultV2(
        this.nextId("verification"),
        runId,
        contextAfterWrite.attemptId,
        contextAfterWrite.verification,
        timestamp
      );
    }

    const result = await runVerificationV2({
      id: this.nextId("verification"),
      runId,
      attemptId: contextAfterWrite.attemptId,
      createdAt: timestamp,
      policy,
      workflowResult: completedWorkflowStepOutputs(contextAfterWrite),
      projectPath: contextAfterWrite.contractSnapshot?.projectBinding?.projectPath,
      priorValidatorResults: contextAfterWrite.verification.validatorResults
    });
    await this.finalizeV2Verification(runId, contextAfterWrite.id, result);

    return result;
  }

  async recordVerification(runId: string, input: RecordVerificationInput): Promise<VerificationResult> {
    const timestamp = this.now();
    const result: VerificationResult = {
      id: this.nextId("verification"),
      runId,
      attemptId: input.attemptId,
      status: input.status,
      summary: input.summary,
      checks: input.checks ?? [],
      createdAt: timestamp
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);
      const shouldRepair = input.repair && input.status === "failed";
      if (input.attemptId) {
        const attempt = requireAttempt(state, input.attemptId);
        if (attempt.runId !== runId) {
          throw new Error(`Attempt does not belong to run: ${input.attemptId}`);
        }
      }
      const repairContext = shouldRepair ? findWorkflowContextForRepair(state, runId, input.attemptId) : undefined;

      return {
        ...state,
        runs:
          shouldRepair
            ? updateRun(state.runs, runId, { status: "repairing", updatedAt: timestamp })
            : state.runs,
        workflowContexts: repairContext
          ? updateWorkflowContext(
              state.workflowContexts,
              repairContext.id,
              repairWorkflowContext(repairContext, input.summary, timestamp)
            )
          : state.workflowContexts,
        verificationResults: [...state.verificationResults, result]
      };
    });

    return result;
  }

  async recordHumanRequest(runId: string, input: RecordHumanRequestInput): Promise<HumanRequest> {
    const timestamp = this.now();
    const request: HumanRequest = {
      id: this.nextId("human"),
      runId,
      question: input.question,
      status: "open",
      createdAt: timestamp
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        runs: updateRun(state.runs, runId, { status: "waiting_for_human", updatedAt: timestamp }),
        humanRequests: [...state.humanRequests, request]
      };
    });

    return request;
  }

  async resolveHumanRequest(requestId: string, input: ResolveHumanRequestInput): Promise<HumanRequest> {
    const timestamp = this.now();
    let resolvedRequest: HumanRequest | undefined;
    let workflowResume:
      | {
          runId: string;
          attemptId?: string;
          workflowContextId: string;
          taskRunId: string;
          sessionId?: string;
          stepId?: string;
        }
      | undefined;

    await this.options.store.updateState((state) => {
      const request = requireHumanRequest(state, requestId);

      if (request.status === "resolved") {
        if (request.response === input.response) {
          resolvedRequest = request;
          return state;
        }

        throw new Error(`Human request already resolved: ${requestId}`);
      }

      resolvedRequest = {
        ...request,
        status: "resolved",
        response: input.response,
        resolvedAt: timestamp
      };
      if (request.workflowContextId && request.taskRunId) {
        workflowResume = {
          runId: request.runId,
          attemptId: request.attemptId,
          workflowContextId: request.workflowContextId,
          taskRunId: request.taskRunId,
          sessionId: request.sessionId,
          stepId: request.stepId
        };
      }

      return {
        ...state,
        humanRequests: state.humanRequests.map((candidate) =>
          candidate.id === requestId ? resolvedRequest! : candidate
        )
      };
    });

    if (workflowResume) {
      await this.recordSessionResult(workflowResume.runId, {
        attemptId: workflowResume.attemptId,
        workflowContextId: workflowResume.workflowContextId,
        taskRunId: workflowResume.taskRunId,
        sessionId: workflowResume.sessionId,
        stepId: workflowResume.stepId,
        idempotencyKey: `human:${requestId}`,
        status: "passed",
        summary: input.summary ?? "Human response recorded.",
        result: input.response
      });
    }

    return resolvedRequest!;
  }

  async readLoopMemory(loopId: string, input: ReadLoopMemoryInput = {}): Promise<LoopMemoryWindow> {
    const state = await this.options.store.readState();
    return loopMemoryWindow(state, loopId, input);
  }

  async commitMemory(loopId: string, input: CommitMemoryInput): Promise<MemoryCommit> {
    const commit: MemoryCommit = {
      id: this.nextId("memory"),
      loopId,
      runId: input.runId,
      summary: input.summary,
      createdAt: this.now()
    };

    await this.options.store.updateState((state) => {
      requireLoop(state, loopId);
      if (input.runId) {
        requireRun(state, input.runId);
      }

      return {
        ...state,
        memoryCommits: [...state.memoryCommits, commit],
        loopMemories: appendLoopMemory(state.loopMemories, loopId, input.summary, commit.createdAt)
      };
    });

    return commit;
  }

  async addArtifact(runId: string, input: AddArtifactInput): Promise<ArtifactRef> {
    const artifact: ArtifactRef = {
      id: this.nextId("artifact"),
      runId,
      title: input.title,
      path: input.path,
      url: input.url,
      kind: input.kind,
      createdAt: this.now()
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        artifacts: [...state.artifacts, artifact]
      };
    });

    return artifact;
  }

  async markRunRepairing(runId: string, input: MarkRunRepairingInput = {}): Promise<LoopRun> {
    const timestamp = this.now();
    let repairingRun: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const repairContext = findWorkflowContextForRepair(state, runId);
      repairingRun = {
        ...run,
        status: "repairing",
        updatedAt: timestamp
      };

      return {
        ...state,
        runs: updateRun(state.runs, runId, { status: "repairing", updatedAt: timestamp }),
        workflowContexts: repairContext
          ? updateWorkflowContext(
              state.workflowContexts,
              repairContext.id,
              repairWorkflowContext(repairContext, input.reason, timestamp)
            )
          : state.workflowContexts,
        events: input.reason
          ? [...state.events, lifecycleEvent(this.nextId("event"), runId, "note", input.reason, timestamp)]
          : state.events
      };
    });

    return repairingRun!;
  }

  async completeRun(runId: string, input: CompleteRunInput = {}): Promise<LoopRun> {
    const timestamp = this.now();
    const status = input.status ?? "completed";
    if ((input.pausedReason as LoopPausedReason | undefined) === "failures") {
      throw new Error("Failure pauses are derived from stopPolicy");
    }
    if (input.pausedReason && status !== "failed") {
      throw new Error("pausedReason can only be recorded for failed runs");
    }
    let completedRun: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      requireRun(state, runId);
      const runs = state.runs.map((run) => {
        if (run.id !== runId) {
          return run;
        }

        const subagentStatus = status === "failed" ? "failed" : "completed";
        const codexSession = run.codexSession
          ? {
              ...run.codexSession,
              status: status === "failed" ? "failed" as const : "completed" as const,
              subagents: run.codexSession.subagents?.map((subagent) => ({
                ...subagent,
                status:
                  subagent.status === "requested" || subagent.status === "running"
                    ? subagentStatus
                    : subagent.status
              }))
            }
          : undefined;

        completedRun = {
          ...run,
          status,
          ...(codexSession ? { codexSession } : {}),
          updatedAt: timestamp,
          completedAt: timestamp,
          ...(input.pausedReason ? { pausedReason: input.pausedReason } : {})
        };

        return completedRun;
      });

      const nextState = {
        ...state,
        runs,
        workflowContexts: completeTerminalWorkflowContextForRun(state, runId, status, timestamp)
      };
      const terminalState = completedRun
        ? applyTerminalRunState(
            nextState,
            completedRun.loopId,
            terminalRunStateOverridesForPausedReason(state, completedRun.loopId, input.pausedReason)
          )
        : nextState;

      if (status !== "failed" || !completedRun) {
        return terminalState;
      }

      return input.pausedReason
        ? applyImmediateStopPolicy(terminalState, completedRun.loopId, input.pausedReason, timestamp)
        : applyFailureStopPolicy(terminalState, completedRun.loopId, timestamp);
    });

    return completedRun!;
  }

  async getRunDetail(runId: string): Promise<RunDetail> {
    const state = await this.options.store.readState();
    const run = requireRun(state, runId);
    const loop = requireLoop(state, run.loopId);

    return {
      run,
      loop,
      attempts: state.attempts.filter((attempt) => attempt.runId === runId),
      events: state.events.filter((event) => event.runId === runId),
      verificationResults: state.verificationResults.filter((result) => result.runId === runId),
      humanRequests: state.humanRequests.filter((request) => request.runId === runId),
      memoryCommits: state.memoryCommits.filter((commit) => commit.runId === runId),
      artifacts: state.artifacts.filter((artifact) => artifact.runId === runId),
      workflowRevisions: state.workflowRevisions.filter((revision) => revision.runId === runId),
      workflowContexts: state.workflowContexts.filter((context) => context.runId === runId)
    };
  }

  async listLoopFiles(loopId: string): Promise<LoopWorkspaceFile[]> {
    const state = await this.options.store.readState();

    return syncLoopWorkspaceDirectory(
      this.options.store.dataDir,
      loopId,
      loopWorkspaceFiles(legacyCompatibleWorkspaceState(state), loopId)
    );
  }

  async getSnapshot(): Promise<Snapshot> {
    const state = await this.options.store.readState();

    return {
      ...state,
      previewUrl: this.getPreviewUrl(),
      codexProjects: this.options.codexProjects ?? []
    };
  }

  getPreviewUrl(): string {
    return this.previewBaseUrl;
  }

  setPreviewUrl(previewUrl: string): void {
    this.previewBaseUrl = previewUrl;
  }

  async proposeWorkflowRevision(loopId: string, input: ProposeWorkflowRevisionInput): Promise<WorkflowRevision> {
    const timestamp = this.now();
    const state = await this.options.store.readState();
    const baseContract = requireFormalContract(state, loopId);
    const { run, attempt } = requireWorkflowRevisionSessionContext(state, loopId, input);
    const reason = input.rationale ?? input.reason;
    if (!reason) {
      throw new Error("Workflow revision rationale is required");
    }
    if (!input.contract && !input.patch) {
      throw new Error("Workflow revision requires a patch or contract");
    }

    const revisionContractInput = input.contract
      ? resolveScriptContractInput({ ...input.contract, id: loopId })
      : resolveScriptContractInput(applyContractPatch(baseContract, input.patch ?? {}));
    const normalized = normalizeFormalContractInput(revisionContractInput, loopId);
    const contract = compileContractWithVerificationInputKind(
      {
        ...normalized,
        id: loopId,
        trigger: normalized.trigger ?? baseContract.trigger,
        repairPolicy: normalized.repairPolicy ?? baseContract.repairPolicy,
        stopPolicy: normalized.stopPolicy ?? baseContract.stopPolicy,
        projectBinding: normalized.projectBinding ?? baseContract.projectBinding,
        status: normalized.status ?? baseContract.status,
        createdAt: baseContract.createdAt,
        updatedAt: timestamp
      },
      timestamp
    );
    validateContract(contract);

    return this.recordWorkflowRevision(run.id, attempt.id, loopId, {
      status: "draft",
      reason,
      contract,
      authorSessionId: input.authorSessionId ?? firstCodexSubagentSessionId(run),
      authorThreadId: input.authorThreadId ?? run.codexSession?.threadId
    });
  }

  async listWorkflowRevisions(loopId: string): Promise<WorkflowRevision[]> {
    const state = await this.options.store.readState();
    requireLoop(state, loopId);
    return state.workflowRevisions.filter((revision) => revision.loopId === loopId);
  }

  async promoteWorkflowRevision(
    loopId: string,
    revisionId: string,
    input: PromoteWorkflowRevisionInput
  ): Promise<WorkflowRevision> {
    const timestamp = this.now();
    let promotedRevision: WorkflowRevision | undefined;

    await this.options.store.updateState((state) => {
      requireLoop(state, loopId);
      const revision = requireWorkflowRevision(state, loopId, revisionId);
      const { attempt } = requireWorkflowRevisionSessionContext(state, loopId, input, revision);
      if (revision.status === "rejected") {
        throw new Error(`Cannot promote rejected workflow revision: ${revisionId}`);
      }
      const contract: FormalLoopContract = {
        ...revision.contract,
        id: loopId,
        status: "active",
        updatedAt: timestamp
      };
      validateContract(contract);
      promotedRevision = {
        ...revision,
        status: "promoted",
        promotedAt: timestamp,
        rejectedAt: undefined,
        rejectionReason: undefined
      };
      const hasExistingContract = state.formalContracts.some((candidate) => candidate.id === loopId);

      return {
        ...state,
        formalContracts: hasExistingContract
          ? state.formalContracts.map((candidate) => (candidate.id === loopId ? contract : candidate))
          : [...state.formalContracts, contract],
        loops: state.loops.map((loop) => (loop.id === loopId ? formalContractToLoop(contract) : loop)),
        workflowRevisions: state.workflowRevisions.map((candidate) => {
          if (candidate.id === revisionId) {
            return promotedRevision!;
          }
          if (candidate.loopId === loopId && candidate.status === "promoted") {
            return { ...candidate, status: "superseded" as const };
          }
          return candidate;
        }),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            revision.runId,
            "note",
            "Promoted workflow revision",
            timestamp,
            { workflowRevisionId: revision.id, loopId, activeRevisionId: revision.id, attemptId: attempt.id }
          )
        ]
      };
    });

    return promotedRevision!;
  }

  async rejectWorkflowRevision(
    loopId: string,
    revisionId: string,
    input: RejectWorkflowRevisionInput
  ): Promise<WorkflowRevision> {
    const timestamp = this.now();
    let rejectedRevision: WorkflowRevision | undefined;

    await this.options.store.updateState((state) => {
      requireLoop(state, loopId);
      const revision = requireWorkflowRevision(state, loopId, revisionId);
      const { attempt } = requireWorkflowRevisionSessionContext(state, loopId, input, revision);
      if (revision.status !== "draft") {
        throw new Error(`Only draft workflow revisions can be rejected: ${revisionId}`);
      }
      rejectedRevision = {
        ...revision,
        status: "rejected",
        rejectedAt: timestamp,
        rejectionReason: input.reason
      };

      return {
        ...state,
        workflowRevisions: state.workflowRevisions.map((candidate) =>
          candidate.id === revisionId ? rejectedRevision! : candidate
        ),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            revision.runId,
            "note",
            "Rejected workflow revision",
            timestamp,
            { workflowRevisionId: revision.id, loopId, attemptId: attempt.id, reason: input.reason }
          )
        ]
      };
    });

    return rejectedRevision!;
  }

  private async recordCompletedCodexSessions(runId: string, engineEvents: EngineEvent[]): Promise<LoopRun> {
    const sessions = engineEvents
      .filter((event): event is Extract<EngineEvent, { type: "agent_done" }> => event.type === "agent_done")
      .map((event) => event.session)
      .filter(isCompletedCodexSession);

    if (sessions.length === 0) {
      return (await this.getRunDetail(runId)).run;
    }

    const timestamp = this.now();
    let updatedRun: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const latestSession = sessions.at(-1)!;
      const existingSubagents = run.codexSession?.subagents ?? [];
      const completedSubagents = sessions.map((session) => ({
        role: session.title,
        status: codexSubagentStatus(session.status),
        sessionId: session.sessionId,
        stepId: session.stepId,
        phaseId: session.phaseId,
        threadId: session.threadId,
        threadTitle: session.threadTitle,
        threadUrl: session.threadUrl,
        prompt: session.prompt,
        subagent: session.subagent,
        agentProfile: session.agentProfile,
        profilePreflight: profilePreflightForStep(run.codexSession?.profilePreflight, session.stepId, session.agentProfile)
      }));

      updatedRun = {
        ...run,
        codexSession: {
          mode: "new_session",
          status: latestSession.status,
          threadId: latestSession.threadId ?? run.codexSession?.threadId,
          threadTitle: latestSession.threadTitle ?? run.codexSession?.threadTitle,
          threadUrl: latestSession.threadUrl ?? run.codexSession?.threadUrl,
          codexProjectId: latestSession.projectId ?? run.codexSession?.codexProjectId ?? run.codexProjectId,
          projectLabel: latestSession.projectLabel ?? run.codexSession?.projectLabel ?? run.projectLabel,
          projectPath: latestSession.projectPath ?? run.codexSession?.projectPath ?? run.projectPath,
          subagents: mergeCodexSessionSubagents(existingSubagents, completedSubagents),
          profilePreflight: run.codexSession?.profilePreflight,
          prompt: latestSession.prompt ?? run.codexSession?.prompt ?? run.goal
        },
        updatedAt: timestamp
      };

      return {
        ...state,
        runs: updateRun(state.runs, runId, updatedRun),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            "Codex worker session completed and attached to this run",
            timestamp,
            { codexSessions: sessions }
          )
        ]
      };
    });

    return updatedRun!;
  }

  private async recordEngineEvents(runId: string, engineEvents: EngineEvent[]): Promise<void> {
    if (engineEvents.length === 0) return;
    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        events: [
          ...state.events,
          ...engineEvents.map((engineEvent) =>
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "note",
              engineEventToMessage(engineEvent),
              engineEvent.createdAt,
              { engineEvent }
            )
          )
        ]
      };
    });
  }

  private async recordWorkflowRevision(
    runId: string,
    attemptId: string | undefined,
    loopId: string,
    input: Pick<WorkflowRevision, "status" | "reason" | "contract"> &
      Pick<Partial<WorkflowRevision>, "authorSessionId" | "authorThreadId">
  ): Promise<WorkflowRevision> {
    const timestamp = this.now();
    const revision: WorkflowRevision = {
      id: this.nextId("revision"),
      loopId,
      runId,
      attemptId,
      authorSessionId: input.authorSessionId,
      authorThreadId: input.authorThreadId,
      status: input.status,
      reason: input.reason,
      contract: input.contract,
      createdAt: timestamp
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
        workflowRevisions: [...state.workflowRevisions, revision],
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            `Created ${revision.status} workflow revision`,
            timestamp,
            { workflowRevisionId: revision.id, attemptId, reason: revision.reason }
          )
        ]
      };
    });

    return revision;
  }

  private async recordVerificationV2Result(runId: string, result: VerificationResultV2): Promise<VerificationResultV2> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      requireRun(state, runId);
      const existing = state.verificationResults.find((candidate) => candidate.id === result.id);
      if (existing) {
        if (isVerificationResultV2(existing)) {
          return state;
        }
        throw new Error(`Verification result id already exists: ${result.id}`);
      }

      return {
        ...state,
        verificationResults: [...state.verificationResults, result],
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), runId, "verification_recorded", result.summary, timestamp, {
            attemptId: result.attemptId,
            verificationId: result.id,
            verificationVersion: 2,
            decision: result.decision
          })
        ]
      };
    });

    return result;
  }

  private async finalizeV2Verification(
    runId: string,
    workflowContextId: string,
    result: VerificationResultV2
  ): Promise<LoopRun> {
    await this.recordVerificationV2Result(runId, result);
    await this.markWorkflowVerificationCompleted(workflowContextId, result);

    const state = await this.options.store.readState();
    const run = requireRun(state, runId);
    const context = requireWorkflowContext(state, workflowContextId);
    const contract = context.contractSnapshot ?? requireFormalContract(state, run.loopId);
    const attemptsForRun = state.attempts.filter((attempt) => attempt.runId === runId);
    const attemptNumber = Math.max(1, attemptsForRun.findIndex((attempt) => attempt.id === context.attemptId) + 1);

    if (result.status === "failed" && shouldRepair(result.decision, contract.repairPolicy, attemptNumber)) {
      await this.markRunRepairing(runId, { reason: repairReasonForV2Result(result) });
      return (await this.getRunDetail(runId)).run;
    }

    if (result.status === "passed") {
      await this.completeWorkflowContext(workflowContextId);
      await this.completeAttempt(context.attemptId, {
        status: "completed",
        summary: result.summary
      });
      return this.completeRun(runId, { status: "completed" });
    }

    if (result.status === "needs_human") {
      await this.completeWorkflowContext(workflowContextId);
      await this.completeAttempt(context.attemptId, {
        status: "completed",
        summary: result.summary
      });
      await this.recordHumanRequest(runId, {
        question: result.humanQuestion ?? result.decision.humanQuestion ?? result.summary
      });
      return (await this.getRunDetail(runId)).run;
    }

    await this.failWorkflowContext(workflowContextId, result.summary);
    await this.completeAttempt(context.attemptId, {
      status: "failed",
      summary: result.summary
    });
    return this.completeRun(runId, { status: "failed" });
  }

  private async startPendingRubricAgentValidators(
    run: LoopRun,
    context: WorkflowContext,
    policy: FormalLoopContract["verification"]
  ): Promise<void> {
    const timestamp = this.now();
    const pendingValidatorIds = pendingRubricAgentValidatorIds(policy, context);
    if (pendingValidatorIds.length === 0) {
      return;
    }

    await this.options.store.updateState((state) => {
      requireRun(state, run.id);
      const currentContext = requireWorkflowContext(state, context.id);
      const verification = currentContext.verification ?? createWorkflowVerificationState(timestamp);

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, currentContext.id, {
          ...currentContext,
          verification: {
            ...verification,
            status: "waiting_for_validator",
            pendingValidatorIds,
            updatedAt: timestamp
          },
          updatedAt: timestamp,
          completedAt: undefined
        }),
        events: [
          ...state.events,
          ...pendingValidatorIds.map((validatorId) =>
            lifecycleEvent(this.nextId("event"), run.id, "note", `Waiting for validator result: ${validatorId}`, timestamp, {
              attemptId: context.attemptId,
              workflowContextId: context.id,
              validatorId
            })
          )
        ]
      };
    });
  }

  private async markWorkflowVerificationCompleted(
    workflowContextId: string,
    result: VerificationResultV2
  ): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const verification = context.verification ?? createWorkflowVerificationState(timestamp);

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
          ...context,
          verification: {
            ...verification,
            status: result.status === "failed" ? "failed" : "completed",
            validatorResults: result.validatorResults,
            pendingValidatorIds: [],
            decision: result.decision,
            resultId: result.id,
            updatedAt: timestamp
          },
          updatedAt: timestamp
        })
      };
    });
  }

  private async prepareWorkflowContext(
    runId: string,
    attemptId: string,
    contract: FormalLoopContract
  ): Promise<WorkflowContext> {
    const timestamp = this.now();
    let preparedContext: WorkflowContext | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const attempt = requireAttempt(state, attemptId);
      const existingContext = state.workflowContexts.find(
        (context) => context.runId === runId && context.attemptId === attemptId
      );
      const existingContextWithGraph = existingContext
        ? ensureWorkflowContextGraphState(existingContext, contract, {
            graphSnapshotId: existingContext.executionGraphSnapshot ? existingContext.executionGraphSnapshot.snapshotId : this.nextId("graph"),
            timestamp
          })
        : undefined;
      preparedContext = existingContext
        ? {
            ...existingContextWithGraph!,
            status: "running",
            cursor: {
              ...existingContext.cursor,
              state: "executing"
            },
            updatedAt: timestamp,
            completedAt: undefined
          }
        : {
            ...createWorkflowContext({
              id: this.nextId("workflow"),
              run,
              attempt,
              contract,
              graphSnapshotId: this.nextId("graph"),
              timestamp
            }),
            status: "running",
            cursor: { state: "executing" }
          };

      return {
        ...state,
        workflowContexts: existingContext
          ? state.workflowContexts.map((context) => (context.id === existingContext.id ? preparedContext! : context))
          : [...state.workflowContexts, preparedContext]
      };
    });

    return preparedContext!;
  }

  private async markWorkflowTaskRunning(
    workflowContextId: string,
    input: {
      runId: string;
      attemptId: string;
      stepId?: string;
      phaseId?: string;
      label?: string;
      prompt?: string;
      subagent?: AgentRequest["subagent"];
      agentProfile?: AgentRequest["agentProfile"];
      profilePreflight?: SkillPreflightReport;
    }
  ): Promise<string> {
    const timestamp = this.now();
    const taskRunId = this.nextId("task");
    const stepId = input.stepId ?? taskRunId;

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun: WorkflowTaskRun = {
        id: taskRunId,
        runId: input.runId,
        attemptId: input.attemptId,
        stepId,
        phaseId: input.phaseId,
        label: input.label,
        prompt: input.prompt,
        subagent: input.subagent,
        agentProfile: input.agentProfile,
        profilePreflight: input.profilePreflight,
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const nextContext = updateNodeRunForTaskRunning(
        {
          ...context,
          status: "running",
          cursor: {
            state: "executing",
            stepId,
            phaseId: input.phaseId
          },
          steps: {
            ...context.steps,
            [stepId]: {
              status: "running",
              updatedAt: timestamp
            }
          },
          taskRuns: [...context.taskRuns, taskRun],
          updatedAt: timestamp,
          completedAt: undefined
        },
        { stepId, taskRunId, timestamp }
      );

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });

    return taskRunId;
  }

  private async attachWorkflowTaskSession(
    workflowContextId: string,
    taskRunId: string,
    session: CodexSessionRef
  ): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = requireWorkflowTaskRun(context, taskRunId);
      const stepId = session.stepId ?? taskRun.stepId;
      const nextContext = updateNodeRunForTaskSession(
        {
          ...context,
          cursor: {
            state: "executing",
            stepId,
            phaseId: session.phaseId ?? taskRun.phaseId,
            sessionId: session.sessionId
          },
          steps: {
            ...context.steps,
            [stepId]: {
              status: "running",
              sessionId: session.sessionId,
              updatedAt: timestamp
            }
          },
          taskRuns: context.taskRuns.map((candidate) =>
            candidate.id === taskRunId
              ? {
                  ...candidate,
                  stepId,
                  phaseId: session.phaseId ?? candidate.phaseId,
                  sessionId: session.sessionId,
                  agentProfile: candidate.agentProfile ?? session.agentProfile,
                  updatedAt: timestamp
                }
              : candidate
          ),
          updatedAt: timestamp
        },
        { stepId, taskRunId, sessionId: session.sessionId, timestamp }
      );

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });
  }

  private async suspendWorkflowTaskForSession(
    workflowContextId: string,
    taskRunId: string,
    session: CodexSessionRef
  ): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = requireWorkflowTaskRun(context, taskRunId);
      const stepId = session.stepId ?? taskRun.stepId;
      const nextContext = updateNodeRunForTaskWaitingForSession(
        {
          ...context,
          status: "suspended",
          cursor: {
            state: "waiting_for_session",
            stepId,
            phaseId: session.phaseId ?? taskRun.phaseId,
            sessionId: session.sessionId
          },
          steps: {
            ...context.steps,
            [stepId]: {
              status: "suspended",
              sessionId: session.sessionId,
              updatedAt: timestamp
            }
          },
          taskRuns: context.taskRuns.map((candidate) =>
            candidate.id === taskRunId
              ? {
                  ...candidate,
                  stepId,
                  phaseId: session.phaseId ?? candidate.phaseId,
                  sessionId: session.sessionId,
                  status: "suspended",
                  updatedAt: timestamp
                }
              : candidate
          ),
          pendingSessionIds: appendUnique(context.pendingSessionIds, session.sessionId),
          updatedAt: timestamp
        },
        { stepId, taskRunId, sessionId: session.sessionId, timestamp }
      );

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });
  }

  private async suspendWorkflowContextForSession(workflowContextId: string, session: CodexSessionRef): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = context.taskRuns.find((candidate) => candidate.sessionId === session.sessionId);
      const stepId = session.stepId ?? taskRun?.stepId;
      if (!stepId) return state;
      const nextContextBase: WorkflowContext = {
        ...context,
        status: "suspended",
        cursor: {
          state: "waiting_for_session",
          stepId,
          phaseId: session.phaseId ?? taskRun?.phaseId,
          sessionId: session.sessionId
        },
        steps: {
          ...context.steps,
          [stepId]: {
            status: "suspended",
            sessionId: session.sessionId,
            updatedAt: timestamp
          }
        },
        taskRuns: context.taskRuns.map((candidate) =>
          candidate.sessionId === session.sessionId
            ? {
                ...candidate,
                status: "suspended",
                updatedAt: timestamp
              }
            : candidate
        ),
        pendingSessionIds: appendUnique(context.pendingSessionIds, session.sessionId),
        updatedAt: timestamp
      };
      const nextContext = taskRun
        ? updateNodeRunForTaskWaitingForSession(nextContextBase, {
            stepId,
            taskRunId: taskRun.id,
            sessionId: session.sessionId,
            timestamp
          })
        : nextContextBase;

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });
  }

  private async completeWorkflowTask(
    workflowContextId: string,
    taskRunId: string,
    result: string
  ): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = requireWorkflowTaskRun(context, taskRunId);
      const nextContext = updateNodeRunForTaskResult(
        {
          ...context,
          steps: {
            ...context.steps,
            [taskRun.stepId]: {
              status: "completed",
              sessionId: taskRun.sessionId,
              output: result,
              updatedAt: timestamp
            }
          },
          taskRuns: context.taskRuns.map((candidate) =>
            candidate.id === taskRunId
              ? {
                  ...candidate,
                  status: "completed",
                  result,
                  updatedAt: timestamp,
                  completedAt: timestamp
                }
              : candidate
          ),
          pendingSessionIds: taskRun.sessionId
            ? context.pendingSessionIds.filter((sessionId) => sessionId !== taskRun.sessionId)
            : context.pendingSessionIds,
          updatedAt: timestamp
        },
        {
          stepId: taskRun.stepId,
          taskRunId,
          sessionId: taskRun.sessionId,
          status: "passed",
          result,
          summary: result,
          timestamp
        }
      );

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });
  }

  private async failWorkflowTask(workflowContextId: string, taskRunId: string, error: string): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = requireWorkflowTaskRun(context, taskRunId);
      const nextContext = updateNodeRunForTaskResult(
        {
          ...context,
          status: "failed",
          cursor: {
            state: "failed",
            stepId: taskRun.stepId,
            phaseId: taskRun.phaseId,
            sessionId: taskRun.sessionId
          },
          steps: {
            ...context.steps,
            [taskRun.stepId]: {
              status: "failed",
              sessionId: taskRun.sessionId,
              error,
              updatedAt: timestamp
            }
          },
          taskRuns: context.taskRuns.map((candidate) =>
            candidate.id === taskRunId
              ? {
                  ...candidate,
                  status: "failed",
                  error,
                  updatedAt: timestamp,
                  completedAt: timestamp
                }
              : candidate
          ),
          pendingSessionIds: taskRun.sessionId
            ? context.pendingSessionIds.filter((sessionId) => sessionId !== taskRun.sessionId)
            : context.pendingSessionIds,
          updatedAt: timestamp,
          completedAt: timestamp
        },
        {
          stepId: taskRun.stepId,
          taskRunId,
          sessionId: taskRun.sessionId,
          status: "failed",
          result: error,
          summary: error,
          timestamp
        }
      );

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, nextContext)
      };
    });
  }

  private async completeWorkflowContext(workflowContextId: string): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
          ...context,
          status: "completed",
          cursor: { state: "completed" },
          pendingSessionIds: [],
          updatedAt: timestamp,
          completedAt: timestamp
        })
      };
    });
  }

  private async markWorkflowContextRepairing(workflowContextId: string, reason: string): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);

      return {
        ...state,
        workflowContexts: updateWorkflowContext(
          state.workflowContexts,
          workflowContextId,
          repairWorkflowContext(context, reason, timestamp)
        )
      };
    });
  }

  private async failWorkflowContext(workflowContextId: string, error: string): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const currentStepId = context.cursor.stepId;

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
          ...context,
          status: "failed",
          cursor: {
            ...context.cursor,
            state: "failed"
          },
          steps: currentStepId
            ? {
                ...context.steps,
                [currentStepId]: {
                  ...context.steps[currentStepId],
                  status: "failed",
                  error,
                  updatedAt: timestamp
                }
              }
            : context.steps,
          pendingSessionIds: [],
          updatedAt: timestamp,
          completedAt: timestamp
        })
      };
    });
  }
}

function createWorkflowContext(input: {
  id: string;
  run: LoopRun;
  attempt: RunAttempt;
  contract?: FormalLoopContract;
  graphSnapshotId?: string;
  timestamp: string;
}): WorkflowContext {
  const baseContext: WorkflowContext = {
    id: input.id,
    runId: input.run.id,
    loopId: input.run.loopId,
    attemptId: input.attempt.id,
    contractId: input.contract?.id,
    contractSnapshot: input.contract,
    status: "ready",
    cursor: { state: "created" },
    vars: {},
    steps: {},
    taskRuns: [],
    verification: createWorkflowVerificationState(input.timestamp),
    pendingSessionIds: [],
    idempotencyKeys: [],
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  };

  return input.contract && input.graphSnapshotId
    ? ensureWorkflowContextGraphState(baseContext, input.contract, {
        graphSnapshotId: input.graphSnapshotId,
        timestamp: input.timestamp
      })
    : baseContext;
}

function ensureWorkflowContextGraphState(
  context: WorkflowContext,
  contract: FormalLoopContract,
  input: {
    graphSnapshotId: string;
    timestamp: string;
  }
): WorkflowContext {
  if (context.executionGraphSnapshot && context.nodeRuns) {
    return context;
  }

  const snapshot = compileExecutionGraph({
    contract,
    runId: context.runId,
    attemptId: context.attemptId,
    workflowContextId: context.id,
    compiledAt: input.timestamp,
    snapshotId: input.graphSnapshotId,
    ...(context.contractRevisionId ? { contractRevisionId: context.contractRevisionId } : {})
  });

  return {
    ...context,
    contractId: context.contractId ?? contract.id,
    contractSnapshot: context.contractSnapshot ?? contract,
    executionGraphSnapshot: snapshot,
    nodeRuns: createInitialNodeRuns(snapshot, input.timestamp)
  };
}

function createWorkflowVerificationState(timestamp: string): WorkflowVerificationState {
  return {
    status: "not_started",
    validatorResults: [],
    pendingValidatorIds: [],
    idempotencyKeys: [],
    updatedAt: timestamp
  };
}

function startWorkflowVerificationState(
  existing: WorkflowVerificationState | undefined,
  timestamp: string
): WorkflowVerificationState {
  const verification = existing ?? createWorkflowVerificationState(timestamp);
  return {
    ...verification,
    status: "running",
    updatedAt: timestamp
  };
}

function workflowVerificationAcceptsValidatorWriteback(
  context: WorkflowContext,
  verification: WorkflowVerificationState
): boolean {
  return (
    (verification.status === "running" || verification.status === "waiting_for_validator") &&
    workflowContextHasCompletedVerifiableWork(context)
  );
}

function workflowContextHasCompletedVerifiableWork(context: WorkflowContext): boolean {
  return (
    Object.values(context.steps).some((step) => step.status === "completed" && step.output !== undefined) ||
    context.taskRuns.some((taskRun) => taskRun.status === "completed" && taskRun.result !== undefined)
  );
}

function completedWorkflowStepOutputs(context: WorkflowContext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context.steps)
      .filter(([, step]) => step.status === "completed" && step.output !== undefined)
      .map(([stepId, step]) => [stepId, step.output as string])
  );
}

function pendingRubricAgentValidatorIds(
  policy: FormalLoopContract["verification"],
  context: WorkflowContext
): string[] {
  const recordedValidatorIds = new Set(
    (context.verification?.validatorResults ?? []).map((result) => result.validatorId)
  );

  return policy.validators
    .filter((validator) => validator.type === "rubric_agent" && !recordedValidatorIds.has(validator.id))
    .map((validator) => validator.id);
}

function usesVerificationV2Runtime(policy: FormalLoopContract["verification"]): boolean {
  return policy.version === 2 && !isLegacyCompatibleVerificationPolicy(policy);
}

function usesExternalV2ValidatorWriteback(policy: FormalLoopContract["verification"]): boolean {
  return usesVerificationV2Runtime(policy) && policy.validators.some((validator) => validator.type === "rubric_agent");
}

function isLegacyCompatibleVerificationPolicy(policy: FormalLoopContract["verification"]): boolean {
  const marker = verificationInputKindMarker(policy);
  if (marker === "legacy") return true;
  if (marker === "v2") return false;

  return hasDefaultLegacyMigrationShape(policy);
}

function legacyCompatibleRunnerContract(contract: FormalLoopContract): FormalLoopContract {
  if (!isLegacyCompatibleVerificationPolicy(contract.verification)) return contract;

  return {
    ...contract,
    verification: legacyVerificationFromMigratedV2(contract.verification) as unknown as FormalLoopContract["verification"]
  };
}

function legacyCompatibleWorkspaceState(state: LoopState): LoopState {
  return {
    ...state,
    formalContracts: state.formalContracts.map(legacyCompatibleRunnerContract)
  };
}

function legacyVerificationFromMigratedV2(policy: VerificationPolicyV2): LegacyVerificationPolicy {
  return {
    mode: policy.mode === "after_each_step" ? "after_each_agent" : "after_workflow",
    rubrics: policy.criteria.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      requirement: criterion.description,
      severity: criterion.severity
    }))
  };
}

function hasDefaultLegacyMigrationShape(policy: FormalLoopContract["verification"]): boolean {
  if (policy.version !== 2) return false;
  if (policy.criteria.length === 0 && policy.validators.length === 0) return true;
  if (policy.validators.length !== 1) return false;

  const validator = policy.validators[0];
  return (
    validator.type === "rubric_agent" &&
    validator.id === "rubric-agent" &&
    validator.label === "Rubric review" &&
    validator.scoreScale.min === 0 &&
    validator.scoreScale.max === 1 &&
    validator.passScore === 1 &&
    validator.evidenceRequired === true &&
    validator.severity === "must" &&
    sameStringSet(validator.criteriaIds, policy.criteria.map((criterion) => criterion.id))
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

function hasOpenWorkflowSessions(context: WorkflowContext): boolean {
  return context.pendingSessionIds.length > 0 ||
    context.taskRuns.some((taskRun) => taskRun.status === "running" || taskRun.status === "suspended");
}

function canUseGraphScheduler(snapshot: ExecutionGraphSnapshot): boolean {
  return snapshot.compilerVersion === 1;
}

function containerTransitionEngineEvents(
  snapshot: ExecutionGraphSnapshot,
  previousNodeRuns: WorkflowNodeRun[],
  nextNodeRuns: WorkflowNodeRun[],
  nextEngineEvent: <TEvent extends EngineEvent>(event: Omit<TEvent, "runId" | "createdAt" | "sequence">) => TEvent
): EngineEvent[] {
  const previousByNodeId = new Map(previousNodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const nextByNodeId = new Map(nextNodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const events: EngineEvent[] = [];

  for (const node of [...snapshot.nodes].sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId))) {
    const previousStatus = previousByNodeId.get(node.nodeId)?.status;
    const nextStatus = nextByNodeId.get(node.nodeId)?.status;
    if (previousStatus === nextStatus) {
      continue;
    }

    if (node.kind === "phase") {
      const phaseId = node.sourceStepId ?? node.nodeId;
      const pipeline = node.pipeline === true ? true : undefined;
      if (nextStatus === "running") {
        events.push(
          nextEngineEvent<Extract<EngineEvent, { type: "phase_started" }>>({
            type: "phase_started",
            label: node.label,
            title: node.label,
            phaseId,
            pipeline
          })
        );
      }
      if (nextStatus === "completed") {
        events.push(
          nextEngineEvent<Extract<EngineEvent, { type: "phase_done" }>>({
            type: "phase_done",
            phaseId,
            title: node.label,
            status: "ok",
            pipeline
          })
        );
      }
    }

    if (node.kind === "parallel") {
      const count = snapshot.edges.filter((edge) => edge.kind === "contains" && edge.fromNodeId === node.nodeId).length;
      if (nextStatus === "running") {
        events.push(
          nextEngineEvent<Extract<EngineEvent, { type: "parallel_started" }>>({
            type: "parallel_started",
            label: node.label,
            count
          })
        );
      }
      if (nextStatus === "completed") {
        events.push(
          nextEngineEvent<Extract<EngineEvent, { type: "parallel_completed" }>>({
            type: "parallel_completed",
            label: node.label,
            count
          })
        );
      }
    }
  }

  return events;
}

function validateWorkflowSessionResultTarget(
  context: WorkflowContext,
  input: RecordSessionResultInput
): WorkflowTaskRun | undefined {
  if (context.taskRuns.length === 0) return undefined;

  const hasTaskLocator = hasWorkflowTaskLocator(input);
  const incompleteTaskRuns = context.taskRuns.filter(
    (taskRun) => taskRun.status === "running" || taskRun.status === "suspended"
  );

  if (!input.idempotencyKey) {
    throw new Error("Workflow task session results require an idempotencyKey");
  }
  if (incompleteTaskRuns.length > 1 && !hasTaskLocator) {
    throw new Error("Multiple workflow task runs are pending; provide taskRunId, sessionId, or stepId");
  }
  if (!hasTaskLocator) {
    return incompleteTaskRuns.length === 1 ? incompleteTaskRuns[0] : undefined;
  }

  const targetTaskRun = context.taskRuns.find((taskRun) => matchesWorkflowTaskRun(taskRun, input));
  if (!targetTaskRun) {
    if (context.taskRuns.some((taskRun) => partiallyMatchesWorkflowTaskRun(taskRun, input))) {
      throw new Error("Workflow task run locator fields disagree");
    }
    throw new Error("Workflow task run not found for session result");
  }

  return targetTaskRun;
}

function hasRemainingExecutableSteps(contract: FormalLoopContract, context: WorkflowContext): boolean {
  const completedSteps = new Set(Object.keys(completedWorkflowStepOutputs(context)));
  return executableWorkflowStepIds(contract.body.steps).some((stepId) => !completedSteps.has(stepId));
}

function executableWorkflowStepIds(steps: FormalLoopContract["body"]["steps"]): string[] {
  return steps.flatMap((step) => {
    if (step.kind === "agent" || step.kind === "task") {
      return [step.id];
    }

    return executableWorkflowStepIds(step.children);
  });
}

function requireLoop(state: LoopState, loopId: string): LoopContract {
  const loop = state.loops.find((candidate) => candidate.id === loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  return loop;
}

function requireFormalContract(state: LoopState, loopId: string): FormalLoopContract {
  const contract = (state.formalContracts ?? []).find((candidate) => candidate.id === loopId);
  if (!contract) {
    throw new Error(`Loop contract not found: ${loopId}`);
  }

  return contract;
}

function requireWorkflowRevision(state: LoopState, loopId: string, revisionId: string): WorkflowRevision {
  const revision = state.workflowRevisions.find(
    (candidate) => candidate.loopId === loopId && candidate.id === revisionId
  );
  if (!revision) {
    throw new Error(`Workflow revision not found: ${revisionId}`);
  }

  return revision;
}

function requireWorkflowRevisionSessionContext(
  state: LoopState,
  loopId: string,
  input: { runId?: string; attemptId?: string } | undefined,
  revision?: WorkflowRevision
): { run: LoopRun; attempt: RunAttempt } {
  if (!input?.runId || !input.attemptId) {
    throw new Error("Workflow revision context requires runId and attemptId");
  }

  const run = requireRun(state, input.runId);
  if (run.loopId !== loopId) {
    throw new Error(`Run does not belong to loop: ${run.id}`);
  }
  if (!run.codexSession) {
    throw new Error(`Workflow revision context must be a Codex session run: ${run.id}`);
  }

  const attempt = requireAttempt(state, input.attemptId);
  if (attempt.runId !== run.id) {
    throw new Error(`Attempt does not belong to run: ${attempt.id}`);
  }

  if (revision) {
    if (revision.runId !== run.id) {
      throw new Error(`Workflow revision does not belong to run: ${revision.id}`);
    }
    if (revision.attemptId && revision.attemptId !== attempt.id) {
      throw new Error(`Workflow revision does not belong to attempt: ${revision.id}`);
    }
  }

  return { run, attempt };
}

// If the input carries a `script` (JSON builder-call AST), evaluate it through the
// pure builders to produce body.steps + folded budget, then drop the script field so
// the rest of the pipeline sees an ordinary raw-Step[] contract input.
function resolveScriptContractInput(input: CreateLoopContractInput): CreateLoopContractInput & { body: FormalLoopContractInput["body"] } {
  const { script, ...rest } = input;
  if (!script) {
    if (!rest.body) {
      throw new Error("Loop contract requires body.steps or a script");
    }
    return rest as CreateLoopContractInput & { body: FormalLoopContractInput["body"] };
  }
  if (rest.body) {
    throw new Error("Loop contract cannot include both body and script");
  }
  const built = evalScriptAst(script);
  return {
    ...rest,
    body: { steps: built.steps },
    ...(built.budgetUsd !== undefined && rest.budgetUsd === undefined ? { budgetUsd: built.budgetUsd } : {})
  } as CreateLoopContractInput & { body: FormalLoopContractInput["body"] };
}

function normalizeFormalContractInput(input: CreateLoopContractInput, id: string): FormalLoopContractInput {
  const { codexProjectId, projectLabel, projectPath, projectBinding, script, body, ...contractInput } = input;
  void script;
  if (!body) {
    throw new Error("Loop contract requires body.steps");
  }
  const normalizedProjectBinding = {
    codexProjectId: projectBinding?.codexProjectId ?? codexProjectId,
    projectLabel: projectBinding?.projectLabel ?? projectLabel,
    projectPath: projectBinding?.projectPath ?? projectPath
  };
  const hasProjectBinding = Object.values(normalizedProjectBinding).some(Boolean);

  return {
    ...contractInput,
    body,
    id,
    ...(hasProjectBinding ? { projectBinding: normalizedProjectBinding } : {})
  };
}

function compileContractWithVerificationInputKind(
  input: FormalLoopContractInput,
  timestamp: string
): FormalLoopContract {
  return withVerificationInputKind(compileContract(input, timestamp), verificationInputKind(input.verification));
}

function verificationInputKind(
  verification: FormalLoopContractInput["verification"] | FormalLoopContract["verification"]
): VerificationInputKind {
  const existing = verificationInputKindMarker(verification);
  if (existing === "legacy" || existing === "v2") return existing;

  return "version" in verification && verification.version === 2 ? "v2" : "legacy";
}

function verificationInputKindMarker(
  verification: FormalLoopContractInput["verification"] | FormalLoopContract["verification"]
): VerificationInputKind | undefined {
  return (verification as Partial<VerificationPolicyWithInputKind>)[VERIFICATION_INPUT_KIND_FIELD];
}

function withVerificationInputKind(
  contract: FormalLoopContract,
  inputKind: VerificationInputKind
): FormalLoopContract {
  return {
    ...contract,
    verification: {
      ...contract.verification,
      [VERIFICATION_INPUT_KIND_FIELD]: inputKind
    } as FormalLoopContract["verification"]
  };
}

function applyContractPatch(
  baseContract: FormalLoopContract,
  patch: Partial<CreateLoopContractInput>
): CreateLoopContractInput {
  // A patch may carry a script (builder AST) instead of a body. When it does, defer to
  // the script and do not inherit the base body so resolveScriptContractInput can compile it.
  if (patch.script) {
    return {
      ...baseContract,
      ...patch,
      id: baseContract.id,
      title: patch.title ?? baseContract.title,
      goal: patch.goal ?? baseContract.goal,
      body: undefined,
      verification: patch.verification ?? baseContract.verification,
      repairPolicy: patch.repairPolicy ?? baseContract.repairPolicy,
      stopPolicy: patch.stopPolicy ?? baseContract.stopPolicy,
      budgetUsd: patch.budgetUsd ?? baseContract.budgetUsd,
      escalation: patch.escalation ?? baseContract.escalation,
      projectBinding: patch.projectBinding ?? baseContract.projectBinding,
      memoryPolicy: patch.memoryPolicy ?? baseContract.memoryPolicy,
      trigger: patch.trigger ?? baseContract.trigger,
      status: patch.status ?? baseContract.status
    };
  }
  return {
    ...baseContract,
    ...patch,
    id: baseContract.id,
    title: patch.title ?? baseContract.title,
    goal: patch.goal ?? baseContract.goal,
    body: patch.body ?? baseContract.body,
    verification: patch.verification ?? baseContract.verification,
    repairPolicy: patch.repairPolicy ?? baseContract.repairPolicy,
    stopPolicy: patch.stopPolicy ?? baseContract.stopPolicy,
    budgetUsd: patch.budgetUsd ?? baseContract.budgetUsd,
    escalation: patch.escalation ?? baseContract.escalation,
    agentProfiles: patch.agentProfiles ?? baseContract.agentProfiles,
    projectBinding: patch.projectBinding ?? baseContract.projectBinding,
    memoryPolicy: patch.memoryPolicy ?? baseContract.memoryPolicy,
    trigger: patch.trigger ?? baseContract.trigger,
    status: patch.status ?? baseContract.status
  };
}

function formalContractToLoop(contract: FormalLoopContract): LoopContract {
  return {
    id: contract.id,
    title: contract.title,
    intent: contract.intent ?? contract.goal,
    trigger: contract.trigger,
    verification: {
      checks: verificationRequirementChecks(contract.verification)
    },
    status: contract.status,
    codexProjectId: contract.projectBinding?.codexProjectId,
    projectLabel: contract.projectBinding?.projectLabel,
    projectPath: contract.projectBinding?.projectPath,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt
  };
}

function verificationRequirementChecks(verification: FormalLoopContract["verification"]): string[] {
  const legacy = verification as unknown as { rubrics?: Array<{ requirement: string }> };
  if (legacy.rubrics) {
    return legacy.rubrics.map((rubric) => rubric.requirement);
  }

  return verification.criteria.map((criterion) => criterion.description);
}

function formatVerificationCriteria(verification: FormalLoopContract["verification"]): string {
  const legacy = verification as unknown as {
    rubrics?: Array<{ severity: string; label: string; requirement: string }>;
  };
  if (legacy.rubrics) {
    return legacy.rubrics.map((rubric) => `- [${rubric.severity}] ${rubric.label}: ${rubric.requirement}`).join("\n");
  }

  return verification.criteria
    .map((criterion) => `- [${criterion.severity}] ${criterion.label}: ${criterion.description}`)
    .join("\n");
}

function verificationDecisionToResultStatus(status: VerificationDecisionStatus): VerificationStatus {
  if (status === "needs_human") {
    return "skipped";
  }

  return status;
}

function verificationDecisionChecksToResults(
  contract: FormalLoopContract,
  decision: VerificationDecision
): VerificationResult["checks"] {
  return decision.checks.map((check) => {
    const rubric = verificationCriterionLabel(contract.verification, check.rubricId);

    return {
      name: rubric ?? check.rubricId,
      status: verificationDecisionToResultStatus(check.status),
      output: check.evidence
    };
  });
}

function verificationCriterionLabel(
  verification: FormalLoopContract["verification"],
  criterionId: string
): string | undefined {
  const legacy = verification as unknown as { rubrics?: Array<{ id: string; label: string }> };
  if (legacy.rubrics) {
    return legacy.rubrics.find((candidate) => candidate.id === criterionId)?.label;
  }

  return verification.criteria.find((candidate) => candidate.id === criterionId)?.label;
}

type CompletedCodexSessionRef = CodexSessionRef & {
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
};
type CodexSubagentStatus = NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number]["status"];
type CodexSessionSubagent = NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number];

function codexThreadUrl(threadId: string | undefined): string | undefined {
  return threadId ? `codex://thread/${threadId}` : undefined;
}

function recordCodexThreadInstruction(runId: string): NonNullable<OpenCodexSessionResult["recordThread"]> {
  return {
    tool: "record_codex_thread",
    runId,
    threadUrlTemplate: "codex://thread/{threadId}"
  };
}

function normalizeCodexSessionThreadUrl(
  codexSession: NonNullable<LoopRun["codexSession"]>,
  threadUrl: string
): NonNullable<LoopRun["codexSession"]> {
  return {
    ...codexSession,
    threadUrl,
    subagents: codexSession.subagents?.map((subagent) =>
      subagent.threadId && !subagent.threadUrl
        ? { ...subagent, threadUrl: codexThreadUrl(subagent.threadId) }
        : subagent
    )
  };
}

function codexSessionStatusForPendingWorkflowSession(
  codexSession: LoopRun["codexSession"]
): NonNullable<LoopRun["codexSession"]>["status"] {
  if (!codexSession) return "requested";
  if (codexSession.status === "failed" || codexSession.status === "unavailable") {
    return codexSession.status;
  }
  if (
    codexSession.status === "started" ||
    codexSession.status === "completed" ||
    codexSession.threadId ||
    codexSession.threadUrl
  ) {
    return "started";
  }

  return "requested";
}

function codexSessionLaunchRequestForRun(
  state: LoopState,
  run: LoopRun
): CodexSessionLaunchRequest | undefined {
  const prompt = run.codexSession?.prompt;
  if (!prompt) return undefined;

  const attempts = state.attempts.filter((attempt) => attempt.runId === run.id);
  const attempt = attempts.find((candidate) => candidate.status === "running") ?? attempts.at(-1);
  const contexts = state.workflowContexts.filter((context) => context.runId === run.id);
  const workflowContext = attempt
    ? contexts.find((context) => context.attemptId === attempt.id) ?? contexts.at(-1)
    : contexts.at(-1);

  if (!attempt || !workflowContext) return undefined;

  const loop = state.loops.find((candidate) => candidate.id === run.loopId);
  const contract =
    workflowContext.contractSnapshot ?? state.formalContracts.find((candidate) => candidate.id === run.loopId);
  const workflowLaunch = contract ? buildWorkflowLaunch(contract) : {};

  return {
    runId: run.id,
    attemptId: attempt.id,
    workflowContextId: workflowContext.id,
    loopId: run.loopId,
    title: `DittosLoop: ${loop?.title ?? run.goal}`,
    prompt,
    ...workflowLaunch,
    codexProjectId: run.codexProjectId ?? run.codexSession?.codexProjectId,
    projectLabel: run.projectLabel ?? run.codexSession?.projectLabel,
    projectPath: run.projectPath ?? run.codexSession?.projectPath
  };
}

function isCompletedCodexSession(value: unknown): value is CompletedCodexSessionRef {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<CompletedCodexSessionRef>;
  return (
    typeof session.sessionId === "string" &&
    typeof session.runId === "string" &&
    typeof session.title === "string" &&
    (session.status === "completed" || session.status === "failed")
  );
}

function codexSubagentStatus(status: CodexSessionRef["status"]): CodexSubagentStatus {
  if (status === "started") return "running";
  return status;
}

function profilePreflightForStep(
  report: SkillPreflightReport | undefined,
  stepId: string | undefined,
  agentProfile: EffectiveAgentProfile | undefined
): SkillPreflightReport | undefined {
  if (!report || !stepId) return undefined;
  const checks = report.checks.filter((check) => check.stepId === stepId);
  if (!checks.length && !agentProfile) return undefined;

  const checkMessages = new Set(checks.map((check) => check.message));
  const warnings = report.warnings.filter((warning) =>
    checks.some((check) => warning.includes(check.profileLabel) || warning.includes(check.profileId) || warning.includes(check.skill.id))
  );
  const blockers = report.blockers.filter((blocker) =>
    checks.some((check) => blocker.includes(check.profileLabel) || blocker.includes(check.profileId) || blocker.includes(check.skill.id))
  );
  const stepWarnings = warnings.length ? warnings : report.warnings.filter((warning) => checkMessages.has(warning));
  const stepBlockers = blockers.length ? blockers : report.blockers.filter((blocker) => checkMessages.has(blocker));
  const status = stepBlockers.length > 0 ? (report.allowDegradedProfiles ? "degraded" : "blocked") : stepWarnings.length > 0 ? "warning" : "passed";

  return {
    status,
    checks,
    warnings: stepWarnings,
    blockers: stepBlockers,
    allowDegradedProfiles: report.allowDegradedProfiles
  };
}

function codexSessionSubagentsForContract(
  contract: FormalLoopContract | undefined,
  prompt: string,
  status: CodexSubagentStatus = "requested",
  preflight?: SkillPreflightReport
): CodexSessionSubagent[] {
  if (!contract) {
    return [{ role: "loop-runner", status, prompt }];
  }

  const agents = flattenWorkflowLaunchSteps(contract.body.steps, resolveEffectiveProfilesByStep(contract))
    .filter((step) => step.kind === "agent" || step.kind === "task")
    .map((step) => ({
      stepId: step.id,
      phaseId: step.phaseId,
      role: step.label,
      status,
      prompt: step.prompt ?? prompt,
      subagent: step.subagent,
      agentProfile: step.agentProfile,
      profilePreflight: profilePreflightForStep(preflight, step.id, step.agentProfile)
    }));

  return agents.length ? agents : [{ role: "loop-runner", status, prompt }];
}

function mergeCodexSessionSubagents(
  existingSubagents: CodexSessionSubagent[],
  updates: CodexSessionSubagent[]
): CodexSessionSubagent[] {
  const merged = [...existingSubagents];

  for (const update of updates) {
    const index = merged.findIndex((subagent) => {
      if (update.sessionId && subagent.sessionId === update.sessionId) return true;
      if (update.stepId && subagent.stepId === update.stepId) return true;
      return !subagent.stepId && subagent.role === update.role && subagent.prompt === update.prompt;
    });

    if (index >= 0) {
      merged[index] = {
        ...merged[index],
        ...update
      };
    } else {
      merged.push(update);
    }
  }

  return merged;
}

function updateCodexSessionSubagentsForResult(
  subagents: CodexSessionSubagent[] | undefined,
  input: RecordSessionResultInput,
  status: CodexSubagentStatus,
  isTargeted: boolean
): CodexSessionSubagent[] {
  const existingSubagents = subagents && subagents.length > 0
    ? subagents
    : [{ role: "loop-runner", status: "running" as const }];
  let matched = false;
  const updatedSubagents = existingSubagents.map((subagent) => {
    if (!shouldUpdateCodexSubagent(subagent, input, isTargeted)) {
      return subagent;
    }

    matched = true;
    return {
      ...subagent,
      status:
        subagent.status === "requested" || subagent.status === "running" || subagent.status === "completed"
          ? status
          : subagent.status,
      sessionId: input.sessionId ?? subagent.sessionId,
      stepId: input.stepId ?? subagent.stepId
    };
  });

  if (!isTargeted || matched) {
    return updatedSubagents;
  }

  return [
    ...updatedSubagents,
    {
      role: input.stepId ?? input.sessionId ?? "loop-runner",
      status,
      sessionId: input.sessionId,
      stepId: input.stepId
    }
  ];
}

function shouldUpdateCodexSubagent(
  subagent: CodexSessionSubagent,
  input: RecordSessionResultInput,
  isTargeted: boolean
): boolean {
  if (!isTargeted) return true;
  if (input.sessionId && subagent.sessionId === input.sessionId) return true;
  if (input.stepId && subagent.stepId === input.stepId) return true;
  return false;
}

function findWorkflowContextForSessionResult(
  state: LoopState,
  runId: string,
  attemptId: string | undefined,
  input: RecordSessionResultInput
): WorkflowContext | undefined {
  const contexts = state.workflowContexts.filter((context) => context.runId === runId);
  if (input.workflowContextId) {
    const context = contexts.find((candidate) => candidate.id === input.workflowContextId);
    if (!context) {
      throw new Error(`Workflow context does not belong to run: ${input.workflowContextId}`);
    }
    return context;
  }

  if (input.attemptId) {
    return contexts.find((context) => context.attemptId === input.attemptId);
  }

  const targetedContext = contexts.find((context) =>
    context.taskRuns.some((taskRun) => matchesWorkflowTaskRun(taskRun, input)) ||
    (input.sessionId && context.cursor.sessionId === input.sessionId) ||
    (input.stepId && context.cursor.stepId === input.stepId)
  );
  if (targetedContext) {
    return targetedContext;
  }

  return (attemptId ? contexts.find((context) => context.attemptId === attemptId) : undefined) ?? contexts.at(-1);
}

function findWorkflowContextForValidatorResult(
  state: LoopState,
  runId: string,
  input: RecordValidatorResultInput
): WorkflowContext {
  const contexts = state.workflowContexts.filter((context) => context.runId === runId);
  if (input.workflowContextId) {
    const context = contexts.find((candidate) => candidate.id === input.workflowContextId);
    if (!context) {
      throw new Error(`Workflow context does not belong to run: ${input.workflowContextId}`);
    }
    return context;
  }

  if (input.attemptId) {
    const context = contexts.find((candidate) => candidate.attemptId === input.attemptId);
    if (!context) {
      throw new Error(`Workflow context not found for attempt: ${input.attemptId}`);
    }
    return context;
  }

  const context = contexts.at(-1);
  if (!context) {
    throw new Error(`Workflow context not found for run: ${runId}`);
  }

  return context;
}

function completeWorkflowContextFromSessionResult(
  context: WorkflowContext,
  input: RecordSessionResultInput,
  timestamp: string,
  options: { finalize?: boolean } = {}
): WorkflowContext {
  const finalize = options.finalize ?? true;
  const targetTaskRun =
    context.taskRuns.find((taskRun) => matchesWorkflowTaskRun(taskRun, input)) ??
    (input.attemptId ? context.taskRuns.find((taskRun) => taskRun.attemptId === input.attemptId) : undefined) ??
    context.taskRuns.at(-1);
  const stepId = input.stepId ?? targetTaskRun?.stepId;
  const phaseId = targetTaskRun?.phaseId;
  const sessionId = input.sessionId ?? targetTaskRun?.sessionId;
  const taskStatus =
    input.status === "failed" ? "failed" : input.status === "needs_human" ? "suspended" : "completed";
  const contextStatus =
    input.status === "failed"
      ? "failed"
      : input.status === "needs_human"
        ? "suspended"
        : finalize
          ? "completed"
          : "running";
  const cursor =
    input.status === "failed"
      ? { state: "failed" as const, stepId, phaseId, sessionId }
      : input.status === "needs_human"
        ? { state: "waiting_for_human" as const, stepId, phaseId, sessionId }
        : finalize
          ? { state: "completed" as const }
          : { state: "executing" as const, stepId, phaseId, sessionId };

  const nextContext: WorkflowContext = {
    ...context,
    status: contextStatus,
    cursor,
    steps: stepId
      ? {
          ...context.steps,
          [stepId]: {
            status: taskStatus,
            sessionId,
            ...(input.status === "failed"
              ? { error: input.result ?? input.summary }
              : input.status === "needs_human"
                ? { output: undefined, error: undefined }
                : { output: input.result ?? input.summary, error: undefined }),
            updatedAt: timestamp
          }
        }
      : context.steps,
    taskRuns: targetTaskRun
      ? context.taskRuns.map((taskRun) =>
          taskRun.id === targetTaskRun.id
            ? {
                ...taskRun,
                sessionId,
                status: taskStatus,
                ...(input.status === "failed"
                  ? { error: input.result ?? input.summary }
                  : input.status === "needs_human"
                    ? { result: undefined, error: undefined }
                    : { result: input.result ?? input.summary, error: undefined }),
                idempotencyKey: input.idempotencyKey ?? taskRun.idempotencyKey,
                updatedAt: timestamp,
                ...(taskStatus === "completed" || taskStatus === "failed"
                  ? { completedAt: timestamp }
                  : { completedAt: undefined })
              }
            : taskRun
        )
      : context.taskRuns,
    pendingSessionIds: sessionId
      ? context.pendingSessionIds.filter((pendingSessionId) => pendingSessionId !== sessionId)
      : context.pendingSessionIds,
    idempotencyKeys: input.idempotencyKey
      ? appendUnique(context.idempotencyKeys, input.idempotencyKey)
      : context.idempotencyKeys,
    updatedAt: timestamp,
    ...(contextStatus === "completed" || contextStatus === "failed"
      ? { completedAt: timestamp }
      : { completedAt: undefined })
  };

  return stepId
    ? updateNodeRunForTaskResult(nextContext, {
        stepId,
        taskRunId: targetTaskRun?.id,
        sessionId,
        status: input.status,
        result: input.result,
        summary: input.summary,
        idempotencyKey: input.idempotencyKey,
        timestamp
      })
    : nextContext;
}

function normalizeWorkflowSessionResultInput(
  input: RecordSessionResultInput,
  taskRun: WorkflowTaskRun
): RecordSessionResultInput {
  return {
    ...input,
    taskRunId: input.taskRunId ?? taskRun.id,
    sessionId: input.sessionId ?? taskRun.sessionId,
    stepId: input.stepId ?? taskRun.stepId
  };
}

function hasWorkflowTaskLocator(input: RecordSessionResultInput): boolean {
  return Boolean(input.taskRunId || input.sessionId || input.stepId);
}

interface WorkflowNodeTransitionAudit {
  nodeId: string;
  nodeRunId: string;
  fromStatus: string;
  toStatus: string;
  stepId?: string;
  taskRunId?: string;
  sessionId?: string;
}

function workflowTaskNodeTransition(input: {
  before?: WorkflowContext;
  after?: WorkflowContext;
  input: RecordSessionResultInput;
  targetTaskRun?: WorkflowTaskRun;
}): WorkflowNodeTransitionAudit | undefined {
  if (!input.before?.executionGraphSnapshot || !input.before.nodeRuns || !input.after?.nodeRuns) {
    return undefined;
  }

  const stepId = input.input.stepId ?? input.targetTaskRun?.stepId;
  if (!stepId) {
    return undefined;
  }

  const nodeId = findNodeIdForStep(input.before.executionGraphSnapshot, stepId);
  if (!nodeId) {
    return undefined;
  }

  const previousNodeRun = input.before.nodeRuns.find((nodeRun) => nodeRun.nodeId === nodeId);
  const nextNodeRun = input.after.nodeRuns.find((nodeRun) => nodeRun.nodeId === nodeId);
  if (!previousNodeRun || !nextNodeRun || previousNodeRun.status === nextNodeRun.status) {
    return undefined;
  }

  return {
    nodeId,
    nodeRunId: nextNodeRun.nodeRunId,
    fromStatus: previousNodeRun.status,
    toStatus: nextNodeRun.status,
    stepId,
    ...(nextNodeRun.taskRunId ?? input.targetTaskRun?.id ?? input.input.taskRunId
      ? { taskRunId: nextNodeRun.taskRunId ?? input.targetTaskRun?.id ?? input.input.taskRunId }
      : {}),
    ...(nextNodeRun.sessionId ?? input.input.sessionId ?? input.targetTaskRun?.sessionId
      ? { sessionId: nextNodeRun.sessionId ?? input.input.sessionId ?? input.targetTaskRun?.sessionId }
      : {})
  };
}

function workflowNodeTransitionMessage(transition: WorkflowNodeTransitionAudit): string {
  return `Workflow node ${transition.nodeId} transitioned from ${transition.fromStatus} to ${transition.toStatus}`;
}

function matchesWorkflowTaskRun(taskRun: WorkflowTaskRun, input: RecordSessionResultInput): boolean {
  if (!hasWorkflowTaskLocator(input)) return false;
  if (input.taskRunId && taskRun.id !== input.taskRunId) return false;
  if (input.sessionId && taskRun.sessionId !== input.sessionId) return false;
  if (input.stepId && taskRun.stepId !== input.stepId) return false;
  return true;
}

function partiallyMatchesWorkflowTaskRun(taskRun: WorkflowTaskRun, input: RecordSessionResultInput): boolean {
  if (input.taskRunId && taskRun.id === input.taskRunId) return true;
  if (input.sessionId && taskRun.sessionId === input.sessionId) return true;
  if (input.stepId && taskRun.stepId === input.stepId) return true;
  return false;
}

function normalizeRecordedRubricAgentInput(
  input: RecordValidatorResultInput["result"]
): RecordedRubricAgentResultInput {
  const criteriaEvidence = input.criteriaResults
    ?.map((result) => result.evidence)
    .filter((evidence): evidence is string => Boolean(evidence?.trim()));
  const criteriaScores = input.criteriaResults
    ?.map((result) => result.score)
    .filter((score): score is number => typeof score === "number" && Number.isFinite(score));

  return {
    status: input.status,
    score: input.score ?? criteriaScores?.[0],
    evidence: input.evidence ?? criteriaEvidence?.join("\n"),
    summary: input.summary,
    output: input.output ?? {
      criteriaResults: input.criteriaResults
    }
  };
}

function pendingVerificationResultV2(
  id: string,
  runId: string,
  attemptId: string | undefined,
  verification: WorkflowVerificationState,
  timestamp: string
): VerificationResultV2 {
  const decision = {
    status: "needs_human" as const,
    summary: `Waiting for validator results: ${verification.pendingValidatorIds.join(", ")}`,
    failedValidatorIds: [],
    needsHumanValidatorIds: verification.pendingValidatorIds,
    failedCriterionIds: [],
    uncoveredMustCriterionIds: [],
    warnings: [],
    humanQuestion: `Waiting for validator results: ${verification.pendingValidatorIds.join(", ")}`
  };

  return {
    id,
    version: 2,
    runId,
    attemptId,
    status: "needs_human",
    summary: decision.summary,
    checks: [],
    validatorResults: verification.validatorResults,
    decision,
    humanQuestion: decision.humanQuestion,
    createdAt: timestamp
  };
}

function isVerificationResultV2(result: unknown): result is VerificationResultV2 {
  return result !== null && typeof result === "object" && "version" in result && result.version === 2;
}

function repairReasonForV2Result(result: VerificationResultV2): string {
  return [
    `Failed validators: ${result.decision.failedValidatorIds.join(", ")}`,
    `failed criteria: ${result.decision.failedCriterionIds.join(", ")}.`
  ].join("; ") + ` ${result.decision.repairInstructions ?? result.summary}`;
}

function engineEventToMessage(event: EngineEvent): string {
  if (event.type === "agent_started") {
    return `Agent 开始：${event.label ?? event.stepId ?? event.nodeId ?? "agent"}`;
  }
  if (event.type === "agent_done") {
    return `Agent 完成：${event.label ?? event.stepId ?? event.nodeId ?? "agent"}`;
  }
  if (event.type === "phase_started") {
    return `阶段开始：${event.label ?? event.title ?? event.phaseId ?? "phase"}`;
  }
  if (event.type === "phase_done") {
    return `阶段完成：${event.title ?? event.phaseId}`;
  }
  if (event.type === "parallel_started") {
    return `并行任务开始：${event.label ?? event.count}`;
  }
  if (event.type === "parallel_completed") {
    return `并行任务完成：${event.label ?? event.count}`;
  }
  if (event.type === "verification_started") {
    return "验证开始";
  }
  if (event.type === "verification_done") {
    return `验证完成：${event.decision.summary}`;
  }
  if (event.type === "repair_started") {
    return `修复开始：${event.reason}`;
  }
  if (event.type === "human_request") {
    return `需要人工处理：${event.question}`;
  }
  if (event.type === "run_done") {
    return `运行结束：${event.summary ?? event.status}`;
  }
  if (event.type === "run_failed") {
    return `运行失败：${event.error}`;
  }
  if (event.type === "log") {
    return event.message;
  }

  return `运行事件：${event.type}`;
}

function createEngineEvent(type: "run_started", runId: string, createdAt: string, sequence: number): EngineEvent {
  return {
    type,
    runId,
    createdAt,
    sequence
  };
}

class CodexSessionPendingError extends Error {
  constructor(readonly session: CodexSessionRef) {
    super(`Codex session result is not ready: ${session.sessionId}`);
    this.name = "CodexSessionPendingError";
  }
}

function isCodexSessionPendingError(error: unknown): error is CodexSessionPendingError {
  return error instanceof CodexSessionPendingError;
}

function isPendingSessionFailureEvent(event: EngineEvent): boolean {
  return event.type === "agent_failed" || event.type === "run_failed" || (event.type === "phase_done" && event.status !== "ok");
}

function workflowTaskResultEngineEvents(input: {
  events: RunEvent[];
  run: LoopRun;
  runId: string;
  timestamp: string;
  input: RecordSessionResultInput;
}): EngineEvent[] {
  const startedAgent = findStartedAgentForSessionResult(input.events, input.input);
  if (!startedAgent) return [];

  let sequence = latestEngineEventSequence(input.events);
  return [
    {
      type: "agent_done",
      runId: input.runId,
      createdAt: input.timestamp,
      sequence: ++sequence,
      label: startedAgent.label,
      stepId: startedAgent.stepId,
      phaseId: startedAgent.phaseId,
      result: input.input.result ?? input.input.summary,
      status: input.input.status === "failed" ? "failed" : "ok",
      session: input.run.codexSession
    }
  ];
}

function workflowCompletionEngineEvents(input: {
  events: RunEvent[];
  run: LoopRun;
  runId: string;
  attemptId: string;
  timestamp: string;
  input: RecordSessionResultInput;
  verification: VerificationResult;
}): EngineEvent[] {
  const startedAgent = findStartedAgentForSessionResult(input.events, input.input);
  if (!startedAgent) return [];

  let sequence = latestEngineEventSequence(input.events);
  const nextEvent = <TEvent extends EngineEvent>(event: Omit<TEvent, "runId" | "createdAt" | "sequence">): TEvent => {
    return {
      ...event,
      runId: input.runId,
      createdAt: input.timestamp,
      sequence: ++sequence
    } as TEvent;
  };
  const status = input.input.status === "passed" ? "completed" : input.input.status === "needs_human" ? "waiting_for_human" : "failed";
  const decision: VerificationDecision = {
    status: input.input.status,
    summary: input.input.summary,
    checks: input.input.checks?.map((check, index) => ({
      rubricId: check.name || `check-${index + 1}`,
      status: check.status === "passed" ? "passed" : check.status === "failed" ? "failed" : "needs_human",
      evidence: check.output
    })) ?? [],
    ...(input.input.humanQuestion ? { humanQuestion: input.input.humanQuestion } : {})
  };

  const events: EngineEvent[] = [
    nextEvent<Extract<EngineEvent, { type: "agent_done" }>>({
      type: "agent_done",
      label: startedAgent.label,
      stepId: startedAgent.stepId,
      phaseId: startedAgent.phaseId,
      result: input.input.result ?? input.input.summary,
      status: input.input.status === "failed" ? "failed" : "ok",
      session: input.run.codexSession
    }),
    ...openParallelCompletionEvents(input.events, input.input.status).map((event) => nextEvent(event)),
    input.input.status === "failed"
      ? nextEvent<Extract<EngineEvent, { type: "run_failed" }>>({
          type: "run_failed",
          status: "failed",
          error: input.input.summary
        })
      : nextEvent<Extract<EngineEvent, { type: "run_completed" }>>({
          type: "run_completed",
          status: "completed",
          result: input.input.result ?? input.input.summary
        }),
    nextEvent<Extract<EngineEvent, { type: "verification_started" }>>({
      type: "verification_started",
      attemptId: input.attemptId
    }),
    nextEvent<Extract<EngineEvent, { type: "verification_done" }>>({
      type: "verification_done",
      attemptId: input.attemptId,
      decision
    }),
    nextEvent<Extract<EngineEvent, { type: "run_done" }>>({
      type: "run_done",
      status,
      summary: input.input.summary
    })
  ];

  if (input.input.status === "needs_human") {
    events.push(
      nextEvent<Extract<EngineEvent, { type: "human_request" }>>({
        type: "human_request",
        question: input.input.humanQuestion ?? input.input.summary
      })
    );
  }

  return events;
}

function findStartedAgentForSessionResult(
  events: RunEvent[],
  input: RecordSessionResultInput
): Extract<EngineEvent, { type: "agent_started" }> | undefined {
  const startedAgents = [...events]
    .reverse()
    .map((event) => event.data?.engineEvent)
    .filter((event): event is Extract<EngineEvent, { type: "agent_started" }> => {
      return Boolean(event) && typeof event === "object" && (event as EngineEvent).type === "agent_started";
    });

  if (input.stepId) {
    const stepMatch = startedAgents.find((event) => event.stepId === input.stepId);
    if (stepMatch) return stepMatch;
  }

  if (input.taskRunId || input.sessionId) {
    return startedAgents.find((event) => event.stepId);
  }

  return startedAgents[0];
}

function latestEngineEventSequence(events: RunEvent[]): number {
  return Math.max(
    0,
    ...events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is EngineEvent => event !== null && event !== undefined && typeof event === "object" && "sequence" in event)
      .map((event) => event.sequence)
  );
}

function openParallelCompletionEvents(
  events: RunEvent[],
  status: RecordSessionResultInput["status"]
): Array<Omit<Extract<EngineEvent, { type: "parallel_completed" }>, "runId" | "createdAt" | "sequence">> {
  if (status !== "passed") return [];

  const openParallelEvents: Extract<EngineEvent, { type: "parallel_started" }>[] = [];
  for (const event of events
    .map((runEvent) => runEvent.data?.engineEvent)
    .filter((engineEvent): engineEvent is EngineEvent =>
      engineEvent !== null && engineEvent !== undefined && typeof engineEvent === "object" && "type" in engineEvent
    )) {
    if (event.type === "parallel_started") {
      openParallelEvents.push(event);
      continue;
    }

    if (event.type === "parallel_completed") {
      let index = -1;
      for (let candidateIndex = openParallelEvents.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
        const started = openParallelEvents[candidateIndex];
        if (started.label === event.label && started.count === event.count) {
          index = candidateIndex;
          break;
        }
      }
      if (index >= 0) {
        openParallelEvents.splice(index, 1);
      }
    }
  }

  return openParallelEvents.map((event) => ({
    type: "parallel_completed",
    label: event.label,
    count: event.count
  }));
}

function requireRun(state: LoopState, runId: string): LoopRun {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}

function firstCodexSubagentSessionId(run: LoopRun): string | undefined {
  return run.codexSession?.subagents?.find((subagent) => subagent.sessionId)?.sessionId;
}

function requireAttempt(state: LoopState, attemptId: string): RunAttempt {
  const attempt = state.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }

  return attempt;
}

function findWorkflowContextById(state: LoopState, workflowContextId: string): WorkflowContext | undefined {
  return state.workflowContexts.find((candidate) => candidate.id === workflowContextId);
}

function findPipelinePhase(steps: Step[], phaseId: string): PhaseStep | undefined {
  for (const step of steps) {
    if (step.kind === "phase") {
      if (step.id === phaseId && step.pipeline === true) {
        return step;
      }
      const nested = findPipelinePhase(step.children, phaseId);
      if (nested) return nested;
    } else if (step.kind === "parallel") {
      const nested = findPipelinePhase(step.children, phaseId);
      if (nested) return nested;
    }
  }
  return undefined;
}

function previousPipelineSiblingId(phase: PhaseStep, stepId: string): string | undefined {
  const index = phase.children.findIndex((child) => child.id === stepId);
  if (index <= 0) return undefined;
  return phase.children[index - 1]?.id;
}

function findStepOutputSchema(steps: Step[], stepId: string): Record<string, unknown> | undefined {
  for (const step of steps) {
    if ((step.kind === "task" || step.kind === "agent") && step.id === stepId) {
      return step.kind === "task" ? step.outputSchema : undefined;
    }
    if (step.kind === "phase" || step.kind === "parallel") {
      const nested = findStepOutputSchema(step.children, stepId);
      if (nested) return nested;
    }
  }
  return undefined;
}

function requireWorkflowContext(state: LoopState, workflowContextId: string): WorkflowContext {
  const context = state.workflowContexts.find((candidate) => candidate.id === workflowContextId);
  if (!context) {
    throw new Error(`Workflow context not found: ${workflowContextId}`);
  }

  return context;
}

function findWorkflowContextForRepair(
  state: LoopState,
  runId: string,
  attemptId?: string
): WorkflowContext | undefined {
  const contexts = state.workflowContexts.filter((context) => context.runId === runId);
  if (attemptId) {
    return contexts.find((context) => context.attemptId === attemptId);
  }

  return contexts.at(-1);
}

function repairWorkflowContext(context: WorkflowContext, reason: string | undefined, timestamp: string): WorkflowContext {
  return {
    ...context,
    status: "repairing",
    cursor: {
      ...context.cursor,
      state: "repairing"
    },
    vars: reason
      ? {
          ...context.vars,
          repairReason: reason
        }
      : context.vars,
    pendingSessionIds: [],
    updatedAt: timestamp,
    completedAt: undefined
  };
}

function completeTerminalWorkflowContextForRun(
  state: LoopState,
  runId: string,
  status: Extract<RunStatus, "completed" | "failed">,
  timestamp: string
): WorkflowContext[] {
  const targetContext = latestWorkflowContextForRun(state, runId);
  if (!targetContext) {
    return state.workflowContexts;
  }

  const result = latestVerificationResultForContext(state, targetContext);
  const terminalStatus = status === "failed" ? "failed" : "completed";

  return updateWorkflowContext(state.workflowContexts, targetContext.id, {
    ...targetContext,
    status,
    cursor: { state: terminalStatus },
    verification: completeWorkflowVerificationState(targetContext.verification, result, terminalStatus, timestamp),
    nodeRuns: completeTerminalWorkflowNodeRuns(targetContext, terminalStatus, result, timestamp),
    pendingSessionIds: [],
    updatedAt: timestamp,
    completedAt: timestamp
  });
}

function latestWorkflowContextForRun(state: LoopState, runId: string): WorkflowContext | undefined {
  const contexts = state.workflowContexts.filter((context) => context.runId === runId);
  if (contexts.length === 0) {
    return undefined;
  }

  const latestAttempt = state.attempts.filter((attempt) => attempt.runId === runId).at(-1);
  if (!latestAttempt) {
    return contexts.at(-1);
  }

  return contexts.filter((context) => context.attemptId === latestAttempt.id).at(-1) ?? contexts.at(-1);
}

function latestVerificationResultForContext(
  state: LoopState,
  context: WorkflowContext
): LoopState["verificationResults"][number] | undefined {
  return [...state.verificationResults]
    .reverse()
    .find(
      (result) =>
        result.runId === context.runId &&
        (!result.attemptId || result.attemptId === context.attemptId)
    );
}

function completeWorkflowVerificationState(
  existing: WorkflowVerificationState | undefined,
  result: LoopState["verificationResults"][number] | undefined,
  status: "completed" | "failed",
  timestamp: string
): WorkflowVerificationState {
  const verification = existing ?? createWorkflowVerificationState(timestamp);

  return {
    ...verification,
    status,
    pendingValidatorIds: [],
    ...(isVerificationResultV2(result)
      ? {
          validatorResults: result.validatorResults,
          decision: result.decision
        }
      : {}),
    ...(result ? { resultId: result.id } : {}),
    updatedAt: timestamp
  };
}

function completeTerminalWorkflowNodeRuns(
  context: WorkflowContext,
  status: "completed" | "failed",
  result: LoopState["verificationResults"][number] | undefined,
  timestamp: string
): WorkflowNodeRun[] | undefined {
  if (!context.executionGraphSnapshot || !context.nodeRuns) {
    return context.nodeRuns;
  }

  const nodesById = new Map(context.executionGraphSnapshot.nodes.map((node) => [node.nodeId, node]));
  const nodeRuns = context.nodeRuns.map((nodeRun) => {
    const node = nodesById.get(nodeRun.nodeId);
    if (!node || (node.kind !== "root" && node.kind !== "verification")) {
      return nodeRun;
    }

    return {
      ...nodeRun,
      status,
      ...(node.kind === "verification" && result ? { output: result.summary } : {}),
      startedAt: nodeRun.startedAt ?? timestamp,
      updatedAt: timestamp,
      completedAt: timestamp
    };
  });

  return advanceContainerNodeRuns(context.executionGraphSnapshot, nodeRuns, timestamp);
}

function requireWorkflowTaskRun(context: WorkflowContext, taskRunId: string): WorkflowTaskRun {
  const taskRun = context.taskRuns.find((candidate) => candidate.id === taskRunId);
  if (!taskRun) {
    throw new Error(`Workflow task run not found: ${taskRunId}`);
  }

  return taskRun;
}

function requireHumanRequest(state: LoopState, requestId: string): HumanRequest {
  const request = state.humanRequests.find((candidate) => candidate.id === requestId);
  if (!request) {
    throw new Error(`Human request not found: ${requestId}`);
  }

  return request;
}

function updateRun(runs: LoopRun[], runId: string, patch: Partial<LoopRun>): LoopRun[] {
  return runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
}

function loopMemoryWindow(state: LoopState, loopId: string, input: ReadLoopMemoryInput = {}): LoopMemoryWindow {
  requireLoop(state, loopId);
  const limit = input.limit ?? DEFAULT_LOOP_MEMORY_READ_LIMIT;
  const offset = input.offset ?? 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOOP_MEMORY_READ_LIMIT) {
    throw new Error(`Memory read limit must be between 1 and ${MAX_LOOP_MEMORY_READ_LIMIT}.`);
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Memory read offset must be greater than or equal to 0.");
  }

  const memory = state.loopMemories.find((candidate) => candidate.loopId === loopId);
  const lines = memoryLines(memory?.content);
  const selectedLines = lines.slice(offset, offset + limit);
  const remainingLines = Math.max(lines.length - offset - selectedLines.length, 0);

  return {
    loopId,
    limit,
    offset,
    returnedLines: selectedLines.length,
    totalLines: lines.length,
    remainingLines,
    content: memoryWindowContent(loopId, selectedLines, lines.length, remainingLines, offset + selectedLines.length, limit)
  };
}

function memoryLines(content: string | undefined): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function memoryWindowContent(
  loopId: string,
  lines: string[],
  totalLines: number,
  remainingLines: number,
  nextOffset: number,
  limit: number
): string {
  if (!lines.length) {
    return totalLines === 0 ? "暂无长期记忆。" : "没有更多长期记忆。";
  }

  const content = lines.join("\n");
  if (!remainingLines) {
    return content;
  }

  return [
    content,
    `还有 ${remainingLines} 条记忆未读取。可调用 read_loop_memory({ loopId: "${loopId}", offset: ${nextOffset}, limit: ${limit} }) 继续读取。`
  ].join("\n");
}

function appendLoopMemory(memories: LoopMemory[], loopId: string, line: string, updatedAt: string): LoopMemory[] {
  const existing = memories.find((memory) => memory.loopId === loopId);
  const updated = {
    loopId,
    content: `${line}\n${existing?.content ?? ""}`,
    updatedAt
  };

  if (!existing) {
    return [...memories, updated];
  }

  return memories.map((memory) => (memory.loopId === loopId ? updated : memory));
}

function applyTerminalRunState(
  state: LoopState,
  loopId: string,
  overrides: { consecutiveFailures?: number } = {}
): LoopState {
  return {
    ...state,
    loopStates: upsertLoopOperationalState(
      state.loopStates,
      buildLoopOperationalState(state, loopId, {
        consecutiveFailures: overrides.consecutiveFailures ?? consecutiveFailuresAfterLatestTerminalRun(state, loopId)
      })
    )
  };
}

function terminalRunStateOverridesForPausedReason(
  state: LoopState,
  loopId: string,
  pausedReason?: LoopPausedReason
): { consecutiveFailures?: number } {
  if (pausedReason !== "escalation") {
    return {};
  }

  return { consecutiveFailures: existingConsecutiveFailures(state, loopId) };
}

function applyFailureStopPolicy(state: LoopState, loopId: string, timestamp: string): LoopState {
  const failures = existingConsecutiveFailures(state, loopId);
  const threshold = failureThresholdForLoop(state, loopId);
  if (failures < threshold) {
    return state;
  }

  return {
    ...state,
    runs: markLatestFailedRunPausedReason(state.runs, loopId, "failures"),
    loops: state.loops.map((loop) =>
      loop.id === loopId
        ? { ...loop, status: "paused", updatedAt: timestamp }
        : loop
    ),
    formalContracts: state.formalContracts.map((contract) =>
      contract.id === loopId
        ? { ...contract, status: "paused", updatedAt: timestamp }
        : contract
    ),
    loopStates: upsertLoopOperationalState(
      state.loopStates,
      pausedStopState(state, loopId, "failures", failures)
    )
  };
}

function applyImmediateStopPolicy(
  state: LoopState,
  loopId: string,
  reason: LoopPausedReason,
  timestamp: string
): LoopState {
  const failures = existingConsecutiveFailures(state, loopId);

  return {
    ...state,
    runs: markLatestFailedRunPausedReason(state.runs, loopId, reason),
    loops: state.loops.map((loop) =>
      loop.id === loopId
        ? { ...loop, status: "paused", updatedAt: timestamp }
        : loop
    ),
    formalContracts: state.formalContracts.map((contract) =>
      contract.id === loopId
        ? { ...contract, status: "paused", updatedAt: timestamp }
        : contract
    ),
    loopStates: upsertLoopOperationalState(
      state.loopStates,
      pausedStopState(state, loopId, reason, failures)
    )
  };
}

function failureThresholdForLoop(state: LoopState, loopId: string): number {
  const configured = state.formalContracts.find((contract) => contract.id === loopId)?.stopPolicy.maxConsecutiveFailures;
  if (configured !== undefined && Number.isInteger(configured) && configured >= 0) {
    return configured;
  }

  return 3;
}

function pausedStopState(
  state: LoopState,
  loopId: string,
  reason: LoopPausedReason,
  failures: number
): LoopOperationalState {
  return buildLoopOperationalState(state, loopId, {
    consecutiveFailures: failures,
    paused: true,
    pausedReason: reason,
    clearPausedReason: false
  });
}

function existingConsecutiveFailures(state: LoopState, loopId: string): number {
  return state.loopStates.find((candidate) => candidate.loopId === loopId)?.consecutiveFailures
    ?? consecutiveFailuresForLoop(state.runs, loopId);
}

function upsertLoopOperationalState(states: LoopOperationalState[], next: LoopOperationalState): LoopOperationalState[] {
  if (!states.some((state) => state.loopId === next.loopId)) {
    return [...states, next];
  }

  return states.map((state) => (state.loopId === next.loopId ? next : state));
}

function consecutiveFailuresAfterLatestTerminalRun(state: LoopState, loopId: string): number {
  const existing = state.loopStates.find((candidate) => candidate.loopId === loopId);
  const latestTerminalRun = terminalRunsForLoop(state.runs, loopId).at(-1);
  if (!latestTerminalRun) {
    return existing?.consecutiveFailures ?? 0;
  }
  if (latestTerminalRun.status === "completed") {
    return 0;
  }
  if (existing?.activeRunId === latestTerminalRun.id) {
    return existing.consecutiveFailures + 1;
  }
  if (existing) {
    return existing.consecutiveFailures;
  }

  return consecutiveFailuresForLoop(state.runs, loopId);
}

function buildLoopOperationalState(
  state: LoopState,
  loopId: string,
  overrides: {
    consecutiveFailures?: number;
    paused?: boolean;
    pausedReason?: LoopPausedReason;
    clearPausedReason?: boolean;
  } = {}
): LoopOperationalState {
  const loop = requireLoop(state, loopId);
  const existing = state.loopStates.find((candidate) => candidate.loopId === loopId);
  const loopRuns = runsForLoopChronological(state.runs, loopId);
  const latestRun = loopRuns.at(-1);
  const activeRun = latestRun && latestRun.status !== "completed" && latestRun.status !== "failed" ? latestRun : undefined;
  const terminalRuns = terminalRunsForLoop(state.runs, loopId);
  const latestTerminalRun = terminalRuns.at(-1);
  const paused = overrides.paused ?? (loop.status === "paused" || existing?.paused === true);
  const pausedReason = paused
    ? overrides.clearPausedReason
      ? undefined
      : overrides.pausedReason ?? existing?.pausedReason
    : undefined;

  return {
    loopId,
    cursor: existing?.cursor ?? null,
    consecutiveFailures: overrides.consecutiveFailures ?? existing?.consecutiveFailures ?? consecutiveFailuresForLoop(state.runs, loopId),
    paused,
    ...(pausedReason ? { pausedReason } : {}),
    running: Boolean(activeRun),
    runCount: Math.max(existing?.runCount ?? 0, terminalRuns.length),
    ...(latestTerminalRun ? { lastRunAt: Date.parse(latestTerminalRun.completedAt ?? latestTerminalRun.updatedAt ?? latestTerminalRun.createdAt) } : {}),
    ...(activeRun ? { activeRunId: activeRun.id, activeRunStatus: activeRun.status } : {})
  };
}

function consecutiveFailuresForLoop(runs: LoopRun[], loopId: string): number {
  const loopRuns = terminalRunsForLoop(runs, loopId);

  let failures = 0;
  for (let index = loopRuns.length - 1; index >= 0; index -= 1) {
    if (loopRuns[index].status !== "failed" || loopRuns[index].pausedReason === "escalation") {
      break;
    }
    failures += 1;
  }

  return failures;
}

function markLatestFailedRunPausedReason(
  runs: LoopRun[],
  loopId: string,
  reason: LoopPausedReason
): LoopRun[] {
  const latestFailedRun = terminalRunsForLoop(runs, loopId).at(-1);
  if (!latestFailedRun || latestFailedRun.status !== "failed") {
    return runs;
  }

  return runs.map((run) =>
    run.id === latestFailedRun.id
      ? { ...run, pausedReason: run.pausedReason ?? reason }
      : run
  );
}

function runsForLoopChronological(runs: LoopRun[], loopId: string): LoopRun[] {
  return runs
    .filter((run) => run.loopId === loopId)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
}

function terminalRunsForLoop(runs: LoopRun[], loopId: string): LoopRun[] {
  return runsForLoopChronological(runs, loopId)
    .filter((run) => run.status === "completed" || run.status === "failed");
}

function updateWorkflowContext(
  workflowContexts: WorkflowContext[],
  workflowContextId: string,
  nextContext: WorkflowContext
): WorkflowContext[] {
  return workflowContexts.map((context) => (context.id === workflowContextId ? nextContext : context));
}

function appendUnique<T>(items: T[], item: T): T[] {
  return items.includes(item) ? items : [...items, item];
}

function lifecycleEvent(
  id: string,
  runId: string,
  kind: EventKind,
  message: string,
  createdAt: string,
  data?: Record<string, unknown>
): RunEvent {
  return {
    id,
    runId,
    kind,
    message,
    createdAt,
    data
  };
}

function runProjectBinding(
  input: { codexProjectId?: string; projectLabel?: string; projectPath?: string },
  loop: LoopContract
): Pick<LoopRun, "codexProjectId" | "projectLabel" | "projectPath"> {
  return {
    codexProjectId: input.codexProjectId ?? loop.codexProjectId,
    projectLabel: input.projectLabel ?? loop.projectLabel,
    projectPath: input.projectPath ?? loop.projectPath
  };
}

function normalizeProjectBinding(
  input: { codexProjectId?: string; projectLabel?: string; projectPath?: string }
): Pick<LoopRun, "codexProjectId" | "projectLabel" | "projectPath"> {
  return {
    codexProjectId: input.codexProjectId,
    projectLabel: input.projectLabel,
    projectPath: input.projectPath
  };
}

function bindLoopProject(
  loops: LoopContract[],
  loopId: string,
  project: Pick<LoopRun, "codexProjectId" | "projectLabel" | "projectPath">,
  timestamp: string
): LoopContract[] {
  if (!project.codexProjectId && !project.projectLabel && !project.projectPath) return loops;

  return loops.map((loop) => {
    if (loop.id !== loopId) return loop;

    return {
      ...loop,
      ...project,
      updatedAt: timestamp
    };
  });
}

function buildNewLoopSessionPrompt(project: Pick<LoopRun, "codexProjectId" | "projectLabel" | "projectPath">): string {
  const projectLines =
    project.codexProjectId || project.projectLabel || project.projectPath
      ? [
          "",
          "已选择的 Codex 项目：",
          project.projectLabel ? `- 项目名：${project.projectLabel}` : undefined,
          project.projectPath ? `- 项目路径：${project.projectPath}` : undefined,
          project.codexProjectId ? `- 项目 ID：${project.codexProjectId}` : undefined
        ].filter(Boolean)
      : [
          "",
          "当前还没有明确的 Codex 项目绑定；请先向用户确认要关联哪个 Codex 项目，再创建 loop。"
        ];

  return [
    "你正在为 DittosLoop For Codex 创建一个新的 Live Loop。",
    "",
    "请根据用户意图创建正式 workflow 版 loop contract；新 loop 一律使用正式 contract。",
    "创建正式 loop 时请调用 DittosLoop MCP 工具 create_loop_contract。",
    ...projectLines,
    "",
    "创建前需要补齐或确认：",
    "- loop 目标和触发方式",
    "- 所属 Codex 项目",
    "- workflow steps，每个 Codex task 的 label、prompt、可选 subagent 配置",
    "- verification.version: 2，包含 criteria、validators、decision",
    "- validator types: command / score / rubric_agent",
    "- workflow task session 不能把自己的 status 当最终验证；最终状态由 verification validators 决定。",
    "- repair policy：不通过时如何修复和重试",
    "- stop policy：何时停止",
    "- 用户最终想看的输出形式",
    "",
    "Contract 应至少表达这些结构：",
    "- title / goal / intent",
    "- body.steps：优先用 task(runtime: \"codex\") / phase / parallel 组织实际工作流；agent 仅作为旧 contract 兼容 spelling",
    "- verification.version: 2，包含 criteria、validators、decision",
    "- validator types: command / score / rubric_agent",
    "- workflow task session 不能把自己的 status 当最终验证；最终状态由 verification validators 决定。",
    "- repairPolicy、stopPolicy、budgetUsd、escalation",
    "- projectBinding：绑定所选 Codex 项目",
    "",
    "完成后请用中文简短返回：loop id、项目名、workflow tasks、verification criteria and validators、repair/stop 策略，以及下一步是否要立即启动一次 run。"
  ].join("\n");
}

function buildCodexSessionPrompt(
  loop: LoopContract,
  goal: string,
  contract?: FormalLoopContract,
  callbacks?: { runId: string; attemptId: string; workflowContextId: string },
  memoryWindow?: LoopMemoryWindow,
  profilePreflight?: SkillPreflightReport
): string {
  const checks = loop.verification.checks.length
    ? loop.verification.checks.map((check) => `- ${check}`).join("\n")
    : "- 记录本轮完成了什么、验证了什么，以及还需要用户处理的事项。";
  const workflowContract = contract
    ? [
        "",
        "Workflow runtime / 工作流运行时：",
        `Contract id: ${contract.id}`,
        "- 使用本地 DittosLoop workflow runtime 执行这个 contract，不要手动重写或绕过工作流。",
        "- 按已编译的 Workflow steps 执行，再用 verification criteria and validators 验证 candidate result。",
        "- workflow task session 不能把自己的 status 当最终验证；最终状态由 verification validators 决定。",
        "- 如果验证失败且允许修复，请生成 candidate workflow draft，并通过 runtime 重试。",
        "- 不要覆盖当前 active workflow contract；workflow 改动只能作为候选修订，等待明确采纳。",
        `- Repair policy: ${contract.repairPolicy.strategy}，最多尝试 ${contract.repairPolicy.maxAttempts} 次。`,
        `- Stop policy: ${contract.stopPolicy.rule}`,
        contract.budgetUsd !== undefined ? `- Budget: 每轮最多 ${contract.budgetUsd} USD；触发时用 pausedReason=budget 回写。` : "",
        contract.escalation?.length ? `- Escalation boundaries: ${contract.escalation.join("；")}；触发时用 pausedReason=escalation 回写。` : "",
        "",
        "Workflow steps / 工作流步骤：",
        formatWorkflowSteps(contract),
        "",
        "Agent profiles / 代理画像：",
        formatAgentProfiles(contract, profilePreflight),
        "",
        "Verification criteria and validators / 验证规则：",
        formatVerificationCriteria(contract.verification)
      ].join("\n")
    : "";
  const loopMemory = memoryWindow
    ? [
        "",
        "Loop memory / 长期记忆：",
        memoryWindow.content,
        "",
        "Memory discipline / 记忆写入纪律：",
        "- 可在需要更多长期上下文时调用 read_loop_memory({ loopId, limit, offset })。",
        "- workflow task 如发现可复用观察，应通过 task result 回传，不直接负责长期记忆取舍。",
        "- verifier 只判断结果是否过关，不负责写入长期记忆。",
        "- 顶层 Codex session 在 verifier 结果可见后决定是否调用 commit_memory。",
        "- 只记录稳定偏好、长期规则、可复用修复经验、边界条件或 workflow 改进；不要记录一次性进度、临时失败、run id、attempt id 或调试残留。"
      ].join("\n")
    : "";
  const workflowCallbacks = callbacks
    ? [
        "",
        "Workflow callbacks / 工作流回调：",
        `runId: ${callbacks.runId}`,
        `attemptId: ${callbacks.attemptId}`,
        `workflowContextId: ${callbacks.workflowContextId}`,
        "- 在本会话内先调用 execute_workflow_attempt({ runId, attemptId })，让本地 workflow engine 按 active contract 调度步骤。",
        "- Codex task/session 完成后，用 record_session_result({ runId, workflowContextId, attemptId, taskRunId/sessionId/stepId, idempotencyKey, status, pausedReason, summary, result }) 精确回写结果。",
        "- 只有预算耗尽或升级边界才填写 pausedReason；连续失败阈值由 runtime 按 stopPolicy 自动计算。",
        "- 多个 locator 同时出现时必须指向同一个 task run；不确定时先读取 run detail，不要猜。",
        "- workflow 需要动态调整时，只能通过 propose_workflow_revision 提交候选，再用 list_workflow_revisions / promote_workflow_revision / reject_workflow_revision 管理修订。"
      ].join("\n")
    : "";

  return [
    `你正在启动 Dittos Live Loop 的一次运行：${loop.title}。`,
    "",
    `Loop intent / Loop 目标：${loop.intent}`,
    `Run goal / 本轮目标：${goal}`,
    "",
    "Before finishing this session / 完成本会话前请做到：",
    "- 读取 loop 目标、最近历史和验证要求。",
    "- 如果提供了 Codex 项目，请在该项目上下文内工作。",
    "- 将进展写回 DittosLoop，包括 attempt、events、verification records。",
    "- 最终输出面向用户的任务结果，不要把 run/attempt/verification id、调试说明或 cite turn 残留写进正文。",
    loopMemory,
    workflowContract,
    workflowCallbacks,
    "",
    "Verification checks / 验证检查：",
    checks
  ].join("\n");
}

function buildWorkflowLaunch(contract: FormalLoopContract): {
  workflowRuntime: "dittosloop-local-workflow";
  workflowContractId: string;
  workflowPlan: WorkflowLaunchPlan;
} {
  const effectiveProfilesByStep = resolveEffectiveProfilesByStep(contract);

  return {
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: contract.id,
    workflowPlan: {
      runtime: "dittosloop-local-workflow",
      contractId: contract.id,
      goal: contract.goal,
      steps: flattenWorkflowLaunchSteps(contract.body.steps, effectiveProfilesByStep),
      verification: workflowLaunchVerification(contract.verification),
      repairPolicy: contract.repairPolicy,
      stopPolicy: contract.stopPolicy,
      budgetUsd: contract.budgetUsd,
      escalation: contract.escalation
    }
  };
}

function workflowLaunchVerification(
  verification: FormalLoopContract["verification"]
): FormalLoopContract["verification"] | LegacyVerificationPolicy {
  return isLegacyCompatibleVerificationPolicy(verification) ? legacyVerificationFromMigratedV2(verification) : verification;
}

function flattenWorkflowLaunchSteps(
  steps: FormalLoopContract["body"]["steps"],
  effectiveProfilesByStep: ReturnType<typeof resolveEffectiveProfilesByStep>,
  phaseId?: string,
  depth = 0
): WorkflowLaunchPlanStep[] {
  const items: WorkflowLaunchPlanStep[] = [];

  for (const step of steps) {
    if (step.kind === "agent" || step.kind === "task") {
      const agentProfile = effectiveProfilesByStep.get(step.id);
      items.push({
        id: step.id,
        kind: step.kind,
        runtime: step.kind === "task" ? step.runtime : undefined,
        label: step.label,
        prompt: step.prompt,
        sessionPolicy: step.sessionPolicy,
        subagent: effectiveProfileToSubagent(agentProfile, step.subagent),
        agentProfile,
        phaseId,
        depth
      });
      continue;
    }

    items.push({
      id: step.id,
      kind: step.kind,
      label: step.label,
      phaseId,
      depth
    });
    items.push(
      ...flattenWorkflowLaunchSteps(
        step.children,
        effectiveProfilesByStep,
        step.kind === "phase" ? step.id : phaseId,
        depth + 1
      )
    );
  }

  return items;
}

function formatWorkflowSteps(contract: FormalLoopContract): string {
  const lines: string[] = [];
  const effectiveProfilesByStep = resolveEffectiveProfilesByStep(contract);
  const visit = (steps: FormalLoopContract["body"]["steps"], depth: number): void => {
    for (const step of steps) {
      const indent = "  ".repeat(depth);
      if (step.kind === "agent" || step.kind === "task") {
        const agentProfile = effectiveProfilesByStep.get(step.id);
        lines.push(`${indent}- ${step.kind} ${step.id}: ${step.label}`);
        lines.push(`${indent}  prompt: ${step.prompt}`);
        if (agentProfile) {
          lines.push(`${indent}  effectiveProfile: ${agentProfile.label} (${agentProfile.id}, ${agentProfile.source})`);
        }
      } else {
        lines.push(`${indent}- ${step.kind} ${step.id}: ${step.label}`);
        visit(step.children, depth + 1);
      }
    }
  };

  visit(contract.body.steps, 0);
  return lines.join("\n");
}

function formatAgentProfiles(contract: FormalLoopContract, profilePreflight?: SkillPreflightReport): string {
  const effectiveProfiles = Array.from(resolveEffectiveProfilesByStep(contract).values());
  if (!effectiveProfiles.length) {
    return [
      "- No explicit agent profiles are declared for executable steps.",
      "- DittosLoop records these profile expectations and performs best-effort checks; the visible Codex session remains the orchestrator and does not provide native Codex skill enforcement."
    ].join("\n");
  }

  const lines = [
    "- DittosLoop records these profile expectations and performs best-effort checks; the visible Codex session remains the orchestrator and does not provide native Codex skill enforcement."
  ];
  const declaredProfiles = Object.values(contract.agentProfiles ?? {});
  if (declaredProfiles.length) {
    lines.push("- Declared profile catalog:");
    for (const profile of declaredProfiles) {
      lines.push(`  - ${profile.id}: ${profile.label} / ${profile.role}`);
    }
  }
  lines.push("- Effective profiles by executable step:");
  for (const profile of effectiveProfiles) {
    lines.push(`  - ${profile.stepId}: ${profile.label} (${profile.id}, ${profile.source})`);
    lines.push(`    role: ${profile.role}`);
    if (profile.requiredSkills.length) {
      lines.push(`    requiredSkills: ${profile.requiredSkills.map(formatSkillRequirement).join(", ")}`);
    }
    if (profile.advisorySkills.length) {
      lines.push(`    advisorySkills: ${profile.advisorySkills.map(formatSkillRequirement).join(", ")}`);
    }
    const checks = profilePreflight?.checks.filter((check) => check.stepId === profile.stepId) ?? [];
    if (checks.length) {
      lines.push(`    preflight: ${checks.map((check) => `${check.skill.id}=${check.status}`).join(", ")}`);
    }
  }
  if (profilePreflight?.warnings.length) {
    lines.push("- Preflight warnings:");
    lines.push(...profilePreflight.warnings.map((warning) => `  - ${warning}`));
  }
  if (profilePreflight?.blockers.length) {
    lines.push("- Preflight blockers:");
    lines.push(...profilePreflight.blockers.map((blocker) => `  - ${blocker}`));
  }

  return lines.join("\n");
}

function formatSkillRequirement(requirement: { id: string; source?: string; pluginId?: string }): string {
  const source = requirement.pluginId
    ? `${requirement.source ?? "plugin"}:${requirement.pluginId}`
    : requirement.source;
  return source ? `${requirement.id} (${source})` : requirement.id;
}
