import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import { startPreviewServer, type PreviewServer } from "../src/previewServer.js";
import { LoopService, type LoopServiceOptions } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type { CodexSessionBridge, CodexSessionRef, CodexSessionRequest } from "../src/codex/sessionBridge.js";

const tempDirs: string[] = [];
const servers: PreviewServer[] = [];
const previewDir = join(dirname(fileURLToPath(import.meta.url)), "../../preview");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(
  options: Partial<Pick<LoopServiceOptions, "codexProjects" | "createId" | "sessionBridge">> = {}
) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-preview-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-23T00:00:00.000Z",
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:0",
    ...options
  });
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
        createdAt: "2026-06-23T00:00:00.000Z",
        prompt: request.prompt,
        subagent: request.subagent,
        workflowRuntime: request.workflowRuntime,
        workflowContractId: request.workflowContractId,
        workflowPlan: request.workflowPlan
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult() {
      return undefined;
    }
  };

  return { bridge, requests };
}

async function createFormalLoop(
  service: LoopService,
  input: {
    title?: string;
    goal?: string;
  } = {}
) {
  return service.createLoopContract({
    title: input.title ?? "Code health",
    goal: input.goal ?? "Keep checks visible",
    body: {
      steps: [
        {
          id: "run-worker",
          kind: "agent",
          label: "Run worker",
          prompt: "Run the loop workflow."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "done",
          label: "Done",
          requirement: "The workflow result satisfies the loop goal.",
          severity: "must"
        }
      ]
    }
  });
}

test("serves the preview shell", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(server.url);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain("DittosLoop For Codex");
  expect(html).toContain("Dittos.Loop");
  expect(html).toContain("Caveat:wght@600;700");
  expect(html).not.toContain("跟你一起");
  expect(html).toContain("id=\"loop-stage\"");
});

test("preview brand matches the Dittos.Loop wordmark treatment", async () => {
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(styles).toContain("--brand-pink: #e85a9e");
  expect(styles).toContain("color: var(--brand-pink)");
  expect(styles).toContain("font-family: Caveat");
});

test("preview script includes a real Live Loop directory view", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("renderLoopDirectory");
  expect(app).toContain("loadLoopFiles");
  expect(app).toContain("activeLoopTab = \"directory\"");
  expect(app).toContain("readRouteState");
  expect(app).toContain("directory-file-list");
  expect(app).toContain("/api/loops/");
  expect(app).toContain("/files");
  expect(app).not.toContain("function buildLoopDirectoryFiles");
  expect(app).not.toContain("function formalLoopDirectoryFiles");
  expect(app).not.toContain("formalWorkflowFlowFile");
  expect(app).not.toContain("compatibilityFlowFile");
  expect(app).not.toContain("context.codexApp.createThread(launch.launchRequest)");
});

test("preview script renders run detail as phase rail and agent cards", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("buildRunPhases");
  expect(app).toContain("selectedRunPhaseId");
  expect(app).toContain("renderAgentCard");
  expect(app).toContain("agent-card");
  expect(app).toContain("agent-avatar");
  expect(app).toContain("待 Codex App 创建");
  expect(app).toContain("threadId");
  expect(app).toContain("Codex 会话");
  expect(app).toContain("timelineSectionAgents");
  expect(app).toContain("workflowTimelinePhases");
  expect(app).toContain("mergePhaseTimelineStatus");
  expect(app).toContain("workflowGroupId");
  expect(app).toContain("item.phaseId");
  expect(app).toContain("sessionFromTimelineItem");
  expect(app).toContain("session?.threadUrl");
  expect(app).toContain("timelineSectionStatus");
  expect(app).toContain("工作流阶段");
  expect(app).toContain("renderWorkflowRuntimePanel");
  expect(app).toContain("detail.workflowContexts ?? []");
  expect(app).toContain("detail.workflowRevisions ?? []");
  expect(app).toContain("workflow-revisions");
  expect(app).toContain("Workflow attempt");
  expect(app).toContain("工作流草稿");
  expect(app).toContain("renderWorkflowTaskRun");
  expect(app).toContain("context.pendingSessionIds ?? []");
  expect(app).toContain("workflow-task-row");
  expect(app).toContain("workflow-pending-sessions");
  expect(app).toContain("subagent.tools?.length");
  expect(app).toContain("subagent.permissions?.filesystem");
  expect(app).toContain("subagent.workdir");
  expect(app).toContain("subagent.env");
  expect(app).toContain("subagent.timeoutMs");
  expect(app).toContain("subagent.context");
  expect(app).toContain("superseded: \"已替代\"");
  expect(app).not.toContain("阶段暂无 agent 明细");
});

