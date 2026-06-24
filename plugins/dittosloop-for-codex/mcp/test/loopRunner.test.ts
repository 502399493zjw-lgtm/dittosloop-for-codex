import { describe, expect, test } from "vitest";

import type { FormalLoopContract } from "../src/contract/types.js";
import { LoopRunner } from "../src/runner/loopRunner.js";

const contract: FormalLoopContract = {
  id: "loop_1",
  title: "AI monitor",
  goal: "Track AI tool updates",
  body: {
    steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
  },
  trigger: { mode: "manual" },
  verification: {
    mode: "after_workflow",
    rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
  },
  repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" },
  stopPolicy: { rule: "user cancels" },
  status: "active",
  createdAt: "2026-06-24T00:00:00.000Z",
  updatedAt: "2026-06-24T00:00:00.000Z"
};

describe("LoopRunner", () => {
  test("executes a formal contract body and returns verifier outcome", async () => {
    const events: string[] = [];
    const runner = new LoopRunner({
      executor: {
        async run(request) {
          return { text: `done:${request.prompt}` };
        }
      },
      verifier: async ({ result }) => ({
        status: "passed",
        summary: `verified:${JSON.stringify(result)}`,
        checks: [{ rubricId: "source", status: "passed", evidence: "official changelog" }]
      }),
      now: () => "2026-06-24T00:00:00.000Z"
    });

    const result = await runner.run({ contract, runId: "run_1", emit: (event) => events.push(event.type) });

    expect(result).toMatchObject({
      status: "completed",
      verification: { status: "passed" },
      shouldRepair: false
    });
    expect(result.output).toEqual(["done:Scan updates"]);
    expect(events).toEqual(["run_started", "agent_started", "agent_done", "run_completed"]);
  });

  test("marks failed verifier decisions as repairable while attempts remain", async () => {
    const runner = new LoopRunner({
      executor: {
        async run() {
          return { text: "missing source" };
        }
      },
      verifier: async () => ({
        status: "failed",
        summary: "Missing source",
        repairInstructions: "Add official source",
        checks: [{ rubricId: "source", status: "failed" }]
      })
    });

    const firstAttempt = await runner.run({ contract, runId: "run_1", attemptNumber: 1 });
    const secondAttempt = await runner.run({ contract, runId: "run_2", attemptNumber: 2 });

    expect(firstAttempt.shouldRepair).toBe(true);
    expect(secondAttempt.shouldRepair).toBe(false);
  });
});
