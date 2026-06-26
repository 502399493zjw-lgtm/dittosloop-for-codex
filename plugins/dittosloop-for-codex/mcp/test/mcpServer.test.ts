import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, expect, test, vi } from "vitest";

import { createMcpServer, createToolHandlers, registerDittosLoopTools } from "../src/mcpServer.js";
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

async function createTestLoopService() {
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

  return { service, sessionRequests };
}

async function createHandlers() {
  const { service, sessionRequests } = await createTestLoopService();
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
    verification: v2RubricAgentVerification({ id: "tests", label: "Tests", description: "npm test passes" })
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
    verification: v2RubricAgentVerification(),
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

test("create_loop_contract rejects legacy rubrics shape at the MCP boundary", async () => {
  const handlers = await createHandlers();

  await expect(handlers.create_loop_contract({
    title: "Legacy shape",
    goal: "Reject rubrics",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  })).rejects.toThrow(/version/i);
});

test("record_validator_result is exposed through MCP", async () => {
  const handlers = await createHandlers();
  const contract = readResult(await handlers.create_loop_contract({
    title: "V2 verifier",
    goal: "Use separate validator",
    body: { steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" }] },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Run once" }));

  await handlers.record_session_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const verification = readResult(await handlers.record_validator_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "mcp-validator-1",
    result: {
      type: "rubric_agent",
      status: "passed",
      evidence: "Looks good.",
      criteriaResults: [
        { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete." }
      ]
    }
  }));

  expect(verification).toMatchObject({ version: 2, status: "passed" });
});

test("exposes loop-level pause and resume controls", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Manual loop control",
    goal: "Pause and resume visible sessions",
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
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

test("preserves budget and escalation stop metadata through MCP session result writeback", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Guarded workflow",
    goal: "Stop on budget or escalation boundaries",
    budgetUsd: 0.5,
    escalation: ["production deploy"],
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));

  const failed = readResult(await handlers.record_session_result({
    runId: launch.run.id,
    status: "failed",
    summary: "Per-run budget cap exceeded.",
    pausedReason: "budget"
  }));
  const snapshot = readResult(await handlers.get_snapshot({}));

  expect(contract).toMatchObject({
    budgetUsd: 0.5,
    escalation: ["production deploy"]
  });
  expect(failed).toMatchObject({
    id: launch.run.id,
    status: "failed",
    pausedReason: "budget"
  });
  expect(snapshot).toMatchObject({
    loops: [{ id: contract.id, status: "paused" }],
    formalContracts: [{ id: contract.id, status: "paused", budgetUsd: 0.5, escalation: ["production deploy"] }],
    loopStates: [
      {
        loopId: contract.id,
        consecutiveFailures: 1,
        paused: true,
        pausedReason: "budget",
        running: false,
        runCount: 1
      }
    ]
  });
});

test("rejects failure pausedReason at the MCP session result boundary", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Failure threshold owner",
    goal: "Let stopPolicy decide failure pauses",
    stopPolicy: { rule: "pause after two failures", maxConsecutiveFailures: 2 },
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));

  await expect(handlers.record_session_result({
    runId: launch.run.id,
    status: "failed",
    summary: "Session failed once.",
    pausedReason: "failures"
  })).rejects.toThrow();
});

test("preserves budget stop metadata through the MCP complete_run writeback", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Budgeted completion",
    goal: "Pause when the manual run exceeds its budget",
    budgetUsd: 0.5,
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));

  const failed = readResult(await handlers.complete_run({
    runId: launch.run.id,
    status: "failed",
    pausedReason: "budget"
  }));
  const snapshot = readResult(await handlers.get_snapshot({}));

  expect(failed).toMatchObject({
    id: launch.run.id,
    status: "failed",
    pausedReason: "budget"
  });
  expect(snapshot).toMatchObject({
    loops: [{ id: contract.id, status: "paused" }],
    loopStates: [
      {
        loopId: contract.id,
        consecutiveFailures: 1,
        paused: true,
        pausedReason: "budget",
        running: false,
        runCount: 1
      }
    ]
  });
});

