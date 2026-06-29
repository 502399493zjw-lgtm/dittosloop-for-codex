import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { HostMediatedSessionBridge } from "../../src/codex/hostMediatedBridge.js";
import { LoopService } from "../../src/service.js";
import { LoopStore } from "../../src/store.js";

const runLive = process.env.DITTOSLOOP_RUNTIME_SCRIPT_LIVE === "1";
const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-verification-live-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const bridge = new HostMediatedSessionBridge({
    now: () => fixedTime,
    makeId: () => {
      const next = (counters.get("session") ?? 0) + 1;
      counters.set("session", next);
      return `session_${next}`;
    }
  });

  return {
    bridge,
    service: new LoopService({
      store: new LoopStore(dir),
      now: () => fixedTime,
      createId: (prefix) => {
        const next = (counters.get(prefix) ?? 0) + 1;
        counters.set(prefix, next);
        return `${prefix}_${next}`;
      },
      previewBaseUrl: "http://127.0.0.1:47888",
      sessionBridge: bridge
    })
  };
}

describe.skipIf(!runLive)("runtime script live verifier subagent", () => {
  test("worker result is checked by a separate verifier subagent", async () => {
    const { bridge, service } = await createService();
    const contract = await service.createLoopContract({
      title: "Runtime verifier live flow",
      goal: "Exercise the worker and verifier session flow",
      workflowKind: "runtime_script",
      script: `
        const output = await agent("Draft the candidate", { label: "draft-worker" });
        return { output };
      `,
      verification: {
        version: 2,
        mode: "after_workflow",
        criteria: [
          {
            id: "quality",
            label: "Quality",
            description: "Verifier accepts the workflow result.",
            severity: "must"
          }
        ],
        validators: [
          {
            id: "quality-review",
            type: "rubric_agent",
            label: "Quality review",
            criteriaIds: ["quality"],
            prompt: "Review the final result and cite evidence.",
            scoreScale: { min: 0, max: 1 },
            passScore: 1,
            evidenceRequired: true,
            subagent: { ref: "reviewer", role: "verifier", tools: ["rg"] },
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
    });
    await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
    const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime verifier live flow" });

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });
    const [workerRequest] = bridge.getRequests();
    await bridge.recordResult(workerRequest.sessionId, {
      status: "completed",
      text: "candidate",
      threadId: "thread_worker",
      threadTitle: "Worker thread",
      threadUrl: "codex://thread/thread_worker",
      createdAt: fixedTime
    });
    await service.recordSessionResult(firstRun.id, {
      attemptId: launch.attempt.id,
      workflowContextId: launch.launchRequest.workflowContextId,
      sessionId: workerRequest.sessionId,
      stepId: "runtime:agent:1:draft-worker",
      idempotencyKey: "runtime-worker:session_1",
      status: "passed",
      summary: "Worker produced candidate",
      result: "candidate"
    });

    const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
      attemptId: launch.attempt.id
    });
    const requests = bridge.getRequests();
    expect(requests).toHaveLength(2);
    const verifierRequest = requests[1];

    expect(verifierRequest.sessionId).not.toBe(workerRequest.sessionId);
    expect(verifierRequest.stepId).toBe("verification:quality-review");

    const verification = await service.recordValidatorResult(resumedRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: verifierRequest.sessionId,
      validatorId: "quality-review",
      idempotencyKey: `verification:${launch.run.id}:${launch.attempt.id}:quality-review`,
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Independent verifier approved the candidate.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "Independent verifier approved the candidate."
          }
        ]
      }
    });

    expect(verification).toMatchObject({ version: 2, status: "passed" });
    await expect(service.getRunDetail(resumedRun.id)).resolves.toMatchObject({
      run: { status: "completed" },
      verificationResults: [expect.objectContaining({ version: 2, status: "passed" })]
    });
  });
});
