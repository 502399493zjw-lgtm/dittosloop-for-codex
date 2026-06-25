import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createToolHandlers, registerDittosLoopTools } from "../src/mcpServer.js";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type {
  CodexSessionBridge,
  CodexSessionRequest,
  CodexSessionResult
} from "../src/codex/sessionBridge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHandlers() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-mcp-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const sessionRequests: CodexSessionRequest[] = [];
  const sessionBridge: CodexSessionBridge = {
    async createSession(request) {
      sessionRequests.push(request);
      return {
        sessionId: `session_${sessionRequests.length}`,
        runId: request.runId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
        createdAt: "2026-06-23T00:00:00.000Z",
        prompt: request.prompt,
        workflowRuntime: request.workflowRuntime,
        workflowContractId: request.workflowContractId,
        workflowPlan: request.workflowPlan,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        projectPath: request.projectPath
      };
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult | undefined> {
      return undefined;
    }
  };

  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-23T00:00:00.000Z",
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });

  return createToolHandlers(service);
}

test("exposes loop operations as MCP content", async () => {
  const handlers = await createHandlers();

  expect(handlers.create_loop).toBeUndefined();
  expect(handlers.trigger_run).toBeUndefined();

  const loop = readResult(await handlers.create_loop_contract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run npm test" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "tests", label: "Tests", requirement: "npm test passes", severity: "must" }]
    }
  }));
  const run = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Check tests" })).run;
  await handlers.append_event({ runId: run.id, message: "Started checks" });
  await handlers.record_verification({ runId: run.id, status: "passed", summary: "Tests passed" });

  const snapshot = readResult(await handlers.get_snapshot({}));

  expect(snapshot).toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    runs: [{ id: "run_1", loopId: "loop_1" }],
    verificationResults: [{ id: "verification_1", status: "passed" }]
  });
  expect(snapshot.events).toEqual(expect.arrayContaining([
    expect.objectContaining({ message: "Started checks" })
  ]));
});

test("exposes formal contract and engine run operations as MCP content", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    },
    repairPolicy: { maxAttempts: 3, strategy: "ask_human" },
    stopPolicy: { rule: "Stop after a verified daily report", maxConsecutiveFailures: 2 }
  }));
  const run = readResult(await handlers.start_loop_run({ loopId: contract.id, goal: "Manual check" }));
  const detail = readResult(await handlers.get_run_detail({ runId: run.id }));

  expect(contract).toMatchObject({
    id: "loop_1",
    goal: "Track AI tool updates",
    body: { steps: [{ id: "scan", kind: "agent" }] },
    repairPolicy: { maxAttempts: 3, strategy: "ask_human" },
    stopPolicy: { rule: "Stop after a verified daily report", maxConsecutiveFailures: 2 }
  });
  expect(detail).toMatchObject({
    run: {
      id: "run_1",
      status: "running",
      codexSession: {
        status: "requested",
        subagents: [
          {
            role: "Scan",
            status: "requested"
          }
        ]
      }
    }
  });
  expect(detail.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "attempt_started",
      message: "工作流执行第 1 次"
    }),
    expect.objectContaining({
      data: expect.objectContaining({
        engineEvent: expect.objectContaining({
          type: "run_started",
          runId: "run_1"
        })
      })
    }),
    expect.objectContaining({
      data: expect.objectContaining({
        codexSession: expect.objectContaining({
          workflowRuntime: "dittosloop-local-workflow",
          workflowContractId: "loop_1"
        })
      })
    })
  ]));
});

test("exposes attempt and run detail operations as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Code health",
    goal: "Keep checks visible",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run checks" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "checks", label: "Checks", requirement: "Checks pass", severity: "must" }]
    }
  }));
  const run = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Run checks" })).run;

  const attempt = readResult(await handlers.start_attempt({ runId: run.id, summary: "First pass" }));
  await handlers.complete_attempt({ attemptId: attempt.id, status: "failed", summary: "Build failed" });
  await handlers.record_verification({
    runId: run.id,
    attemptId: attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true
  });
  const request = readResult(await handlers.record_human_request({ runId: run.id, question: "Continue?" }));
  await handlers.resolve_human_request({ requestId: request.id, response: "Continue." });
  await handlers.mark_run_repairing({ runId: run.id, reason: "Repair after build failure" });

  const detail = readResult(await handlers.get_run_detail({ runId: run.id }));

  expect(detail).toMatchObject({
    run: { id: run.id, status: "repairing" },
    verificationResults: [{ attemptId: attempt.id }],
    humanRequests: [{ id: request.id, status: "resolved", response: "Continue." }]
  });
  expect(detail.attempts).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: attempt.id, status: "failed" })
  ]));
});

