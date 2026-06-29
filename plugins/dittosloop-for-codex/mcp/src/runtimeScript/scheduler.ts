import {
  hashRuntimeScriptArgs,
  hashRuntimeScriptOptions,
  hashRuntimeScriptPrompt,
  hashRuntimeScriptSource,
  runtimeAgentJournalKey
} from "./hash.js";
import type {
  RuntimeScriptAgentOptions,
  RuntimeScriptEventInput,
  RuntimeScriptRunInput
} from "./types.js";

export interface RuntimeScriptApi {
  agent(prompt: string, options?: RuntimeScriptAgentOptions): Promise<string>;
  parallel<T>(tasks: Array<() => Promise<T>>, options?: RuntimeWorkflowOptions): Promise<T[]>;
  parallel<T>(task: () => Promise<T>, ...tasks: Array<() => Promise<T>>): Promise<T[]>;
  pipeline<TInput, TOutput>(
    items: TInput[],
    stages: Array<(item: TInput | TOutput, index: number) => Promise<TOutput>>,
    options?: RuntimeWorkflowOptions
  ): Promise<TOutput[]>;
  pipeline<TInput, TOutput>(
    items: TInput[],
    stage: (item: TInput | TOutput, index: number) => Promise<TOutput>,
    ...stages: Array<(item: TInput | TOutput, index: number) => Promise<TOutput>>
  ): Promise<TOutput[]>;
  phase(label: string): { done(status?: "ok" | "failed"): void };
  log(message: string): void;
}

type RuntimeWorkflowOptions = { label?: string };
type RuntimeParallelTask<T> = () => Promise<T>;
type RuntimePipelineStage<TInput, TOutput> = (item: TInput | TOutput, index: number) => Promise<TOutput>;

export class RuntimeScriptAgentError extends Error {
  readonly status: "failed" | "needs_human";
  readonly session: unknown;

  constructor(message: string, status: "failed" | "needs_human", session?: unknown) {
    super(message);
    this.name = "RuntimeScriptAgentError";
    this.status = status;
    this.session = session;
  }
}

export function createRuntimeScriptScheduler(input: RuntimeScriptRunInput): RuntimeScriptApi {
  const scriptHash = hashRuntimeScriptSource(input.source);
  const argsHash = hashRuntimeScriptArgs(input.args);
  let agentSequence = 0;
  let logChars = 0;

  const emit = (type: string, data?: Record<string, unknown>) => {
    input.emit?.({
      type,
      runId: input.runId,
      attemptId: input.attemptId,
      workflowContextId: input.workflowContextId,
      contractId: input.contractId,
      timestamp: input.now(),
      data
    } satisfies RuntimeScriptEventInput);
  };

  const buildJournalRecord = (params: {
    key: string;
    callSite: string;
    prompt: string;
    options: RuntimeScriptAgentOptions | undefined;
    status: "completed" | "failed";
    output?: string;
    error?: string;
    sessionId?: string;
  }) => ({
    loopId: input.loopId ?? input.contractId,
    runId: input.runId,
    attemptId: input.attemptId,
    workflowContextId: input.workflowContextId,
    contractId: input.contractId,
    scriptHash,
    argsHash,
    key: params.key,
    callSite: params.callSite,
    promptHash: hashRuntimeScriptPrompt(params.prompt),
    optionsHash: hashRuntimeScriptOptions(params.options),
    status: params.status,
    output: params.output,
    error: params.error,
    sessionId: params.sessionId
  });

  const agent = async (prompt: string, options?: RuntimeScriptAgentOptions): Promise<string> => {
    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      throw new Error("Runtime script agent prompt must be non-empty");
    }

    agentSequence += 1;
    if (agentSequence > input.limits.maxAgentCalls) {
      throw new Error(`Runtime script exceeded maxAgentCalls (${input.limits.maxAgentCalls})`);
    }

    const labelOrPromptHash = options?.label?.trim() || hashRuntimeScriptPrompt(prompt);
    const callSite = `agent:${agentSequence}:${labelOrPromptHash}`;
    const key = runtimeAgentJournalKey({
      contractId: input.contractId,
      scriptHash,
      argsHash,
      callSite,
      prompt,
      options
    });

    const cached = await input.journal.get(key);
    if (cached?.status === "completed") {
      emit("agent:cached", {
        callSite,
        key,
        label: options?.label,
        sessionId: cached.sessionId
      });
      return cached.output ?? "";
    }

    emit("agent:start", {
      callSite,
      key,
      label: options?.label,
      prompt
    });

    const result = await input.subagentBridge.runAgent({
      prompt,
      label: options?.label,
      callSite,
      idempotencyKey: key,
      options
    });

    if (result.status === "completed") {
      const output = result.output ?? "";
      await input.journal.recordCompleted(buildJournalRecord({
        key,
        callSite,
        prompt,
        options,
        status: "completed",
        output,
        sessionId: result.session?.sessionId
      }));
      emit("agent:done", {
        callSite,
        key,
        label: options?.label,
        result: output,
        status: result.status,
        session: result.session,
        sessionId: result.session?.sessionId
      });
      return output;
    }

    if (result.status === "needs_human") {
      emit("agent:error", {
        callSite,
        key,
        label: options?.label,
        status: result.status,
        sessionId: result.session?.sessionId,
        error: result.error ?? "Sub-agent needs human input"
      });
      throw new RuntimeScriptAgentError(
        result.error ?? "Runtime script sub-agent needs human input",
        "needs_human",
        result.session
      );
    }

    await input.journal.recordFailed(buildJournalRecord({
      key,
      callSite,
      prompt,
      options,
      status: "failed",
      error: result.error ?? "Sub-agent failed",
      sessionId: result.session?.sessionId
    }));
    emit("agent:error", {
      callSite,
      key,
      label: options?.label,
      status: result.status,
      sessionId: result.session?.sessionId,
      error: result.error ?? "Sub-agent failed"
    });
    throw new RuntimeScriptAgentError(result.error ?? "Runtime script sub-agent failed", "failed", result.session);
  };

  const parallel = async <T>(...args: unknown[]): Promise<T[]> => {
    const { tasks, options } = normalizeParallelArgs<T>(args);
    if (tasks.length > input.limits.maxParallelBranches) {
      throw new Error(`Runtime script exceeded maxParallelBranches (${input.limits.maxParallelBranches})`);
    }

    emit("runtime_parallel_started", {
      label: options?.label,
      count: tasks.length,
      branches: tasks.length
    });
    const results = await Promise.all(tasks.map((task) => task()));
    emit("runtime_parallel_completed", {
      label: options?.label,
      count: tasks.length,
      branches: tasks.length
    });
    return results;
  };

  const pipeline = async <TInput, TOutput>(items: TInput[], ...args: unknown[]): Promise<TOutput[]> => {
    const { stages, options } = normalizePipelineArgs<TInput, TOutput>(items, args);
    if (items.length > input.limits.maxPipelineItems) {
      throw new Error(`Runtime script exceeded maxPipelineItems (${input.limits.maxPipelineItems})`);
    }

    emit("runtime_pipeline_started", {
      label: options?.label,
      count: items.length,
      items: items.length,
      stages: stages.length
    });
    const results = await Promise.all(
      items.map(async (item, index) => {
        let current: TInput | TOutput = item;
        for (const stage of stages) {
          current = await stage(current, index);
        }
        return current as TOutput;
      })
    );
    emit("runtime_pipeline_completed", {
      label: options?.label,
      count: items.length,
      items: items.length,
      stages: stages.length
    });
    return results;
  };

  const phase = (label: string): { done(status?: "ok" | "failed"): void } => {
    emit("runtime_phase_started", { label });
    return {
      done(status: "ok" | "failed" = "ok") {
        emit("runtime_phase_done", { label, status });
      }
    };
  };

  const log = (message: string): void => {
    const text = String(message);
    logChars += text.length;
    if (logChars > input.limits.maxLogChars) {
      throw new Error(`Runtime script exceeded maxLogChars (${input.limits.maxLogChars})`);
    }
    emit("runtime_log", { message: text });
  };

  return {
    agent,
    parallel,
    pipeline,
    phase,
    log
  };
}

