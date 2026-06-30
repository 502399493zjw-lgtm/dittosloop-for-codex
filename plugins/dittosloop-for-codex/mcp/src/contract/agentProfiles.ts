import type {
  AgentProfile,
  AgentStep,
  CodexSubagentSpec,
  EffectiveAgentProfile,
  FormalLoopContract,
  Step,
  TaskStep
} from "./types.js";

export function resolveEffectiveAgentProfile(
  contract: FormalLoopContract,
  step: AgentStep | TaskStep
): EffectiveAgentProfile | undefined {
  const requestedRef = step.agentProfileRef ?? step.subagent?.ref;
  const declaredProfile = requestedRef ? contract.agentProfiles?.[requestedRef] : undefined;

  if (step.agentProfileRef) {
    if (!declaredProfile) {
      return undefined;
    }

    return toEffectiveAgentProfile(step, declaredProfile, step.subagent, "declared", step.agentProfileRef);
  }

  if (declaredProfile) {
    return toEffectiveAgentProfile(step, declaredProfile, step.subagent, "declared", requestedRef);
  }

  if (!step.subagent) {
    return undefined;
  }

  return toEffectiveAgentProfile(step, undefined, step.subagent, "legacy-inline", requestedRef);
}

export function resolveEffectiveProfilesByStep(
  contract: FormalLoopContract
): Map<string, EffectiveAgentProfile> {
  const profiles = new Map<string, EffectiveAgentProfile>();
  const body = contract.body ?? (contract.workflow.kind === "static_steps" ? contract.workflow.body : undefined);

  if (!body) {
    return profiles;
  }

  visitSteps(body.steps, (step) => {
    if (step.kind !== "agent" && step.kind !== "task") return;

    const profile = resolveEffectiveAgentProfile(contract, step);
    if (profile) {
      profiles.set(step.id, profile);
    }
  });

  return profiles;
}

export function effectiveProfileToSubagent(
  profile: EffectiveAgentProfile | undefined,
  legacySubagent?: CodexSubagentSpec
): CodexSubagentSpec | undefined {
  if (!profile && !legacySubagent) {
    return undefined;
  }

  const profileSubagent = profile
    ? {
        ref: profile.id,
        role: profile.role,
        model: profile.model,
        tools: profile.allowedTools,
        workdir: profile.workdir,
        env: profile.env,
        permissions: profile.permissions,
        timeoutMs: profile.timeoutMs,
        context: profile.context
      }
    : undefined;

  return mergeSubagent(profileSubagent, legacySubagent);
}

function visitSteps(steps: Step[], visitor: (step: Step) => void): void {
  for (const step of steps) {
    visitor(step);
    if (step.kind === "phase" || step.kind === "parallel") {
      visitSteps(step.children, visitor);
    }
  }
}

function toEffectiveAgentProfile(
  step: AgentStep | TaskStep,
  declaredProfile: AgentProfile | undefined,
  inlineSubagent: CodexSubagentSpec | undefined,
  source: EffectiveAgentProfile["source"],
  requestedRef?: string
): EffectiveAgentProfile | undefined {
  if (!declaredProfile && !inlineSubagent) {
    return undefined;
  }

  const merged = mergeSubagent(
    declaredProfile
      ? {
          ref: declaredProfile.id,
          role: declaredProfile.role,
          model: declaredProfile.model,
          tools: declaredProfile.allowedTools,
          workdir: declaredProfile.workdir,
          env: declaredProfile.env,
          permissions: declaredProfile.permissions,
          timeoutMs: declaredProfile.timeoutMs,
          context: declaredProfile.context
        }
      : undefined,
    inlineSubagent
  );

  const id = declaredProfile?.id ?? requestedRef ?? step.subagent?.ref ?? step.id;
  const label = declaredProfile?.label ?? merged?.role ?? step.label;

  return {
    id,
    label,
    role: merged?.role ?? declaredProfile?.role ?? step.label,
    instructions: declaredProfile?.instructions,
    model: merged?.model,
    workdir: merged?.workdir,
    requiredSkills: declaredProfile?.requiredSkills ?? [],
    advisorySkills: declaredProfile?.advisorySkills ?? [],
    allowedTools: merged?.tools,
    permissions: merged?.permissions,
    env: merged?.env,
    timeoutMs: merged?.timeoutMs,
    context: merged?.context,
    source,
    stepId: step.id,
    requestedRef
  };
}

function mergeSubagent(
  base: CodexSubagentSpec | undefined,
  overrides: CodexSubagentSpec | undefined
): CodexSubagentSpec | undefined {
  if (!base && !overrides) {
    return undefined;
  }

  return {
    ...base,
    ...overrides,
    env: overrides?.env ?? base?.env,
    permissions: overrides?.permissions ?? base?.permissions,
    context: overrides?.context ?? base?.context,
    tools: overrides?.tools ?? base?.tools
  };
}