test("exposes codex session launch as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Monitor",
    goal: "Watch updates",
    body: {
      steps: [{ id: "monitor", kind: "agent", label: "Monitor updates", prompt: "Watch updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "updates", label: "Updates", requirement: "Summarize updates", severity: "must" }]
    }
  }));

  const launch = readResult(await handlers.start_codex_session({
    loopId: loop.id,
    goal: "Check today",
    codexProjectId: "codex-project-1",
    projectLabel: "Codex Project",
    projectPath: "/tmp/project"
  }));

  expect(launch).toMatchObject({
    run: {
      loopId: loop.id,
      goal: "Check today",
      codexProjectId: "codex-project-1",
      projectLabel: "Codex Project",
      projectPath: "/tmp/project",
      codexSession: {
        status: "requested",
        codexProjectId: "codex-project-1",
        projectLabel: "Codex Project"
      }
    },
    attempt: { status: "running" }
  });
  expect(launch.prompt).toContain("Monitor");
});

test("exposes codex thread writeback as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Monitor",
    goal: "Watch updates",
    body: {
      steps: [{ id: "monitor", kind: "agent", label: "Monitor updates", prompt: "Watch updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "updates", label: "Updates", requirement: "Summarize updates", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Check today" }));

  const run = readResult(await handlers.record_codex_thread({
    runId: launch.run.id,
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: Monitor"
  }));

  expect(run).toMatchObject({
    id: launch.run.id,
    codexSession: {
      status: "started",
      threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
      threadTitle: "DittosLoop: Monitor",
      subagents: [
        {
          status: "running",
          threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
        }
      ]
    }
  });
});

test("exposes codex session result writeback as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Monitor",
    goal: "Watch updates",
    body: {
      steps: [{ id: "monitor", kind: "agent", label: "Monitor updates", prompt: "Watch updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "updates", label: "Updates", requirement: "Summarize updates", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Check today" }));
  await handlers.record_codex_thread({
    runId: launch.run.id,
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
  });

  const run = readResult(await handlers.record_session_result({
    runId: launch.run.id,
    status: "passed",
    summary: "Worker result passed verification",
    result: "Daily report body",
    checks: [{ name: "Daily report", status: "passed", output: "Chinese report generated" }]
  }));

  expect(run).toMatchObject({
    id: launch.run.id,
    status: "completed",
    codexSession: {
      subagents: [{ status: "completed" }]
    }
  });
});

test("exposes codex session open and resume operations as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "AI Dev Tools Daily",
    goal: "Write the daily report",
    body: {
      steps: [{ id: "write", kind: "agent", label: "Write report", prompt: "Write a Chinese daily report" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "zh", label: "Chinese", requirement: "Use Chinese", severity: "must" }]
    },
    projectBinding: {
      codexProjectId: "project-1",
      projectLabel: "dittos loop"
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Run once" }));
  await handlers.record_codex_thread({
    runId: launch.run.id,
    threadId: "019ef91e-0f19-74d5-b14c-bac2f257d269",
    threadTitle: "DittosLoop: AI Dev Tools Daily",
    threadUrl: "codex://thread/019ef91e-0f19-74d5-b14c-bac2f257d269"
  });

  const opened = readResult(await handlers.open_codex_session({ runId: launch.run.id }));
  const resumed = readResult(await handlers.resume_loop_run({ runId: launch.run.id, goal: "Repair the report" }));

  expect(opened).toMatchObject({
    status: "ready",
    threadId: "019ef91e-0f19-74d5-b14c-bac2f257d269",
    threadUrl: "codex://thread/019ef91e-0f19-74d5-b14c-bac2f257d269"
  });
  expect(resumed).toMatchObject({
    run: {
      id: launch.run.id,
      status: "running",
      goal: "Repair the report",
      codexProjectId: "project-1",
      projectLabel: "dittos loop"
    },
    attempt: {
      runId: launch.run.id,
      status: "running"
    },
    launchRequest: {
      runId: launch.run.id,
      loopId: loop.id,
      workflowRuntime: "dittosloop-local-workflow",
      workflowContractId: loop.id,
      codexProjectId: "project-1",
      projectLabel: "dittos loop"
    }
  });
});

test("registers the DittosLoop tool surface", () => {
  const registeredTools: string[] = [];
  const fakeServer = {
    registerTool(name: string) {
      registeredTools.push(name);
    }
  };

  registerDittosLoopTools(fakeServer, {} as ReturnType<typeof createToolHandlers>);

  expect(registeredTools).toEqual([
    "create_loop_contract",
    "list_loops",
    "start_loop_run",
    "start_codex_session",
    "record_codex_thread",
    "record_session_result",
    "resume_loop_run",
    "open_codex_session",
    "start_attempt",
    "complete_attempt",
    "append_event",
    "record_verification",
    "record_human_request",
    "resolve_human_request",
    "commit_memory",
    "add_artifact",
    "mark_run_repairing",
    "complete_run",
    "get_run_detail",
    "get_snapshot",
    "get_preview_url"
  ]);
});

function readResult(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0].text);
}