function normalizeParallelArgs<T>(args: unknown[]): { tasks: RuntimeParallelTask<T>[]; options?: RuntimeWorkflowOptions } {
  const [first, second, ...rest] = args;
  if (Array.isArray(first)) {
    if (!areFunctions(first)) {
      throw new Error("Runtime script parallel() expects branch functions");
    }
    const options = normalizeOptions(second, rest, "parallel");
    return { tasks: first as RuntimeParallelTask<T>[], options };
  }

  const options = tryTakeTrailingOptions(args);
  const taskArgs = options ? args.slice(0, -1) : args;
  if (taskArgs.length === 0 || !areFunctions(taskArgs)) {
    throw new Error("Runtime script parallel() expects branch functions");
  }
  return { tasks: taskArgs as RuntimeParallelTask<T>[], options };
}

function normalizePipelineArgs<TInput, TOutput>(
  items: TInput[],
  args: unknown[]
): { stages: RuntimePipelineStage<TInput, TOutput>[]; options?: RuntimeWorkflowOptions } {
  if (!Array.isArray(items)) {
    throw new Error("Runtime script pipeline() expects an array of input items");
  }

  const [first, second, ...rest] = args;
  if (Array.isArray(first)) {
    if (!areFunctions(first)) {
      throw new Error("Runtime script pipeline() expects stage functions");
    }
    const options = normalizeOptions(second, rest, "pipeline");
    return { stages: first as RuntimePipelineStage<TInput, TOutput>[], options };
  }

  const options = tryTakeTrailingOptions(args);
  const stageArgs = options ? args.slice(0, -1) : args;
  if (stageArgs.length === 0 || !areFunctions(stageArgs)) {
    throw new Error("Runtime script pipeline() expects stage functions");
  }
  return { stages: stageArgs as RuntimePipelineStage<TInput, TOutput>[], options };
}

function normalizeOptions(
  candidate: unknown,
  remaining: unknown[],
  helperName: "parallel" | "pipeline"
): RuntimeWorkflowOptions | undefined {
  if (remaining.length > 0) {
    throw new Error(`Runtime script ${helperName}() received too many arguments`);
  }
  if (candidate === undefined) {
    return undefined;
  }
  if (!isRuntimeWorkflowOptions(candidate)) {
    throw new Error(`Runtime script ${helperName}() options must be an object`);
  }
  return candidate;
}

function tryTakeTrailingOptions(args: unknown[]): RuntimeWorkflowOptions | undefined {
  const last = args.at(-1);
  return isRuntimeWorkflowOptions(last) ? last : undefined;
}

function isRuntimeWorkflowOptions(value: unknown): value is RuntimeWorkflowOptions {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areFunctions(values: unknown[]): boolean {
  return values.every((value) => typeof value === "function");
}
