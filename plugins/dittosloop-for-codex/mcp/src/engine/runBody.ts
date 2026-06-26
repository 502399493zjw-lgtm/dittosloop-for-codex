import type { EffectiveAgentProfile, ExecutionBody, Step } from "../contract/types.js";
import { effectiveProfileToSubagent } from "../contract/agentProfiles.js";
import type { FlowApi } from "./types.js";

export async function runBody(
  body: ExecutionBody,
  api: FlowApi,
  effectiveProfilesByStep: Map<string, EffectiveAgentProfile> = new Map()
): Promise<unknown[]> {
  const results: unknown[] = [];

  for (const step of body.steps) {
    results.push(await runStep(step, api, effectiveProfilesByStep));
  }

  return results;
}

async function runStep(
  step: Step,
  api: FlowApi,
  effectiveProfilesByStep: Map<string, EffectiveAgentProfile>,
  phaseId?: string
): Promise<unknown> {
  if (step.kind === "agent" || step.kind === "task") {
    const agentProfile = effectiveProfilesByStep.get(step.id);
    return api.agent(step.prompt, {
      label: step.label,
      stepId: step.id,
      phaseId,
      subagent: effectiveProfileToSubagent(agentProfile, step.subagent),
      agentProfile
    });
  }

  if (step.kind === "phase") {
    const phase = api.phase(step.label, { phaseId: step.id });
    try {
      const results: unknown[] = [];
      for (const child of step.children) {
        results.push(await runStep(child, api, effectiveProfilesByStep, step.id));
      }
      phase.done("ok");
      return results;
    } catch (error) {
      phase.done("failed");
      throw error;
    }
  }

  return api.parallel(
    step.children.map((child) => () => runStep(child, api, effectiveProfilesByStep, phaseId)),
    { label: step.label, stepId: step.id }
  );
}
