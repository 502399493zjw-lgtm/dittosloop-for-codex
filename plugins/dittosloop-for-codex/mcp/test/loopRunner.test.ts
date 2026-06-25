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
    expect(events).toEqual([
      "run_started",
      "agent_started",
      "agent_done",
      "run_completed",
      "verification_started",
      "verification_done",
      "run_done"
    ]);
  });

  test("marks failed verifier decisions as repairable while attempts remain", async () => {
    const events: string[] = [];
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

    const emittedAttemptIds: string[] = [];
    const firstAttempt = await runner.run({
      contract,
      runId: "run_1",
      attemptId: "persisted_attempt_17",
      attemptNumber: 1,
      emit: (event) => {
        events.push(event.type);
        if ("attemptId" in event) {
          emittedAttemptIds.push(event.attemptId);
        }
      }
    });
    const secondAttempt = await runner.run({ contract, runId: "run_2", attemptNumber: 2 });

    expect(firstAttempt.shouldRepair).toBe(true);
    expect(firstAttempt.status).toBe("repairing");
    expect(secondAttempt.shouldRepair).toBe(false);
    expect(secondAttempt.status).toBe("failed");
    expect(events).toContain("repair_started");
    expect(emittedAttemptIds).toEqual([
      "persisted_attempt_17",
      "persisted_attempt_17",
      "persisted_attempt_17"
    ]);
  });

  test("emits a human request when verification needs a decision", async () => {
    const events: Array<{ type: string; question?: string; status?: string }> = [];
    const runner = new LoopRunner({
      executor: {
        async run() {
          return { text: "ambiguous result" };
        }
      },
      verifier: async () => ({
        status: "needs_human",
        summary: "Need user to choose a source policy.",
        humanQuestion: "Should the loop accept unofficial community sources?",
        checks: [{ rubricId: "source", status: "needs_human" }]
      }),
      now: () => "2026-06-24T00:00:00.000Z"
    });

    const result = await runner.run({
      contract,
      runId: "run_human",
      emit: (event) => events.push({
        type: event.type,
        question: event.type === "human_request" ? event.question : undefined,
        status: event.type === "run_done" ? event.status : undefined
      })
    });

    expect(result.status).toBe("waiting_for_human");
    expect(result.shouldRepair).toBe(false);
    expect(events).toContainEqual({
      type: "human_request",
      question: "Should the loop accept unofficial community sources?",
      status: undefined
    });
    expect(events.at(-1)).toEqual({
      type: "run_done",
      question: undefined,
      status: "waiting_for_human"
    });
  });

  test("passes workflow launch context to agent executors", async () => {
    const agentRequests: unknown[] = [];
    const runner = new LoopRunner({
      executor: {
        async run(request) {
          agentRequests.push(request);
          return { text: "collected sources" };
        }
      }
    });
    const workflowContract: FormalLoopContract = {
      ...contract,
      body: {
        steps: [
          {
            id: "research",
            kind: "phase",
            label: "Research",
            children: [
              {
                id: "collect",
                kind: "agent",
                label: "Collect sources",
                prompt: "Collect official sources",
                sessionPolicy: "new"
              }
            ]
          }
        ]
      }
    };

    await runner.run({ contract: workflowContract, runId: "run_workflow" });

    expect(agentRequests).toMatchObject([
      {
        prompt: "Collect official sources",
        label: "Collect sources",
        stepId: "collect",
        phaseId: "research",
        workflowRuntime: "dittosloop-local-workflow",
        workflowContractId: "loop_1",
        workflowPlan: {
          contractId: "loop_1",
          goal: "Track AI tool updates",
          steps: [
            expect.objectContaining({ id: "research", kind: "phase", depth: 0 }),
            expect.objectContaining({ id: "collect", kind: "agent", depth: 1, phaseId: "research", sessionPolicy: "new" })
          ],
          verification: workflowContract.verification,
          repairPolicy: workflowContract.repairPolicy,
          stopPolicy: workflowContract.stopPolicy
        }
      }
    ]);
  });
});
