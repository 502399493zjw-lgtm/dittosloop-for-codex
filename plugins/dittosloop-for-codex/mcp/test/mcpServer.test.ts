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
        subagent: request.subagent,
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

  const handlers = createToolHandlers(service);
  Object.defineProperty(handlers, "__sessionRequests", {
    value: sessionRequests,
    enumerable: false
  });
  return handlers as ReturnType<typeof createToolHandlers> & { __sessionRequests: CodexSessionRequest[] };
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

test("exposes formal contract and session-first workflow operations as MCP content", async () => {
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
  expect(handlers.start_loop_run).toBeUndefined();
  expect(handlers.resume_loop_run).toBeUndefined();
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  const run = readResult(await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  }));
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
  expect(detail.workflowContexts).toMatchObject([
    {
      runId: "run_1",
      attemptId: "attempt_1",
      status: "suspended",
      cursor: { state: "waiting_for_session", stepId: "scan", sessionId: "session_1" }
    }
  ]);
  expect(detail.events).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "attempt_started",
      message: "Request a new Codex session for AI monitor"
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

test("exposes loop-level pause and resume controls", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Manual loop control",
    goal: "Pause and resume visible sessions",
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  }));

  const paused = readResult(await handlers.pause_loop({ loopId: contract.id }));
  expect(paused).toMatchObject({
    loop: { id: contract.id, status: "paused" },
    state: {
      loopId: contract.id,
      paused: true,
      consecutiveFailures: 0,
      running: false
    }
  });
  expect(paused.state.pausedReason).toBeUndefined();
  await expect(handlers.start_codex_session({ loopId: contract.id, goal: "Blocked while paused" })).rejects.toThrow(/Loop is paused/);

  const resumed = readResult(await handlers.resume_loop({ loopId: contract.id }));
  expect(resumed).toMatchObject({
    loop: { id: contract.id, status: "active" },
    state: {
      loopId: contract.id,
      paused: false,
      consecutiveFailures: 0,
      running: false
    }
  });
  expect(resumed.state.pausedReason).toBeUndefined();
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Run after resume" }));
  expect(launch.run).toMatchObject({ id: "run_1", loopId: contract.id, status: "running" });
});

test("rejects unsupported session reuse policies at the MCP schema boundary", async () => {
  const handlers = await createHandlers();

  await expect(
    handlers.create_loop_contract({
      title: "Reuse policy workflow",
      goal: "Reject unsupported session reuse",
      body: {
        steps: [
          {
            id: "scan",
            kind: "task",
            runtime: "codex",
            label: "Scan",
            prompt: "Scan updates",
            sessionPolicy: "reuse-run"
          }
        ]
      },
      verification: {
        mode: "after_workflow",
        rubrics: [{ id: "done", label: "Done", requirement: "Task finishes", severity: "must" }]
      }
    })
  ).rejects.toThrow();
});

test("exposes workflow execution and precise session result writeback as MCP content", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  const run = readResult(await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  }));

  expect(run).toMatchObject({
    id: launch.run.id,
    status: "running",
    codexSession: {
      status: "requested",
      subagents: [{ role: "Scan", status: "requested" }]
    }
  });

  const completed = readResult(await handlers.record_session_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "scan",
    idempotencyKey: "session_1:final",
    status: "passed",
    summary: "Worker result passed verification",
    result: "Daily report body"
  }));

  expect(completed).toMatchObject({
    id: launch.run.id,
    status: "completed"
  });
  const snapshot = readResult(await handlers.get_snapshot({}));
  expect(snapshot.workflowContexts).toMatchObject([
    {
      runId: launch.run.id,
      attemptId: launch.attempt.id,
      status: "completed",
      taskRuns: [{ stepId: "scan", sessionId: "session_1", status: "completed" }]
    }
  ]);
});

test("does not relaunch existing pending workflow sessions through the MCP handler", async () => {
  const handlers = await createHandlers();
  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  const before = readResult(await handlers.get_snapshot({})).workflowContexts;

  await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  expect(readResult(await handlers.get_snapshot({})).workflowContexts).toEqual(before);
});

test("passes codex task subagent tools through the MCP workflow execution path", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Tool allowlist workflow",
    goal: "Run a task with explicit Codex subagent tools",
    body: {
      steps: [
        {
          id: "scan",
          kind: "task",
          runtime: "codex",
          label: "Scan",
          prompt: "Scan the workspace",
          subagent: {
            ref: "code-searcher",
            role: "Code searcher",
            model: "gpt-5.4-mini",
            tools: ["rg", "sed"],
            permissions: { filesystem: "workspace-write", network: "disabled" }
          }
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Task finishes", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Run scan" }));

  expect(launch.run.codexSession.subagents).toMatchObject([
    {
      stepId: "scan",
      subagent: {
        ref: "code-searcher",
        role: "Code searcher",
        model: "gpt-5.4-mini",
        tools: ["rg", "sed"],
        permissions: { filesystem: "workspace-write", network: "disabled" }
      }
    }
  ]);

  await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  expect(handlers.__sessionRequests).toMatchObject([
    {
      stepId: "scan",
      subagent: {
        ref: "code-searcher",
        role: "Code searcher",
        model: "gpt-5.4-mini",
        tools: ["rg", "sed"],
        permissions: { filesystem: "workspace-write", network: "disabled" }
      }
    }
  ]);
  expect(readResult(await handlers.get_snapshot({})).workflowContexts).toMatchObject([
    {
      taskRuns: [
        {
          stepId: "scan",
          status: "suspended",
          subagent: {
            tools: ["rg", "sed"],
            permissions: { filesystem: "workspace-write", network: "disabled" }
          }
        }
      ]
    }
  ]);
});

