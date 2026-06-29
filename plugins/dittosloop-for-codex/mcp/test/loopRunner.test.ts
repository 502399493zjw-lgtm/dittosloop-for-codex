import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import type { FormalLoopContract } from "../src/contract/types.js";
import { compileContract } from "../src/contract/compileContract.js";
import { LoopRunner } from "../src/runner/loopRunner.js";

const legacyContract = {
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
} as unknown as FormalLoopContract;

const contract: FormalLoopContract = compileContract(legacyContract);

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

    const result = await runner.run({ contract: legacyContract, runId: "run_1", emit: (event) => events.push(event.type) });

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
      contract: legacyContract,
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
    const secondAttempt = await runner.run({ contract: legacyContract, runId: "run_2", attemptNumber: 2 });

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
      contract: legacyContract,
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

  test("does not auto-pass verification v2 contracts when no validator passes", async () => {
    const v2Contract = {
      ...contract,
      verification: {
        version: 2,
        mode: "after_workflow",
        criteria: [
          { id: "quality", label: "Quality", description: "Output meets quality.", severity: "must" }
        ],
        validators: [
          {
            id: "quality-review",
            type: "rubric_agent",
            label: "Quality review",
            criteriaIds: ["quality"],
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
    } satisfies FormalLoopContract;

    const runner = new LoopRunner({
      executor: { async run() { return { text: "candidate" }; } },
      now: () => "2026-06-26T00:00:00.000Z"
    });

    const result = await runner.run({ contract: v2Contract, runId: "run_1", attemptNumber: 1 });

    expect(result.status).toBe("waiting_for_human");
    expect(result.shouldRepair).toBe(false);
    expect(result.verification).toMatchObject({
      version: 2,
      status: "needs_human",
      decision: { needsHumanValidatorIds: ["quality-review"] }
    });
  });

  test("emits verification v2 validator and decision events", async () => {
    const events: string[] = [];
    const v2Contract = {
      ...contract,
      verification: {
        version: 2,
        mode: "after_workflow",
        criteria: [
          { id: "tests", label: "Tests", description: "Tests pass.", severity: "must" }
        ],
        validators: [
          {
            id: "unit-tests",
            type: "command",
            label: "Unit tests",
            command: "npm",
            args: ["test"],
            criteriaIds: ["tests"],
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
    } satisfies FormalLoopContract;
    const runner = new LoopRunner({
      executor: { async run() { return { text: "candidate" }; } },
      commandExecutor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" }),
      now: () => "2026-06-26T00:00:00.000Z"
    });

    const result = await runner.run({
      contract: v2Contract,
      runId: "run_1",
      attemptId: "attempt_1",
      emit: (event) => events.push(event.type)
    });

    expect(result.status).toBe("completed");
    expect(events).toEqual(expect.arrayContaining([
      "verification_started",
      "validator_started",
      "validator_done",
      "verification_decided",
      "verification_done"
    ]));
    expect(events.indexOf("validator_started")).toBeLessThan(events.indexOf("validator_done"));
    expect(events.indexOf("validator_done")).toBeLessThan(events.indexOf("verification_decided"));
  });

  test("passes contract workspace path to script validators", async () => {
    const workspace = createScriptWorkspace("script-quality");
    const requests: Array<{ cwd?: string; stdin?: string }> = [];
    try {
      const scriptContract = {
        ...contract,
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "quality", label: "Quality", description: "Output is acceptable.", severity: "must" }
          ],
          validators: [
            {
              id: "script-quality",
              type: "script",
              label: "Script quality",
              criteriaIds: ["quality"],
              severity: "must",
              runtime: "node",
              scriptRef: {
                path: "evaluators/script-quality/evaluator.mjs",
                checksum: workspace.checksum,
                cwd: "loop",
                timeoutMs: 30000
              },
              input: { source: "workflow_result" },
              output: { schema: "verification_result_v1" },
              evidenceRequired: true,
              builder: {
                kind: "codex_subagent",
                builtAt: "2026-06-29T00:00:00.000Z",
                selfCheck: {
                  status: "passed",
                  command: "node",
                  args: ["evaluators/script-quality/evaluator.mjs"],
                  evidence: "fixture passed"
                }
              }
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true,
            requireEvidenceForScriptResults: true
          }
        }
      } satisfies FormalLoopContract;

      const runner = new LoopRunner({
        executor: { async run() { return { text: "candidate" }; } },
        commandExecutor: async (request) => {
          requests.push(request);
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              status: "passed",
              summary: "Script accepted output.",
              evidence: ["checked candidate"]
            }),
            stderr: ""
          };
        },
        contractWorkspacePath: workspace.tempDir,
        now: () => "2026-06-29T00:00:00.000Z"
      });

      const result = await runner.run({ contract: scriptContract, runId: "run_script", attemptId: "attempt_script" });

      expect(result.status).toBe("completed");
      expect(requests[0]).toMatchObject({ cwd: workspace.tempDir });
    } finally {
      workspace.cleanup();
    }
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
      budgetUsd: 0.5,
      escalation: ["production deploy"],
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
          stopPolicy: workflowContract.stopPolicy,
          budgetUsd: 0.5,
          escalation: ["production deploy"]
        }
      }
    ]);
  });
});

function createScriptWorkspace(validatorId: string) {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), `loop-runner-${validatorId}-`));
  const evaluatorDir = path.join(tempDir, "evaluators", validatorId);
  const source = "process.stdout.write(JSON.stringify({ status: 'passed', summary: 'fixture', evidence: ['fixture evidence'] }));";
  mkdirSync(evaluatorDir, { recursive: true });
  writeFileSync(path.join(evaluatorDir, "evaluator.mjs"), source, "utf8");
  return {
    tempDir,
    checksum: `sha256:${createHash("sha256").update(source).digest("hex")}`,
    cleanup() {
      rmSync(tempDir, { recursive: true, force: true });
    }
  };
}
