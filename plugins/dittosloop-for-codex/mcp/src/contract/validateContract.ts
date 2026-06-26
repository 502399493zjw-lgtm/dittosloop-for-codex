import type {
  AgentProfile,
  CodexSubagentSpec,
  FormalLoopContract,
  SkillRequirement,
  Step
} from "./types.js";

export function validateContract(contract: FormalLoopContract): void {
  const errors: string[] = [];
  const stepIds = new Set<string>();

  required(contract.id, "id", errors);
  required(contract.title, "title", errors);
  required(contract.goal, "goal", errors);
  validateAgentProfiles(contract, errors);

  if (!contract.body || !Array.isArray(contract.body.steps) || contract.body.steps.length === 0) {
    errors.push("body.steps must contain at least one step");
  } else {
    for (const step of contract.body.steps) {
      validateStep(contract, step, stepIds, errors);
    }
  }

  if (contract.verification.mode !== "after_workflow" && contract.verification.mode !== "after_each_agent") {
    errors.push("verification.mode must be after_workflow or after_each_agent");
  }

  if (!Array.isArray(contract.verification.rubrics)) {
    errors.push("verification.rubrics must be an array");
  } else {
    for (const rubric of contract.verification.rubrics) {
      required(rubric.id, "verification rubric id", errors);
      required(rubric.label, "verification rubric label", errors);
      required(rubric.requirement, "verification rubric requirement", errors);
      if (rubric.severity !== "must" && rubric.severity !== "should") {
        errors.push(`verification rubric ${rubric.id || "<missing>"} severity must be must or should`);
      }
    }
  }

  if (!Number.isInteger(contract.repairPolicy.maxAttempts) || contract.repairPolicy.maxAttempts < 0) {
    errors.push("repairPolicy.maxAttempts must be a non-negative integer");
  }

  if (
    contract.repairPolicy.strategy !== "repair_then_retry" &&
    contract.repairPolicy.strategy !== "ask_human" &&
    contract.repairPolicy.strategy !== "fail_run"
  ) {
    errors.push("repairPolicy.strategy is invalid");
  }

  required(contract.stopPolicy.rule, "stopPolicy.rule", errors);

  if (contract.budgetUsd !== undefined && (!Number.isFinite(contract.budgetUsd) || contract.budgetUsd <= 0 || contract.budgetUsd > 20)) {
    errors.push("budgetUsd must be a positive number no greater than 20");
  }

  if (contract.escalation !== undefined) {
    if (!Array.isArray(contract.escalation)) {
      errors.push("escalation must be an array");
    } else if (contract.escalation.some((boundary) => !boundary || boundary.trim().length === 0)) {
      errors.push("escalation must contain non-empty strings");
    }
  }

  if (errors.length > 0) {
    throw new Error(`Loop contract is invalid: ${errors.join("; ")}`);
  }
}

function validateStep(contract: FormalLoopContract, step: Step, stepIds: Set<string>, errors: string[]): void {
  required(step.id, "step id", errors);
  required(step.label, `step ${step.id || "<missing>"} label`, errors);

  if (step.id) {
    if (stepIds.has(step.id)) {
      errors.push(`step id must be unique: ${step.id}`);
    }
    stepIds.add(step.id);
  }

  if (step.kind === "agent" || step.kind === "task") {
    required(step.prompt, `${step.kind} step ${step.id || "<missing>"} prompt`, errors);
    if (step.kind === "task" && step.runtime !== "codex") {
      errors.push(`task step ${step.id || "<missing>"} runtime must be codex`);
    }
    if (step.kind === "task" && step.human === true) {
      if (!step.prompt || step.prompt.trim().length === 0) {
        errors.push(`human task step ${step.id || "<missing>"} requires a prompt question`);
      }
      if (step.runtime !== "codex") {
        errors.push(`human task step ${step.id || "<missing>"} runtime must be codex`);
      }
    }
    if (step.sessionPolicy !== undefined && step.sessionPolicy !== "new") {
      errors.push(`${step.kind} step ${step.id || "<missing>"} sessionPolicy currently supports only new`);
    }
    if (step.agentProfileRef && !contract.agentProfiles?.[step.agentProfileRef]) {
      errors.push(`${step.kind} step ${step.id || "<missing>"} agentProfileRef ${step.agentProfileRef} was not found`);
    }
    validateSubagent(step.subagent, step, errors);
    return;
  }

  if (step.kind === "phase" || step.kind === "parallel") {
    if (step.kind === "phase" && step.pipeline !== undefined && typeof step.pipeline !== "boolean") {
      errors.push(`phase step ${step.id || "<missing>"} pipeline must be a boolean`);
    }
    if (!Array.isArray(step.children) || step.children.length === 0) {
      errors.push(`${step.kind} step ${step.id || "<missing>"} must include children`);
      return;
    }

    for (const child of step.children) {
      validateStep(contract, child, stepIds, errors);
    }
    return;
  }

  const unknownStep = step as { id?: string };
  errors.push(`step ${unknownStep.id || "<missing>"} has invalid kind`);
}

