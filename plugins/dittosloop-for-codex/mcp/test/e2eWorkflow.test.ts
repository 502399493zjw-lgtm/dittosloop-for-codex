import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../src/codex/sessionBridge.js";
import { createToolHandlers, type TextToolResult } from "../src/mcpServer.js";
import { startPreviewServer, type PreviewServer } from "../src/previewServer.js";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type { RunDetail } from "../src/types.js";

const tempDirs: string[] = [];
const servers: PreviewServer[] = [];
const previewDir = join(dirname(fileURLToPath(import.meta.url)), "../../preview");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("runs a formal fan-out workflow end to end through MCP, Codex sessions, and preview detail", async () => {
  const sessionBridge = createCompletedSessionBridge();
  const service = await createService(sessionBridge);
  const handlers = createToolHandlers(service);
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const loop = await callTool(handlers.create_loop_contract, {
    title: "AI 开发工具真实日报闭环",
    goal: "生成中文 AI 开发工具产品动态日报。",
    intent: "监控 OpenClaw、Claude Code、Codex、Hermes 的官方动态，并输出可验证的中文日报。",
    projectBinding: {
      codexProjectId: "dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    },
    body: {
      steps: [
        {
          id: "plan",
          kind: "agent",
          label: "日报编排员",
          prompt: "制定本轮日报的采集范围、证据标准和输出结构。"
        },
        {
          id: "collect",
          kind: "parallel",
          label: "并行动态采集",
          children: [
            {
              id: "openclaw-researcher",
              kind: "agent",
              label: "OpenClaw 观察员",
              prompt: "采集 OpenClaw 官方发布、仓库变化和高信号社区动态。"
            },
            {
              id: "claude-code-researcher",
              kind: "agent",
              label: "Claude Code 观察员",
              prompt: "采集 Claude Code 官方发布、文档变化和社区高信号动态。"
            },
            {
              id: "codex-researcher",
              kind: "agent",
              label: "Codex 观察员",
              prompt: "采集 Codex CLI、Codex App 和 OpenAI Codex 相关更新。"
            },
            {
              id: "hermes-researcher",
              kind: "agent",
              label: "Hermes 观察员",
              prompt: "采集 Hermes Agent 官方发布、仓库变化和产品动态。"
            }
          ]
        },
        {
          id: "write-and-check",
          kind: "phase",
          label: "合成与核对",
          children: [
            {
              id: "daily-editor",
              kind: "agent",
              label: "中文日报编辑",
              prompt: "把各观察员结果合成为中文日报，包含摘要、重点更新、影响判断、风险限制和行动建议。"
            },
            {
              id: "evidence-checker",
              kind: "agent",
              label: "证据核对员",
              prompt: "核对日报是否覆盖四类工具、是否为中文、是否包含来源和限制说明。"
            }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "zh-report",
          label: "中文日报",
          requirement: "最终输出必须是中文日报，而不是内部执行日志。",
          severity: "must"
        },
        {
          id: "tool-coverage",
          label: "工具覆盖",
          requirement: "必须覆盖 OpenClaw、Claude Code、Codex、Hermes。",
          severity: "must"
        },
        {
          id: "evidence-and-actions",
          label: "证据与行动",
          requirement: "必须包含来源、限制说明和建议行动。",
          severity: "must"
        }
      ]
    },
    repairPolicy: {
      maxAttempts: 1,
      strategy: "fail_run"
    },
    stopPolicy: {
      rule: "verification_passed_or_failed_after_one_attempt",
      maxConsecutiveFailures: 1
    }
  });

  const launch = await callTool<{ run: { id: string }; attempt: { id: string } }>(handlers.start_codex_session, {
    loopId: loop.id,
    goal: "执行一次真实端到端日报闭环。",
    codexProjectId: "dittos-loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });
  const run = await callTool(handlers.execute_workflow_attempt, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  const detail = await fetchJson<RunDetail>(`${server.url}/api/runs/${run.id}`);
  const snapshot = await fetchJson<any>(`${server.url}/api/snapshot`);
  const openSession = await callTool(handlers.open_codex_session, { runId: run.id });

  expect(snapshot.formalContracts).toHaveLength(1);
  expect(snapshot.loops).toHaveLength(1);
  expect(snapshot.loops[0].id).toBe(loop.id);
  expect(snapshot.loops[0].intent).toContain("监控 OpenClaw");

  expect(detail.run.status).toBe("completed");
  expect(detail.run.codexProjectId).toBe("dittos-loop");
  expect(detail.run.projectLabel).toBe("dittos loop");
  expect(detail.run.codexSession?.status).toBe("completed");
  expect(detail.run.codexSession?.threadUrl).toMatch(/^codex:\/\/thread\//);
  expect(openSession.status).toBe("ready");
  expect(openSession.threadUrl).toMatch(/^codex:\/\/thread\//);

  const subagents = detail.run.codexSession?.subagents ?? [];
  expect(subagents.map((agent) => agent.role)).toEqual([
    "日报编排员",
    "OpenClaw 观察员",
    "Claude Code 观察员",
    "Codex 观察员",
    "Hermes 观察员",
    "中文日报编辑",
    "证据核对员"
  ]);
  expect(subagents.every((agent) => agent.status === "completed")).toBe(true);
  expect(subagents.every((agent) => agent.threadUrl?.startsWith("codex://thread/"))).toBe(true);

  const requests = sessionBridge.requests;
  expect(requests).toHaveLength(7);
  expect(requests.every((request) => request.workflowRuntime === "dittosloop-local-workflow")).toBe(true);
  expect(requests.every((request) => request.workflowContractId === loop.id)).toBe(true);
  expect(requests[0].workflowPlan?.runtime).toBe("dittosloop-local-workflow");
  expect(requests[0].workflowPlan?.steps).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "collect", kind: "parallel", label: "并行动态采集" }),
      expect.objectContaining({ id: "openclaw-researcher", kind: "agent", label: "OpenClaw 观察员" }),
      expect.objectContaining({ id: "claude-code-researcher", kind: "agent", label: "Claude Code 观察员" }),
      expect.objectContaining({ id: "daily-editor", kind: "agent", label: "中文日报编辑" })
    ])
  );

  expect(detail.attempts).toHaveLength(1);
  expect(detail.attempts[0].status).toBe("completed");
  expect(detail.verificationResults).toHaveLength(1);
  expect(detail.verificationResults[0].status).toBe("passed");
  expect(detail.verificationResults[0].checks.map((check) => check.name)).toEqual([
    "中文日报",
    "工具覆盖",
    "证据与行动"
  ]);

  const engineEvents = detail.events.map((event) => event.data?.engineEvent).filter(Boolean);
  expect(engineEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        type: "parallel_started",
        label: "并行动态采集",
        count: 4
      }),
      expect.objectContaining({
        type: "parallel_completed",
        label: "并行动态采集",
        count: 4
      }),
      expect.objectContaining({
        type: "agent_started",
        label: "OpenClaw 观察员",
        stepId: "openclaw-researcher"
      }),
      expect.objectContaining({
        type: "agent_done",
        label: "证据核对员",
        stepId: "evidence-checker"
      })
    ])
  );
  expect(detail.events.some((event) => event.message.includes("loop-runner"))).toBe(false);
});

