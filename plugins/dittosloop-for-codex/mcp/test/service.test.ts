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

test("creates a formal loop contract and starts an engine-backed run", async () => {
  const service = await createService();

  const formal = await service.createLoopContract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  });

  expect(formal.body.steps[0]).toMatchObject({ id: "scan", kind: "agent" });

  const run = await service.startLoopRun(formal.id, { goal: "Manual check" });

  expect(run).toMatchObject({
    id: "run_1",
    loopId: formal.id,
    status: "running",
    goal: "Manual check"
  });
  await expect(service.getRunDetail(run.id)).resolves.toMatchObject({
    events: [
      {
        data: {
          engineEvent: {
            type: "run_started",
            runId: run.id,
            sequence: 1
          }
        }
      }
    ]
  });
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

test("binds loop runs to the Codex project selected for the loop", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "Project monitor",
    intent: "Watch a Codex project",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  const run = await service.triggerRun(loop.id, { goal: "Run scheduled check" });

  expect(run).toMatchObject({
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });
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

test("starts a current-session subagent run with project binding and prompt intent", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "AI Dev Tools Update Monitor",
    intent: "Watch release updates and Twitter/X signals",
    verificationChecks: ["official changelog checked"]
  });

  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  expect(launch.run).toMatchObject({
    id: "run_1",
    loopId: loop.id,
    goal: "Check today updates",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop",
    codexSession: {
      mode: "current_session",
      status: "requested",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop",
      subagents: [
        {
          role: "loop-runner",
          status: "requested"
        }
      ]
    }
  });
  expect(launch.attempt).toMatchObject({
    id: "attempt_1",
    runId: launch.run.id,
    status: "running",
    summary: "Run AI Dev Tools Update Monitor in current Codex session with subagent"
  });
  expect(launch.prompt).toContain("AI Dev Tools Update Monitor");
  expect(launch.prompt).toContain("Check today updates");
  expect(launch.prompt).toContain("official changelog checked");
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { codexSession: { status: "requested" } },
    loop: {
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    },
    events: [
      {
        kind: "run_created",
        data: {
          codexSession: {
            mode: "current_session",
            status: "requested",
            codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
            projectLabel: "dittos loop",
            projectPath: "/Users/edisonzhong/Documents/dittos loop",
            subagents: [{ role: "loop-runner", status: "requested" }]
          }
        }
      },
      { kind: "attempt_started" }
    ]
  });
});

test("records a real Codex thread against a requested session run", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "AI Dev Tools Update Monitor",
    intent: "Watch release updates and Twitter/X signals"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates"
  });

  const updated = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });

  expect(updated.codexSession).toMatchObject({
    status: "started",
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475",
    subagents: [
      {
        role: "loop-runner",
        status: "running",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    ]
  });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: {
      codexSession: {
        status: "started",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    },
    events: [
      { kind: "run_created" },
      { kind: "attempt_started" },
      {
        kind: "note",
        message: "Codex thread created and attached to this run",
        data: {
          codexThread: {
            threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
            threadTitle: "DittosLoop: AI Dev Tools Update Monitor"
          }
        }
      }
    ]
  });
});

test("records a default subagent when older session runs have none", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "Legacy Monitor",
    intent: "Watch updates"
  });
  const run = await service.triggerRun(loop.id, { goal: "Check today updates" });
  await service.appendEvent(run.id, { message: "legacy setup" });
  await (service as any).options.store.updateState((state) => ({
    ...state,
    runs: state.runs.map((candidate) =>
      candidate.id === run.id
        ? {
            ...candidate,
            codexSession: {
              mode: "new_session",
              status: "requested",
              prompt: "legacy prompt"
            }
          }
        : candidate
    )
  }));

  const updated = await service.recordCodexThread(run.id, {
    threadId: "019ef4e5-21f0-7131-be8c-708f720e49de"
  });

  expect(updated.codexSession?.subagents).toEqual([
    {
      role: "loop-runner",
      status: "running",
      threadId: "019ef4e5-21f0-7131-be8c-708f720e49de",
      threadTitle: undefined,
      threadUrl: undefined
    }
  ]);
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
