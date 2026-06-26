import { expect, test } from "vitest";

import type { VerificationPolicyV2 } from "../src/contract/types.js";
import { shouldRepair } from "../src/runner/repair.js";
import { aggregateVerificationDecision, runVerificationV2 } from "../src/runner/verificationV2.js";
import { createFailedDecision, createPassedDecision } from "../src/runner/verifier.js";

test("creates structured verifier decisions from rubric checks", () => {
  expect(createPassedDecision("Looks good", [{ rubricId: "source", evidence: "official changelog" }])).toMatchObject({
    status: "passed",
    summary: "Looks good",
    checks: [{ rubricId: "source", status: "passed", evidence: "official changelog" }]
  });

  expect(createFailedDecision("Missing source", [{ rubricId: "source", evidence: "no source" }], "Add official source"))
    .toMatchObject({
      status: "failed",
      repairInstructions: "Add official source",
      checks: [{ rubricId: "source", status: "failed" }]
    });
});

test("repair policy retries only while attempts remain", () => {
  const decision = createFailedDecision("Missing source", [{ rubricId: "source" }], "Add source");
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "repair_then_retry" }, 1)).toBe(true);
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "repair_then_retry" }, 2)).toBe(false);
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "ask_human" }, 1)).toBe(false);
});

test("verification v2 command validators pass and fail by exit code", async () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "unit-tests",
      type: "command",
      label: "Unit tests",
      command: "npm",
      args: ["test"],
      cwd: "project",
      timeoutMs: 1000,
      criteriaIds: ["tests-pass"],
      severity: "must",
      parse: { kind: "none" }
    }
  ]);

  const passed = await runVerificationV2({
    id: "verification_1",
    runId: "run_1",
    attemptId: "attempt_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: {},
    projectPath: "/repo",
    commandExecutor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" })
  });
  const failed = await runVerificationV2({
    id: "verification_2",
    runId: "run_1",
    attemptId: "attempt_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: {},
    projectPath: "/repo",
    commandExecutor: async () => ({ exitCode: 1, stdout: "", stderr: "boom" })
  });

  expect(passed).toMatchObject({
    version: 2,
    status: "passed",
    validatorResults: [{ validatorId: "unit-tests", status: "passed", stdout: "ok" }]
  });
  expect(failed).toMatchObject({
    version: 2,
    status: "failed",
    validatorResults: [{ validatorId: "unit-tests", status: "failed", stderr: "boom" }]
  });
});

test("verification v2 score validators read workflow and validator output metrics", async () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "coverage",
      type: "score",
      label: "Coverage",
      metric: "coverage",
      source: { type: "workflow_result", path: "metrics.coverage" },
      operator: ">=",
      threshold: 0.8,
      criteriaIds: ["tests-pass"],
      severity: "must"
    },
    {
      id: "quality",
      type: "score",
      label: "Quality",
      metric: "quality",
      source: { type: "validator_output", validatorId: "coverage", path: "score" },
      operator: "==",
      threshold: 0.91,
      criteriaIds: ["tests-pass"],
      severity: "must"
    }
  ]);

  const result = await runVerificationV2({
    id: "verification_1",
    runId: "run_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: { metrics: { coverage: 0.91 } },
    commandExecutor: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  expect(result).toMatchObject({
    status: "passed",
    validatorResults: [
      { validatorId: "coverage", type: "score", score: 0.91, threshold: 0.8 },
      { validatorId: "quality", type: "score", score: 0.91, threshold: 0.91 }
    ]
  });
});

test("verification v2 does not auto-pass rubric agents or unloaded artifacts", async () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "human-review",
      type: "rubric_agent",
      label: "Human review",
      criteriaIds: ["tests-pass"],
      scoreScale: { min: 0, max: 1 },
      passScore: 1,
      evidenceRequired: true,
      severity: "must"
    },
    {
      id: "artifact-score",
      type: "score",
      label: "Artifact score",
      metric: "artifactQuality",
      source: { type: "artifact", artifactId: "report", path: "quality" },
      operator: ">=",
      threshold: 0.8,
      criteriaIds: ["tests-pass"],
      severity: "must"
    }
  ]);

  const result = await runVerificationV2({
    id: "verification_1",
    runId: "run_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: {}
  });

  expect(result).toMatchObject({
    status: "needs_human",
    validatorResults: [
      { validatorId: "human-review", status: "needs_human" },
      { validatorId: "artifact-score", status: "needs_human" }
    ]
  });
});

test("verification v2 uncovered must criteria fail aggregation", () => {
  const policy = verificationPolicyWithValidators([]);
  const decision = aggregateVerificationDecision(policy, []);

  expect(decision).toMatchObject({
    status: "failed",
    failedCriterionIds: ["tests-pass"]
  });
});

test("repair policy accepts verification v2 aggregated decisions", () => {
  const decision = aggregateVerificationDecision(verificationPolicyWithValidators([]), []);

  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "repair_then_retry" }, 1)).toBe(true);
});

function verificationPolicyWithValidators(validators: VerificationPolicyV2["validators"]): VerificationPolicyV2 {
  return {
    version: 2,
    mode: "after_workflow",
    criteria: [
      { id: "tests-pass", label: "Tests pass", description: "Tests pass.", severity: "must" }
    ],
    validators,
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}