test("preview renders agent cards with minimal avatars and no diamond marker", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");
  const agentCardRule = styles.match(/\.agent-card \{[\s\S]*?\n\}/)?.[0] ?? "";

  expect(app).toContain("agent-avatar");
  expect(app).toContain("agent-main");
  expect(app).toContain("agentInitial(agent)");
  expect(app).not.toContain("agent-diamond");
  expect(styles).toContain(".agent-avatar");
  expect(styles).toContain(".agent-main");
  expect(styles).toContain("border: 1.5px solid var(--dittos-700)");
  expect(styles).toContain("background: transparent");
  expect(styles).toContain(".agent-card:not(:last-child)");
  expect(styles).toContain("border-bottom: 1px solid var(--hair)");
  expect(styles).not.toContain("margin: 7px 0 0 41px");
  expect(agentCardRule).toContain("border: 0");
  expect(agentCardRule).not.toContain("border-radius");
  expect(styles).not.toContain(".agent-diamond");
  expect(styles).not.toContain("box-shadow: 0 5px 18px rgba(107, 91, 208, 0.08)");
});

test("preview keeps run output out of the run detail board", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).not.toContain("renderSummaryOutput");
  expect(app).not.toContain("summary-output");
  expect(app).not.toContain("汇总输出");
  expect(styles).not.toContain("summary-output");
  expect(styles).not.toContain("summary-copy");
  expect(app).not.toContain("run.codexSession.subagents ?? []).map");
  expect(app).not.toContain("Codex subagent attempt");
  expect(app).not.toContain("timelineAgents = detail.events.map");
});

test("preview script includes codex session launch controls", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("startCodexSession");
  expect(app).toContain("copyNewLoopPrompt");
  expect(app).toContain("copyText");
  expect(app).toContain("projectForLoop");
  expect(app).toContain("project?.name || project?.label");
  expect(app).toContain("project.name ?? project.label");
  expect(app).toContain("loop-project-group-title");
  expect(app).toContain("UNASSIGNED_PROJECT_LABEL = \"无项目\"");
  expect(app).toContain("closeCurrentLoopTab");
  expect(app).toContain("inactive-tab-title");
  expect(app).toContain("loopSelectionClosed = true");
  expect(app).toContain("updateWorkspaceState");
  expect(app).toContain("workspace-closed");
  expect(app).toContain("/codex-session");
  expect(app).toContain("/api/new-loop-session");
  expect(app).toContain("已复制成功，请打开 Codex 新会话粘贴构建。");
  expect(app).toContain("创建 Codex 会话请求");
  expect(app).toContain("sessionActionForRun");
  expect(app).toContain("等待 Codex App 创建");
  expect(app).toContain("dittosloop:create-codex-thread");
  expect(app).toContain("launchRequest");
  expect(app).toContain("codexProjectId");
  expect(app).toContain("deleteLoop");
  expect(app).toContain("danger-button");
  expect(app).toContain("window.confirm");
  expect(app).not.toContain("再次点击删除");
  expect(app).not.toContain("未连接 Codex 项目");
  expect(app).not.toContain("未关联会话");
  expect(app).not.toContain("待创建会话");
  expect(app).not.toContain("本轮剧本");
  expect(app).not.toContain("script-steps");
});

test("preview closes the workspace when all loop tabs are closed", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).toContain("const workspaceClosed = !selectedLoopId && !selectedRunId");
  expect(app).toContain("elements.shell?.classList.toggle(\"workspace-closed\", workspaceClosed)");
  expect(styles).toContain(".loop-shell.workspace-closed");
  expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(styles).toContain(".loop-shell.workspace-closed .loop-workspace");
  expect(styles).toContain("display: none");
});

test("preview keeps the workspace closed on initial history load", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("const route = readRouteState()");
  expect(app).toContain("route.runId");
  expect(app).not.toContain("selectedLoopId = newestLoopId(loops, runs)");
});

test("new loop prompt copy uses a centered toast without changing the workspace", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).toContain("showToast(\"已复制成功，请打开 Codex 新会话粘贴构建。\")");
  expect(app).toContain("function showToast(message)");
  expect(app).toContain("dittos-toast");
  expect(app).not.toContain("renderNotice(\"已复制新建循环提示词");
  expect(styles).toContain(".dittos-toast");
  expect(styles).toContain("position: fixed");
  expect(styles).toContain("left: 50%");
});

