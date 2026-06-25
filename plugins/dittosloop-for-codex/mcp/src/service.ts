import { createId, type IdPrefix } from "./id.js";
import { compileContract } from "./contract/compileContract.js";
import type { CodexSessionBridge, CodexSessionRef } from "./codex/sessionBridge.js";
import type { FormalLoopContract, FormalLoopContractInput } from "./contract/types.js";
import { validateContract } from "./contract/validateContract.js";
import type { AgentRequest, AgentResult, EngineEvent, Executor } from "./engine/types.js";
import { LoopRunner, type LoopRunResult, type LoopVerifier } from "./runner/loopRunner.js";
import type { VerificationDecision, VerificationDecisionStatus } from "./runner/verifier.js";
import type {
  ArtifactRef,
  CodexProjectRef,
  EventKind,
  HumanRequest,
  LoopContract,
  LoopRun,
  RunAttempt,
  RunDetail,
  LoopState,
  MemoryCommit,
  RunEvent,
  RunStatus,
  VerificationResult,
  VerificationStatus,
  WorkflowContext,
  WorkflowTaskRun,
  WorkflowRevision
} from "./types.js";
import type { LoopStore } from "./store.js";

export interface LoopServiceOptions {
  store: LoopStore;
  now?: () => string;
  createId?: (prefix: IdPrefix) => string;
  previewBaseUrl?: string;
  codexProjects?: CodexProjectRef[];
  sessionBridge?: CodexSessionBridge;
}

export type CreateLoopContractInput = Omit<FormalLoopContractInput, "id"> & {
  id?: string;
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
}

export interface OpenCodexSessionResult {
  runId: string;
  status: "ready" | "unavailable";
  message: string;
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
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
  launchRequest: {
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
  };
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
  verification: FormalLoopContract["verification"];
  repairPolicy: FormalLoopContract["repairPolicy"];
  stopPolicy: FormalLoopContract["stopPolicy"];
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

export interface RecordSessionResultInput {
  workflowContextId?: string;
  attemptId?: string;
  taskRunId?: string;
  sessionId?: string;
  stepId?: string;
  idempotencyKey?: string;
  status: "passed" | "failed" | "needs_human";
  summary: string;
  result?: string;
  checks?: VerificationResult["checks"];
  humanQuestion?: string;
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
}

export type Snapshot = LoopState & {
  previewUrl: string;
  codexProjects: CodexProjectRef[];
};

export class LoopService {
  private readonly now: () => string;
  private readonly nextId: (prefix: IdPrefix) => string;
  private readonly previewBaseUrl: string;

  constructor(private readonly options: LoopServiceOptions) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.nextId = options.createId ?? createId;
    this.previewBaseUrl = options.previewBaseUrl ?? "http://127.0.0.1:47888";
  }

