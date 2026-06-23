import { mkdtemp, rm } from "node:fs/promises";
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
  expect(html).toContain("Run detail");
  expect(html).toContain("id=\"run-detail\"");
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

test("returns 404 for unknown run detail", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/run_missing`);
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body).toEqual({ error: "Run not found: run_missing" });
});
