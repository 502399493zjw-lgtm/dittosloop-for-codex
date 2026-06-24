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

export interface CreateLoopInput {
  title: string;
  intent: string;
  verificationChecks?: string[];
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export type CreateLoopContractInput = Omit<FormalLoopContractInput, "id"> & {
  id?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
};

export interface TriggerRunInput {
  goal?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface StartLoopRunInput {
  goal?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface RunLoopWorkflowInput {
  goal?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
  executor?: Executor;
  verifier?: LoopVerifier;
  repairWorkflow?: WorkflowRepairer;
}

export type WorkflowRepairer = (input: {
  contract: FormalLoopContract;
  decision: VerificationDecision;
  attemptNumber: number;
}) => Promise<FormalLoopContract> | FormalLoopContract;

export interface StartAttemptInput {
  summary?: string;
}

export interface StartCodexSessionRunInput {
  goal?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface ResumeLoopRunInput {
  goal?: string;
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
  kind: "agent" | "parallel" | "phase";
  label: string;
  depth: number;
  phaseId?: string;
  prompt?: string;
  sessionPolicy?: "new" | "reuse-run" | "reuse-step";
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

  async createLoop(input: CreateLoopInput): Promise<LoopContract> {
    const timestamp = this.now();
    const loop: LoopContract = {
      id: this.nextId("loop"),
      title: input.title,
      intent: input.intent,
      trigger: { mode: "manual" },
      verification: { checks: input.verificationChecks ?? [] },
      status: "active",
      codexProjectId: input.codexProjectId,
      projectLabel: input.projectLabel,
      projectPath: input.projectPath,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.options.store.updateState((state) => ({
      ...state,
      loops: [...state.loops, loop]
    }));

    return loop;
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

  async triggerRun(loopId: string, input: TriggerRunInput = {}): Promise<LoopRun> {
    const timestamp = this.now();
    let run: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const project = runProjectBinding(input, loop);
      run = {
        id: this.nextId("run"),
        loopId,
        status: "running",
        goal: input.goal ?? "Manual loop run",
        trigger: "manual",
        ...project,
        createdAt: timestamp,
        updatedAt: timestamp
      };

      return {
        ...state,
        runs: [...state.runs, run]
      };
    });

    return run!;
  }

  async startLoopRun(loopId: string, input: StartLoopRunInput = {}): Promise<LoopRun> {
    const timestamp = this.now();
    let run: LoopRun | undefined;

    await this.options.store.updateState((state) => {
      const contract = requireFormalContract(state, loopId);
      const loop = state.loops.find((candidate) => candidate.id === loopId) ?? formalContractToLoop(contract);
      const project = runProjectBinding(input, loop);
      run = {
        id: this.nextId("run"),
        loopId,
        status: "running",
        goal: input.goal ?? contract.goal,
        trigger: "manual",
        ...project,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const engineEvent = createEngineEvent("run_started", run.id, timestamp, 1);

      return {
        ...state,
        loops: state.loops.some((candidate) => candidate.id === loopId) ? state.loops : [...state.loops, loop],
        runs: [...state.runs, run],
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), run.id, "run_created", `Started ${contract.title}`, timestamp, {
            engineEvent: { ...engineEvent, runId: run.id }
          })
        ]
      };
    });

    return run!;
  }

  async runLoopWorkflow(loopId: string, input: RunLoopWorkflowInput): Promise<LoopRun> {
    const initialState = await this.options.store.readState();
    const baseContract = requireFormalContract(initialState, loopId);
    const run = await this.triggerRun(loopId, {
      goal: input.goal ?? baseContract.goal,
      codexProjectId: input.codexProjectId,
      projectLabel: input.projectLabel,
      projectPath: input.projectPath
    });
    let activeContract = baseContract;
    let finalRun: LoopRun = run;

    for (let attemptNumber = 1; attemptNumber <= baseContract.repairPolicy.maxAttempts; attemptNumber += 1) {
      const attempt = await this.startAttempt(run.id, { summary: `工作流执行第 ${attemptNumber} 次` });
      const engineEvents: EngineEvent[] = [];
      const runner = new LoopRunner({
        executor: input.executor ?? this.createCodexSessionExecutor(run),
        verifier: input.verifier,
        now: this.now
      });
      let result: LoopRunResult;
      try {
        result = await runner.run({
          contract: activeContract,
          runId: run.id,
          attemptNumber,
          emit: (event) => engineEvents.push(event)
        });
      } catch (error) {
        if (isCodexSessionPendingError(error)) {
          await this.recordEngineEvents(run.id, engineEvents.filter((event) => !isPendingSessionFailureEvent(event)));
          finalRun = await this.markRunWaitingForCodexSession(run.id, error.session);
          break;
        }
        throw error;
      }

      await this.recordEngineEvents(run.id, engineEvents);
      await this.recordVerification(run.id, {
        attemptId: attempt.id,
        status: verificationDecisionToResultStatus(result.verification.status),
        summary: result.verification.summary,
        checks: verificationDecisionChecksToResults(activeContract, result.verification),
        repair: result.shouldRepair
      });

      if (result.verification.status === "passed") {
        await this.completeAttempt(attempt.id, {
          status: "completed",
          summary: result.verification.summary
        });
        finalRun = await this.completeRun(run.id, { status: "completed" });
        break;
      }

      if (result.verification.status === "needs_human") {
        await this.completeAttempt(attempt.id, {
          status: "completed",
          summary: result.verification.summary
        });
        await this.recordHumanRequest(run.id, {
          question: result.verification.humanQuestion ?? result.verification.summary
        });
        finalRun = (await this.getRunDetail(run.id)).run;
        break;
      }

      await this.completeAttempt(attempt.id, {
        status: "failed",
        summary: result.verification.summary
      });

      if (!result.shouldRepair || !input.repairWorkflow) {
        finalRun = await this.completeRun(run.id, { status: "failed" });
        break;
      }

      activeContract = await input.repairWorkflow({
        contract: activeContract,
        decision: result.verification,
        attemptNumber
      });
      await this.recordWorkflowRevision(run.id, attempt.id, loopId, {
        status: "draft",
        reason: result.verification.summary,
        contract: activeContract
      });
    }

    return finalRun;
  }

  private createCodexSessionExecutor(run: LoopRun): Executor {
    const bridge = this.options.sessionBridge;
    if (!bridge) {
      throw new Error("No workflow executor or Codex session bridge is configured.");
    }

    return {
      run: async (request) => this.runCodexSessionStep(bridge, run, request)
    };
  }

  private async runCodexSessionStep(
    bridge: CodexSessionBridge,
    run: LoopRun,
    request: AgentRequest
  ): Promise<AgentResult> {
    const session = await bridge.createSession({
      runId: run.id,
      stepId: request.stepId,
      phaseId: request.phaseId,
      title: request.label ?? request.stepId ?? "Codex workflow step",
      prompt: request.prompt,
      workflowRuntime: request.workflowRuntime,
      workflowContractId: request.workflowContractId,
      workflowPlan: request.workflowPlan,
      projectId: run.codexProjectId,
      projectLabel: run.projectLabel,
      projectPath: run.projectPath
    });
    const result = await bridge.readResult(session.sessionId);

    if (!result) {
      throw new CodexSessionPendingError(session);
    }

    if (result.status === "failed") {
      throw new Error(result.text || `Codex session failed: ${session.sessionId}`);
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
      const subagents = [
        ...(run.codexSession?.subagents ?? []),
        {
          role: session.title,
          status: "requested" as const,
          threadId: undefined,
          threadTitle: undefined,
          threadUrl: undefined,
          prompt: session.prompt
        }
      ];

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
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract);
      const workflowLaunch = formalContract ? buildWorkflowLaunch(formalContract) : {};
      const attemptSummary = `Request a new Codex session for ${loop.title}`;
      const project = runProjectBinding(input, loop);
      const run: LoopRun = {
        id: this.nextId("run"),
        loopId,
        status: "running",
        goal,
        trigger: "manual",
        ...project,
        codexSession: {
          mode: "new_session",
          status: "requested",
          ...project,
          subagents: [
            {
              role: "loop-runner",
              status: "requested",
              prompt
            }
          ],
          prompt
        },
        createdAt: timestamp,
        updatedAt: timestamp
      };
      const attempt: RunAttempt = {
        id: this.nextId("attempt"),
        runId: run.id,
        status: "running",
        summary: attemptSummary,
        createdAt: timestamp
      };

      launch = {
        run,
        attempt,
        prompt,
        launchRequest: {
          runId: run.id,
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

  async resumeLoopRun(runId: string, input: ResumeLoopRunInput = {}): Promise<CodexSessionLaunch> {
    const timestamp = this.now();
    let launch: CodexSessionLaunch | undefined;

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      const loop = requireLoop(state, run.loopId);
      const goal = input.goal ?? `Resume ${loop.title}`;
      const formalContract = state.formalContracts.find((contract) => contract.id === loop.id);
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract);
      const workflowLaunch = formalContract ? buildWorkflowLaunch(formalContract) : {};
      const project = normalizeProjectBinding(run);
      const attempt: RunAttempt = {
        id: this.nextId("attempt"),
        runId,
        status: "running",
        summary: `Resume Codex session for ${loop.title}`,
        createdAt: timestamp
      };
      const updatedRun: LoopRun = {
        ...run,
        status: "running",
        goal,
        completedAt: undefined,
        updatedAt: timestamp,
        codexSession: {
          mode: "new_session",
          status: "requested",
          ...project,
          subagents: [
            ...(run.codexSession?.subagents ?? []),
            {
              role: "loop-runner",
              status: "requested",
              prompt
            }
          ],
          prompt
        }
      };

      launch = {
        run: updatedRun,
        attempt,
        prompt,
        launchRequest: {
          runId,
          loopId: run.loopId,
          title: `DittosLoop: ${loop.title}`,
          prompt,
          ...workflowLaunch,
          ...project
        }
      };

      return {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun : candidate)),
        attempts: [...state.attempts, attempt],
        events: [
          ...state.events,
          lifecycleEvent(this.nextId("event"), runId, "attempt_started", attempt.summary ?? "Loop run resumed", timestamp, {
            attemptId: attempt.id,
            resumed: true,
            ...project
          })
        ]
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

    await this.options.store.updateState((state) => {
      const run = requireRun(state, runId);
      if (!run.codexSession) {
        throw new Error(`Run has no Codex session request: ${runId}`);
      }

      const attemptsForRun = state.attempts.filter((attempt) => attempt.runId === runId);
      const targetAttempt = attemptsForRun.at(-1);
      const attemptId = targetAttempt?.id ?? this.nextId("attempt");
      const verification: VerificationResult = {
        id: this.nextId("verification"),
        runId,
        attemptId,
        status: input.status === "needs_human" ? "skipped" : input.status,
        summary: input.summary,
        checks: input.checks ?? [],
        createdAt: timestamp
      };
      const runStatus: RunStatus =
        input.status === "passed" ? "completed" : input.status === "needs_human" ? "waiting_for_human" : "failed";
      const subagentStatus: NonNullable<NonNullable<LoopRun["codexSession"]>["subagents"]>[number]["status"] =
        input.status === "failed" ? "failed" : "completed";
      const codexSession = {
        ...run.codexSession,
        status:
          input.status === "failed"
            ? "failed" as const
            : input.status === "passed"
              ? "completed" as const
              : run.codexSession.status === "requested"
                ? "started" as const
                : run.codexSession.status,
        subagents:
          run.codexSession.subagents && run.codexSession.subagents.length > 0
            ? run.codexSession.subagents.map((subagent) => ({
                  ...subagent,
                  status:
                    subagent.status === "requested" || subagent.status === "running" || subagent.status === "completed"
                      ? subagentStatus
                      : subagent.status
                }))
            : [
                {
                  role: "loop-runner",
                  status: subagentStatus
                }
              ]
      };

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
                  status: input.status === "failed" ? "failed" as const : "completed" as const,
                  summary: input.summary,
                  completedAt: timestamp
                }
              : attempt
          )
        : [
            ...state.attempts,
            {
              id: attemptId,
              runId,
              status: input.status === "failed" ? "failed" as const : "completed" as const,
              summary: input.summary,
              createdAt: timestamp,
              completedAt: timestamp
            }
          ];
      const humanRequest = input.status === "needs_human"
        ? {
            id: this.nextId("human"),
            runId,
            question: input.humanQuestion ?? input.summary,
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
        input,
        verification
      });

      return {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
        attempts,
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
          lifecycleEvent(this.nextId("event"), runId, "verification_recorded", input.summary, timestamp, {
            attemptId,
            verificationId: verification.id,
            sessionResult: {
              status: input.status,
              summary: input.summary,
              result: input.result
            }
          }),
          lifecycleEvent(this.nextId("event"), runId, "attempt_completed", input.summary, timestamp, {
            attemptId,
            verificationId: verification.id
          }),
          ...(runStatus === "completed" || runStatus === "failed"
            ? [
                lifecycleEvent(
                  this.nextId("event"),
                  runId,
                  "run_completed",
                  `Codex session result ${input.status}`,
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
      if (input.attemptId) {
        const attempt = requireAttempt(state, input.attemptId);
        if (attempt.runId !== runId) {
          throw new Error(`Attempt does not belong to run: ${input.attemptId}`);
        }
      }

      return {
        ...state,
        runs:
          input.repair && input.status === "failed"
            ? updateRun(state.runs, runId, { status: "repairing", updatedAt: timestamp })
            : state.runs,
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

      return {
        ...state,
        humanRequests: state.humanRequests.map((candidate) =>
          candidate.id === requestId ? resolvedRequest! : candidate
        )
      };
    });

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
      repairingRun = {
        ...run,
        status: "repairing",
        updatedAt: timestamp
      };

      return {
        ...state,
        runs: updateRun(state.runs, runId, { status: "repairing", updatedAt: timestamp }),
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
      workflowRevisions: state.workflowRevisions.filter((revision) => revision.runId === runId)
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
    attemptId: string,
    loopId: string,
    input: Pick<WorkflowRevision, "status" | "reason" | "contract">
  ): Promise<WorkflowRevision> {
    const timestamp = this.now();
    const revision: WorkflowRevision = {
      id: this.nextId("workflow"),
      loopId,
      runId,
      attemptId,
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

function workflowCompletionEngineEvents(input: {
  events: RunEvent[];
  run: LoopRun;
  runId: string;
  attemptId: string;
  timestamp: string;
  input: RecordSessionResultInput;
  verification: VerificationResult;
}): EngineEvent[] {
  const startedAgent = [...input.events]
    .reverse()
    .map((event) => event.data?.engineEvent)
    .find((event): event is Extract<EngineEvent, { type: "agent_started" }> => {
      return Boolean(event) && typeof event === "object" && (event as EngineEvent).type === "agent_started";
    });
  if (!startedAgent) return [];

  let sequence = Math.max(
    0,
    ...input.events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is EngineEvent => event !== null && event !== undefined && typeof event === "object" && "sequence" in event)
      .map((event) => event.sequence)
  );
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

function requireRun(state: LoopState, runId: string): LoopRun {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}

function requireAttempt(state: LoopState, attemptId: string): RunAttempt {
  const attempt = state.attempts.find((candidate) => candidate.id === attemptId);
  if (!attempt) {
    throw new Error(`Attempt not found: ${attemptId}`);
  }

  return attempt;
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
    "请根据用户意图创建正式 workflow 版 loop contract，不要使用兼容版 create_loop，除非用户明确要求简单记录型 loop。",
    "创建正式 loop 时请调用 DittosLoop MCP 工具 create_loop_contract。",
    ...projectLines,
    "",
    "创建前需要补齐或确认：",
    "- loop 目标和触发方式",
    "- 所属 Codex 项目",
    "- workflow steps，每个 agent 的 label 与 prompt",
    "- verifier rubrics，包括 must/should 级别要求",
    "- repair policy：不通过时如何修复和重试",
    "- stop policy：何时停止",
    "- 用户最终想看的输出形式",
    "",
    "Contract 应至少表达这些结构：",
    "- title / goal / intent",
    "- body.steps：用 agent / phase / parallel 组织实际工作流",
    "- verification.rubrics：用于检查 candidate result",
    "- repairPolicy 和 stopPolicy",
    "- projectBinding：绑定所选 Codex 项目",
    "",
    "完成后请用中文简短返回：loop id、项目名、workflow agents、verifier rubrics、repair/stop 策略，以及下一步是否要立即启动一次 run。"
  ].join("\n");
}

function buildCodexSessionPrompt(loop: LoopContract, goal: string, contract?: FormalLoopContract): string {
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
    if (step.kind === "agent") {
      items.push({
        id: step.id,
        kind: "agent",
        label: step.label,
        prompt: step.prompt,
        sessionPolicy: step.sessionPolicy,
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
      if (step.kind === "agent") {
        lines.push(`${indent}- agent ${step.id}: ${step.label}`);
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
