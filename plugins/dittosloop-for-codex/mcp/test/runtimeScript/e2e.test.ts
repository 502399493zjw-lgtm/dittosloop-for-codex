import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../../src/codex/sessionBridge.js";
import { enrichRunDetail } from "../../src/preview/eventAdapter.js";
import { LoopService } from "../../src/service.js";
import { LoopStore } from "../../src/store.js";
import type { RunDetail } from "../../src/types.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createSessionRef(request: CodexSessionRequest, index: number, status: CodexSessionRef["status"] = "requested"): CodexSessionRef {
  return {
    sessionId: `session_${index}`,
    runId: request.runId,
    attemptId: request.attemptId,
    workflowContextId: request.workflowContextId,
    stepId: request.stepId,
    phaseId: request.phaseId,
    title: request.title,
    status,
    createdAt: fixedTime,
    prompt: request.prompt,
    subagent: request.subagent,
    agentProfile: request.agentProfile,
    workflowRuntime: request.workflowRuntime,
    workflowContractId: request.workflowContractId,
    workflowPlan: request.workflowPlan,
    projectId: request.projectId,
    projectLabel: request.projectLabel,
    projectPath: request.projectPath
  };
}

function createMutableSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const results = new Map<string, CodexSessionResult | undefined>();
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return createSessionRef(request, requests.length);
    },
    async sendMessage() {},
    async recordResult(sessionId, result) {
      results.set(sessionId, result);
    },
    async readResult(sessionId) {
      return results.get(sessionId);
    }
  };

  return { bridge, requests, results };
}

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-e2e-"));
  tempDirs.push(dir);
  return dir;
}

