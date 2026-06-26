import { evalScriptAst, type ScriptAst } from "../script/evalScript.js";
import type {
  FormalLoopContract,
  FormalLoopContractInput,
  LegacyVerificationPolicy,
  VerificationPolicyInput,
  VerificationPolicyV2
} from "./types.js";

const defaultDecision = {
  requireAllMustCriteriaCovered: true,
  failOnMustValidatorFailure: true,
  failOnShouldValidatorFailure: false,
  requireEvidenceForAgentScores: true
} satisfies VerificationPolicyV2["decision"];

export function migrateVerificationToV2(input: VerificationPolicyInput): VerificationPolicyV2 {
  if ("version" in input && input.version === 2) {
    return input;
  }

  const legacy = input as LegacyVerificationPolicy;
  const criteria = legacy.rubrics.map((rubric) => ({
    id: rubric.id,
    label: rubric.label,
    description: rubric.requirement,
    severity: rubric.severity
  }));

  return {
    version: 2,
    mode: legacy.mode === "after_each_agent" ? "after_each_step" : "after_workflow",
    criteria,
    validators: criteria.length
      ? [
          {
            id: "rubric-agent",
            type: "rubric_agent",
            label: "Rubric review",
            criteriaIds: criteria.map((criterion) => criterion.id),
            scoreScale: { min: 0, max: 1 },
            passScore: 1,
            evidenceRequired: true,
            severity: "must"
          }
        ]
      : [],
    decision: defaultDecision
  };
}

export function compileContract(input: FormalLoopContractInput, now: string = new Date().toISOString()): FormalLoopContract {
  return {
    ...input,
    verification: migrateVerificationToV2(input.verification),
    trigger: input.trigger ?? { mode: "manual" },
    repairPolicy: input.repairPolicy ?? { maxAttempts: 1, strategy: "repair_then_retry" },
    stopPolicy: input.stopPolicy ?? { rule: "user cancels" },
    status: input.status ?? "active",
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now
  };
}

// Compile a script (JSON builder-call AST) into a FormalLoopContract by first
// evaluating the AST through the pure builders, then folding the resulting
// steps / budget into the same compileContract path as the raw-Step[] form.
export function compileScriptContract(
  input: Omit<FormalLoopContractInput, "body">,
  ast: ScriptAst,
  now: string = new Date().toISOString()
): FormalLoopContract {
  const built = evalScriptAst(ast);
  return compileContract(
    {
      ...input,
      body: { steps: built.steps },
      ...(built.budgetUsd !== undefined && input.budgetUsd === undefined ? { budgetUsd: built.budgetUsd } : {})
    },
    now
  );
}
