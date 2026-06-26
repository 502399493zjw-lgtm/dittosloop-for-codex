import path from "node:path";

import type { CodexProjectBinding, CodexSubagentSpec, FormalLoopContract, Step, VerificationPolicyV2 } from "./types.js";

export function validateContract(contract: FormalLoopContract): void {
  const errors: string[] = [];
  const stepIds = new Set<string>();

  required(contract.id, "id", errors);
  required(contract.title, "title", errors);
  required(contract.goal, "goal", errors);

  if (!contract.body || !Array.isArray(contract.body.steps) || contract.body.steps.length === 0) {
    errors.push("body.steps must contain at least one step");
  } else {
    for (const step of contract.body.steps) {
      validateStep(step, stepIds, errors);
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

function validateStep(step: Step, stepIds: Set<string>, errors: string[]): void {
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
      validateStep(child, stepIds, errors);
    }
    return;
  }

  const unknownStep = step as { id?: string };
  errors.push(`step ${unknownStep.id || "<missing>"} has invalid kind`);
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

    if (validator.type === "command") {
      if (!validator.command || validator.command.trim().length === 0) {
        errors.push("command validator command is required");
      }
      if (validator.cwd !== undefined && path.isAbsolute(validator.cwd)) {
        errors.push("command validator cwd must not be absolute");
      }
      continue;
    }

    const scoreValues = [validator.scoreScale.min, validator.scoreScale.max, validator.passScore];
    if (scoreValues.some((value) => !Number.isFinite(value))) {
      errors.push("score validator threshold must be finite");
      continue;
    }

    if (validator.passScore < validator.scoreScale.min || validator.passScore > validator.scoreScale.max) {
      errors.push("rubric_agent validator passScore must be inside scoreScale");
    }
  }

  if (verification.decision.requireAllMustCriteriaCovered) {
    for (const criterion of verification.criteria ?? []) {
      if (criterion.severity === "must" && !coveredCriteria.has(criterion.id)) {
        errors.push(`must criterion is not covered by any validator: ${criterion.id}`);
      }
    }
  }
}
