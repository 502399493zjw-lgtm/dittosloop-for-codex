import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../src/codex/sessionBridge.js";
import {
  hashRuntimeScriptArgs,
  hashRuntimeScriptSource,
  runtimeAgentJournalKey
} from "../src/runtimeScript/hash.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(sessionBridge?: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-service-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });
}

function createCompletedSessionBridge(resultText: string) {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "completed",
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
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult> {
      return {
        status: "completed",
        text: resultText,
        threadId: "thread_1",
        threadTitle: "Runtime script worker",
        threadUrl: "codex://thread/thread_1",
        createdAt: fixedTime
      };
    }
  };

  return { bridge, requests };
}

function createPendingSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
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
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult | undefined> {
      return undefined;
    }
  };

  return { bridge, requests };
}

test("creates a runtime script loop without body steps", async () => {
  const service = await createService();

  const contract = await service.createLoopContract({
    title: "Runtime script review",
    goal: "Run a dynamic review flow",
    workflowKind: "runtime_script",
    script: 'return { summary: "ok", score: 1 };',
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script completed", severity: "must" }]
    }
  });

  expect(contract.workflow).toMatchObject({
    kind: "runtime_script",
    language: "javascript",
    source: 'return { summary: "ok", score: 1 };'
  });
  expect(contract.body).toBeUndefined();
});

test("executes a runtime script workflow end-to-end with a completed bridge", async () => {
  const { bridge, requests } = createCompletedSessionBridge("bridge says hello");
  const service = await createService(bridge);
  const contract = await service.createLoopContract({
    title: "Runtime script execution",
    goal: "Use a subagent result and finish",
    workflowKind: "runtime_script",
    script: `
      const output = await agent("Say hello from runtime script", { label: "greeter" });
      return {
        output,
        score: output.length
      };
    `,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script execution" });
  const verifier = vi.fn(async ({ result }) => {
    const runtimeResult = result as { output: string; score: number };

    return {
      status: runtimeResult.score >= 5 ? "passed" : "failed",
      summary: `Verified ${runtimeResult.output}`,
      checks: [{ rubricId: "done", status: "passed", evidence: runtimeResult.output }]
    };
  });

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(run.status).toBe("completed");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    workflowContractId: contract.id,
    title: "greeter",
    prompt: "Say hello from runtime script"
  });
  expect(verifier).toHaveBeenCalledWith({
    contract: expect.objectContaining({ id: contract.id }),
    result: {
      output: "bridge says hello",
      score: 17
    }
  });

  const detail = await service.getRunDetail(run.id);
  expect(detail.attempts[0]).toMatchObject({
    id: launch.attempt.id,
    status: "completed",
    summary: "Verified bridge says hello",
    completedAt: fixedTime
  });
  expect(detail.verificationResults).toMatchObject([
    {
      attemptId: launch.attempt.id,
      status: "passed",
      summary: "Verified bridge says hello"
    }
  ]);

  const context = detail.workflowContexts[0];
  expect(context.status).toBe("completed");
  expect(context.executionGraphSnapshot).toBeUndefined();
  expect(context.nodeRuns).toBeUndefined();
  expect(context.vars.runtimeScript).toMatchObject({
    status: "completed",
    result: {
      output: "bridge says hello",
      score: 17
    },
    updatedAt: fixedTime
  });

  const snapshot = await service.getSnapshot();
  expect(snapshot.runtimeScriptJournals).toMatchObject([
    {
      contractId: contract.id,
      status: "completed",
      output: "bridge says hello",
      sessionId: "session_1"
    }
  ]);
  expect(detail.run.codexSession?.subagents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session_1",
        stepId: "agent:1:greeter",
        status: "completed",
        prompt: "Say hello from runtime script"
      })
    ])
  );
  expect(
    detail.events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is { type: string; status?: string } => Boolean(event))
      .map((event) => event.type)
  ).toEqual(expect.arrayContaining(["runtime_script_started", "agent:start", "agent:done", "runtime_script_done"]));
});

test("reuses a completed pending runtime script agent result when the run resumes", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createService(bridge);
  const prompt = "Say hello after async completion";
  const options = { label: "greeter" };
  const source = `
    const output = await agent("${prompt}", ${JSON.stringify(options)});
    return { output };
  `;
  const contract = await service.createLoopContract({
    title: "Runtime script async resume",
    goal: "Resume a pending runtime script agent",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run async runtime script execution" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    workflowContractId: contract.id,
    stepId: "agent:1:greeter",
    title: "greeter",
    prompt
  });

  const idempotencyKey = runtimeAgentJournalKey({
    contractId: contract.id,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs({}),
    callSite: "agent:1:greeter",
    prompt,
    options
  });

  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "agent:1:greeter",
    idempotencyKey,
    status: "passed",
    summary: "async hello",
    result: "async hello"
  });

  const verifier = vi.fn(async ({ result }) => ({
    status: (result as { output: string }).output === "async hello" ? "passed" : "failed",
    summary: "Verified async hello",
    checks: [{ rubricId: "done", status: "passed", evidence: "async hello" }]
  }));

  const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(resumedRun.status).toBe("completed");
  expect(requests).toHaveLength(1);
  expect(verifier).toHaveBeenCalledWith({
    contract: expect.objectContaining({ id: contract.id }),
    result: { output: "async hello" }
  });

  const detail = await service.getRunDetail(resumedRun.id);
  expect(detail.run.codexSession?.subagents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session_1",
        stepId: "agent:1:greeter",
        status: "completed",
        prompt
      })
    ])
  );
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: { output: "async hello" }
  });
  const snapshot = await service.getSnapshot();
  expect(snapshot.runtimeScriptJournals).toMatchObject([
    {
      contractId: contract.id,
      key: idempotencyKey,
      status: "completed",
      output: "async hello",
      sessionId: "session_1"
    }
  ]);
  expect(
    detail.events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is { type: string } => Boolean(event))
      .map((event) => event.type)
  ).toEqual(expect.arrayContaining(["agent:cached", "runtime_script_done"]));
});
