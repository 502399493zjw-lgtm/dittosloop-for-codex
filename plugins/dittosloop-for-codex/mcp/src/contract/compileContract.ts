import { evalScriptAst, type ScriptAst } from "../script/evalScript.js";
import type {
  FormalLoopContract,
  FormalLoopContractInput,
  LegacyVerificationPolicy,
  RuntimeScriptWorkflowDefinition,
  StaticStepsWorkflowDefinition,
  WorkflowDefinition,
  VerificationPolicyInput,
  VerificationPolicyV2
} from "./types.js";

const defaultDecision = {
  requireAllMustCriteriaCovered: true,
  failOnMustValidatorFailure: true,
  failOnShouldValidatorFailure: false,
  requireEvidenceForAgentScores: true
} satisfies VerificationPolicyV2["decision"];

const defaultRubricAgentPrompt = "Review the workflow result against the verification criteria.";

interface CompileContractOptions {
  allowRuntimeWorkflowObject: boolean;
}

export function migrateVerificationToV2(input: VerificationPolicyInput): VerificationPolicyV2 {
  if ("version" in input && input.version === 2) {
    return normalizeVerificationV2(input);
  }

  const legacy = input as LegacyVerificationPolicy;
  const criteria = legacy.rubrics.map((rubric) => ({
    id: rubric.id,
    label: rubric.label,
    description: rubric.requirement,
    severity: rubric.severity
  }));

  return normalizeVerificationV2({
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
            prompt: defaultRubricAgentPrompt,
            scoreScale: { min: 0, max: 1 },
            passScore: 1,
            evidenceRequired: true,
            severity: "must"
          }
        ]
      : [],
    decision: defaultDecision
  });
}

function normalizeVerificationV2(policy: VerificationPolicyV2): VerificationPolicyV2 {
  return {
    ...policy,
    validators: policy.validators.map((validator) => {
      if (validator.type !== "rubric_agent") {
        return validator;
      }

      return {
        ...validator,
        prompt: validator.prompt ?? defaultRubricAgentPrompt,
        scoreScale: validator.scoreScale ?? { min: 0, max: 1 },
        passScore: validator.passScore ?? validator.scoreScale?.max ?? 1,
        evidenceRequired: validator.evidenceRequired ?? true,
        allowSelfReview: validator.allowSelfReview ?? false
      };
    })
  };
}

export function compileContract(input: FormalLoopContractInput, now: string = new Date().toISOString()): FormalLoopContract {
  return compileContractInternal(input, now, { allowRuntimeWorkflowObject: false });
}

export function recompileFormalContract(input: FormalLoopContract, now: string = new Date().toISOString()): FormalLoopContract {
  return compileContractInternal(input, now, { allowRuntimeWorkflowObject: true });
}

function compileContractInternal(
  input: FormalLoopContractInput,
  now: string,
  options: CompileContractOptions
): FormalLoopContract {
  const { workflowKind, workflow, body, script, args, limits, approval, journal, verification, ...contractInput } = input;
  const normalizedWorkflow = normalizeWorkflowDefinition({
    workflowKind,
    workflow,
    body,
    script,
    args,
    limits,
    approval,
    journal
  }, options);

  return {
    ...contractInput,
    workflow: normalizedWorkflow.workflow,
    body: normalizedWorkflow.workflow.kind === "runtime_script" ? undefined : normalizedWorkflow.body,
    verification: migrateVerificationToV2(verification),
    trigger: contractInput.trigger ?? { mode: "manual" },
    repairPolicy: contractInput.repairPolicy ?? { maxAttempts: 1, strategy: "repair_then_retry" },
    stopPolicy: contractInput.stopPolicy ?? { rule: "user cancels" },
    status: contractInput.status ?? "active",
    createdAt: contractInput.createdAt ?? now,
    updatedAt: contractInput.updatedAt ?? now,
    ...(normalizedWorkflow.budgetUsd !== undefined && contractInput.budgetUsd === undefined
      ? { budgetUsd: normalizedWorkflow.budgetUsd }
      : {})
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
  return compileContract(
    {
      ...input,
      script: ast
    },
    now
  );
}

function normalizeWorkflowDefinition(input: Pick<
  FormalLoopContractInput,
  "workflowKind" | "workflow" | "body" | "script" | "args" | "limits" | "approval" | "journal"
>, options: CompileContractOptions): { workflow: WorkflowDefinition; body?: StaticStepsWorkflowDefinition["body"]; budgetUsd?: number } {
  if (input.body && input.script !== undefined) {
    throw new Error("Loop contract cannot include both body and script");
  }

  if (input.workflow?.kind === "runtime_script" && !options.allowRuntimeWorkflowObject) {
    throw new Error('Runtime script workflow objects are internal; use workflowKind: "runtime_script" with a string script');
  }

  if (typeof input.script === "string") {
    if (input.workflowKind !== "runtime_script") {
      throw new Error('String script requires workflowKind: "runtime_script"');
    }

    return {
      workflow: normalizeRuntimeScriptWorkflow(input, input.script)
    };
  }

  if (input.script !== undefined) {
    if (input.workflowKind === "runtime_script") {
      throw new Error("script.build is a static_steps builder script and cannot be used with workflowKind runtime_script");
    }

    const built = evalScriptAst(input.script as ScriptAst);
    const body = { steps: built.steps };
    return {
      workflow: { kind: "static_steps", body },
      body,
      ...(built.budgetUsd !== undefined ? { budgetUsd: built.budgetUsd } : {})
    };
  }

  if (input.workflow?.kind === "runtime_script") {
    return {
      workflow: normalizeRuntimeScriptWorkflow(input, input.workflow.source)
    };
  }

  if (input.body) {
    if (input.workflowKind === "runtime_script") {
      throw new Error("body.steps cannot be used with workflowKind runtime_script");
    }

    return {
      workflow: { kind: "static_steps", body: input.body },
      body: input.body
    };
  }

  const body = input.workflow?.body;
  return {
    workflow: { kind: "static_steps", body: body as StaticStepsWorkflowDefinition["body"] },
    body
  };
}

function normalizeRuntimeScriptWorkflow(
  input: Pick<FormalLoopContractInput, "workflow" | "args" | "limits" | "approval" | "journal">,
  source: string
): RuntimeScriptWorkflowDefinition {
  const workflow = input.workflow?.kind === "runtime_script" ? input.workflow : undefined;

  return {
    kind: "runtime_script",
    language: "javascript",
    source,
    ...(input.args !== undefined || workflow?.args !== undefined ? { args: input.args ?? workflow?.args } : {}),
    ...(input.limits !== undefined || workflow?.limits !== undefined ? { limits: input.limits ?? workflow?.limits } : {}),
    approval: input.approval ?? workflow?.approval ?? { required: true },
    ...(input.journal !== undefined || workflow?.journal !== undefined ? { journal: input.journal ?? workflow?.journal } : {})
  };
}