test("resumes a suspended task workflow with subagent metadata through session writeback and preview detail", async () => {
  const researcherSubagent = {
    ref: "researcher",
    role: "Release researcher",
    model: "gpt-5.4-mini",
    tools: ["rg", "sed"],
    permissions: { filesystem: "workspace-write", network: "disabled" },
    timeoutMs: 120_000,
    context: { scope: "local e2e", expectedOutput: "facts" }
  };
  const researcherProfile = {
    id: "researcher",
    label: "Release researcher",
    role: "Release researcher",
    model: "gpt-5.4-mini",
    allowedTools: ["rg", "sed"],
    permissions: { filesystem: "workspace-write", network: "disabled" },
    timeoutMs: 120_000,
    context: { scope: "local e2e", expectedOutput: "facts" },
    source: "legacy-inline",
    stepId: "collect",
    requestedRef: "researcher",
    requiredSkills: [],
    advisorySkills: []
  };
  const reviewerSubagent = {
    ref: "reviewer",
    role: "Quality reviewer",
    model: "gpt-5.4-mini",
    tools: ["rg"],
    permissions: { filesystem: "read-only", network: "disabled" },
    timeoutMs: 60_000,
    context: { scope: "local e2e", expectedOutput: "approval" }
  };
  const reviewerProfile = {
    id: "reviewer",
    label: "Quality reviewer",
    role: "Quality reviewer",
    model: "gpt-5.4-mini",
    allowedTools: ["rg"],
    permissions: { filesystem: "read-only", network: "disabled" },
    timeoutMs: 60_000,
    context: { scope: "local e2e", expectedOutput: "approval" },
    source: "legacy-inline",
    stepId: "review",
    requestedRef: "reviewer",
    requiredSkills: [],
    advisorySkills: []
  };

  const sessionBridge = createPendingSessionBridge();
  const service = await createService(sessionBridge);
  const handlers = createToolHandlers(service);
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const loop = await callTool<{ id: string }>(handlers.create_loop_contract, {
    title: "Suspended local subagent workflow",
    goal: "Run a session-first workflow that delegates local work to Codex subagents.",
    intent: "Verify the visible Codex session starts the workflow and task sessions resume through result writeback.",
    projectBinding: {
      codexProjectId: "dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    },
    body: {
      steps: [
        {
          id: "collect",
          kind: "task",
          runtime: "codex",
          label: "Collect release evidence",
          prompt: "Inspect local files and summarize release facts.",
          subagent: researcherSubagent
        },
        {
          id: "review",
          kind: "task",
          runtime: "codex",
          label: "Review release evidence",
          prompt: "Review the collected facts and decide whether the loop can pass.",
          subagent: reviewerSubagent
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "review-approved",
          label: "Review approved",
          requirement: "The reviewer subagent must approve the collected evidence.",
          severity: "must"
        }
      ]
    },
    repairPolicy: {
      maxAttempts: 0,
      strategy: "fail_run"
    },
    stopPolicy: {
      rule: "verification_passed_or_failed",
      maxConsecutiveFailures: 0
    }
  });

  const launch = await callTool<{
    run: { id: string };
    attempt: { id: string };
    launchRequest: {
      workflowContextId: string;
      workflowPlan: { steps: Array<{ id: string; subagent?: unknown; agentProfile?: unknown }> };
    };
  }>(handlers.start_codex_session, {
    loopId: loop.id,
    goal: "Start the local suspended workflow.",
    codexProjectId: "dittos-loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  await callTool(handlers.record_codex_thread, {
    runId: launch.run.id,
    threadId: "thread_suspended_subagents",
    threadTitle: "Suspended subagent workflow",
    threadUrl: "codex://thread/thread_suspended_subagents"
  });

  expect(launch.launchRequest.workflowPlan.steps.find((step) => step.id === "collect")?.subagent).toEqual(
    researcherSubagent
  );
  expect(launch.launchRequest.workflowPlan.steps.find((step) => step.id === "collect")?.agentProfile).toEqual(
    researcherProfile
  );
  expect(launch.launchRequest.workflowPlan.steps.find((step) => step.id === "review")?.subagent).toEqual(
    reviewerSubagent
  );
  expect(launch.launchRequest.workflowPlan.steps.find((step) => step.id === "review")?.agentProfile).toEqual(
    reviewerProfile
  );

  const firstExecution = await callTool<{ status: string }>(handlers.execute_workflow_attempt, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  expect(firstExecution.status).toBe("running");
  expect(sessionBridge.requests).toHaveLength(1);
  expect(sessionBridge.requests[0]).toMatchObject({
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    stepId: "collect",
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: loop.id,
    subagent: researcherSubagent,
    agentProfile: researcherProfile
  });

  let detail = await callTool<RunDetail>(handlers.get_run_detail, { runId: launch.run.id });
  let workflowContext = detail.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);

  expect(workflowContext).toBeDefined();
  expect(workflowContext?.status).toBe("suspended");
  expect(workflowContext?.pendingSessionIds).toEqual(["session_1"]);
  expect(workflowContext?.taskRuns).toHaveLength(1);
  expect(workflowContext?.taskRuns[0]).toMatchObject({
    stepId: "collect",
    sessionId: "session_1",
    status: "suspended",
    subagent: researcherSubagent,
    agentProfile: researcherProfile
  });

  const afterCollect = await callTool<{ status: string }>(handlers.record_session_result, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "session_1:collect:passed",
    status: "passed",
    summary: "Collect subagent finished.",
    result: "Collected release facts from the local project."
  });

  expect(afterCollect.status).toBe("running");
  expect(sessionBridge.requests).toHaveLength(2);
  expect(sessionBridge.requests[1]).toMatchObject({
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    stepId: "review",
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: loop.id,
    subagent: reviewerSubagent,
    agentProfile: reviewerProfile
  });

  detail = await callTool<RunDetail>(handlers.get_run_detail, { runId: launch.run.id });
  workflowContext = detail.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);

  expect(workflowContext?.status).toBe("suspended");
  expect(workflowContext?.pendingSessionIds).toEqual(["session_2"]);
  expect(workflowContext?.taskRuns.find((taskRun) => taskRun.stepId === "collect")).toMatchObject({
    status: "completed",
    result: "Collected release facts from the local project.",
    subagent: researcherSubagent,
    agentProfile: researcherProfile
  });
  expect(workflowContext?.taskRuns.find((taskRun) => taskRun.stepId === "review")).toMatchObject({
    sessionId: "session_2",
    status: "suspended",
    subagent: reviewerSubagent,
    agentProfile: reviewerProfile
  });

  const completed = await callTool<{ status: string }>(handlers.record_session_result, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_2",
    stepId: "review",
    idempotencyKey: "session_2:review:passed",
    status: "passed",
    summary: "Review subagent approved.",
    result: "Reviewed the collected facts and approved the release evidence."
  });

  expect(completed.status).toBe("completed");

  detail = await callTool<RunDetail>(handlers.get_run_detail, { runId: launch.run.id });
  workflowContext = detail.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);

  expect(detail.run.status).toBe("completed");
  expect(detail.run.codexSession?.status).toBe("completed");
  expect(detail.attempts[0]?.status).toBe("completed");
  expect(workflowContext?.status).toBe("completed");
  expect(workflowContext?.taskRuns.map((taskRun) => taskRun.status)).toEqual(["completed", "completed"]);
  expect(detail.verificationResults).toHaveLength(1);
  expect(detail.verificationResults[0]?.status).toBe("passed");

  const previewDetail = await fetchJson<RunDetail>(`${server.url}/api/runs/${launch.run.id}`);
  const previewContext = previewDetail.workflowContexts.find(
    (context) => context.id === launch.launchRequest.workflowContextId
  );

  expect(previewContext?.taskRuns.find((taskRun) => taskRun.stepId === "collect")?.subagent).toEqual(
    researcherSubagent
  );
  expect(previewContext?.taskRuns.find((taskRun) => taskRun.stepId === "collect")?.agentProfile).toEqual(
    researcherProfile
  );
  expect(previewContext?.taskRuns.find((taskRun) => taskRun.stepId === "review")?.subagent).toEqual(reviewerSubagent);
  expect(previewContext?.taskRuns.find((taskRun) => taskRun.stepId === "review")?.agentProfile).toEqual(reviewerProfile);
  expect(previewDetail.events.some((event) => event.message === "Codex task result recorded; continuing workflow")).toBe(
    true
  );
});

