import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../../src/codex/sessionBridge.js";
import {
  hashRuntimeScriptArgs,
  hashRuntimeScriptSource,
  runtimeAgentJournalKey
} from "../../src/runtimeScript/hash.js";
import { LoopService } from "../../src/service.js";
import { LoopStore } from "../../src/store.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(sessionBridge: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-subagent-bridge-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_${Math.random().toString(36).slice(2, 8)}`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });
}

function createSessionRef(request: CodexSessionRequest, index: number, status: CodexSessionRef["status"]): CodexSessionRef {
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

function createMutableSessionBridge(results: Map<string, CodexSessionResult | undefined> = new Map()) {
  const requests: CodexSessionRequest[] = [];
  const readSessionIds: string[] = [];
  const bridge: CodexSessionBridge = {
    createSession: vi.fn(async (request) => {
      requests.push(request);
      return createSessionRef(request, requests.length, "requested");
    }),
    sendMessage: vi.fn(async () => {}),
    recordResult: vi.fn(async (sessionId, result) => {
      results.set(sessionId, result);
    }),
    readResult: vi.fn(async (sessionId) => {
      readSessionIds.push(sessionId);
      return results.get(sessionId);
    })
  };

  return { bridge, requests, readSessionIds, results };
}

async function createRuntimeScriptRun(
  service: LoopService,
  source = `
    const output = await agent("Collect runtime evidence", { label: "collector" });
    return { output };
  `
) {
  const contract = await service.createLoopContract({
    title: "Runtime script sub-agent bridge",
    goal: "Exercise runtime script sub-agent bridge semantics",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script completed", severity: "must" }]
    }
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script" });

  return { contract, launch, source };
}

function runtimeAgentKey(contractId: string, source: string) {
  return runtimeAgentJournalKey({
    contractId,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs({}),
    callSite: "agent:1:collector",
    prompt: "Collect runtime evidence",
    options: { label: "collector" }
  });
}

test("first runtime script agent call creates one Codex session", async () => {
  const { bridge, requests } = createMutableSessionBridge(
    new Map([
      [
        "session_1",
        {
          status: "completed",
          text: "evidence ready",
          createdAt: fixedTime
        }
      ]
    ])
  );
  const service = await createService(bridge);
  const { launch } = await createRuntimeScriptRun(service);

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier: async () => ({
      status: "passed",
      summary: "verified",
      checks: [{ rubricId: "done", status: "passed", evidence: "evidence ready" }]
    })
  });

  expect(run.status).toBe("completed");
  expect(bridge.createSession).toHaveBeenCalledTimes(1);
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    stepId: "runtime:agent:1:collector",
    title: "collector",
    prompt: "Collect runtime evidence"
  });
});

test("missing runtime script bridge result suspends the run and records the pending session", async () => {
  const { bridge } = createMutableSessionBridge();
  const service = await createService(bridge);
  const { launch } = await createRuntimeScriptRun(service);

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(run.status).toBe("running");
  expect(bridge.createSession).toHaveBeenCalledTimes(1);

  const detail = await service.getRunDetail(run.id);
  const context = detail.workflowContexts[0];
  expect(context.status).toBe("suspended");
  expect(context.pendingSessionIds).toEqual(["session_1"]);
  expect(context.taskRuns).toEqual([
    expect.objectContaining({
      stepId: "runtime:agent:1:collector",
      idempotencyKey: expect.any(String),
      sessionId: "session_1",
      status: "suspended"
    })
  ]);
});

test("rerun with same runtime script call site reuses the pending session", async () => {
  const { bridge, readSessionIds } = createMutableSessionBridge();
  const service = await createService(bridge);
  const { launch } = await createRuntimeScriptRun(service);

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  const secondRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id
  });

  expect(secondRun.status).toBe("running");
  expect(bridge.createSession).toHaveBeenCalledTimes(1);
  expect(readSessionIds).toEqual(["session_1", "session_1"]);

  const detail = await service.getRunDetail(secondRun.id);
  expect(detail.workflowContexts[0].pendingSessionIds).toEqual(["session_1"]);
  expect(detail.workflowContexts[0].taskRuns).toHaveLength(1);
});

test("recorded runtime script session result lets rerun complete the original task", async () => {
  const { bridge } = createMutableSessionBridge();
  const service = await createService(bridge);
  const { contract, launch, source } = await createRuntimeScriptRun(service);

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "runtime:agent:1:collector",
    idempotencyKey: runtimeAgentKey(contract.id, source),
    status: "passed",
    summary: "evidence ready",
    result: "evidence ready"
  });

  const run = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier: async ({ result }) => ({
      status: (result as { output: string }).output === "evidence ready" ? "passed" : "failed",
      summary: "verified",
      checks: [{ rubricId: "done", status: "passed", evidence: "evidence ready" }]
    })
  });

  expect(run.status).toBe("completed");
  expect(bridge.createSession).toHaveBeenCalledTimes(1);

  const detail = await service.getRunDetail(run.id);
  expect(detail.workflowContexts[0].taskRuns).toEqual([
    expect.objectContaining({
      sessionId: "session_1",
      status: "completed",
      result: "evidence ready"
    })
  ]);
});

