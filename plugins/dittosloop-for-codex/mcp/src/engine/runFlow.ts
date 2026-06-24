import { parallel as runParallel } from "./parallel.js";
import type { EngineEvent, EngineEventInput, FlowApi, RunFlowDeps, RunFlowResult } from "./types.js";

export async function runFlow<T>(
  flow: (api: FlowApi) => Promise<T> | T,
  deps: RunFlowDeps
): Promise<RunFlowResult> {
  let sequence = 0;
  const now = deps.now ?? (() => new Date().toISOString());
  const emit = (event: EngineEventInput): void => {
    deps.emit?.({
      ...event,
      runId: deps.runId,
      createdAt: now(),
      sequence: ++sequence
    } as EngineEvent);
  };

  const api: FlowApi = {
    phase(title) {
      emit({ type: "phase_started", label: title });
    },
    async agent(prompt, opts) {
      emit({ type: "agent_started", label: opts?.label, stepId: opts?.stepId, prompt });
      try {
        const result = await deps.executor.run({ prompt, label: opts?.label, stepId: opts?.stepId });
        emit({ type: "agent_done", label: opts?.label, stepId: opts?.stepId, result: result.text });
        return result.text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "agent_failed", label: opts?.label, stepId: opts?.stepId, error: message });
        throw error;
      }
    },
    async parallel(tasks, opts) {
      emit({ type: "parallel_started", label: opts?.label, count: tasks.length });
      const results = await runParallel(tasks);
      emit({ type: "parallel_completed", label: opts?.label, count: tasks.length });
      return results;
    },
    log(message) {
      emit({ type: "log", message });
    },
    commit(data) {
      emit({ type: "commit", data });
    }
  };

  emit({ type: "run_started" });

  try {
    const result = await flow(api);
    emit({ type: "run_completed", status: "completed", result });
    return { status: "completed", result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    emit({ type: "run_failed", status: "failed", error: message });
    throw error;
  }
}
