import type { ExecutionBody, Step } from "../contract/types.js";
import type { FlowApi } from "./types.js";

export async function runBody(body: ExecutionBody, api: FlowApi): Promise<unknown[]> {
  const results: unknown[] = [];

  for (const step of body.steps) {
    results.push(await runStep(step, api));
  }

  return results;
}

async function runStep(step: Step, api: FlowApi, phaseId?: string, pipeline = false): Promise<unknown> {
  if (step.kind === "agent" || step.kind === "task") {
    return api.agent(step.prompt, {
      label: step.label,
      stepId: step.id,
      phaseId,
      subagent: step.subagent,
      ...(pipeline ? { pipeline: true } : {}),
      ...(step.kind === "task" && step.human ? { human: true } : {})
    });
  }

  if (step.kind === "phase") {
    const phase = api.phase(step.label, { phaseId: step.id, pipeline: step.pipeline === true });
    try {
      const results: unknown[] = [];
      for (const child of step.children) {
        results.push(await runStep(child, api, step.id, step.pipeline === true));
      }
      phase.done("ok");
      return results;
    } catch (error) {
      phase.done("failed");
      throw error;
    }
  }

  return api.parallel(
    step.children.map((child) => () => runStep(child, api, phaseId)),
    { label: step.label, stepId: step.id }
  );
}