test("completed runtime script journal hit does not create another Codex session", async () => {
  const { bridge } = createMutableSessionBridge();
  const service = await createService(bridge);
  const { contract, launch, source } = await createRuntimeScriptRun(service);

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "runtime:agent:1:collector",
    idempotencyKey: runtimeAgentKey(contract.id, source),
    status: "passed",
    summary: "cached output",
    result: "cached output"
  });

  vi.mocked(bridge.createSession).mockClear();
  vi.mocked(bridge.readResult).mockClear();

  const run = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier: async () => ({
      status: "passed",
      summary: "verified cached output",
      checks: [{ rubricId: "done", status: "passed", evidence: "cached output" }]
    })
  });

  expect(run.status).toBe("completed");
  expect(bridge.createSession).not.toHaveBeenCalled();
  expect(bridge.readResult).not.toHaveBeenCalled();
});

test("failed runtime script bridge result marks the task failed and surfaces the error", async () => {
  const { bridge, results } = createMutableSessionBridge();
  results.set("session_1", {
    status: "failed",
    text: "worker failed hard",
    createdAt: fixedTime
  });
  const service = await createService(bridge);
  const { launch } = await createRuntimeScriptRun(service);

  await expect(
    service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    })
  ).rejects.toThrow("worker failed hard");

  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.run.status).toBe("failed");
  expect(detail.workflowContexts[0].status).toBe("failed");
  expect(detail.workflowContexts[0].taskRuns).toEqual([
    expect.objectContaining({
      sessionId: "session_1",
      status: "failed",
      error: "worker failed hard"
    })
  ]);
});

test("failed runtime script child session inside parallel is isolated as null while siblings finish", async () => {
  const requests: CodexSessionRequest[] = [];
  const requestBySessionId = new Map<string, CodexSessionRequest>();
  let releaseReads!: () => void;
  const allSessionsStarted = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const bridge: CodexSessionBridge = {
    createSession: vi.fn(async (request) => {
      requests.push(request);
      const session = createSessionRef(request, requests.length, "requested");
      requestBySessionId.set(session.sessionId, request);
      if (requests.length === 2) {
        releaseReads();
      }
      return session;
    }),
    sendMessage: vi.fn(async () => {}),
    recordResult: vi.fn(async () => {}),
    readResult: vi.fn(async (sessionId) => {
      await allSessionsStarted;
      const prompt = requestBySessionId.get(sessionId)?.prompt;
      if (prompt === "good") {
        return {
          status: "completed",
          text: "good result",
          createdAt: fixedTime
        };
      }
      if (prompt === "bad") {
        return {
          status: "failed",
          text: "bad exploded",
          createdAt: fixedTime
        };
      }
      return undefined;
    })
  };
  const service = await createService(bridge);
  const { contract, launch } = await createRuntimeScriptRun(service, `
    const results = await parallel(
      () => agent("good", { key: "good", label: "good" }),
      () => agent("bad", { key: "bad", label: "bad" })
    );
    return { results };
  `);

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier: async ({ result }) => ({
      status: JSON.stringify((result as { results: Array<string | null> }).results) === JSON.stringify(["good result", null])
        ? "passed"
        : "failed",
      summary: "verified isolated branch failure",
      checks: [{ rubricId: "done", status: "passed", evidence: JSON.stringify(result) }]
    })
  });

  expect(run.status).toBe("completed");
  expect(requests).toHaveLength(2);
  expect(new Set(requests.map((request) => request.prompt))).toEqual(new Set(["good", "bad"]));
  const sessionIdByPrompt = new Map(requests.map((request, index) => [request.prompt, `session_${index + 1}`]));

  const detail = await service.getRunDetail(run.id);
  expect(detail.workflowContexts[0].status).toBe("completed");
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: {
      results: ["good result", null]
    }
  });
  expect(detail.workflowContexts[0].taskRuns).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sessionId: sessionIdByPrompt.get("good"),
      stepId: "runtime:good",
      status: "completed",
      result: "good result"
    }),
    expect.objectContaining({
      sessionId: sessionIdByPrompt.get("bad"),
      stepId: "runtime:bad",
      status: "failed",
      error: "bad exploded"
    })
  ]));

  const snapshot = await service.getSnapshot();
  expect(snapshot.runtimeScriptJournals).toEqual(expect.arrayContaining([
    expect.objectContaining({
      contractId: contract.id,
      callSite: "bad",
      status: "failed",
      error: "bad exploded",
      sessionId: sessionIdByPrompt.get("bad")
    })
  ]));
});