test("rejects failure pausedReason at the MCP complete_run boundary", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Manual failure threshold owner",
    goal: "Let stopPolicy decide manual failure pauses",
    stopPolicy: { rule: "pause after two failures", maxConsecutiveFailures: 2 },
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));

  await expect(handlers.complete_run({
    runId: launch.run.id,
    status: "failed",
    pausedReason: "failures"
  })).rejects.toThrow();
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
      verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Task finishes" })
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
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual check" }));
  const run = readResult<{
    run: { id: string; status: string; codexSession?: { status: string; subagents?: Array<{ role: string; status: string }> } };
    sessionResult?: unknown;
  }>(await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  }));

  expect(run).toMatchObject({
    id: launch.run.id,
    status: "running",
    run: {
      id: launch.run.id,
      status: "running",
      codexSession: {
        status: "requested",
        subagents: [{ role: "Scan", status: "requested" }]
      }
    }
  });
  expect(run.sessionResult).toBeUndefined();

  const pendingVerification = readResult<{
    run: { id: string; status: string };
    sessionResult?: {
      status: string;
      finalAnswer: string;
      summary: string;
      result?: unknown;
      verification?: { status: string; summary: string };
      artifacts: unknown[];
    };
  }>(await handlers.record_session_result({
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

  expect(pendingVerification).toMatchObject({
    id: launch.run.id,
    status: "running",
    run: {
      id: launch.run.id,
      status: "running"
    }
  });
  expect(pendingVerification.sessionResult).toBeUndefined();

  const verification = readResult(await handlers.record_validator_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "quality-review:final",
    result: {
      type: "rubric_agent",
      status: "passed",
      score: 1,
      evidence: "The report uses official sources."
    }
  }));

  expect(verification).toMatchObject({
    version: 2,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    status: "passed",
    summary: "Verification passed."
  });
  const snapshot = readResult(await handlers.get_snapshot({}));
  expect(snapshot.runs).toMatchObject([
    { id: launch.run.id, status: "completed" }
  ]);
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
    verification: v2RubricAgentVerification()
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
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Task finishes" })
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

test("accepts agent profile fields through the MCP schema boundary", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Profile-aware workflow",
    goal: "Accept profile references through MCP",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Researcher",
        instructions: "Use primary sources.",
        model: "gpt-5.4-mini",
        workdir: "/tmp/research",
        requiredSkills: [{ id: "openai-docs", source: "plugin", pluginId: "openai", version: "1.0.0" }],
        advisorySkills: [{ id: "brainstorming", source: "project" }],
        allowedTools: ["web.search_query"],
        permissions: { filesystem: "workspace-write", network: "enabled" },
        env: { FOO: "bar" },
        timeoutMs: 300000,
        context: { topic: "agents" }
      }
    },
    body: {
      steps: [
        {
          id: "scan",
          kind: "agent",
          label: "Scan",
          prompt: "Scan updates",
          agentProfileRef: "researcher"
        },
        {
          id: "write",
          kind: "task",
          runtime: "codex",
          label: "Write",
          prompt: "Write report",
          agentProfileRef: "researcher"
        }
      ]
    },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Workflow finishes" })
  }));

  expect(contract).toMatchObject({
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Researcher",
        instructions: "Use primary sources.",
        model: "gpt-5.4-mini",
        workdir: "/tmp/research",
        requiredSkills: [{ id: "openai-docs", source: "plugin", pluginId: "openai", version: "1.0.0" }],
        advisorySkills: [{ id: "brainstorming", source: "project" }],
        allowedTools: ["web.search_query"],
        permissions: { filesystem: "workspace-write", network: "enabled" },
        env: { FOO: "bar" },
        timeoutMs: 300000,
        context: { topic: "agents" }
      }
    },
    body: {
      steps: [
        { id: "scan", agentProfileRef: "researcher" },
        { id: "write", agentProfileRef: "researcher" }
      ]
    }
  });
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
    verification: v2RubricAgentVerification()
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

