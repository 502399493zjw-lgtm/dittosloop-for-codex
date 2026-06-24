import { createId, type IdPrefix } from "./id.js";
import { compileContract } from "./contract/compileContract.js";
import type { FormalLoopContract, FormalLoopContractInput } from "./contract/types.js";
import { validateContract } from "./contract/validateContract.js";
import type { EngineEvent, Executor } from "./engine/types.js";
import { LoopRunner, type LoopVerifier } from "./runner/loopRunner.js";
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
  executor: Executor;
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
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  };
}

export interface RecordCodexThreadInput {
  threadId: string;
  threadTitle?: string;
  threadUrl?: string;
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
    const contract = compileContract(
      {
        ...input,
        id: input.id ?? this.nextId("loop")
      },
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

  async listLoops(): Promise<LoopContract[]> {
    const state = await this.options.store.readState();

    return state.loops;
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
      const attempt = await this.startAttempt(run.id, { summary: `Workflow attempt ${attemptNumber}` });
      const engineEvents: EngineEvent[] = [];
      const runner = new LoopRunner({
        executor: input.executor,
        verifier: input.verifier,
        now: this.now
      });
      const result = await runner.run({
        contract: activeContract,
        runId: run.id,
        attemptNumber,
        emit: (event) => engineEvents.push(event)
      });

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

  async startCodexSessionRun(loopId: string, input: StartCodexSessionRunInput = {}): Promise<CodexSessionLaunch> {
    const timestamp = this.now();
    let launch: CodexSessionLaunch | undefined;

    await this.options.store.updateState((state) => {
      const loop = requireLoop(state, loopId);
      const goal = input.goal ?? `Run ${loop.title}`;
      const formalContract = state.formalContracts.find((contract) => contract.id === loopId);
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract);
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
          ...(formalContract
            ? {
                workflowRuntime: "dittosloop-local-workflow" as const,
                workflowContractId: formalContract.id
              }
            : {}),
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
      const runningSessionAttempts = state.attempts.filter(
        (attempt) => attempt.runId === runId && attempt.status === "running"
      );
      updatedRun = {
        ...run,
        status: "completed",
        updatedAt: timestamp,
        completedAt: run.completedAt ?? timestamp,
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
                        ? "completed"
                        : subagent.status,
                    ...codexThread
                  })
                )
              : [
                  {
                    role: "loop-runner",
                    status: "completed",
                    ...codexThread
                  }
                ]
        }
      };

      return {
        ...state,
        runs: state.runs.map((candidate) => (candidate.id === runId ? updatedRun! : candidate)),
        attempts: state.attempts.map((attempt) =>
          attempt.runId === runId && attempt.status === "running"
            ? {
                ...attempt,
                status: "completed",
                completedAt: timestamp
              }
            : attempt
        ),
        events: [
          ...state.events,
          lifecycleEvent(
            this.nextId("event"),
            runId,
            "note",
            "Codex thread created and attached to this run",
            timestamp,
            { codexThread }
          ),
          ...runningSessionAttempts.map((attempt) =>
            lifecycleEvent(
              this.nextId("event"),
              runId,
              "attempt_completed",
              "Codex thread created and attached to this run",
              timestamp,
              { attemptId: attempt.id, codexThread }
            )
          ),
          lifecycleEvent(this.nextId("event"), runId, "run_completed", "Codex session launch completed", timestamp, {
            codexThread
          })
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
    return `Workflow agent started: ${event.label ?? event.stepId ?? "agent"}`;
  }
  if (event.type === "agent_done") {
    return `Workflow agent completed: ${event.label ?? event.stepId ?? "agent"}`;
  }
  if (event.type === "phase_started") {
    return `Workflow phase started: ${event.label}`;
  }
  if (event.type === "parallel_started") {
    return `Workflow parallel group started: ${event.label ?? event.count}`;
  }
  if (event.type === "parallel_completed") {
    return `Workflow parallel group completed: ${event.label ?? event.count}`;
  }
  if (event.type === "run_failed") {
    return `Workflow run failed: ${event.error}`;
  }
  if (event.type === "log") {
    return event.message;
  }

  return `Workflow ${event.type}`;
}

function createEngineEvent(type: "run_started", runId: string, createdAt: string, sequence: number): EngineEvent {
  return {
    type,
    runId,
    createdAt,
    sequence
  };
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

function buildCodexSessionPrompt(loop: LoopContract, goal: string, contract?: FormalLoopContract): string {
  const checks = loop.verification.checks.length
    ? loop.verification.checks.map((check) => `- ${check}`).join("\n")
    : "- Record what changed, what was verified, and any follow-up needed.";
  const workflowContract = contract
    ? [
        "",
        "Workflow runtime:",
        `Contract id: ${contract.id}`,
        "- Use the local DittosLoop workflow runtime for this contract. Do not manually recreate or bypass the workflow.",
        "- Execute the compiled workflow steps, then verify the candidate result with the contract rubrics.",
        "- If verification fails and repair is allowed, create a candidate workflow draft and retry through the runtime.",
        "- Do not replace the active workflow contract. Workflow edits must stay as candidate revisions until explicitly adopted.",
        `- Repair policy: ${contract.repairPolicy.strategy}, max attempts ${contract.repairPolicy.maxAttempts}.`,
        "",
        "Workflow steps:",
        formatWorkflowSteps(contract),
        "",
        "Verifier rubrics:",
        contract.verification.rubrics
          .map((rubric) => `- [${rubric.severity}] ${rubric.label}: ${rubric.requirement}`)
          .join("\n")
      ].join("\n")
    : "";

  return [
    `You are starting a Dittos Live Loop run: ${loop.title}.`,
    "",
    `Loop intent: ${loop.intent}`,
    `Run goal: ${goal}`,
    "",
    "Before finishing this session:",
    "- Read the loop goal, recent history, and verification checks.",
    "- Work inside the selected Codex project when one is provided.",
    "- Write progress back to DittosLoop as attempt/events/verification records.",
    workflowContract,
    "",
    "Verification checks:",
    checks
  ].join("\n");
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
