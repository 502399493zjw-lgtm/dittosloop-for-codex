import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { expect, test } from "vitest";

import type { VerificationPolicyV2 } from "../src/contract/types.js";
import { shouldRepair } from "../src/runner/repair.js";
import {
  MAX_EVIDENCE_CHARS,
  aggregateVerificationDecision,
  recordedRubricAgentResultToValidatorResult,
  runVerificationV2
} from "../src/runner/verificationV2.js";
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

test("verification v2 script validators emit failed results instead of crashing", async () => {
  const workspace = createScriptWorkspace();
  const events: string[] = [];

  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_1",
      runId: "run_1",
      attemptId: "attempt_1",
      createdAt: "2026-06-26T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 1,
        stdout: "",
        stderr: "script boom"
      }),
      emit: (event) => {
        events.push(event.type);
      }
    });

    expect(result).toMatchObject({
      status: "failed",
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "failed",
          criteriaIds: ["tests-pass"]
        }
      ]
    });
    expect(result.validatorResults[0]?.summary).toContain("failed to execute");
    expect(result.validatorResults[0]?.evidence).toContain("stderr:");
    expect(events).toEqual(["validator_started", "validator_done", "verification_decided"]);
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators parse structured JSON results", async () => {
  const workspace = createScriptWorkspace();
  const requests: Array<{ command: string; args: string[]; cwd?: string; stdin?: string }> = [];
  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_script",
      runId: "run_1",
      attemptId: "attempt_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: { releaseNotes: "All changes covered." },
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async (request) => {
        requests.push(request);
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            status: "passed",
            score: 0.92,
            summary: "Release notes cover all changes.",
            evidence: ["Matched 8 of 8 commits."],
            criteriaResults: [
              {
                criterionId: "tests-pass",
                status: "passed",
                score: 0.92,
                evidence: "Every user-facing change is represented."
              }
            ],
            output: { matchedCommits: 8, totalCommits: 8 }
          }),
          stderr: ""
        };
      }
    });

    expect(requests[0]).toMatchObject({
      command: "node",
      args: ["evaluators/release-note-script/evaluator.mjs"],
      cwd: workspace.tempDir
    });
    expect(JSON.parse(requests[0].stdin ?? "{}")).toMatchObject({
      validatorId: "release-note-script",
      workflowResult: { releaseNotes: "All changes covered." }
    });
    expect(result).toMatchObject({
      status: "passed",
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "passed",
          score: 0.92,
          evidence: "Matched 8 of 8 commits.\nEvery user-facing change is represented."
        }
      ]
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators preserve criteriaResults in output when output is omitted", async () => {
  const workspace = createScriptWorkspace();

  try {
    const result = await runVerificationV2({
      id: "verification_script_criteria_output",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy: verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]),
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          summary: "Criterion details retained.",
          criteriaResults: [
            {
              criterionId: "tests-pass",
              status: "passed",
              score: 1,
              evidence: ["Detailed criterion evidence"]
            }
          ]
        }),
        stderr: ""
      })
    });

    expect(result.validatorResults[0]).toMatchObject({
      validatorId: "release-note-script",
      output: {
        criteriaResults: [
          {
            criterionId: "tests-pass",
            status: "passed",
            score: 1,
            evidence: ["Detailed criterion evidence"]
          }
        ]
      }
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators treat criterion evidence as satisfying evidence policy", async () => {
  const workspace = createScriptWorkspace();

  try {
    const result = await runVerificationV2({
      id: "verification_script_criteria_evidence",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy: verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]),
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          summary: "Criterion evidence only.",
          criteriaResults: [
            {
              criterionId: "tests-pass",
              status: "passed",
              evidence: ["Evidence came from the criterion result."]
            }
          ]
        }),
        stderr: ""
      })
    });

    expect(result).toMatchObject({
      status: "passed",
      validatorResults: [
        expect.objectContaining({
          validatorId: "release-note-script",
          status: "passed",
          evidence: "Evidence came from the criterion result."
        })
      ]
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators fail on invalid JSON output", async () => {
  const workspace = createScriptWorkspace();

  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_script_invalid",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: "not-json",
        stderr: "warning"
      })
    });

    expect(result).toMatchObject({
      status: "failed",
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "failed",
          summary: "Script validator release-note-script did not return valid verification_result_v1 JSON."
        }
      ]
    });
    expect(result.validatorResults[0]?.evidence).toContain("stdout:");
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators require evidence when validator marks it required", async () => {
  const workspace = createScriptWorkspace();

  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_script_missing_evidence",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          score: 1,
          summary: "Structured result but no evidence."
        }),
        stderr: ""
      })
    });

    expect(result).toMatchObject({
      status: "needs_human",
      decision: {
        needsHumanValidatorIds: ["release-note-script"],
        humanQuestion: "Review required for validators: release-note-script"
      }
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators cannot pass without required evidence", async () => {
  const workspace = createScriptWorkspace();
  const validator = scriptValidatorFixture({ checksum: workspace.checksum });
  if (validator.type !== "script") {
    throw new Error("expected script validator");
  }
  const policy = verificationPolicyWithValidators([{ ...validator, evidenceRequired: false }]);
  policy.decision.requireEvidenceForScriptResults = true;

  try {
    const result = await runVerificationV2({
      id: "verification_script_no_evidence",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          score: 1,
          summary: "Looks good."
        }),
        stderr: ""
      })
    });

    expect(result).toMatchObject({
      status: "needs_human",
      decision: {
        needsHumanValidatorIds: ["release-note-script"]
      }
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators surface missing required evidence in visible results", async () => {
  const workspace = createScriptWorkspace();
  const validatorDoneResults: Array<{ validatorId: string; status: string; summary: string }> = [];

  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_script_visible_no_evidence",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          score: 1,
          summary: "Structured result but no evidence."
        }),
        stderr: ""
      }),
      emit: (event) => {
        if (event.type === "validator_done") {
          validatorDoneResults.push({
            validatorId: event.result.validatorId,
            status: event.result.status,
            summary: event.result.summary
          });
        }
      }
    });

    expect(result).toMatchObject({
      status: "needs_human",
      checks: [
        {
          rubricId: "tests-pass",
          status: "needs_human"
        }
      ],
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "needs_human",
          summary: "Script validator result requires evidence."
        }
      ]
    });
    expect(validatorDoneResults).toEqual([
      {
        validatorId: "release-note-script",
        status: "needs_human",
        summary: "Script validator result requires evidence."
      }
    ]);
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators parse valid long JSON stdout before truncating stored logs", async () => {
  const workspace = createScriptWorkspace();
  const longEvidence = "x".repeat(MAX_EVIDENCE_CHARS);
  const stdout = JSON.stringify({
    status: "passed",
    score: 0.91,
    summary: "Long payload is still valid.",
    evidence: [longEvidence]
  });

  try {
    const policy = verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]);
    const result = await runVerificationV2({
      id: "verification_script_long_stdout",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy,
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => ({
        exitCode: 0,
        stdout,
        stderr: ""
      })
    });

    expect(result).toMatchObject({
      status: "passed",
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "passed",
          summary: "Long payload is still valid.",
          evidence: longEvidence
        }
      ]
    });
    expect(result.validatorResults[0]).toMatchObject({
      stdout: expect.stringContaining("[truncated]")
    });
  } finally {
    workspace.cleanup();
  }
});

