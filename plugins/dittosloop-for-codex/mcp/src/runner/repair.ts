import type { RepairPolicy } from "../contract/types.js";
import type { VerificationDecision } from "./verifier.js";

type RepairableDecision = Pick<VerificationDecision, "status"> & {
  repairInstructions?: string;
};

export function shouldRepair(decision: RepairableDecision, policy: RepairPolicy, attemptNumber: number): boolean {
  return decision.status === "failed" && policy.strategy === "repair_then_retry" && attemptNumber < policy.maxAttempts;
}