async function createService(dataDir: string, sessionBridge?: CodexSessionBridge) {
  const counters = new Map<string, number>();

  return new LoopService({
    store: new LoopStore(dataDir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });
}

function verificationWithVerifierSubagent() {
  return {
    version: 2 as const,
    mode: "after_workflow" as const,
    criteria: [
      {
        id: "quality",
        label: "Quality",
        description: "Verifier accepts the workflow result.",
        severity: "must" as const
      }
    ],
    validators: [
      {
        id: "quality-review",
        type: "rubric_agent" as const,
        label: "Quality review",
        criteriaIds: ["quality"],
        prompt: "Review the final result and cite evidence.",
        scoreScale: { min: 0, max: 1 },
        passScore: 1,
        evidenceRequired: true,
        subagent: {
          ref: "reviewer",
          role: "verifier",
          tools: ["rg"]
        },
        severity: "must" as const
      }
    ],
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}

function workflowContext(detail: RunDetail) {
  expect(detail.workflowContexts).toHaveLength(1);
  return detail.workflowContexts[0];
}

function taskRunForSession(detail: RunDetail, sessionId: string) {
  const taskRun = workflowContext(detail).taskRuns.find((candidate) => candidate.sessionId === sessionId);
  expect(taskRun).toBeDefined();
  expect(taskRun?.idempotencyKey).toEqual(expect.any(String));
  return taskRun!;
}

async function recordWorkerResult(service: LoopService, runId: string, detail: RunDetail, sessionId: string, result: string) {
  const context = workflowContext(detail);
  const taskRun = taskRunForSession(detail, sessionId);

  await service.recordSessionResult(runId, {
    attemptId: context.attemptId,
    workflowContextId: context.id,
    sessionId,
    stepId: taskRun.stepId,
    idempotencyKey: taskRun.idempotencyKey!,
    status: "passed",
    summary: result,
    result
  });
}

function passedVerifierResult(summary: string, evidence: string) {
  return {
    type: "rubric_agent" as const,
    status: "passed" as const,
    summary,
    evidence,
    criteriaResults: [
      {
        criterionId: "quality",
        status: "passed" as const,
        score: 1,
        maxScore: 1,
        evidence
      }
    ]
  };
}

test("runs runtime script end-to-end through workers, parallel fan-out, verifier, and replay cache hits", async () => {
  const dir = await createTempDir();
  const { bridge, requests } = createMutableSessionBridge();
  const service = await createService(dir, bridge);
  const contract = await service.createLoopContract({
    title: "Runtime script e2e",
    goal: "Exercise runtime script orchestration end-to-end",
    workflowKind: "runtime_script",
    script: `
      const files = JSON.parse(await agent("Return [\\"a.ts\\",\\"b.ts\\"]"));
      const reviews = await parallel(files.map((file) => () => agent(\`Review \${file}\`)));
      const summary = await agent(\`Summarize: \${JSON.stringify(reviews)}\`);
      return { files, reviews, summary };
    `,
    verification: verificationWithVerifierSubagent()
  });

  expect(contract.workflow.kind).toBe("runtime_script");
  expect(contract.body).toBeUndefined();

  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script e2e" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(1);

  const firstDetail = await service.getRunDetail(firstRun.id);
  expect(firstDetail.run.codexSession?.subagents).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sessionId: "session_1",
      stepId: expect.stringMatching(/^runtime:agent:/)
    })
  ]));

  await recordWorkerResult(service, firstRun.id, firstDetail, "session_1", '["a.ts","b.ts"]');

  const parallelRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id
  });
  expect(parallelRun.status).toBe("running");
  expect(requests).toHaveLength(3);

  const parallelDetail = await service.getRunDetail(parallelRun.id);
  const parallelTaskRuns = workflowContext(parallelDetail).taskRuns.filter((candidate) =>
    candidate.sessionId === "session_2" || candidate.sessionId === "session_3"
  );
  expect(parallelTaskRuns).toHaveLength(2);
  expect(new Set(parallelTaskRuns.map((candidate) => candidate.sessionId)).size).toBe(2);
  expect(new Set(parallelTaskRuns.map((candidate) => candidate.stepId)).size).toBe(2);

  await recordWorkerResult(service, parallelRun.id, parallelDetail, "session_2", "review a.ts");
  await recordWorkerResult(service, parallelRun.id, parallelDetail, "session_3", "review b.ts");

  const summaryRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id
  });
  expect(summaryRun.status).toBe("running");
  expect(requests).toHaveLength(4);
  expect(requests[3]).toMatchObject({
    prompt: 'Summarize: ["review a.ts","review b.ts"]'
  });

  const summaryDetail = await service.getRunDetail(summaryRun.id);
  await recordWorkerResult(service, summaryRun.id, summaryDetail, "session_4", "summary ready");

  const verifierRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id
  });
  expect(verifierRun.status).toBe("running");
  expect(requests).toHaveLength(5);
  expect(requests[4]).toMatchObject({
    stepId: "verification:quality-review",
    title: "Quality review",
    subagent: { ref: "reviewer", role: "verifier", tools: ["rg"] }
  });

  const workerSessionIds = ["session_1", "session_2", "session_3", "session_4"];
  expect(workerSessionIds).not.toContain("session_5");

  const detailBeforeVerification = await service.getRunDetail(verifierRun.id);
  expect(detailBeforeVerification.run.codexSession?.subagents).toEqual(expect.arrayContaining([
    expect.objectContaining({ sessionId: "session_1" }),
    expect.objectContaining({ sessionId: "session_2" }),
    expect.objectContaining({ sessionId: "session_3" }),
    expect.objectContaining({ sessionId: "session_4" }),
    expect.objectContaining({ sessionId: "session_5", stepId: "verification:quality-review" })
  ]));

  const verification = await service.recordValidatorResult(verifierRun.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_5",
    validatorId: "quality-review",
    idempotencyKey: `verification:${launch.run.id}:${launch.attempt.id}:quality-review`,
    result: passedVerifierResult(
      "Verifier approved the runtime summary.",
      "The summary included both file reviews."
    )
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });

  const completedDetail = enrichRunDetail(await service.getRunDetail(verifierRun.id));
  expect(completedDetail.run.status).toBe("completed");

  const workflowTimeline = completedDetail.timeline.find((section) => section.id === "workflow");
  const verificationTimeline = completedDetail.timeline.find((section) => section.id === "verification");
  expect(workflowTimeline?.items.some((item) => item.kind === "run" && item.label.includes("Runtime script"))).toBe(true);
  expect(workflowTimeline?.items.some((item) => item.kind === "agent")).toBe(true);
  expect(workflowTimeline?.items.some((item) => item.kind === "parallel")).toBe(true);
  expect(verificationTimeline?.items.length ?? 0).toBeGreaterThan(0);

  const requestCountBeforeReplay = requests.length;
  const replayLaunch = await service.startCodexSessionRun(contract.id, { goal: "Replay runtime script e2e" });
  const replayRun = await service.executeWorkflowAttempt(replayLaunch.run.id, {
    attemptId: replayLaunch.attempt.id
  });

  expect(replayRun.status).toBe("running");

  const replayDetail = enrichRunDetail(await service.getRunDetail(replayRun.id));
  const replayRequests = requests.slice(requestCountBeforeReplay);
  expect(replayRequests).toHaveLength(1);
  expect(replayRequests[0].stepId).toBe("verification:quality-review");
  expect(replayRequests.every((request) => request.stepId?.startsWith("verification:"))).toBe(true);
  expect(replayDetail.engineEvents.filter((event) => event.type === "agent:cached")).toHaveLength(4);

  await service.recordValidatorResult(replayRun.id, {
    workflowContextId: replayLaunch.launchRequest.workflowContextId,
    attemptId: replayLaunch.attempt.id,
    sessionId: "session_6",
    validatorId: "quality-review",
    idempotencyKey: `verification:${replayLaunch.run.id}:${replayLaunch.attempt.id}:quality-review`,
    result: passedVerifierResult(
      "Verifier approved the replayed runtime summary.",
      "All runtime worker results were replayed from cache."
    )
  });

  await expect(service.getRunDetail(replayRun.id)).resolves.toMatchObject({
    run: { status: "completed" }
  });
});

