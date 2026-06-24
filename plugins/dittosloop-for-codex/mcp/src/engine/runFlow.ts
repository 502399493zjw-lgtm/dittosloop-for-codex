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
    phase(title, opts) {
      const phaseId = opts?.phaseId ?? title;
      let closed = false;
      emit({ type: "phase_started", label: title, title, phaseId });

      return {
        done(status = "ok") {
          if (closed) return;
          closed = true;
          emit({ type: "phase_done", phaseId, title, status });
        }
      };
    },
    async agent(prompt, opts) {
      emit({ type: "agent_started", label: opts?.label, stepId: opts?.stepId, phaseId: opts?.phaseId, prompt });
      try {
        const result = await deps.executor.run({
          prompt,
          label: opts?.label,
          stepId: opts?.stepId,
          phaseId: opts?.phaseId,
          workflowRuntime: deps.workflow?.runtime,
          workflowContractId: deps.workflow?.contractId,
          workflowPlan: deps.workflow
        });
        emit({
          type: "agent_done",
          label: opts?.label,
          stepId: opts?.stepId,
          phaseId: opts?.phaseId,
          result: result.text,
          session: result.data?.session
        });
        return result.text;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "agent_failed", label: opts?.label, stepId: opts?.stepId, phaseId: opts?.phaseId, error: message });
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