test("accepts taskRunId-only precise session result writeback through MCP", async () => {
  const handlers = await createHandlers();
  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [
        { id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" },
        { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write report" }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  const running = readResult(await handlers.record_session_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    taskRunId: "task_1",
    idempotencyKey: "task_1:final",
    status: "passed",
    summary: "Scan complete.",
    result: "Scan notes"
  }));

  expect(running).toMatchObject({
    status: "running",
    codexSession: {
      subagents: [
        { stepId: "scan", sessionId: "session_1", status: "completed" },
        { stepId: "write", sessionId: "session_2", status: "requested" }
      ]
    }
  });
  expect(running.codexSession.subagents.some((subagent: any) => subagent.role === "loop-runner")).toBe(false);
  expect(readResult(await handlers.get_snapshot({})).workflowContexts).toMatchObject([
    {
      status: "suspended",
      pendingSessionIds: ["session_2"],
      taskRuns: [
        { id: "task_1", stepId: "scan", sessionId: "session_1", status: "completed" },
        { id: "task_2", stepId: "write", sessionId: "session_2", status: "suspended" }
      ]
    }
  ]);
});

test("exposes workflow revision proposal, promotion, listing, and rejection as MCP content", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  const draft = readResult(await handlers.propose_workflow_revision({
    loopId: contract.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Need synthesis after scanning.",
    contract: {
      title: "AI monitor",
      goal: "Track AI tool updates",
      body: {
        steps: [
          { id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write a sourced report" }
        ]
      },
      verification: {
        mode: "after_workflow",
        rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
      }
    }
  }));

  expect(draft).toMatchObject({
    id: "revision_1",
    loopId: contract.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    status: "draft",
    reason: "Need synthesis after scanning.",
    contract: {
      id: contract.id,
      body: { steps: [{ id: "scan" }, { id: "write" }] }
    }
  });
  expect(readResult(await handlers.list_workflow_revisions({ loopId: contract.id }))).toHaveLength(1);

  await expect(
    handlers.promote_workflow_revision({
      loopId: contract.id,
      revisionId: draft.id
    })
  ).rejects.toThrow(/runId|attemptId|Required/);

  const promoted = readResult(await handlers.promote_workflow_revision({
    loopId: contract.id,
    revisionId: draft.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id
  }));
  expect(promoted).toMatchObject({ id: draft.id, status: "promoted", promotedAt: "2026-06-23T00:00:00.000Z" });
  await expect(
    handlers.reject_workflow_revision({
      loopId: contract.id,
      revisionId: draft.id,
      runId: launch.run.id,
      attemptId: launch.attempt.id,
      reason: "Promoted revisions cannot be rejected."
    })
  ).rejects.toThrow(/Only draft workflow revisions can be rejected/);
  const snapshotAfterPromote = readResult(await handlers.get_snapshot({}));
  expect(snapshotAfterPromote.formalContracts[0].body.steps).toMatchObject([{ id: "scan" }, { id: "write" }]);

  const secondDraft = readResult(await handlers.propose_workflow_revision({
    loopId: contract.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Try a longer report shape.",
    contract: {
      title: "AI monitor",
      goal: "Track AI tool updates",
      body: {
        steps: [
          { id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" },
          { id: "outline", kind: "task", runtime: "codex", label: "Outline", prompt: "Outline a report" },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write a sourced report" }
        ]
      },
      verification: {
        mode: "after_workflow",
        rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
      }
    }
  }));
  const rejected = readResult(await handlers.reject_workflow_revision({
    loopId: contract.id,
    revisionId: secondDraft.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Superseded by another local edit."
  }));
  expect(rejected).toMatchObject({
    id: secondDraft.id,
    status: "rejected",
    rejectionReason: "Superseded by another local edit."
  });
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

test("exposes codex session open operation as MCP content", async () => {
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

  expect(opened).toMatchObject({
    status: "ready",
    threadId: "019ef91e-0f19-74d5-b14c-bac2f257d269",
    threadUrl: "codex://thread/019ef91e-0f19-74d5-b14c-bac2f257d269"
  });
  expect(handlers.resume_loop_run).toBeUndefined();
});

test("registers the DittosLoop tool surface", () => {
  const registeredTools: string[] = [];
  const toolMetadata: Record<string, { title: string; description: string }> = {};
  const fakeServer = {
    registerTool(name: string, metadata: { title: string; description: string }) {
      registeredTools.push(name);
      toolMetadata[name] = metadata;
    }
  };

  registerDittosLoopTools(fakeServer, {} as ReturnType<typeof createToolHandlers>);

  expect(registeredTools).toEqual([
    "create_loop_contract",
    "list_loops",
    "pause_loop",
    "resume_loop",
    "start_codex_session",
    "execute_workflow_attempt",
    "propose_workflow_revision",
    "list_workflow_revisions",
    "promote_workflow_revision",
    "reject_workflow_revision",
    "record_codex_thread",
    "record_session_result",
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
  expect(toolMetadata.record_session_result.description).toContain("resume");
  expect(toolMetadata.record_session_result.description).not.toContain("close or pause");
});

function readResult(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0].text);
}