  async createLoopContract(input: CreateLoopContractInput): Promise<FormalLoopContract> {
    const timestamp = this.now();
    const contract = compileContract(normalizeFormalContractInput(input, input.id ?? this.nextId("loop")), timestamp);

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
        artifacts: state.artifacts.filter((artifact) => !deletedRunIds.has(artifact.runId))
      };
    });

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
    const attemptNumber = Math.max(1, attemptsForRun.findIndex((candidate) => candidate.id === attempt.id) + 1);
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
        contract,
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
    await this.recordVerification(runId, {
      attemptId: attempt.id,
      status: verificationDecisionToResultStatus(result.verification.status),
      summary: result.verification.summary,
      checks: verificationDecisionChecksToResults(contract, result.verification),
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

  private createWorkflowContextExecutor(run: LoopRun, attemptId: string, workflowContextId: string): Executor {
    const bridge = this.options.sessionBridge;
    if (!bridge) {
      throw new Error("No workflow executor or Codex session bridge is configured.");
    }

    return {
      run: async (request) =>
        this.runCodexSessionStep(
          bridge,
          run,
          {
            ...request,
            attemptId,
            workflowContextId
          },
          {
            attemptId,
            workflowContextId
          }
        )
    };
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
          subagent: request.subagent
        })
      : undefined;
    const session = await bridge.createSession({
      runId: run.id,
      attemptId: request.attemptId,
      workflowContextId: request.workflowContextId,
      stepId: request.stepId,
      phaseId: request.phaseId,
      title: request.label ?? request.stepId ?? "Codex workflow step",
      prompt: request.prompt,
      subagent: request.subagent,
      workflowRuntime: request.workflowRuntime,
      workflowContractId: request.workflowContractId,
      workflowPlan: request.workflowPlan,
      projectId: run.codexProjectId,
      projectLabel: run.projectLabel,
      projectPath: run.projectPath
    });
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
        subagent: session.subagent
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
          status: "requested",
          threadId: run.codexSession?.threadId,
          threadTitle: run.codexSession?.threadTitle,
          threadUrl: run.codexSession?.threadUrl,
          codexProjectId: session.projectId ?? run.codexSession?.codexProjectId ?? run.codexProjectId,
          projectLabel: session.projectLabel ?? run.codexSession?.projectLabel ?? run.projectLabel,
          projectPath: session.projectPath ?? run.codexSession?.projectPath ?? run.projectPath,
          subagents,
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
    let launch: CodexSessionLaunch | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const goal = input.goal ?? `Run ${loop.title}`;
      const formalContract = state.formalContracts.find((contract) => contract.id === loopId);
      const runId = this.nextId("run");
      const attemptId = this.nextId("attempt");
      const workflowContextId = this.nextId("workflow");
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract, {
        runId,
        attemptId,
        workflowContextId
      });
      const workflowLaunch = formalContract ? buildWorkflowLaunch(formalContract) : {};
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
          subagents: codexSessionSubagentsForContract(formalContract, prompt),
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
        contract: formalContract,
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

      if (!codexSession.threadUrl) {
        result = {
          runId,
          status: "unavailable",
          message: "The Codex session has not been created by the host yet."
        };
        return state;
      }

      result = {
        runId,
        status: "ready",
        message: "Codex session is ready to open.",
        threadId: codexSession.threadId,
        threadTitle: codexSession.threadTitle,
        threadUrl: codexSession.threadUrl
      };

      return {
        ...state,
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), runId, "note", "Codex session open requested", timestamp, {
            codexThread: {
              threadId: codexSession.threadId,
              threadTitle: codexSession.threadTitle,
              threadUrl: codexSession.threadUrl
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
        threadUrl: input.threadUrl
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
      const workflowContextAfterTaskResult = targetContext
        ? completeWorkflowContextFromSessionResult(targetContext, resultInput, timestamp, { finalize: false })
        : undefined;
      const hasRemainingWorkflowSteps = Boolean(
        targetContract &&
        workflowContextAfterTaskResult &&
        hasRemainingExecutableSteps(targetContract, workflowContextAfterTaskResult)
      );
      const hasPendingWorkflowSessions = Boolean(workflowContextAfterTaskResult?.pendingSessionIds.length);
      const shouldContinueThisWorkflow = Boolean(
        resultInput.status === "passed" &&
        isWorkflowTaskResult &&
        hasRemainingWorkflowSteps &&
        !hasPendingWorkflowSessions
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
        const workflowProgressEvents = shouldWaitForPendingWorkflowSessions
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
        ...(runStatus === "completed" || runStatus === "failed" ? { completedAt: timestamp } : {})
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
      const workflowCompletionEvents = workflowCompletionEngineEvents({
        events: state.events,
        run,
        runId,
        attemptId,
        timestamp,
        input: resultInput,
        verification
      });
      const workflowContexts = targetContext
        ? state.workflowContexts.map((context) =>
            context.id === targetContext.id
              ? completeWorkflowContextFromSessionResult(context, resultInput, timestamp, { finalize: true })
              : context
          )
        : state.workflowContexts;

      return {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
        attempts,
        workflowContexts,
        verificationResults: [...state.verificationResults, verification],
        humanRequests: humanRequest ? [...state.humanRequests, humanRequest] : state.humanRequests,
        events: [
          ...state.events,
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
        memoryCommits: [...state.memoryCommits, commit]
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
          completedAt: timestamp
        };

        return completedRun;
      });

      return {
        ...state,
        runs
      };
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
      ? { ...input.contract, id: loopId }
      : applyContractPatch(baseContract, input.patch ?? {});
    const normalized = normalizeFormalContractInput(revisionContractInput, loopId);
    const contract = compileContract(
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
        subagent: session.subagent
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
      preparedContext = existingContext
        ? {
            ...existingContext,
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
        status: "running",
        createdAt: timestamp,
        updatedAt: timestamp
      };

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
        })
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

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
                  updatedAt: timestamp
                }
              : candidate
          ),
          updatedAt: timestamp
        })
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

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
        })
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

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
        })
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

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
        })
      };
    });
  }

  private async failWorkflowTask(workflowContextId: string, taskRunId: string, error: string): Promise<void> {
    const timestamp = this.now();

    await this.options.store.updateState((state) => {
      const context = requireWorkflowContext(state, workflowContextId);
      const taskRun = requireWorkflowTaskRun(context, taskRunId);

      return {
        ...state,
        workflowContexts: updateWorkflowContext(state.workflowContexts, workflowContextId, {
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
        })
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
  timestamp: string;
}): WorkflowContext {
  return {
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
    pendingSessionIds: [],
    idempotencyKeys: [],
    createdAt: input.timestamp,
    updatedAt: input.timestamp
  };
}

function completedWorkflowStepOutputs(context: WorkflowContext): Record<string, string> {
  return Object.fromEntries(
    Object.entries(context.steps)
      .filter(([, step]) => step.status === "completed" && step.output !== undefined)
      .map(([stepId, step]) => [stepId, step.output as string])
  );
}

function hasOpenWorkflowSessions(context: WorkflowContext): boolean {
  return context.pendingSessionIds.length > 0 ||
    context.taskRuns.some((taskRun) => taskRun.status === "running" || taskRun.status === "suspended");
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

function normalizeFormalContractInput(input: CreateLoopContractInput, id: string): FormalLoopContractInput {
  const { codexProjectId, projectLabel, projectPath, projectBinding, ...contractInput } = input;
  const normalizedProjectBinding = {
    codexProjectId: projectBinding?.codexProjectId ?? codexProjectId,
    projectLabel: projectBinding?.projectLabel ?? projectLabel,
    projectPath: projectBinding?.projectPath ?? projectPath
  };
  const hasProjectBinding = Object.values(normalizedProjectBinding).some(Boolean);

  return {
    ...contractInput,
    id,
    ...(hasProjectBinding ? { projectBinding: normalizedProjectBinding } : {})
  };
}

function applyContractPatch(
  baseContract: FormalLoopContract,
  patch: Partial<CreateLoopContractInput>
): CreateLoopContractInput {
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
      checks: contract.verification.rubrics.map((rubric) => rubric.requirement)
    },
    status: contract.status,
    codexProjectId: contract.projectBinding?.codexProjectId,
    projectLabel: contract.projectBinding?.projectLabel,
    projectPath: contract.projectBinding?.projectPath,
    createdAt: contract.createdAt,
    updatedAt: contract.updatedAt
  };
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
    const rubric = contract.verification.rubrics.find((candidate) => candidate.id === check.rubricId);

    return {
      name: rubric?.label ?? check.rubricId,
      status: verificationDecisionToResultStatus(check.status),
      output: check.evidence
    };
  });
}

