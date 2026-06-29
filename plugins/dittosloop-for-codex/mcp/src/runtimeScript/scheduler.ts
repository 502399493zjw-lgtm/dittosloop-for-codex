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
  parallel<T>(tasks: Array<() => Promise<T>>, options?: { label?: string }): Promise<T[]>;
  pipeline<TInput, TOutput>(
    items: TInput[],
    stages: Array<(item: TInput | TOutput, index: number) => Promise<TOutput>>,
    options?: { label?: string }
  ): Promise<TOutput[]>;
  phase(label: string): { done(status?: "ok" | "failed"): void };
  log(message: string): void;
}

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
        status: result.status,
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

  const parallel = async <T>(tasks: Array<() => Promise<T>>, options?: { label?: string }): Promise<T[]> => {
    if (!Array.isArray(tasks)) {
      throw new Error("Runtime script parallel() expects an array of branch functions");
    }
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

  const pipeline = async <TInput, TOutput>(
    items: TInput[],
    stages: Array<(item: TInput | TOutput, index: number) => Promise<TOutput>>,
    options?: { label?: string }
  ): Promise<TOutput[]> => {
    if (!Array.isArray(items)) {
      throw new Error("Runtime script pipeline() expects an array of input items");
    }
    if (!Array.isArray(stages)) {
      throw new Error("Runtime script pipeline() expects an array of stage functions");
    }
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
