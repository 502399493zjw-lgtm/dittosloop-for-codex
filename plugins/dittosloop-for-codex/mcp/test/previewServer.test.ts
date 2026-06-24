import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import { startPreviewServer, type PreviewServer } from "../src/previewServer.js";
import { LoopService, type LoopServiceOptions } from "../src/service.js";
import { LoopStore } from "../src/store.js";

const tempDirs: string[] = [];
const servers: PreviewServer[] = [];
const previewDir = join(dirname(fileURLToPath(import.meta.url)), "../../preview");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(options: Partial<Pick<LoopServiceOptions, "codexProjects">> = {}) {
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
  expect(app).toContain("activeLoopTab = \"directory\"");
  expect(app).toContain("readRouteState");
  expect(app).toContain("directory-file-list");
  expect(app).toContain("flow.js");
  expect(app).toContain("memory.md");
  expect(app).toContain("contract.json");
  expect(app).toContain("session.json");
  expect(app).toContain("formalWorkflowFlowFile");
  expect(app).toContain("workflowContractId");
  expect(app).toContain("runPhase");
  expect(app).toContain("runParallel");
  expect(app).toContain("runAgent");
  expect(app).toContain("verifyRubrics");
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
  expect(app).not.toContain("workflowRevisions ?? []).map");
  expect(app).not.toContain("workflow-revisions");
  expect(app).not.toContain("修订草稿");
  expect(app).not.toContain("Workflow attempt");
  expect(app).not.toContain("Workflow draft");
  expect(app).not.toContain("工作流草稿");
  expect(app).not.toContain("阶段暂无 agent 明细");
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
  expect(app).toContain("/codex-thread");
  expect(app).toContain("record_codex_thread");
  expect(app).toContain("已复制新建循环提示词");
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
  await service.createLoop({
    title: "Daily code health check",
    intent: "Keep the project healthy",
    verificationChecks: ["npm test"]
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
  expect(launch.prompt).toContain("agent / phase / parallel");
  expect(launch.prompt).not.toContain("agent / sequence / parallel");
});

test("deletes a loop from the preview api", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "Daily code health check",
    intent: "Keep the project healthy"
  });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
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
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail).toMatchObject({
    run: { id: run.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }]
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
  const run = await service.startLoopRun(contract.id, { goal: "Manual check" });
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
  const run = await service.startLoopRun(contract.id, { goal: "Manual formal run" });
  const events = [
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
  const loop = await service.createLoop({
    title: "AI Dev Tools Update Monitor",
    intent: "Watch release updates"
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
  const loop = await service.createLoop({
    title: "AI Dev Tools Update Monitor",
    intent: "Watch release updates"
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
  const loop = await service.createLoop({
    title: "AI Dev Tools Update Monitor",
    intent: "Watch release updates"
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
