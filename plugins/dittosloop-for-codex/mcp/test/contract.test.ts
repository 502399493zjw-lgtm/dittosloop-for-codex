import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { migrateLegacyContract } from "../src/contract/migrateLegacyContract.js";
import { validateContract } from "../src/contract/validateContract.js";

const fixedTime = "2026-06-24T00:00:00.000Z";

describe("formal loop contracts", () => {
  test("compiles defaults for a one-step manual contract", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "AI monitor",
        goal: "Track AI tool updates",
        body: {
          steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan official updates" }]
        },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "source", label: "Source", requirement: "Uses official sources", severity: "must" }]
        }
      },
      fixedTime
    );

    expect(contract).toMatchObject({
      id: "loop_1",
      title: "AI monitor",
      goal: "Track AI tool updates",
      trigger: { mode: "manual" },
      repairPolicy: { maxAttempts: 1, strategy: "repair_then_retry" },
      stopPolicy: { rule: "user cancels" },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });
  });

  test("rejects duplicate step ids", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad loop",
        goal: "Run duplicated steps",
        body: {
          steps: [
            { id: "scan", kind: "agent", label: "Scan 1", prompt: "one" },
            { id: "scan", kind: "agent", label: "Scan 2", prompt: "two" }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/unique/i);
  });

  test("migrates a legacy loop into a formal one-step body", () => {
    const migrated = migrateLegacyContract({
      id: "loop_1",
      title: "Legacy",
      intent: "Keep project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });

    expect(migrated.goal).toBe("Keep project healthy");
    expect(migrated.body.steps).toEqual([
      { id: "legacy-agent", kind: "agent", label: "Run loop", prompt: "Keep project healthy" }
    ]);
    expect(migrated.verification).toMatchObject({
      version: 2,
      mode: "after_workflow",
      criteria: [],
      validators: [
        { id: "check-1-command", type: "command", command: "npm", args: ["test"], severity: "must" }
      ]
    });
  });

  test("accepts structured Codex subagent specs on task steps", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Subagent workflow",
        goal: "Run a specialized local Codex worker",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: {
                ref: "researcher",
                role: "code-researcher",
                model: "gpt-5-codex",
                tools: ["rg", "sed"],
                workdir: "/tmp/project",
                env: { LANG: "en_US.UTF-8" },
                permissions: {
                  filesystem: "workspace-write",
                  network: "enabled"
                },
                timeoutMs: 120000,
                context: { topic: "release notes" }
              }
            }
          ]
        },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "source", label: "Source", requirement: "Uses official sources", severity: "must" }]
        }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.body.steps[0]).toMatchObject({
      kind: "task",
      subagent: {
        ref: "researcher",
        role: "code-researcher",
        tools: ["rg", "sed"],
        permissions: {
          filesystem: "workspace-write",
          network: "enabled"
        }
      }
    });
  });

  test("rejects invalid Codex subagent timeout values", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: { timeoutMs: -1 } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/timeoutMs/i);
  });

  test("rejects task steps without the Codex runtime", () => {
    const missingRuntime = compileContract(
      {
        id: "loop_1",
        title: "Bad task workflow",
        goal: "Reject missing task runtime",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              label: "Scan worker",
              prompt: "Scan project changes."
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );
    const shellRuntime = compileContract(
      {
        id: "loop_2",
        title: "Bad task workflow",
        goal: "Reject non-Codex task runtime",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "shell",
              label: "Scan worker",
              prompt: "Scan project changes."
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(missingRuntime)).toThrow(/runtime must be codex/);
    expect(() => validateContract(shellRuntime)).toThrow(/runtime must be codex/);
  });

  test("rejects invalid Codex subagent tools and permissions", () => {
    const invalidTools = compileContract(
      {
        id: "loop_1",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent tool specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: { tools: ["rg", ""] } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );
    const invalidPermissions = compileContract(
      {
        id: "loop_2",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent permission specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: {
                permissions: { filesystem: "write-everywhere", network: "sometimes" }
              } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(invalidTools)).toThrow(/subagent\.tools/i);
    expect(() => validateContract(invalidPermissions)).toThrow(/subagent\.permissions\.filesystem/i);
    expect(() => validateContract(invalidPermissions)).toThrow(/subagent\.permissions\.network/i);
  });

  test("accepts pipeline phases and human task nodes", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Pipeline workflow",
        goal: "Thread outputs and gate on a human",
        body: {
          steps: [
            {
              id: "produce",
              kind: "phase",
              label: "Produce",
              pipeline: true,
              children: [
                { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write the draft." },
                { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review the draft." }
              ]
            },
            {
              id: "signoff",
              kind: "task",
              runtime: "codex",
              label: "Sign-off",
              prompt: "Approve the report?",
              human: true
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.body.steps[0]).toMatchObject({ kind: "phase", pipeline: true });
    expect(contract.body.steps[1]).toMatchObject({ kind: "task", human: true, prompt: "Approve the report?" });
  });

  test("rejects a human task without a prompt question", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad human workflow",
        goal: "Reject a human node without a question",
        body: {
          steps: [
            {
              id: "signoff",
              kind: "task",
              runtime: "codex",
              label: "Sign-off",
              prompt: "",
              human: true
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/human task step .* requires a prompt question|prompt is required/i);
  });

  test("rejects unsupported session reuse policies", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Reuse policy workflow",
        goal: "Reject session reuse until the runtime implements it",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              sessionPolicy: "reuse-run" as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/sessionPolicy currently supports only new/i);
  });

  test("accepts verification v2 criteria validators and decision policy", () => {
    const contract = compileContract(
      {
        id: "loop_v2",
        title: "V2 loop",
        goal: "Run real verification",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan project" }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "tests-pass", label: "Tests pass", description: "The repository test command passes.", severity: "must" }
          ],
          validators: [
            {
              id: "npm-test",
              type: "command",
              label: "npm test",
              command: "npm",
              args: ["test"],
              cwd: "project",
              timeoutMs: 120000,
              criteriaIds: ["tests-pass"],
              severity: "must",
              parse: { kind: "none" }
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.verification.version).toBe(2);
  });

  test("rejects invalid verification v2 validator references and duplicate ids", () => {
    const duplicateCriteria = compileContract(
      {
        id: "loop_bad",
        title: "Bad v2 loop",
        goal: "Reject bad verification",
        body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan" }] },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "quality", label: "Quality", description: "Meets quality bar.", severity: "must" },
            { id: "quality", label: "Quality again", description: "Duplicate id.", severity: "must" }
          ],
          validators: [
            {
              id: "agent-review",
              type: "rubric_agent",
              label: "Review",
              criteriaIds: ["missing"],
              scoreScale: { min: 0, max: 1 },
              passScore: 1,
              evidenceRequired: true,
              severity: "must"
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(duplicateCriteria)).toThrow(/criterion id must be unique/i);
    expect(() => validateContract(duplicateCriteria)).toThrow(/missing criterion/i);
  });

  test("migrates legacy verification checks into v2 command and rubric-agent validators", () => {
    const migrated = migrateLegacyContract({
      id: "loop_legacy",
      title: "Legacy",
      intent: "Keep project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test", "Use official sources"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });

    expect(migrated.verification).toMatchObject({
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "check-2", label: "Use official sources", description: "Use official sources", severity: "must" }
      ],
      validators: [
        { id: "check-1-command", type: "command", command: "npm", args: ["test"], severity: "must" },
        { id: "legacy-rubric-agent", type: "rubric_agent", criteriaIds: ["check-2"], evidenceRequired: true }
      ]
    });
  });
});
