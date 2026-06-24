import type { ExecutionBody, Step } from "../contract/types.js";
import type { FlowApi } from "./types.js";

export async function runBody(body: ExecutionBody, api: FlowApi): Promise<unknown[]> {
  const results: unknown[] = [];

  for (const step of body.steps) {
    results.push(await runStep(step, api));
  }

  return results;
}

async function runStep(step: Step, api: FlowApi): Promise<unknown> {
  if (step.kind === "agent") {
    return api.agent(step.prompt, { label: step.label, stepId: step.id });
  }

  if (step.kind === "phase") {
    api.phase(step.label);
    const results: unknown[] = [];
    for (const child of step.children) {
      results.push(await runStep(child, api));
    }
    return results;
  }

  return api.parallel(
    step.children.map((child) => () => runStep(child, api)),
    { label: step.label, stepId: step.id }
  );
}