type CompletedCodexSessionRef = CodexSessionRef & {
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
};
type CodexSubagentStatus = NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number]["status"];
type CodexSessionSubagent = NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number];

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

function codexSessionSubagentsForContract(
  contract: FormalLoopContract | undefined,
  prompt: string,
  status: CodexSubagentStatus = "requested"
): CodexSessionSubagent[] {
  if (!contract) {
    return [{ role: "loop-runner", status, prompt }];
  }

  const agents = flattenWorkflowLaunchSteps(contract.body.steps)
    .filter((step) => step.kind === "agent" || step.kind === "task")
    .map((step) => ({
      stepId: step.id,
      phaseId: step.phaseId,
      role: step.label,
      status,
      prompt: step.prompt ?? prompt,
      subagent: step.subagent
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

  return {
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
    "- verifier rubrics，包括 must/should 级别要求",
    "- repair policy：不通过时如何修复和重试",
    "- stop policy：何时停止",
    "- 用户最终想看的输出形式",
    "",
    "Contract 应至少表达这些结构：",
    "- title / goal / intent",
    "- body.steps：优先用 task(runtime: \"codex\") / phase / parallel 组织实际工作流；agent 仅作为旧 contract 兼容 spelling",
    "- verification.rubrics：用于检查 candidate result",
    "- repairPolicy 和 stopPolicy",
    "- projectBinding：绑定所选 Codex 项目",
    "",
    "完成后请用中文简短返回：loop id、项目名、workflow tasks、verifier rubrics、repair/stop 策略，以及下一步是否要立即启动一次 run。"
  ].join("\n");
}

function buildCodexSessionPrompt(
  loop: LoopContract,
  goal: string,
  contract?: FormalLoopContract,
  callbacks?: { runId: string; attemptId: string; workflowContextId: string }
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
        "- 按已编译的 Workflow steps 执行，再用 contract rubrics 验证 candidate result。",
        "- 如果验证失败且允许修复，请生成 candidate workflow draft，并通过 runtime 重试。",
        "- 不要覆盖当前 active workflow contract；workflow 改动只能作为候选修订，等待明确采纳。",
        `- Repair policy: ${contract.repairPolicy.strategy}，最多尝试 ${contract.repairPolicy.maxAttempts} 次。`,
        "",
        "Workflow steps / 工作流步骤：",
        formatWorkflowSteps(contract),
        "",
        "Verifier rubrics / 验证规则：",
        contract.verification.rubrics
          .map((rubric) => `- [${rubric.severity}] ${rubric.label}: ${rubric.requirement}`)
          .join("\n")
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
        "- Codex task/session 完成后，用 record_session_result({ runId, workflowContextId, attemptId, taskRunId/sessionId/stepId, idempotencyKey, status, summary, result }) 精确回写结果。",
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
  return {
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: contract.id,
    workflowPlan: {
      runtime: "dittosloop-local-workflow",
      contractId: contract.id,
      goal: contract.goal,
      steps: flattenWorkflowLaunchSteps(contract.body.steps),
      verification: contract.verification,
      repairPolicy: contract.repairPolicy,
      stopPolicy: contract.stopPolicy
    }
  };
}

function flattenWorkflowLaunchSteps(
  steps: FormalLoopContract["body"]["steps"],
  phaseId?: string,
  depth = 0
): WorkflowLaunchPlanStep[] {
  const items: WorkflowLaunchPlanStep[] = [];

  for (const step of steps) {
    if (step.kind === "agent" || step.kind === "task") {
      items.push({
        id: step.id,
        kind: step.kind,
        runtime: step.kind === "task" ? step.runtime : undefined,
        label: step.label,
        prompt: step.prompt,
        sessionPolicy: step.sessionPolicy,
        subagent: step.subagent,
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
    items.push(...flattenWorkflowLaunchSteps(step.children, step.kind === "phase" ? step.id : phaseId, depth + 1));
  }

  return items;
}

function formatWorkflowSteps(contract: FormalLoopContract): string {
  const lines: string[] = [];
  const visit = (steps: FormalLoopContract["body"]["steps"], depth: number): void => {
    for (const step of steps) {
      const indent = "  ".repeat(depth);
      if (step.kind === "agent" || step.kind === "task") {
        lines.push(`${indent}- ${step.kind} ${step.id}: ${step.label}`);
        lines.push(`${indent}  prompt: ${step.prompt}`);
      } else {
        lines.push(`${indent}- ${step.kind} ${step.id}: ${step.label}`);
        visit(step.children, depth + 1);
      }
    }
  };

  visit(contract.body.steps, 0);
  return lines.join("\n");
}