test("passes allowDegradedProfiles into startCodexSessionRun", async () => {
  const startCodexSessionRun = vi.fn(async () => ({
    run: { id: "run_1" },
    attempt: { id: "attempt_1" },
    prompt: "Prompt",
    launchRequest: {
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      loopId: "loop_1",
      title: "DittosLoop: Monitor",
      prompt: "Prompt"
    }
  }));
  const handlers = createToolHandlers({
    startCodexSessionRun
  } as unknown as LoopService);

  await handlers.start_codex_session({
    loopId: "loop_1",
    goal: "Check today",
    allowDegradedProfiles: true,
    codexProjectId: "codex-project-1",
    projectLabel: "Codex Project",
    projectPath: "/tmp/project"
  });

  expect(startCodexSessionRun).toHaveBeenCalledWith("loop_1", {
    goal: "Check today",
    allowDegradedProfiles: true,
    codexProjectId: "codex-project-1",
    projectLabel: "Codex Project",
    projectPath: "/tmp/project"
  });
});

test("exposes workflow revision proposal, promotion, listing, and rejection as MCP content", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
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
      verification: v2RubricAgentVerification()
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
      verification: v2RubricAgentVerification()
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
    verification: v2RubricAgentVerification({ id: "checks", label: "Checks", description: "Checks pass" })
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
    verification: v2RubricAgentVerification({ id: "updates", label: "Updates", description: "Summarize updates" })
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
    verification: v2RubricAgentVerification({ id: "updates", label: "Updates", description: "Summarize updates" })
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
    verification: v2RubricAgentVerification({ id: "updates", label: "Updates", description: "Summarize updates" })
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
    verification: v2RubricAgentVerification({ id: "zh", label: "Chinese", description: "Use Chinese" }),
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

test("reads loop memory through MCP with bounded newest-first windows", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Memory loop",
    goal: "Remember durable lessons",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Check", prompt: "Check memory" }]
    },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Memory can be read" })
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Run memory update" }));

  await handlers.commit_memory({ loopId: loop.id, runId: launch.run.id, summary: "First lesson." });
  await handlers.commit_memory({ loopId: loop.id, runId: launch.run.id, summary: "Second lesson." });

  const memory = readResult(await handlers.read_loop_memory({ loopId: loop.id, limit: 1 }));

  expect(memory).toEqual({
    loopId: loop.id,
    limit: 1,
    offset: 0,
    returnedLines: 1,
    totalLines: 2,
    remainingLines: 1,
    content:
      "Second lesson.\n还有 1 条记忆未读取。可调用 read_loop_memory({ loopId: \"loop_1\", offset: 1, limit: 1 }) 继续读取。"
  });
});

test("returns an exhausted memory window through MCP when offset is past the end", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Memory loop",
    goal: "Remember durable lessons",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Check", prompt: "Check memory" }]
    },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Memory can be read" })
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Run memory update" }));

  await handlers.commit_memory({ loopId: loop.id, runId: launch.run.id, summary: "First lesson." });

  const memory = readResult(await handlers.read_loop_memory({ loopId: loop.id, limit: 2, offset: 3 }));

  expect(memory).toEqual({
    loopId: loop.id,
    limit: 2,
    offset: 3,
    returnedLines: 0,
    totalLines: 1,
    remainingLines: 0,
    content: "没有更多长期记忆。"
  });
});

test("rejects invalid MCP memory read windows", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Memory loop",
    goal: "Remember durable lessons",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Check", prompt: "Check memory" }]
    },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Memory can be read" })
  }));

  await expect(handlers.read_loop_memory({ loopId: loop.id, limit: 0 })).rejects.toThrow();
  await expect(handlers.read_loop_memory({ loopId: loop.id, limit: 201 })).rejects.toThrow();
  await expect(handlers.read_loop_memory({ loopId: loop.id, offset: -1 })).rejects.toThrow();
});