test("preview shell uses the new loop button as a session launch action", async () => {
  const html = await readFile(join(previewDir, "index.html"), "utf8");

  expect(html).toContain("id=\"new-loop\"");
  expect(html).toContain("+ 新建循环");
  expect(html).not.toContain("id=\"refresh\"");
  expect(html).not.toContain("id=\"loop-group-label\"");
});

test("preview script keeps deep-linked run routes even before snapshot catches up", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("selectedRunId = route.runId");
  expect(app).toContain("selectedLoopId = detail.loop.id");
});

test("serves the loop snapshot api", async () => {
  const service = await createService({
    codexProjects: [
      {
        id: "/Users/edisonzhong/Documents/dittos loop",
        name: "dittos loop",
        path: "/Users/edisonzhong/Documents/dittos loop"
      }
    ]
  });
  await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: { steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run npm test" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "tests", label: "Tests", requirement: "npm test passes", severity: "must" }]
    }
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/snapshot`);
  const snapshot = await response.json();

  expect(response.status).toBe(200);
  expect(snapshot).toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    codexProjects: [{ name: "dittos loop" }]
  });
});

test("serves backend-rendered loop directory files api", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成 AI 开发工具中文日报",
    body: {
      steps: [{ id: "write-report", kind: "agent", label: "日报 worker", prompt: "生成中文日报。" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "daily-report", label: "中文日报", requirement: "输出中文日报。", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "生成今天的中文日报" });
  await service.commitMemory(contract.id, { runId: run.id, summary: "保留昨天的来源筛选规则。" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${contract.id}/files`);
  const files = await response.json();

  expect(response.status).toBe(200);
  expect(files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "flow.js", kind: "flow", language: "javascript" }),
      expect.objectContaining({ path: "memory.md", kind: "memory", language: "markdown" }),
      expect.objectContaining({ path: "contract.json", kind: "contract", language: "json" })
    ])
  );
  expect(files.find((file: { path: string }) => file.path === "memory.md").content).toContain("保留昨天的来源筛选规则。");
  const sessionFile = files.find((file: { path: string }) => file.path === "codex/session.json");
  expect(sessionFile.content).toContain(`/api/runs/${run.id}/codex-thread`);
  expect(sessionFile.content).toContain("record_codex_thread");
});

test("creates a host-mediated new loop codex session request", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/new-loop-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch.launchRequest).toMatchObject({
    title: "DittosLoop: 新建 Live Loop",
    workflowRuntime: "dittosloop-loop-creator",
    projectLabel: "dittos loop"
  });
  expect(launch.prompt).toContain("create_loop_contract");
  expect(launch.prompt).toContain("workflow steps");
  expect(launch.prompt).toContain("verifier rubrics");
  expect(launch.prompt).toContain("task(runtime: \"codex\") / phase / parallel");
  expect(launch.prompt).not.toContain("agent / sequence / parallel");
});

