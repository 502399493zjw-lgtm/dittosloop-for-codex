import type { LoopContract } from "../types.js";
import { compileContract } from "./compileContract.js";
import type { FormalLoopContract, VerificationCriterion, VerificationValidator } from "./types.js";

type MaybeFormalLoopContract = FormalLoopContract | LoopContract;

function commandValidatorForCheck(check: string, id: string) {
  const match = /^(npm)(?:\s+run)?\s+(test|build|lint|typecheck)$/.exec(check.trim());
  if (!match) return undefined;

  const script = match[2];
  const args = script === "test" ? ["test"] : ["run", script];
  return {
    id: `${id}-command`,
    type: "command" as const,
    label: check,
    command: "npm",
    args,
    cwd: "project" as const,
    timeoutMs: 120000,
    severity: "must" as const,
    parse: { kind: "none" as const }
  };
}

export function migrateLegacyContract(loop: MaybeFormalLoopContract): FormalLoopContract {
  if (isFormalContract(loop)) {
    return compileContract(loop, loop.updatedAt);
  }

  const goal = loop.intent || loop.title;
  const projectBinding =
    loop.codexProjectId || loop.projectLabel || loop.projectPath
      ? {
          codexProjectId: loop.codexProjectId,
          projectLabel: loop.projectLabel,
          projectPath: loop.projectPath
        }
      : undefined;

  return compileContract(
    {
      id: loop.id,
      title: loop.title,
      goal,
      intent: loop.intent,
      body: {
        steps: [{ id: "legacy-agent", kind: "agent", label: "Run loop", prompt: goal }]
      },
      trigger: loop.trigger,
      verification: migrateLegacyVerificationChecks(loop.verification.checks),
      projectBinding,
      status: loop.status,
      createdAt: loop.createdAt,
      updatedAt: loop.updatedAt
    },
    loop.updatedAt
  );
}

function isFormalContract(loop: MaybeFormalLoopContract): loop is FormalLoopContract {
  return "goal" in loop && "body" in loop && "repairPolicy" in loop && "stopPolicy" in loop;
}

function migrateLegacyVerificationChecks(checks: string[]): FormalLoopContract["verification"] {
  const validators: VerificationValidator[] = [];
  const criteria: VerificationCriterion[] = [];

  for (const [index, check] of checks.entries()) {
    const id = `check-${index + 1}`;
    const commandValidator = commandValidatorForCheck(check, id);

    if (commandValidator) {
      validators.push(commandValidator);
      continue;
    }

    criteria.push({
      id,
      label: check,
      description: check,
      severity: "must" as const
    });
  }

  if (criteria.length > 0) {
    validators.push({
      id: "legacy-rubric-agent",
      type: "rubric_agent" as const,
      label: "Legacy rubric review",
      criteriaIds: criteria.map((criterion) => criterion.id),
      scoreScale: { min: 0, max: 1 },
      passScore: 1,
      evidenceRequired: true,
      severity: "must" as const
    });
  }

  return {
    version: 2,
    mode: "after_workflow",
    criteria,
    validators,
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}
