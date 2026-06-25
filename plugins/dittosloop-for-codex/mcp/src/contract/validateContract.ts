import type { CodexSubagentSpec, FormalLoopContract, Step } from "./types.js";

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
    if (step.sessionPolicy !== undefined && step.sessionPolicy !== "new") {
      errors.push(`${step.kind} step ${step.id || "<missing>"} sessionPolicy currently supports only new`);
    }
    validateSubagent(step.subagent, step, errors);
    return;
  }

  if (step.kind === "phase" || step.kind === "parallel") {
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
