import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { createToolHandlers } from "../../src/mcpServer.js";
import { LoopService } from "../../src/service.js";
import { LoopStore } from "../../src/store.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-approval-"));
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

function runtimeVerification() {
  return {
    mode: "after_workflow" as const,
    rubrics: [{ id: "done", label: "Done", requirement: "Workflow result is acceptable.", severity: "must" as const }]
  };
}

function readResult<T>(result: { content: Array<{ text: string }> }): T {
  return JSON.parse(result.content[0].text) as T;
}

test("unapproved runtime script is blocked before execution and verification", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Approval-gated runtime script",
    goal: "Wait for human approval before executing",
    workflowKind: "runtime_script",
    script: "return { summary: 'executed' };",
    verification: runtimeVerification()
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run after approval" });
  const verifier = vi.fn();

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(run.status).toBe("waiting_for_human");
  expect(verifier).not.toHaveBeenCalled();

  const detail = await service.getRunDetail(run.id);
  expect(detail.events.map((event) => event.message).join("\n")).not.toContain("运行时脚本开始");
  expect(detail.workflowContexts[0]?.vars.runtimeScript).toMatchObject({
    status: "not_started"
  });
  expect(detail.humanRequests).toEqual([
    expect.objectContaining({
      runId: run.id,
      status: "open"
    })
  ]);
});

test("approval tool persists approval and allows runtime script execution", async () => {
  const service = await createService();
  const handlers = createToolHandlers(service);
  const contract = await service.createLoopContract({
    title: "Approval path",
    goal: "Execute only after approval",
    workflowKind: "runtime_script",
    script: "return { summary: 'executed', score: 1 };",
    verification: runtimeVerification()
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run after approval" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const approved = readResult<any>(await handlers["approve_runtime_script"]({
    loopId: contract.id,
    approvedBy: "user"
  }));
  const verifier = vi.fn(async ({ result }) => ({
    status: "passed" as const,
    summary: "Approved runtime script executed",
    checks: [{ rubricId: "done", status: "passed" as const, evidence: JSON.stringify(result) }]
  }));

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(approved.workflow.approval).toMatchObject({
    required: true,
    approvedAt: fixedTime,
    approvedBy: "user"
  });
  expect(run.status).toBe("completed");
  expect(verifier).toHaveBeenCalled();

  const detail = await service.getRunDetail(run.id);
  expect(detail.workflowContexts[0]?.contractSnapshot?.workflow).toMatchObject({
    kind: "runtime_script",
    approval: {
      required: true,
      approvedAt: fixedTime,
      approvedBy: "user"
    }
  });
  expect(detail.events.map((event) => event.message)).toEqual(
    expect.arrayContaining(["运行时脚本开始：loop_1", "运行时脚本完成：completed"])
  );
  expect(detail.humanRequests.filter((request) => request.runId === run.id && request.status === "open")).toEqual([]);
  expect(detail.humanRequests).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        runId: run.id,
        status: "resolved",
        response: expect.stringContaining("Approved by user")
      })
    ])
  );
});

test("approval requests are deduped while runtime script remains blocked", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Deduped approval request",
    goal: "Keep one approval request open",
    workflowKind: "runtime_script",
    script: "return { summary: 'executed' };",
    verification: runtimeVerification()
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run after approval" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.humanRequests.filter((request) => request.runId === launch.run.id && request.status === "open")).toHaveLength(1);
});

test("approval state is persisted on the active runtime script contract", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Persistent approval",
    goal: "Keep approval metadata",
    workflowKind: "runtime_script",
    script: "return 'ok';",
    verification: runtimeVerification()
  });

  const approved = await service.approveRuntimeScript(contract.id, { approvedBy: "user" });
  const loops = await service.listLoops();

  expect(approved.workflow.approval).toMatchObject({
    required: true,
    approvedAt: fixedTime,
    approvedBy: "user"
  });
  expect(loops.find((loop) => loop.id === contract.id)?.updatedAt).toBe(fixedTime);
});

test("static workflows do not require runtime script approval", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Static workflow",
    goal: "Run without runtime approval",
    body: {
      steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write the draft." }]
    },
    verification: runtimeVerification()
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run static workflow" });
  const verifier = vi.fn(async () => ({
    status: "passed" as const,
    summary: "Static workflow passed",
    checks: [{ rubricId: "done", status: "passed" as const, evidence: "ok" }]
  }));

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    executor: {
      async run() {
        return { text: "done" };
      }
    },
    verifier
  });

  expect(run.status).toBe("completed");
  expect(verifier).toHaveBeenCalled();
});
