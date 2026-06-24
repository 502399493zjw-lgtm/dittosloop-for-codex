import type { ExecutionBody, Step } from "../contract/types.js";
import type { FlowApi } from "./types.js";

export async function runBody(body: ExecutionBody, api: FlowApi): Promise<unknown[]> {
  const results: unknown[] = [];

  for (const step of body.steps) {
    results.push(await runStep(step, api));
  }

  return results;
}

async function runStep(step: Step, api: FlowApi, phaseId?: string): Promise<unknown> {
  if (step.kind === "agent") {
    return api.agent(step.prompt, { label: step.label, stepId: step.id, phaseId });
  }

  if (step.kind === "phase") {
    const phase = api.phase(step.label, { phaseId: step.id });
    try {
      const results: unknown[] = [];
      for (const child of step.children) {
        results.push(await runStep(child, api, step.id));
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
