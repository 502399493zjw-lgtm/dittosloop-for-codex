import path from "node:path";

import type {
  CodexProjectBinding,
  CodexSubagentSpec,
  FormalLoopContract,
  RuntimeScriptLimits,
  RuntimeScriptWorkflowDefinition,
  ScoreValidator,
  Step,
  VerificationCommandValidator,
  VerificationPolicyV2,
  VerificationRubricAgentValidator,
  VerificationValidator
} from "./types.js";

export const MAX_RUNTIME_SCRIPT_SOURCE_CHARS = 100_000;

const scoreOperators = new Set([">=", ">", "<=", "<", "==", "!="]);

export function validateContract(contract: FormalLoopContract): void {
  const errors: string[] = [];
  const stepIds = new Set<string>();

  required(contract.id, "id", errors);
  required(contract.title, "title", errors);
  required(contract.goal, "goal", errors);
  validateAgentProfiles(contract, errors);

  if (!contract.workflow) {
    errors.push("workflow is required");
  } else if (contract.workflow.kind === "runtime_script") {
    validateRuntimeScriptWorkflow(contract.workflow, contract.body, errors);
  } else {
    const body = contract.body ?? contract.workflow.body;
    if (!body || !Array.isArray(body.steps) || body.steps.length === 0) {
      errors.push("body.steps must contain at least one step");
    } else {
      for (const step of body.steps) {
        validateStep(contract, step, stepIds, errors);
      }
    }
  }

  validateVerificationV2(contract.verification, contract.projectBinding, errors);

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
  validateCodexSubagentSpec(subagent, `${step.kind} step ${step.id || "<missing>"} subagent`, errors);
}

function validateCodexSubagentSpec(subagent: CodexSubagentSpec | undefined, label: string, errors: string[]): void {
  if (!subagent) return;

  if (subagent.timeoutMs !== undefined && (!Number.isInteger(subagent.timeoutMs) || subagent.timeoutMs <= 0)) {
    errors.push(`${label}.timeoutMs must be a positive integer`);
  }

  if (subagent.tools !== undefined) {
    if (!Array.isArray(subagent.tools) || subagent.tools.some((tool) => !tool || tool.trim().length === 0)) {
      errors.push(`${label}.tools must contain non-empty strings`);
    }
  }

  if (
    subagent.permissions?.filesystem !== undefined &&
    !["read-only", "workspace-write", "danger-full-access"].includes(subagent.permissions.filesystem)
  ) {
    errors.push(`${label}.permissions.filesystem is invalid`);
  }

  if (
    subagent.permissions?.network !== undefined &&
    subagent.permissions.network !== "enabled" &&
    subagent.permissions.network !== "disabled"
  ) {
    errors.push(`${label}.permissions.network is invalid`);
  }
}

function validateRuntimeScriptWorkflow(
  workflow: RuntimeScriptWorkflowDefinition,
  body: FormalLoopContract["body"],
  errors: string[]
): void {
  if (workflow.language !== "javascript") {
    errors.push("runtime_script workflow language must be javascript");
  }

  if (!workflow.source || workflow.source.trim().length === 0) {
    errors.push("runtime_script workflow source is required");
  } else if (workflow.source.length > MAX_RUNTIME_SCRIPT_SOURCE_CHARS) {
    errors.push(`runtime_script workflow source must be at most ${MAX_RUNTIME_SCRIPT_SOURCE_CHARS} characters`);
  }

  if (body?.steps !== undefined) {
    errors.push("runtime_script workflow must not include body.steps");
  }

  validateRuntimeScriptLimits(workflow.limits, errors);

  if (!workflow.approval) {
    errors.push("runtime_script workflow approval policy is required");
  } else if (typeof workflow.approval.required !== "boolean") {
    errors.push("runtime_script workflow approval.required must be a boolean");
  }

  if (workflow.journal !== undefined && typeof workflow.journal.enabled !== "boolean") {
    errors.push("runtime_script workflow journal.enabled must be a boolean");
  }
}

