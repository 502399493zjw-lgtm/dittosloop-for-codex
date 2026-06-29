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

async function parallel(tasks, options) {
  if (!Array.isArray(tasks)) {
    throw new Error("Runtime script parallel() expects an array of branch functions");
  }
  if (tasks.length > workerData.limits.maxParallelBranches) {
    throw new Error(` + "`Runtime script exceeded maxParallelBranches (${workerData.limits.maxParallelBranches})`" + `);
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
}

async function pipeline(items, stages, options) {
  if (!Array.isArray(items)) {
    throw new Error("Runtime script pipeline() expects an array of input items");
  }
  if (!Array.isArray(stages)) {
    throw new Error("Runtime script pipeline() expects an array of stage functions");
  }
  if (items.length > workerData.limits.maxPipelineItems) {
    throw new Error(` + "`Runtime script exceeded maxPipelineItems (${workerData.limits.maxPipelineItems})`" + `);
  }

  emit("runtime_pipeline_started", {
    label: options?.label,
    count: items.length,
    items: items.length,
    stages: stages.length
  });
  const results = await Promise.all(
    items.map(async (item, index) => {
      let current = item;
      for (const stage of stages) {
        current = await stage(current, index);
      }
      return current;
    })
  );
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