test("create_loop_contract accepts a script AST that compiles to the same body as a hand-written contract", async () => {
  const handlers = await createHandlers();

  const fromScript = readResult(await handlers.create_loop_contract({
    title: "Script authored",
    goal: "Author a loop through the builder script",
    script: {
      build: [
        { fn: "budget", args: [2] },
        {
          fn: "pipeline",
          args: [
            "produce",
            "Produce",
            [
              { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write the draft." }] },
              { fn: "task", args: [{ id: "review", label: "Review", prompt: "Review the draft." }] }
            ]
          ]
        }
      ]
    },
    verification: v2RubricAgentVerification({
      id: "done",
      label: "Done",
      description: "Output satisfies the goal"
    })
  }));

  expect(fromScript.body.steps).toEqual([
    {
      id: "produce",
      kind: "phase",
      label: "Produce",
      pipeline: true,
      children: [
        { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write the draft." },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review the draft." }
      ]
    }
  ]);
  expect(fromScript.budgetUsd).toBe(2);
});

test("create_loop_contract rejects providing both body and script, and providing neither", async () => {
  const handlers = await createHandlers();

  await expect(handlers.create_loop_contract({
    title: "Both",
    goal: "Reject both body and script",
    body: { steps: [{ id: "a", kind: "agent", label: "A", prompt: "..." }] },
    script: { build: [{ fn: "task", args: [{ id: "a", label: "A", prompt: "..." }] }] },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Output is done" })
  })).rejects.toThrow(/exactly one of body or script/i);

  await expect(handlers.create_loop_contract({
    title: "Neither",
    goal: "Reject neither body nor script",
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Output is done" })
  })).rejects.toThrow(/exactly one of body or script/i);
});

test("propose_workflow_revision accepts a script-authored revision", async () => {
  const handlers = await createHandlers();
  const contract = readResult(await handlers.create_loop_contract({
    title: "Revisable",
    goal: "Revise via script",
    body: { steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write." }] },
    verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Output ok" })
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Run" }));

  const revision = readResult(await handlers.propose_workflow_revision({
    loopId: contract.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Add review through a script",
    contract: {
      title: "Revisable",
      goal: "Revise via script",
      script: {
        build: [
          { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write." }] },
          { fn: "task", args: [{ id: "review", label: "Review", prompt: "Review." }] }
        ]
      },
      verification: v2RubricAgentVerification({ id: "done", label: "Done", description: "Output ok" })
    }
  }));

  expect(revision.contract.body.steps.map((step: { id: string }) => step.id)).toEqual(["draft", "review"]);
});

test("exposes structured schemas for refined tools through MCP listTools", async () => {
  const { service } = await createTestLoopService();
  const server = createMcpServer(service);
  const client = new Client({ name: "schema-test-client", version: "0.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await server.connect(serverTransport);
  await client.connect(clientTransport);

  try {
    const { tools } = await client.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    const createLoopContract = byName.get("create_loop_contract");
    const proposeWorkflowRevision = byName.get("propose_workflow_revision");

    expect(createLoopContract?.inputSchema.properties).toMatchObject({
      title: expect.any(Object),
      goal: expect.any(Object),
      body: expect.any(Object),
      script: expect.any(Object),
      agentProfiles: expect.any(Object)
    });
    expect(JSON.stringify(createLoopContract?.inputSchema)).toContain("agentProfileRef");

    expect(proposeWorkflowRevision?.inputSchema.properties).toMatchObject({
      loopId: expect.any(Object),
      runId: expect.any(Object),
      attemptId: expect.any(Object),
      contract: expect.any(Object),
      patch: expect.any(Object)
    });
  } finally {
    await Promise.allSettled([client.close(), server.close()]);
  }
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
    "record_validator_result",
    "open_codex_session",
    "start_attempt",
    "complete_attempt",
    "append_event",
    "record_verification",
    "record_human_request",
    "resolve_human_request",
    "read_loop_memory",
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
  expect(toolMetadata.record_validator_result.description).toContain("asynchronous verification v2 validator");
});

function readResult(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0].text);
}

function v2RubricAgentVerification(
  criterion: { id: string; label: string; description: string; severity?: "must" | "should" } = {
    id: "quality",
    label: "Quality",
    description: "Use official sources"
  }
) {
  return {
    version: 2 as const,
    mode: "after_workflow" as const,
    criteria: [{ ...criterion, severity: criterion.severity ?? "must" }],
    validators: [
      {
        id: "quality-review",
        type: "rubric_agent" as const,
        label: "Quality review",
        criteriaIds: [criterion.id],
        scoreScale: { min: 0, max: 1 },
        passScore: 1,
        evidenceRequired: true,
        severity: "must" as const
      }
    ],
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}
