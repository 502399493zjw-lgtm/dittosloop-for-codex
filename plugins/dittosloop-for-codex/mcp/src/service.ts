import { createId, type IdPrefix } from "./id.js";
import type {
  ArtifactRef,
  EventKind,
  HumanRequest,
  LoopContract,
  LoopRun,
  LoopState,
  MemoryCommit,
  RunEvent,
  RunStatus,
  VerificationResult,
  VerificationStatus
} from "./types.js";
import type { LoopStore } from "./store.js";

export interface LoopServiceOptions {
  store: LoopStore;
  now?: () => string;
  createId?: (prefix: IdPrefix) => string;
  previewBaseUrl?: string;
}

export interface CreateLoopInput {
  title: string;
  intent: string;
  verificationChecks?: string[];
}

export interface TriggerRunInput {
  goal?: string;
}

export interface AppendEventInput {
  kind?: EventKind;
  message: string;
  data?: Record<string, unknown>;
}

export interface RecordVerificationInput {
  status: VerificationStatus;
  summary: string;
  checks?: VerificationResult["checks"];
}

export interface RecordHumanRequestInput {
  question: string;
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
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.options.store.updateState((state) => ({
      ...state,
      loops: [...state.loops, loop]
    }));

    return loop;
  }

  async listLoops(): Promise<LoopContract[]> {
    const state = await this.options.store.readState();

    return state.loops;
  }

  async triggerRun(loopId: string, input: TriggerRunInput = {}): Promise<LoopRun> {
    const timestamp = this.now();
    const run: LoopRun = {
      id: this.nextId("run"),
      loopId,
      status: "running",
      goal: input.goal ?? "Manual loop run",
      trigger: "manual",
      createdAt: timestamp,
      updatedAt: timestamp
    };

    await this.options.store.updateState((state) => {
      requireLoop(state, loopId);

      return {
        ...state,
        runs: [...state.runs, run]
      };
    });

    return run;
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
    const result: VerificationResult = {
      id: this.nextId("verification"),
      runId,
      status: input.status,
      summary: input.summary,
      checks: input.checks ?? [],
      createdAt: this.now()
    };

    await this.options.store.updateState((state) => {
      requireRun(state, runId);

      return {
        ...state,
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

        completedRun = {
          ...run,
          status,
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

  async getSnapshot(): Promise<Snapshot> {
    const state = await this.options.store.readState();

    return {
      ...state,
      previewUrl: this.getPreviewUrl()
    };
  }

  getPreviewUrl(): string {
    return this.previewBaseUrl;
  }
}

function requireLoop(state: LoopState, loopId: string): LoopContract {
  const loop = state.loops.find((candidate) => candidate.id === loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  return loop;
}

function requireRun(state: LoopState, runId: string): LoopRun {
  const run = state.runs.find((candidate) => candidate.id === runId);
  if (!run) {
    throw new Error(`Run not found: ${runId}`);
  }

  return run;
}

function updateRun(runs: LoopRun[], runId: string, patch: Partial<LoopRun>): LoopRun[] {
  return runs.map((run) => (run.id === runId ? { ...run, ...patch } : run));
}
