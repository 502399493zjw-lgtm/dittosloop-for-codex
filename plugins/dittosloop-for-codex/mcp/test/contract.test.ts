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
});
