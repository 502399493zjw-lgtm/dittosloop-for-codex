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

test("starts and completes an attempt under a run", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });

  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  const completed = await service.completeAttempt(attempt.id, {
    status: "completed",
    summary: "Tests passed"
  });

  expect(completed).toMatchObject({
    id: "attempt_1",
    runId: run.id,
    status: "completed",
    summary: "Tests passed",
    completedAt: fixedTime
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    attempts: [{ id: "attempt_1", runId: run.id, status: "completed" }],
    events: [
      { kind: "attempt_started", runId: run.id, message: "First pass" },
      { kind: "attempt_completed", runId: run.id, message: "Tests passed" }
    ]
  });
});

test("records failed verification against an attempt and marks run repairing when requested", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id);

  const result = await service.recordVerification(run.id, {
    attemptId: attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true,
    checks: [{ name: "npm run build", status: "failed", output: "TS error" }]
  });

  expect(result).toMatchObject({ runId: run.id, attemptId: attempt.id, status: "failed" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: run.id, status: "repairing", updatedAt: fixedTime }],
    verificationResults: [{ id: "verification_1", attemptId: attempt.id }]
  });
});

test("resolves a human request with a response", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const request = await service.recordHumanRequest(run.id, { question: "Continue with repair?" });

  const resolved = await service.resolveHumanRequest(request.id, { response: "Yes, continue." });

  expect(resolved).toMatchObject({
    id: request.id,
    status: "resolved",
    response: "Yes, continue.",
    resolvedAt: fixedTime
  });
});

test("returns composed run detail", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.appendEvent(run.id, { message: "Checked package scripts" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  await service.recordHumanRequest(run.id, { question: "Ship it?" });
  await service.commitMemory(loop.id, { runId: run.id, summary: "Checks passed locally." });
  await service.addArtifact(run.id, { title: "Preview", url: "http://127.0.0.1:47888" });

  const detail = await service.getRunDetail(run.id);

  expect(detail).toMatchObject({
    run: { id: run.id },
    loop: { id: loop.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }],
    humanRequests: [{ status: "open" }],
    memoryCommits: [{ summary: "Checks passed locally." }],
    artifacts: [{ title: "Preview" }]
  });
  expect(detail.events).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Checked package scripts" })]));
});