test("deletes a loop from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "Daily code health check",
    goal: "Keep the project healthy"
  });
  const { run } = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${loop.id}`, { method: "DELETE" });
  const deleted = await response.json();

  expect(response.status).toBe(200);
  expect(deleted).toMatchObject({ id: loop.id, title: "Daily code health check" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [],
    runs: [],
    attempts: [],
    verificationResults: []
  });
});

test("serves composed run detail api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  const { run, attempt } = launch;
  await service.proposeWorkflowRevision(loop.id, {
    runId: run.id,
    attemptId: attempt.id,
    reason: "Add source scan",
    contract: {
      title: "Code health",
      goal: "Keep checks visible",
      body: {
        steps: [
          { id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." },
          { id: "scan-source", kind: "agent", label: "Scan source", prompt: "Check source links." }
        ]
      },
      verification: {
        mode: "after_workflow",
        rubrics: [
          {
            id: "done",
            label: "Done",
            requirement: "The workflow result satisfies the loop goal.",
            severity: "must"
          }
        ]
      }
    }
  });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail).toMatchObject({
    run: { id: run.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }],
    workflowContexts: [{ runId: run.id, status: "ready" }],
    workflowRevisions: [{ runId: run.id, status: "draft", reason: "Add source scan" }]
  });
});

test("serves workflow runtime detail for suspended tasks and promoted revisions", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const counters = new Map<string, number>();
  const service = await createService({
    sessionBridge: bridge,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    }
  });
  const contract = await service.createLoopContract({
    title: "Preview runtime",
    goal: "Show runtime state",
    body: {
      steps: [
        {
          id: "collect",
          kind: "task",
          runtime: "codex",
          label: "Collect",
          prompt: "Collect facts.",
          subagent: {
            ref: "researcher",
            tools: ["rg"],
            permissions: { filesystem: "workspace-write", network: "enabled" }
          }
        },
        { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write summary." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime is visible", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Preview suspended runtime" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const draft = await service.proposeWorkflowRevision(contract.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Add review step.",
    patch: {
      body: {
        steps: [
          { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect facts." },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write summary." },
          { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review summary." }
        ]
      }
    }
  });
  await service.promoteWorkflowRevision(contract.id, draft.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(requests.map((request) => request.stepId)).toEqual(["collect"]);
  expect(detail).toMatchObject({
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        status: "suspended",
        cursor: { state: "waiting_for_session", stepId: "collect", sessionId: "session_1" },
        pendingSessionIds: ["session_1"],
        taskRuns: [
          {
            id: "task_1",
            stepId: "collect",
            sessionId: "session_1",
            status: "suspended",
            subagent: {
              ref: "researcher",
              tools: ["rg"],
              permissions: { filesystem: "workspace-write", network: "enabled" }
            }
          }
        ]
      }
    ],
    workflowRevisions: [
      {
        id: draft.id,
        status: "promoted",
        reason: "Add review step."
      }
    ],
    engineEvents: [
      expect.objectContaining({ type: "run_started" }),
      expect.objectContaining({ type: "agent_started", stepId: "collect" })
    ],
    timeline: [
      expect.objectContaining({
        id: "workflow",
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "agent", label: "Collect", status: "started", stepId: "collect" })
        ])
      })
    ]
  });
});

test("serves engine events and grouped runtime timeline in run detail api", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual check" });
  await service.appendEvent(run.id, {
    message: "run_started",
    data: {
      engineEvent: {
        type: "run_started",
        runId: run.id,
        sequence: 1,
        createdAt: "2026-06-23T00:00:00.000Z"
      }
    }
  });
  await service.appendEvent(run.id, {
    message: "Agent started",
    data: {
      engineEvent: {
        type: "agent_started",
        runId: run.id,
        sequence: 2,
        createdAt: "2026-06-23T00:00:00.000Z",
        label: "Scan",
        stepId: "scan",
        prompt: "Scan updates"
      }
    }
  });
  await service.recordVerification(run.id, {
    status: "failed",
    summary: "Missing source",
    repair: true,
    checks: [{ name: "source", status: "failed", output: "No official source" }]
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail.engineEvents).toEqual([
    expect.objectContaining({ type: "run_started", sequence: 1 }),
    expect.objectContaining({ type: "agent_started", sequence: 2, label: "Scan" })
  ]);
  expect(detail.timeline).toEqual([
    expect.objectContaining({
      id: "workflow",
      title: "工作流",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "run", label: "开始运行", status: "started" }),
        expect.objectContaining({ kind: "agent", label: "Scan", status: "started" })
      ])
    }),
    expect.objectContaining({
      id: "verification",
      title: "验证",
      items: [expect.objectContaining({ kind: "verification", status: "failed", label: "Missing source" })]
    }),
    expect.objectContaining({
      id: "repair",
      title: "修复",
      items: [expect.objectContaining({ kind: "repair", label: "Missing source", status: "repairing" })]
    })
  ]);
});

test("serves formal engine event sections without invented verification records", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Formal runtime",
    goal: "Run a formal workflow",
    body: {
      steps: [
        {
          id: "collect",
          kind: "phase",
          label: "Collect",
          children: [{ id: "agent-collect", kind: "agent", label: "Collector", prompt: "Collect facts" }]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "complete", label: "Complete", requirement: "Produce complete output", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual formal run" });
  const events = [
    {
      type: "run_started",
      runId: run.id,
      sequence: 1,
      createdAt: "2026-06-23T00:00:00.000Z"
    },
    {
      type: "phase_started",
      runId: run.id,
      sequence: 2,
      createdAt: "2026-06-23T00:01:00.000Z",
      phaseId: "collect",
      title: "Collect"
    },
    {
      type: "agent_done",
      runId: run.id,
      sequence: 3,
      createdAt: "2026-06-23T00:02:00.000Z",
      nodeId: "agent-collect",
      phaseId: "collect",
      label: "Collector",
      status: "ok",
      result: "Collected facts",
      session: {
        sessionId: "session_1",
        threadId: "thread_1",
        threadTitle: "DittosLoop: Collector",
        threadUrl: "codex://thread/thread_1"
      }
    },
    {
      type: "verification_started",
      runId: run.id,
      sequence: 4,
      createdAt: "2026-06-23T00:03:00.000Z",
      attemptId: "attempt_1"
    },
    {
      type: "verification_done",
      runId: run.id,
      sequence: 5,
      createdAt: "2026-06-23T00:04:00.000Z",
      attemptId: "attempt_1",
      decision: {
        status: "failed",
        summary: "Need stronger sources",
        checks: [{ rubricId: "complete", status: "failed", evidence: "No source links" }],
        repairInstructions: "Add source links"
      }
    },
    {
      type: "repair_started",
      runId: run.id,
      sequence: 6,
      createdAt: "2026-06-23T00:05:00.000Z",
      attemptId: "attempt_2",
      reason: "Add source links"
    },
    {
      type: "human_request",
      runId: run.id,
      sequence: 7,
      createdAt: "2026-06-23T00:06:00.000Z",
      question: "Should the run continue?"
    },
    {
      type: "run_done",
      runId: run.id,
      sequence: 8,
      createdAt: "2026-06-23T00:07:00.000Z",
      status: "waiting_for_human",
      summary: "Waiting for user input"
    }
  ];
  for (const event of events) {
    await service.appendEvent(run.id, { message: event.type, data: { engineEvent: event } });
  }
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail.verificationResults).toEqual([]);
  expect(detail.timeline).toEqual([
    expect.objectContaining({
      id: "workflow",
      title: "工作流",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "phase", label: "Collect", status: "started" }),
        expect.objectContaining({
          kind: "agent",
          label: "Collector",
          status: "completed",
          phaseId: "collect",
          message: "Collected facts",
          session: expect.objectContaining({
            sessionId: "session_1",
            threadUrl: "codex://thread/thread_1"
          })
        })
      ])
    }),
    expect.objectContaining({
      id: "verification",
      title: "验证",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "verification", label: "开始验证", status: "started" }),
        expect.objectContaining({ kind: "verification", label: "Need stronger sources", status: "failed", message: "Complete: failed - No source links" })
      ])
    }),
    expect.objectContaining({
      id: "repair",
      title: "修复",
      items: [expect.objectContaining({ kind: "repair", label: "Add source links", status: "repairing" })]
    }),
    expect.objectContaining({
      id: "human",
      title: "人工处理",
      items: [expect.objectContaining({ kind: "human", label: "Should the run continue?", status: "needs_human" })]
    }),
    expect.objectContaining({
      id: "run",
      title: "运行",
      items: [expect.objectContaining({ kind: "run", label: "Waiting for user input", status: "waiting_for_human" })]
    })
  ]);
});

test("starts a codex session run from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${loop.id}/codex-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Check today updates",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch).toMatchObject({
    run: {
      loopId: loop.id,
      goal: "Check today updates",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop",
      codexSession: {
        mode: "new_session",
        status: "requested",
        codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
        projectLabel: "dittos loop"
      }
    },
    attempt: {
      status: "running"
    }
  });
  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    loopId: loop.id,
    title: "DittosLoop: AI Dev Tools Update Monitor",
    projectLabel: "dittos loop"
  });
  expect(launch.prompt).toContain("AI Dev Tools Update Monitor");
});

test("records a codex thread from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Check today updates" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}/codex-thread`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
      threadTitle: "DittosLoop: AI Dev Tools Update Monitor"
    })
  });
  const run = await response.json();

  expect(response.status).toBe(200);
  expect(run).toMatchObject({
    id: launch.run.id,
    codexSession: {
      status: "started",
      threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
      threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
      subagents: [
        {
          status: "running",
          threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
        }
      ]
    }
  });
});

test("opens a codex session from the preview api when the host thread is attached", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Check today updates" });
  await service.recordCodexThread(launch.run.id, {
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}/open-codex-session`, {
    method: "POST"
  });
  const opened = await response.json();

  expect(response.status).toBe(200);
  expect(opened).toEqual({
    runId: launch.run.id,
    status: "ready",
    message: "Codex session is ready to open.",
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });
});

test("returns 404 for unknown run detail", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/run_missing`);
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body).toEqual({ error: "Run not found: run_missing" });
});
