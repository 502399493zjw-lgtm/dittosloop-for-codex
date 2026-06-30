import { Worker } from "node:worker_threads";

import { createRuntimeScriptScheduler } from "./scheduler.js";
import type { RuntimeScriptRunInput } from "./types.js";
import { validateRuntimeScript } from "./validateScript.js";

export async function runRuntimeScriptInVm(input: RuntimeScriptRunInput): Promise<unknown> {
  const validation = validateRuntimeScript(input.source);
  if (!validation.ok) {
    throw new Error(`Runtime script failed validation: ${validation.errors.join("; ")}`);
  }

  const clonedArgs = cloneRuntimeScriptArgs(input.args);
  const api = createRuntimeScriptScheduler(input);

  return await new Promise<unknown>((resolve, reject) => {
    const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(runtimeScriptWorkerSource)}`), {
      workerData: {
        source: input.source,
        args: clonedArgs,
        limits: input.limits,
        contractId: input.contractId
      }
    });
    let settled = false;
    const timeout = setTimeout(() => {
      settle(reject, new Error(`Runtime script timed out after ${input.limits.timeoutMs}ms`));
      void worker.terminate();
    }, input.limits.timeoutMs);

    const settle = (callback: (value: unknown) => void, value: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      worker.removeAllListeners();
      callback(value);
    };

    worker.on("message", (message: RuntimeWorkerToParentMessage) => {
      void handleWorkerMessage(message);
    });
    worker.on("error", (error) => {
      settle(reject, error);
    });
    worker.on("exit", (code) => {
      if (!settled && code !== 0) {
        settle(reject, new Error(`Runtime script worker exited with code ${code}`));
      }
    });

    const emit = (type: string, data?: Record<string, unknown>) => {
      input.emit?.({
        type,
        runId: input.runId,
        attemptId: input.attemptId,
        workflowContextId: input.workflowContextId,
        contractId: input.contractId,
        timestamp: input.now(),
        data
      });
    };

    const handleWorkerMessage = async (message: RuntimeWorkerToParentMessage) => {
      if (settled) {
        return;
      }

      if (message.kind === "done") {
        settle(resolve, message.value);
        return;
      }

      if (message.kind === "error") {
        settle(reject, deserializeWorkerError(message.error));
        return;
      }

      if (message.kind === "event") {
        emit(message.type, message.data);
        return;
      }

      if (message.kind === "request" && message.api === "agent") {
        try {
          const output = await api.agent(message.prompt, message.options);
          worker.postMessage({ kind: "response", id: message.id, ok: true, value: output });
        } catch (error) {
          worker.postMessage({ kind: "response", id: message.id, ok: false, error: serializeWorkerError(error) });
        }
      }
    };
  });
}

function cloneRuntimeScriptArgs(args: Record<string, unknown>): Record<string, unknown> {
  try {
    return structuredClone(args);
  } catch (error) {
    throw new Error(
      `Runtime script args must be structured-cloneable JSON values: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

interface RuntimeWorkerRequestMessage {
  kind: "request";
  id: number;
  api: "agent";
  prompt: string;
  options?: Record<string, unknown>;
}

type RuntimeWorkerToParentMessage =
  | RuntimeWorkerRequestMessage
  | { kind: "event"; type: string; data?: Record<string, unknown> }
  | { kind: "done"; value: unknown }
  | { kind: "error"; error: SerializedWorkerError };

interface SerializedWorkerError {
  name?: string;
  message: string;
  status?: unknown;
  session?: unknown;
}

function serializeWorkerError(error: unknown): SerializedWorkerError {
  if (error instanceof Error) {
    const withRuntimeFields = error as Error & { status?: unknown; session?: unknown };
    return {
      name: error.name,
      message: error.message,
      status: withRuntimeFields.status,
      session: withRuntimeFields.session
    };
  }

  return {
    message: String(error)
  };
}

function deserializeWorkerError(error: SerializedWorkerError): Error {
  const deserialized = new Error(error.message);
  deserialized.name = error.name ?? "RuntimeScriptWorkerError";
  const withRuntimeFields = deserialized as Error & { status?: unknown; session?: unknown };
  withRuntimeFields.status = error.status;
  withRuntimeFields.session = error.session;
  return deserialized;
}

export function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (!value || typeof value !== "object") {
    return value;
  }

  const objectValue = value as Record<PropertyKey, unknown>;
  if (seen.has(objectValue)) {
    return value;
  }
  seen.add(objectValue);

  for (const key of Reflect.ownKeys(objectValue)) {
    deepFreeze(objectValue[key], seen);
  }

  return Object.freeze(value);
}

const runtimeScriptWorkerSource = String.raw`
import { parentPort, workerData } from "node:worker_threads";
import vm from "node:vm";

let nextRequestId = 1;
let logChars = 0;
const pendingRequests = new Map();

parentPort.on("message", (message) => {
  if (message.kind !== "response") {
    return;
  }
  const pending = pendingRequests.get(message.id);
  if (!pending) {
    return;
  }
  pendingRequests.delete(message.id);
  if (message.ok) {
    pending.resolve(message.value);
  } else {
    const error = new Error(message.error?.message ?? "Runtime script parent request failed");
    error.name = message.error?.name ?? "RuntimeScriptParentRequestError";
    error.status = message.error?.status;
    error.session = message.error?.session;
    pending.reject(error);
  }
});

function callParent(api, payload) {
  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    parentPort.postMessage({ kind: "request", id, api, ...payload });
  });
}

function emit(type, data) {
  parentPort.postMessage({ kind: "event", type, data });
}

function finish(message) {
  parentPort.postMessage(message);
  parentPort.close();
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

async function agent(prompt, options) {
  return await callParent("agent", { prompt, options });
}

function isWorkflowOptions(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function areFunctions(values) {
  return values.every((value) => typeof value === "function");
}

function normalizeOptions(candidate, remaining, helperName) {
  if (remaining.length > 0) {
    throw new Error("Runtime script " + helperName + "() received too many arguments");
  }
  if (candidate === undefined) {
    return undefined;
  }
  if (!isWorkflowOptions(candidate)) {
    throw new Error("Runtime script " + helperName + "() options must be an object");
  }
  return candidate;
}

function tryTakeTrailingOptions(args) {
  const last = args.at(-1);
  return isWorkflowOptions(last) ? last : undefined;
}

function normalizeParallelArgs(args) {
  const [first, second, ...rest] = args;
  if (Array.isArray(first)) {
    if (!areFunctions(first)) {
      throw new Error("Runtime script parallel() expects branch functions");
    }
    return { tasks: first, options: normalizeOptions(second, rest, "parallel") };
  }

  const options = tryTakeTrailingOptions(args);
  const tasks = options ? args.slice(0, -1) : args;
  if (tasks.length === 0 || !areFunctions(tasks)) {
    throw new Error("Runtime script parallel() expects branch functions");
  }
  return { tasks, options };
}

function normalizePipelineArgs(items, args) {
  if (!Array.isArray(items)) {
    throw new Error("Runtime script pipeline() expects an array of input items");
  }

  const [first, second, ...rest] = args;
  if (Array.isArray(first)) {
    if (!areFunctions(first)) {
      throw new Error("Runtime script pipeline() expects stage functions");
    }
    return { stages: first, options: normalizeOptions(second, rest, "pipeline") };
  }

  const options = tryTakeTrailingOptions(args);
  const stages = options ? args.slice(0, -1) : args;
  if (stages.length === 0 || !areFunctions(stages)) {
    throw new Error("Runtime script pipeline() expects stage functions");
  }
  return { stages, options };
}

function isHandledBranchFailure(error) {
  return Boolean(error && typeof error === "object" && error.status === "failed");
}

async function mapWithConcurrencyLimit(items, limit, mapper) {
  if (limit < 1) {
    throw new Error(` + "`Runtime script maxParallelBranches must be at least 1 (received ${limit})`" + `);
  }

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return results;
}

async function parallel(...args) {
  const { tasks, options } = normalizeParallelArgs(args);

  emit("runtime_parallel_started", {
    label: options?.label,
    count: tasks.length,
    branches: tasks.length
  });
  const results = await mapWithConcurrencyLimit(tasks, workerData.limits.maxParallelBranches, async (task) => {
    try {
      return await task();
    } catch (error) {
      if (isHandledBranchFailure(error)) {
        return null;
      }
      throw error;
    }
  });
  emit("runtime_parallel_completed", {
    label: options?.label,
    count: tasks.length,
    branches: tasks.length
  });
  return results;
}

async function pipeline(items, ...args) {
  const { stages, options } = normalizePipelineArgs(items, args);
  if (items.length > workerData.limits.maxPipelineItems) {
    throw new Error(` + "`Runtime script exceeded maxPipelineItems (${workerData.limits.maxPipelineItems})`" + `);
  }

  emit("runtime_pipeline_started", {
    label: options?.label,
    count: items.length,
    items: items.length,
    stages: stages.length
  });
  const results = await mapWithConcurrencyLimit(items, workerData.limits.maxParallelBranches, async (item, index) => {
    try {
      let current = item;
      for (const stage of stages) {
        current = await stage(current, item, index);
      }
      return current;
    } catch (error) {
      if (isHandledBranchFailure(error)) {
        return null;
      }
      throw error;
    }
  });
  emit("runtime_pipeline_completed", {
    label: options?.label,
    count: items.length,
    items: items.length,
    stages: stages.length
  });
  return results;
}

function phase(label) {
  emit("runtime_phase_started", { label });
  return {
    done(status = "ok") {
      emit("runtime_phase_done", { label, status });
    }
  };
}

function log(message) {
  const text = String(message);
  logChars += text.length;
  if (logChars > workerData.limits.maxLogChars) {
    throw new Error(` + "`Runtime script exceeded maxLogChars (${workerData.limits.maxLogChars})`" + `);
  }
  emit("runtime_log", { message: text });
}

(async () => {
  try {
    const context = vm.createContext(Object.freeze({
      agent,
      parallel,
      pipeline,
      phase,
      log,
      args: deepFreeze(workerData.args),
      budget: Object.freeze({ limits: deepFreeze(workerData.limits) })
    }));
    const script = new vm.Script(` + "`\"use strict\"; (async () => {\\n${workerData.source}\\n})()`" + `, {
      filename: ` + "`dittosloop-runtime-script:${workerData.contractId}`" + `
    });
    const value = await script.runInContext(context);
    finish({ kind: "done", value });
  } catch (error) {
    finish({
      kind: "error",
      error: {
        name: error?.name,
        message: error instanceof Error ? error.message : String(error),
        status: error?.status,
        session: error?.session
      }
    });
  }
})();
`;
