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
