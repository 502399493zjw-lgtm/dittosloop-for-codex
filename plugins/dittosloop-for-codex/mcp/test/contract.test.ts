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
    expect(migrated.verification.rubrics).toEqual([
      { id: "check-1", label: "npm test", requirement: "npm test", severity: "must" }
    ]);
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
        verification: { mode: "after_workflow", rubrics: [] }
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
});
