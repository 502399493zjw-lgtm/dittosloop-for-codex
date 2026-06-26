import { evalScriptAst, type ScriptAst } from "../script/evalScript.js";
import type { FormalLoopContract, FormalLoopContractInput } from "./types.js";

export function compileContract(input: FormalLoopContractInput, now: string = new Date().toISOString()): FormalLoopContract {
  return {
    ...input,
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