test("reuses the runtime script journal after a service restart without creating a duplicate worker session", async () => {
  const dir = await createTempDir();
  const firstBridge = createMutableSessionBridge();
  const service = await createService(dir, firstBridge.bridge);
  const contract = await service.createLoopContract({
    title: "Runtime script restart replay",
    goal: "Reuse a completed runtime agent call after restart",
    workflowKind: "runtime_script",
    script: `
      const output = await agent("Collect runtime evidence");
      return { output };
    `,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script completed", severity: "must" }]
    }
  });

  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script restart replay" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  expect(firstBridge.requests).toHaveLength(1);

  const firstDetail = await service.getRunDetail(firstRun.id);
  await recordWorkerResult(service, firstRun.id, firstDetail, "session_1", "restart-safe evidence");

  const secondBridge = createMutableSessionBridge();
  const restartedService = await createService(dir, secondBridge.bridge);

  const resumedRun = await restartedService.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier: async ({ result }) => ({
      status: (result as { output: string }).output === "restart-safe evidence" ? "passed" : "failed",
      summary: "Restart journal verified",
      checks: [{ rubricId: "done", status: "passed", evidence: "restart-safe evidence" }]
    })
  });

  expect(resumedRun.status).toBe("completed");
  expect(secondBridge.requests).toHaveLength(0);

  const resumedDetail = enrichRunDetail(await restartedService.getRunDetail(firstRun.id));
  expect(resumedDetail.engineEvents.some((event) => event.type === "agent:cached")).toBe(true);
  expect(workflowContext(resumedDetail).taskRuns).toEqual([
    expect.objectContaining({
      sessionId: "session_1",
      status: "completed",
      result: "restart-safe evidence"
    })
  ]);
});
