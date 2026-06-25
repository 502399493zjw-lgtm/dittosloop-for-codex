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

  const run = await callTool(handlers.start_loop_run, {
    loopId: loop.id,
    goal: "执行一次真实端到端日报闭环。",
    codexProjectId: "dittos-loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
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

async function createService(sessionBridge: ReturnType<typeof createCompletedSessionBridge>) {
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

async function callTool<T = any>(handler: (input: unknown) => Promise<TextToolResult>, input: unknown): Promise<T> {
  const result = await handler(input);
  return JSON.parse(result.content[0].text) as T;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  expect(response.status).toBe(200);
  return response.json() as Promise<T>;
}
