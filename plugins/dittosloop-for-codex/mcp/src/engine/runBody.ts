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
  phaseId?: string,
  pipeline = false
): Promise<unknown> {
  if (step.kind === "agent" || step.kind === "task") {
    const agentProfile = effectiveProfilesByStep.get(step.id);
    return api.agent(step.prompt, {
      label: step.label,
      stepId: step.id,
      phaseId,
      subagent: effectiveProfileToSubagent(agentProfile, step.subagent),
      agentProfile,
      ...(pipeline ? { pipeline: true } : {}),
      ...(step.kind === "task" && step.human ? { human: true } : {})
    });
  }

  if (step.kind === "phase") {
    const phase = api.phase(step.label, { phaseId: step.id, pipeline: step.pipeline === true });
    try {
      const results: unknown[] = [];
      for (const child of step.children) {
        results.push(await runStep(child, api, effectiveProfilesByStep, step.id, step.pipeline === true));
      }
      phase.done("ok");
      return results;
    } catch (error) {
      phase.done("failed");
      throw error;
    }
  }

  return api.parallel(
    step.children.map((child) => () => runStep(child, api, effectiveProfilesByStep, phaseId, pipeline)),
    { label: step.label, stepId: step.id }
  );
}
