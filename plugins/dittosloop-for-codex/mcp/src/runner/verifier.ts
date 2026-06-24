export type VerificationDecisionStatus = "passed" | "failed" | "needs_human";

export interface VerificationDecisionCheckInput {
  rubricId: string;
  evidence?: string;
}

export interface VerificationDecisionCheck extends VerificationDecisionCheckInput {
  status: VerificationDecisionStatus;
}

export interface VerificationDecision {
  status: VerificationDecisionStatus;
  summary: string;
  checks: VerificationDecisionCheck[];
  repairInstructions?: string;
}

export function createPassedDecision(
  summary: string,
  checks: VerificationDecisionCheckInput[] = []
): VerificationDecision {
  return {
    status: "passed",
    summary,
    checks: checks.map((check) => ({ ...check, status: "passed" }))
  };
}

export function createFailedDecision(
  summary: string,
  checks: VerificationDecisionCheckInput[] = [],
  repairInstructions?: string
): VerificationDecision {
  return {
    status: "failed",
    summary,
    repairInstructions,
    checks: checks.map((check) => ({ ...check, status: "failed" }))
  };
}

export function createNeedsHumanDecision(
  summary: string,
  checks: VerificationDecisionCheckInput[] = []
): VerificationDecision {
  return {
    status: "needs_human",
    summary,
    checks: checks.map((check) => ({ ...check, status: "needs_human" }))
  };
}
