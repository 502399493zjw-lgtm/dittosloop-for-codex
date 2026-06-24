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

async function createServiceWithSequentialIds() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
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

test("runs a formal workflow end to end with a draft workflow repair without replacing the active contract", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "AI Dev Tools Update Monitor",
    goal: "Monitor Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates",
    body: {
      steps: [
        {
          id: "collect",
          kind: "agent",
          label: "Collect updates",
          prompt: "Collect notable updates without sources"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "sources",
          label: "Sources",
          requirement: "Every notable update includes an official source",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" },
    stopPolicy: { rule: "stop after verification passes or attempts are exhausted" }
  });

  const run = await service.runLoopWorkflow(formal.id, {
    executor: {
      async run(request) {
        return request.prompt.includes("with official sources")
          ? { text: "Claude Code update with official changelog source" }
          : { text: "Claude Code update" };
      }
    },
    verifier: ({ result }) => {
      const text = JSON.stringify(result);
      return text.includes("official changelog source")
        ? {
            status: "passed",
            summary: "All updates include official sources.",
            checks: [{ rubricId: "sources", status: "passed", evidence: "official changelog source" }]
          }
        : {
            status: "failed",
            summary: "Missing official sources.",
            repairInstructions: "Update the collect step to require official sources.",
            checks: [{ rubricId: "sources", status: "failed" }]
          };
    },
    repairWorkflow: ({ contract }) => ({
      ...contract,
      body: {
        steps: contract.body.steps.map((step) =>
          step.id === "collect" && step.kind === "agent"
            ? { ...step, prompt: "Collect notable updates with official sources" }
            : step
        )
      }
    })
  });

  expect(run).toMatchObject({
    loopId: formal.id,
    status: "completed",
    goal: formal.goal
  });

  const detail = await service.getRunDetail(run.id);
  expect(detail.attempts).toMatchObject([
    { status: "failed", summary: "Missing official sources." },
    { status: "completed", summary: "All updates include official sources." }
  ]);
  expect(detail.verificationResults).toMatchObject([
    { status: "failed", summary: "Missing official sources.", checks: [{ name: "Sources", status: "failed" }] },
    {
      status: "passed",
      summary: "All updates include official sources.",
      checks: [{ name: "Sources", status: "passed", output: "official changelog source" }]
    }
  ]);
  expect(detail.events.map((event) => event.data?.engineEvent?.type).filter(Boolean)).toEqual([
    "run_started",
    "agent_started",
    "agent_done",
    "run_completed",
    "run_started",
    "agent_started",
    "agent_done",
    "run_completed"
  ]);
  expect(detail.workflowRevisions).toHaveLength(1);
  expect(detail.workflowRevisions[0]).toMatchObject({
    status: "draft",
    reason: "Missing official sources.",
    contract: {
      id: formal.id,
      body: {
        steps: [{ id: "collect", kind: "agent", prompt: "Collect notable updates with official sources" }]
      }
    }
  });

  const snapshot = await service.getSnapshot();
  expect(snapshot.formalContracts?.[0].body.steps[0]).toMatchObject({
    id: "collect",
    kind: "agent",
    prompt: "Collect notable updates without sources"
  });
  expect(snapshot.workflowRevisions?.[0].contract.body.steps[0]).toMatchObject({
    id: "collect",
    kind: "agent",
    prompt: "Collect notable updates with official sources"
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

test("deletes a loop and its run history", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: {
      steps: [
        {
          id: "check",
          kind: "agent",
          label: "Run checks",
          prompt: "Run the local health checks."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "tests",
          label: "Tests",
          requirement: "Tests pass",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" }
  });
  const run = await service.runLoopWorkflow(formal.id, {
    executor: {
      async run() {
        return { text: "Tests passed" };
      }
    },
    verifier: () => ({
      status: "failed",
      summary: "Missing artifact.",
      checks: [{ rubricId: "tests", status: "failed" }]
    }),
    repairWorkflow: ({ contract }) => contract
  });
  await service.appendEvent(run.id, { kind: "note", message: "Started local checks" });
  await service.recordHumanRequest(run.id, { question: "Ship it?" });
  await service.commitMemory(formal.id, { runId: run.id, summary: "Checks passed locally." });
  await service.addArtifact(run.id, { title: "Preview", url: "http://127.0.0.1:47888" });

  const deleted = await service.deleteLoop(formal.id);

  expect(deleted).toMatchObject({ id: formal.id, title: "Daily code health check" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [],
    formalContracts: [],
    workflowRevisions: [],
    runs: [],
    attempts: [],
    events: [],
    verificationResults: [],
    humanRequests: [],
    memoryCommits: [],
    artifacts: []
  });
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

test("starts a host-mediated Codex session launch request with project binding and prompt intent", async () => {
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
      mode: "new_session",
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
    summary: "Request a new Codex session for AI Dev Tools Update Monitor"
  });
  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    loopId: loop.id,
    title: "DittosLoop: AI Dev Tools Update Monitor",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop",
    prompt: launch.prompt
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
            mode: "new_session",
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

test("compiles Codex session prompt from formal workflow contract when available", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "AI Dev Tools Workflow Runtime",
    goal: "Monitor AI dev tool updates through the DittosLoop runtime",
    body: {
      steps: [
        {
          id: "collect",
          kind: "agent",
          label: "Collect official updates",
          prompt: "Collect Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "official-source",
          label: "Official source",
          requirement: "Every notable update cites an official source or explicitly says none was found",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 3, strategy: "repair_then_retry" }
  });

  const launch = await service.startCodexSessionRun(formal.id, {
    goal: "Run the monitor using the local workflow runtime"
  });

  expect(launch.prompt).toContain(`Contract id: ${formal.id}`);
  expect(launch.prompt).toContain("Use the local DittosLoop workflow runtime");
  expect(launch.prompt).toContain("Do not replace the active workflow contract");
  expect(launch.prompt).toContain("Collect official updates");
  expect(launch.prompt).toContain("Every notable update cites an official source");
  expect(launch.launchRequest).toMatchObject({
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: formal.id
  });
  expect(launch.run.codexSession?.subagents?.[0].prompt).toBe(launch.prompt);
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
        status: "completed",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    ]
  });
  expect(updated).toMatchObject({
    status: "completed",
    completedAt: fixedTime
  });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: {
      status: "completed",
      completedAt: fixedTime,
      codexSession: {
        status: "started",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    },
    attempts: [
      {
        status: "completed",
        completedAt: fixedTime,
        summary: "Request a new Codex session for AI Dev Tools Update Monitor"
      }
    ],
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
      },
      {
        kind: "attempt_completed",
        message: "Codex thread created and attached to this run"
      },
      {
        kind: "run_completed",
        message: "Codex session launch completed"
      }
    ]
  });

  const corrected = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef7a0-bc04-72f1-8454-607c376eaaea"
  });

  expect(corrected.codexSession).toMatchObject({
    threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
    subagents: [
      {
        status: "completed",
        threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
        threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
        threadUrl: "codex://thread/019ef7a0-bc04-72f1-8454-607c376eaaea"
      }
    ]
  });
});

test("completing a Codex session run closes its subagent status", async () => {
  const service = await createService();
  const loop = await service.createLoop({
    title: "Chinese Daily Report",
    intent: "Write a daily report"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Start worker session"
  });
  const started = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef7b4-7a0d-74f2-b1a9-10502784e636",
    threadTitle: "DittosLoop: AI 开发工具更新日报"
  });

  expect(started.codexSession?.subagents?.[0]?.status).toBe("completed");

  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.run).toMatchObject({
    status: "completed",
    codexSession: {
      subagents: [
        {
          role: "loop-runner",
          status: "completed",
          threadId: "019ef7b4-7a0d-74f2-b1a9-10502784e636"
        }
      ]
    }
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
      status: "completed",
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
