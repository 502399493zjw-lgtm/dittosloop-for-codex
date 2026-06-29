import vm from "node:vm";

import { createRuntimeScriptScheduler } from "./scheduler.js";
import type { RuntimeScriptRunInput } from "./types.js";
import { validateRuntimeScript } from "./validateScript.js";

export async function runRuntimeScriptInVm(input: RuntimeScriptRunInput): Promise<unknown> {
  const validation = validateRuntimeScript(input.source);
  if (!validation.ok) {
    throw new Error(`Runtime script failed validation: ${validation.errors.join("; ")}`);
  }

  const api = createRuntimeScriptScheduler(input);
  const context = vm.createContext(Object.freeze({
    agent: api.agent,
    parallel: api.parallel,
    pipeline: api.pipeline,
    phase: api.phase,
    log: api.log,
    args: deepFreeze(input.args),
    budget: Object.freeze({ limits: deepFreeze(input.limits) })
  }));

  const script = new vm.Script(`"use strict"; (async () => {\n${input.source}\n})()`, {
    filename: `dittosloop-runtime-script:${input.contractId}`
  });

  return await script.runInContext(context, { timeout: input.limits.timeoutMs });
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