test("authors a loop via script, suspends on the first task, and resumes to completion without relaunching", async () => {
  const sessionBridge = createPendingSessionBridge();
  const service = await createService(sessionBridge);
  const handlers = createToolHandlers(service);
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const loop = await callTool<{ id: string; body: { steps: Array<{ id: string }> } }>(handlers.create_loop_contract, {
    title: "Scripted pipeline loop",
    goal: "Author and run a pipeline loop from a builder script.",
    script: {
      build: [
        {
          fn: "pipeline",
          args: [
            "produce",
            "Produce",
            [
              { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write a draft." }] },
              { fn: "task", args: [{ id: "review", label: "Review", prompt: "Review the draft." }] }
            ]
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The report is complete.", severity: "must" }]
    }
  });

  expect(loop.body.steps[0]).toMatchObject({ id: "produce", kind: "phase", pipeline: true });

  const launch = await callTool<{ run: { id: string }; attempt: { id: string }; launchRequest: { workflowContextId: string } }>(
    handlers.start_codex_session,
    { loopId: loop.id, goal: "Run the scripted pipeline." }
  );

  const firstExecution = await callTool<{ status: string }>(handlers.execute_workflow_attempt, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  expect(firstExecution.status).toBe("running");
  expect(sessionBridge.requests.map((request) => request.stepId)).toEqual(["draft"]);

  await callTool(handlers.record_session_result, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "session_1:draft:passed",
    status: "passed",
    summary: "Draft finished.",
    result: "DRAFT-FROM-STEP-1"
  });

  // The first step is not relaunched; the second runs once with the prior output threaded in.
  expect(sessionBridge.requests.map((request) => request.stepId)).toEqual(["draft", "review"]);
  const reviewRequest = sessionBridge.requests.find((request) => request.stepId === "review");
  expect(reviewRequest?.prompt).toContain("[pipeline] Prior step (draft) output:");
  expect(reviewRequest?.prompt).toContain("DRAFT-FROM-STEP-1");

  const completed = await callTool<{ status: string }>(handlers.record_session_result, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_2",
    stepId: "review",
    idempotencyKey: "session_2:review:passed",
    status: "passed",
    summary: "Review approved.",
    result: "FINAL-REPORT"
  });
  expect(completed.status).toBe("completed");

  const detail = await callTool<RunDetail>(handlers.get_run_detail, { runId: launch.run.id });
  const context = detail.workflowContexts.find((candidate) => candidate.id === launch.launchRequest.workflowContextId);
  expect(context?.status).toBe("completed");
  expect(context?.steps.draft).toMatchObject({ status: "completed", output: "DRAFT-FROM-STEP-1" });
  expect(context?.steps.review).toMatchObject({ status: "completed", output: "FINAL-REPORT" });
});

async function createService(sessionBridge: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-e2e-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();

  return new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-25T00:00:00.000Z",
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:0",
    codexProjects: [
      {
        id: "dittos-loop",
        name: "dittos loop",
        path: "/Users/edisonzhong/Documents/dittos loop"
      }
    ],
    sessionBridge
  });
}

function createCompletedSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const sessions = new Map<string, CodexSessionRef>();
  const results = new Map<string, CodexSessionResult>();

  const bridge: CodexSessionBridge & { requests: CodexSessionRequest[] } = {
    requests,
    async createSession(request) {
      requests.push(request);
      const sessionId = `session_${requests.length}`;
      const session: CodexSessionRef = {
        sessionId,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "completed",
        createdAt: "2026-06-25T00:00:00.000Z",
        prompt: request.prompt,
        workflowRuntime: request.workflowRuntime,
        workflowContractId: request.workflowContractId,
        workflowPlan: request.workflowPlan,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        projectPath: request.projectPath
      };
      sessions.set(sessionId, session);
      results.set(sessionId, {
        status: "completed",
        text: `${request.title} 已完成：输出中文日报片段，覆盖 OpenClaw、Claude Code、Codex、Hermes，并包含来源、限制和建议行动。`,
        threadId: `thread_${sessionId}`,
        threadTitle: request.title,
        threadUrl: `codex://thread/thread_${sessionId}`,
        createdAt: "2026-06-25T00:00:00.000Z"
      });
      return session;
    },
    async sendMessage() {
      return undefined;
    },
    async recordResult(sessionId, result) {
      results.set(sessionId, result);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status: result.status });
      }
    },
    async readResult(sessionId) {
      return results.get(sessionId);
    }
  };

  return bridge;
}

function createPendingSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const sessions = new Map<string, CodexSessionRef>();
  const results = new Map<string, CodexSessionResult>();

  const bridge: CodexSessionBridge & {
    requests: CodexSessionRequest[];
    results: Map<string, CodexSessionResult>;
  } = {
    requests,
    results,
    async createSession(request) {
      requests.push(request);
      const sessionId = `session_${requests.length}`;
      const session: CodexSessionRef = {
        sessionId,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
        createdAt: "2026-06-25T00:00:00.000Z",
        prompt: request.prompt,
        subagent: request.subagent,
        workflowRuntime: request.workflowRuntime,
        workflowContractId: request.workflowContractId,
        workflowPlan: request.workflowPlan,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        projectPath: request.projectPath
      };
      sessions.set(sessionId, session);
      return session;
    },
    async sendMessage() {
      return undefined;
    },
    async recordResult(sessionId, result) {
      results.set(sessionId, result);
      const session = sessions.get(sessionId);
      if (session) {
        sessions.set(sessionId, { ...session, status: result.status === "passed" ? "completed" : "failed" });
      }
    },
    async readResult(sessionId) {
      return results.get(sessionId);
    }
  };

  return bridge;
}

async function callTool<T = any>(handler: (input: unknown) => Promise<TextToolResult>, input: unknown): Promise<T> {
  const result = await handler(input);
  return JSON.parse(result.content[0].text) as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}
