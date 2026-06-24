import type { RepairPolicy } from "../contract/types.js";
import type { VerificationDecision } from "./verifier.js";

export function shouldRepair(decision: VerificationDecision, policy: RepairPolicy, attemptNumber: number): boolean {
  return decision.status === "failed" && policy.strategy === "repair_then_retry" && attemptNumber < policy.maxAttempts;
}
