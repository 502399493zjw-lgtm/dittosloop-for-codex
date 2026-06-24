import { mkdtemp, rm } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import { startPreviewServer, type PreviewServer } from "../src/previewServer.js";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";

const tempDirs: string[] = [];
const servers: PreviewServer[] = [];
const previewDir = join(dirname(fileURLToPath(import.meta.url)), "../../preview");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-preview-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-23T00:00:00.000Z",
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:0"
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
  expect(html).toContain("Live Loop");
  expect(html).toContain("id=\"loop-stage\"");
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
  expect(app).toContain("workflowAgentCards");
  expect(app).toContain("Workflow attempt");
  expect(app).toContain("Workflow draft");
  expect(app).toContain("workflowRevisions");
  expect(app).toContain("工作流阶段");
});

test("preview keeps verification internals out of the user-facing summary output", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("renderSummaryOutput");
  expect(app).not.toContain("latestVerification ? el(\"p\", \"summary-copy\", latestVerification.summary)");
  expect(app).not.toContain("run.codexSession.subagents ?? []).map");
  expect(app).not.toContain("Codex subagent attempt");
  expect(app).not.toContain("timelineAgents = detail.events.map");
});

test("preview script includes codex session launch controls", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("startCodexSession");
  expect(app).toContain("project-picker");
  expect(app).toContain("/codex-session");
  expect(app).toContain("/codex-thread");
  expect(app).toContain("record_codex_thread");
  expect(app).toContain("创建 Codex 会话请求");
  expect(app).toContain("launchRequest");
  expect(app).toContain("codexProjectId");
  expect(app).toContain("deleteLoop");
  expect(app).toContain("danger-button");
  expect(app).not.toContain("未连接 Codex 项目");
  expect(app).not.toContain("本轮剧本");
  expect(app).not.toContain("script-steps");
});

test("preview script keeps deep-linked run routes even before snapshot catches up", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("selectedRunId = route.runId");
  expect(app).toContain("selectedLoopId = detail.loop.id");
});

test("serves the loop snapshot api", async () => {
  const service = await createService();
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
    loops: [{ id: "loop_1", title: "Daily code health check" }]
  });
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
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "run", status: "started" }),
        expect.objectContaining({ kind: "agent", label: "Scan", status: "started" })
      ])
    }),
    expect.objectContaining({
      id: "verification",
      items: [expect.objectContaining({ kind: "verification", status: "failed", label: "Missing source" })]
    }),
    expect.objectContaining({
      id: "repair",
      items: [expect.objectContaining({ kind: "repair", status: "repairing" })]
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
          status: "completed",
          threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
        }
      ]
    }
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