test("verification v2 script validators reject invalid criteriaResults shapes", async () => {
  const invalidOutputs = [
    {
      label: "unknown criterion",
      payload: {
        status: "passed",
        summary: "bad criterion",
        criteriaResults: [{ criterionId: "missing", status: "passed" }]
      },
      message: "criterionId must be covered by the validator criteriaIds"
    },
    {
      label: "invalid status",
      payload: {
        status: "passed",
        summary: "bad status",
        criteriaResults: [{ criterionId: "tests-pass", status: "unknown" }]
      },
      message: "status must be passed, failed, or needs_human"
    },
    {
      label: "invalid score",
      payload: {
        status: "passed",
        summary: "bad score",
        criteriaResults: [{ criterionId: "tests-pass", status: "passed", score: "high" }]
      },
      message: "score must be a finite number"
    },
    {
      label: "invalid evidence",
      payload: {
        status: "passed",
        summary: "bad evidence",
        criteriaResults: [{ criterionId: "tests-pass", status: "passed", evidence: ["ok", ""] }]
      },
      message: "evidence must be a non-empty string or array of non-empty strings"
    }
  ];

  for (const invalidOutput of invalidOutputs) {
    const workspace = createScriptWorkspace();
    try {
      const result = await runVerificationV2({
        id: `verification_script_invalid_${invalidOutput.label.replace(/\s+/g, "_")}`,
        runId: "run_1",
        createdAt: "2026-06-29T00:00:00.000Z",
        policy: verificationPolicyWithValidators([scriptValidatorFixture({ checksum: workspace.checksum })]),
        workflowResult: {},
        contractWorkspacePath: workspace.tempDir,
        commandExecutor: async () => ({
          exitCode: 0,
          stdout: JSON.stringify(invalidOutput.payload),
          stderr: ""
        })
      });

      expect(result.validatorResults[0]).toMatchObject({
        validatorId: "release-note-script",
        type: "script",
        status: "failed",
        summary: "Script validator release-note-script did not return valid verification_result_v1 JSON."
      });
      expect(result.validatorResults[0]?.evidence).toContain(invalidOutput.message);
    } finally {
      workspace.cleanup();
    }
  }
});

