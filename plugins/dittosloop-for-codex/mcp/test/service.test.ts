import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-23T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888"
  });
}

test("creates a loop contract with manual trigger defaults", async () => {
  const service = await createService();

  const loop = await service.createLoop({
    title: "Daily code health check",
    intent: "Keep the project healthy",
    verificationChecks: ["npm test"]
  });

  await expect(service.listLoops()).resolves.toEqual([
    {
      id: "loop_1",
      title: "Daily code health check",
      intent: "Keep the project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    }
  ]);
  expect(loop.id).toBe("loop_1");
});

test("records a run lifecycle in the snapshot", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "Daily code health check",
    intent: "Keep the project healthy",
    verificationChecks: ["npm test"]
  });

  const run = await service.triggerRun(loop.id, { goal: "Check current tests" });
  await service.appendEvent(run.id, { kind: "note", message: "Started local checks" });
  await service.recordVerification(run.id, {
    status: "passed",
    summary: "Tests passed",
    checks: [{ name: "npm test", status: "passed", output: "2 passed" }]
  });
  await service.recordHumanRequest(run.id, { question: "Should this loop run every morning?" });
  await service.commitMemory(loop.id, {
    runId: run.id,
    summary: "Manual check loop should stay local-first."
  });
  await service.addArtifact(run.id, {
    title: "Preview",
    url: "http://127.0.0.1:47888",
    kind: "preview"
  });
  await service.completeRun(run.id, { status: "completed" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    runs: [{ id: "run_1", loopId: "loop_1", status: "completed", completedAt: fixedTime }],
    events: [{ id: "event_1", runId: "run_1", kind: "note", message: "Started local checks" }],
    verificationResults: [{ id: "verification_1", runId: "run_1", status: "passed" }],
    humanRequests: [{ id: "human_1", runId: "run_1", question: "Should this loop run every morning?" }],
    memoryCommits: [{ id: "memory_1", loopId: "loop_1", runId: "run_1" }],
    artifacts: [{ id: "artifact_1", runId: "run_1", title: "Preview" }]
  });
  expect(service.getPreviewUrl()).toBe("http://127.0.0.1:47888");
});