function validateRuntimeScriptLimits(limits: RuntimeScriptLimits | undefined, errors: string[]): void {
  if (!limits) return;

  for (const [key, value] of Object.entries(limits)) {
    if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
      errors.push(`runtime_script workflow limits.${key} must be a positive integer`);
    }
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

function validateVerificationV2(
  verification: VerificationPolicyV2,
  _projectBinding: CodexProjectBinding | undefined,
  errors: string[]
): void {
  if (verification.version !== 2) {
    errors.push("verification.version must be 2");
  }

  if (verification.mode !== "after_workflow" && verification.mode !== "after_each_step") {
    errors.push("verification.mode must be after_workflow or after_each_step");
  }

  if (!Array.isArray(verification.criteria)) {
    errors.push("verification.criteria must be an array");
  }

  const criterionIds = new Set<string>();
  const coveredCriteria = new Set<string>();

  for (const criterion of verification.criteria ?? []) {
    required(criterion.id, "verification criterion id", errors);
    required(criterion.label, "verification criterion label", errors);
    required(criterion.description, "verification criterion description", errors);
    if (criterion.severity !== "must" && criterion.severity !== "should") {
      errors.push(`verification criterion ${criterion.id || "<missing>"} severity must be must or should`);
    }
    if (criterion.id) {
      if (criterionIds.has(criterion.id)) {
        errors.push(`criterion id must be unique: ${criterion.id}`);
      }
      criterionIds.add(criterion.id);
    }
  }

  if (!Array.isArray(verification.validators) || verification.validators.length === 0) {
    errors.push("verification.validators must contain at least one validator");
    return;
  }

  const validatorIds = new Set<string>();

  for (const validator of verification.validators) {
    validateVerificationValidatorMetadata(validator, criterionIds, validatorIds, coveredCriteria, errors);
  }

  for (const validator of verification.validators) {
    validateVerificationValidator(validator, validatorIds, errors);
  }

  if (verification.decision.requireAllMustCriteriaCovered) {
    for (const criterion of verification.criteria ?? []) {
      if (criterion.severity === "must" && !coveredCriteria.has(criterion.id)) {
        errors.push(`must criterion is not covered by any validator: ${criterion.id}`);
      }
    }
  }
}

function validateVerificationValidatorMetadata(
  validator: VerificationValidator,
  criterionIds: Set<string>,
  validatorIds: Set<string>,
  coveredCriteria: Set<string>,
  errors: string[]
): void {
  required(validator.id, "verification validator id", errors);
  required(validator.label, "verification validator label", errors);

  if (validator.id) {
    if (validatorIds.has(validator.id)) {
      errors.push(`validator id must be unique: ${validator.id}`);
    }
    validatorIds.add(validator.id);
  }

  if (validator.severity !== "must" && validator.severity !== "should") {
    errors.push(`verification validator ${validator.id || "<missing>"} severity must be must or should`);
  }

  for (const criterionId of validator.criteriaIds ?? []) {
    if (!criterionIds.has(criterionId)) {
      errors.push(`validator references missing criterion: ${criterionId}`);
    } else {
      coveredCriteria.add(criterionId);
    }
  }
}

function validateVerificationValidator(
  validator: VerificationValidator,
  validatorIds: Set<string>,
  errors: string[]
): void {
  switch (validator.type) {
    case "command":
      validateCommandValidator(validator, errors);
      return;
    case "score":
      validateScoreValidator(validator, validatorIds, errors);
      return;
    case "rubric_agent":
      validateRubricAgentValidator(validator, errors);
      return;
    default:
      errors.push("verification validator has invalid type");
  }
}

function validateCommandValidator(validator: VerificationCommandValidator, errors: string[]): void {
  if (!validator.command || validator.command.trim().length === 0) {
    errors.push("command validator command is required");
  }

  if (validator.cwd === undefined) {
    return;
  }

  if (typeof validator.cwd === "string") {
    if (path.isAbsolute(validator.cwd)) {
      errors.push("command validator cwd must not be absolute");
    }
    return;
  }

  const relativePath = validator.cwd.relativeToProject?.trim();
  if (!relativePath) {
    errors.push("command validator cwd relativeToProject is required");
    return;
  }

  if (path.isAbsolute(relativePath)) {
    errors.push("command validator cwd must not be absolute");
    return;
  }

  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    errors.push("command validator cwd must stay within the project");
  }
}

function validateScoreValidator(
  validator: ScoreValidator,
  validatorIds: Set<string>,
  errors: string[]
): void {
  if (!validator.metric || validator.metric.trim().length === 0) {
    errors.push("score validator metric is required");
  }

  if (!scoreOperators.has(validator.operator)) {
    errors.push("score validator operator is invalid");
  }

  if (!Number.isFinite(validator.threshold)) {
    errors.push("score validator threshold must be finite");
  }

  validateScoreSource(validator, validatorIds, errors);
}

function validateScoreSource(
  validator: ScoreValidator,
  validatorIds: Set<string>,
  errors: string[]
): void {
  const source = validator.source;
  if (!source || typeof source !== "object") {
    errors.push("score validator source is invalid");
    return;
  }

  if (!("type" in source)) {
    errors.push("score validator source is invalid");
    return;
  }

  switch (source.type) {
    case "workflow_result":
      if (!source.path || source.path.trim().length === 0) {
        errors.push("score validator source workflow_result.path is required");
      }
      return;
    case "artifact":
      if (!source.artifactId || source.artifactId.trim().length === 0) {
        errors.push("score validator source artifact.artifactId is required");
      }
      if (!source.path || source.path.trim().length === 0) {
        errors.push("score validator source artifact.path is required");
      }
      return;
    case "validator_output":
      if (!source.validatorId || source.validatorId.trim().length === 0) {
        errors.push("score validator source validator_output.validatorId is required");
      } else if (!validatorIds.has(source.validatorId)) {
        errors.push(`score validator source references missing validator: ${source.validatorId}`);
      }
      if (!source.path || source.path.trim().length === 0) {
        errors.push("score validator source validator_output.path is required");
      }
      return;
    default:
      errors.push("score validator source is invalid");
  }
}

function validateRubricAgentValidator(validator: VerificationRubricAgentValidator, errors: string[]): void {
  if (!Array.isArray(validator.criteriaIds) || validator.criteriaIds.length === 0) {
    errors.push("rubric_agent validator criteriaIds must contain at least one criterion");
  }

  if (!validator.prompt || validator.prompt.trim().length === 0) {
    errors.push("rubric_agent validator prompt is required");
  }

  if (validator.allowSelfReview !== undefined && typeof validator.allowSelfReview !== "boolean") {
    errors.push("rubric_agent validator allowSelfReview must be a boolean");
  }

  validateCodexSubagentSpec(validator.subagent, `rubric_agent validator ${validator.id || "<missing>"} subagent`, errors);

  const scoreScale = validator.scoreScale ?? { min: 0, max: 1 };
  const passScore = validator.passScore ?? scoreScale.max;
  const scoreValues = [scoreScale.min, scoreScale.max, passScore];
  if (scoreValues.some((value) => !Number.isFinite(value))) {
    errors.push("score validator threshold must be finite");
    return;
  }

  if (passScore < scoreScale.min || passScore > scoreScale.max) {
    errors.push("rubric_agent validator passScore must be inside scoreScale");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