test("verification v2 script validators fail checksum mismatches before execution", async () => {
  const workspace = createScriptWorkspace();
  let invoked = false;

  try {
    const result = await runVerificationV2({
      id: "verification_script_checksum_mismatch",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy: verificationPolicyWithValidators([scriptValidatorFixture({
        checksum: `sha256:${"f".repeat(64)}`
      })]),
      workflowResult: {},
      contractWorkspacePath: workspace.tempDir,
      commandExecutor: async () => {
        invoked = true;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    });

    expect(invoked).toBe(false);
    expect(result.validatorResults[0]).toMatchObject({
      validatorId: "release-note-script",
      type: "script",
      status: "failed",
      summary: "Script validator release-note-script checksum verification failed."
    });
    expect(result.validatorResults[0]?.evidence).toContain(workspace.checksum);
  } finally {
    workspace.cleanup();
  }
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

test("verification v2 recorded rubric results cannot pass without required evidence", () => {
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
    }
  ]);
  const validator = policy.validators[0];
  if (validator.type !== "rubric_agent") {
    throw new Error("expected rubric_agent validator");
  }

  const result = recordedRubricAgentResultToValidatorResult(validator, { status: "passed", score: 1 });
  const decision = aggregateVerificationDecision(policy, [result]);

  expect(result).toMatchObject({ validatorId: "human-review", status: "needs_human" });
  expect(decision).toMatchObject({
    status: "needs_human",
    needsHumanValidatorIds: ["human-review"]
  });
});

test("verification v2 needs-human aggregation preserves failed criterion ids", () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "unit-tests",
      type: "command",
      label: "Unit tests",
      command: "npm",
      args: ["test"],
      criteriaIds: ["tests-pass"],
      severity: "must",
      parse: { kind: "none" }
    },
    {
      id: "human-review",
      type: "rubric_agent",
      label: "Human review",
      criteriaIds: ["tests-pass"],
      scoreScale: { min: 0, max: 1 },
      passScore: 1,
      evidenceRequired: true,
      severity: "must"
    }
  ]);
  const decision = aggregateVerificationDecision(policy, [
    {
      validatorId: "unit-tests",
      type: "command",
      label: "Unit tests",
      severity: "must",
      criteriaIds: ["tests-pass"],
      status: "failed",
      summary: "Tests failed.",
      command: "npm",
      args: ["test"],
      exitCode: 1,
      stdout: "",
      stderr: "boom"
    },
    {
      validatorId: "human-review",
      type: "rubric_agent",
      label: "Human review",
      severity: "must",
      criteriaIds: ["tests-pass"],
      status: "needs_human",
      summary: "Review required."
    }
  ]);

  expect(decision).toMatchObject({
    status: "needs_human",
    failedValidatorIds: ["unit-tests"],
    failedCriterionIds: ["tests-pass"],
    needsHumanValidatorIds: ["human-review"]
  });
});