function validateAgentProfiles(contract: FormalLoopContract, errors: string[]): void {
  if (contract.agentProfiles === undefined) {
    return;
  }

  if (!isRecord(contract.agentProfiles)) {
    errors.push("agentProfiles must be an object keyed by profile id");
    return;
  }

  for (const [profileId, profile] of Object.entries(contract.agentProfiles)) {
    if (!isRecord(profile)) {
      errors.push(`agentProfiles.${profileId} must be an object`);
      continue;
    }

    validateAgentProfile(profileId, profile, errors);
  }
}

function required(value: string | undefined, label: string, errors: string[]): void {
  if (!value || value.trim().length === 0) {
    errors.push(`${label} is required`);
  }
}

function validateSubagent(subagent: CodexSubagentSpec | undefined, step: Step, errors: string[]): void {
  if (!subagent) return;

  if (subagent.timeoutMs !== undefined && (!Number.isInteger(subagent.timeoutMs) || subagent.timeoutMs <= 0)) {
    errors.push(`${step.kind} step ${step.id || "<missing>"} subagent.timeoutMs must be a positive integer`);
  }

  if (subagent.tools !== undefined) {
    if (!Array.isArray(subagent.tools) || subagent.tools.some((tool) => !tool || tool.trim().length === 0)) {
      errors.push(`${step.kind} step ${step.id || "<missing>"} subagent.tools must contain non-empty strings`);
    }
  }

  if (
    subagent.permissions?.filesystem !== undefined &&
    !["read-only", "workspace-write", "danger-full-access"].includes(subagent.permissions.filesystem)
  ) {
    errors.push(`${step.kind} step ${step.id || "<missing>"} subagent.permissions.filesystem is invalid`);
  }

  if (
    subagent.permissions?.network !== undefined &&
    subagent.permissions.network !== "enabled" &&
    subagent.permissions.network !== "disabled"
  ) {
    errors.push(`${step.kind} step ${step.id || "<missing>"} subagent.permissions.network is invalid`);
  }
}

function validateAgentProfile(profileId: string, profile: Record<string, unknown>, errors: string[]): void {
  required(profileId, "agentProfiles key", errors);
  required(asOptionalString(profile.id), `agentProfiles.${profileId}.id`, errors);
  required(asOptionalString(profile.label), `agentProfiles.${profileId}.label`, errors);
  required(asOptionalString(profile.role), `agentProfiles.${profileId}.role`, errors);

  if (asOptionalString(profile.id) && profile.id !== profileId) {
    errors.push(`agentProfiles.${profileId}.id must match its object key`);
  }

  validateSkillRequirements(profile.requiredSkills, `agentProfiles.${profileId}.requiredSkills`, errors);
  validateSkillRequirements(profile.advisorySkills, `agentProfiles.${profileId}.advisorySkills`, errors);
  validateAllowedTools(profile.allowedTools, `agentProfiles.${profileId}.allowedTools`, errors);
  validatePermissions(profile.permissions, `agentProfiles.${profileId}.permissions`, errors);

  if (
    profile.timeoutMs !== undefined &&
    (typeof profile.timeoutMs !== "number" || !Number.isInteger(profile.timeoutMs) || profile.timeoutMs <= 0)
  ) {
    errors.push(`agentProfiles.${profileId}.timeoutMs must be a positive integer`);
  }
}

function validateSkillRequirements(requirements: unknown, label: string, errors: string[]): void {
  if (requirements === undefined) {
    return;
  }

  if (!Array.isArray(requirements)) {
    errors.push(`${label} must be an array`);
    return;
  }

  for (const [index, requirement] of requirements.entries()) {
    required(requirement?.id, `${label}[${index}].id`, errors);
    if (
      requirement?.source !== undefined &&
      requirement.source !== "plugin" &&
      requirement.source !== "project" &&
      requirement.source !== "user" &&
      requirement.source !== "system"
    ) {
      errors.push(`${label}[${index}].source must be plugin, project, user, or system`);
    }
  }
}

function validateAllowedTools(allowedTools: unknown, label: string, errors: string[]): void {
  if (allowedTools === undefined) {
    return;
  }

  if (!Array.isArray(allowedTools) || allowedTools.some((tool) => !tool || tool.trim().length === 0)) {
    errors.push(`${label} must contain non-empty strings`);
  }
}

function validatePermissions(permissions: unknown, label: string, errors: string[]): void {
  if (permissions === undefined) {
    return;
  }

  if (!isRecord(permissions)) {
    errors.push(`${label} must be an object`);
    return;
  }

  if (
    permissions.filesystem !== undefined &&
    !["read-only", "workspace-write", "danger-full-access"].includes(String(permissions.filesystem))
  ) {
    errors.push(`${label}.filesystem is invalid`);
  }

  if (
    permissions.network !== undefined &&
    permissions.network !== "enabled" &&
    permissions.network !== "disabled"
  ) {
    errors.push(`${label}.network is invalid`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