test("default command executor pipes stdin to child processes for script validators", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "verification-v2-stdin-"));
  const evaluatorDir = path.join(tempDir, "evaluators", "release-note-script");
  mkdirSync(evaluatorDir, { recursive: true });
  writeFileSync(
    path.join(evaluatorDir, "evaluator.mjs"),
    [
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "const payload = JSON.parse(input);",
      "process.stdout.write(JSON.stringify({",
      "  status: 'passed',",
      "  summary: 'stdin received',",
      "  evidence: [`releaseNotes=${payload.workflowResult.releaseNotes}`]",
      "}));"
    ].join("\n"),
    "utf8"
  );

  try {
    const checksum = checksumForContent([
      "let input = '';",
      "for await (const chunk of process.stdin) input += chunk;",
      "const payload = JSON.parse(input);",
      "process.stdout.write(JSON.stringify({",
      "  status: 'passed',",
      "  summary: 'stdin received',",
      "  evidence: [`releaseNotes=${payload.workflowResult.releaseNotes}`]",
      "}));"
    ].join("\n"));
    const result = await runVerificationV2({
      id: "verification_script_stdin",
      runId: "run_1",
      createdAt: "2026-06-29T00:00:00.000Z",
      policy: verificationPolicyWithValidators([scriptValidatorFixture({ checksum })]),
      workflowResult: { releaseNotes: "from-stdin" },
      contractWorkspacePath: tempDir
    });

    expect(result).toMatchObject({
      status: "passed",
      validatorResults: [
        {
          validatorId: "release-note-script",
          type: "script",
          status: "passed",
          evidence: "releaseNotes=from-stdin"
        }
      ]
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
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
      requireEvidenceForAgentScores: true,
      requireEvidenceForScriptResults: true
    }
  };
}

function scriptValidatorFixture(
  overrides: Partial<VerificationPolicyV2["validators"][number]> & {
    checksum?: string;
    scriptRef?: Partial<VerificationPolicyV2["validators"][number]["scriptRef"]>;
  } = {}
): VerificationPolicyV2["validators"][number] {
  const { checksum, scriptRef: scriptRefOverrides = {}, ...validatorOverrides } = overrides;
  const scriptRef = {
    path: "evaluators/release-note-script/evaluator.mjs",
    checksum: checksum ?? `sha256:${"0".repeat(64)}`,
    cwd: "loop",
    args: [],
    timeoutMs: 30000,
    ...scriptRefOverrides
  };

  return {
    id: "release-note-script",
    type: "script",
    label: "Release note script",
    criteriaIds: ["tests-pass"],
    severity: "must",
    runtime: "node",
    input: { source: "workflow_result" },
    output: { schema: "verification_result_v1" },
    evidenceRequired: true,
    builder: {
      kind: "codex_subagent",
      builtAt: "2026-06-29T00:00:00.000Z",
      selfCheck: {
        status: "passed",
        command: "node",
        args: ["evaluators/release-note-script/evaluator.mjs"],
        evidence: "fixture passed"
      }
    },
    ...validatorOverrides,
    scriptRef
  };
}

function createScriptWorkspace(sourceLines?: string[]) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "verification-v2-script-"));
  const evaluatorDir = path.join(tempDir, "evaluators", "release-note-script");
  const source = (sourceLines ?? [
    "process.stdout.write(JSON.stringify({ status: 'passed', summary: 'fixture', evidence: ['fixture evidence'] }));"
  ]).join("\n");
  mkdirSync(evaluatorDir, { recursive: true });
  writeFileSync(path.join(evaluatorDir, "evaluator.mjs"), source, "utf8");
  return {
    tempDir,
    checksum: checksumForContent(source),
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

function checksumForContent(source: string): string {
  return `sha256:${createHash("sha256").update(source).digest("hex")}`;
}
