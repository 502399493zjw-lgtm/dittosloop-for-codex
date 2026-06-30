import { expect, test } from "vitest";

import { enrichRunDetail } from "../src/preview/eventAdapter.js";
import type { EngineEvent } from "../src/engine/types.js";
import type { RunDetail } from "../src/types.js";

const baseCreatedAt = "2026-06-23T00:00:00.000Z";

function runDetailWithEvents(events: EngineEvent[]): RunDetail {
  return {
    run: {
      id: "run_1",
      loopId: "loop_1",
      status: "running",
      goal: "Render timeline",
      trigger: "manual",
      createdAt: baseCreatedAt,
      updatedAt: baseCreatedAt
    },
    loop: {
      id: "loop_1",
      title: "Preview loop",
      intent: "Render timeline",
      trigger: { mode: "manual" },
      verification: { checks: [] },
      status: "active",
      createdAt: baseCreatedAt,
      updatedAt: baseCreatedAt
    },
    attempts: [],
    events: events.map((engineEvent, index) => ({
      id: `event_${index + 1}`,
      runId: "run_1",
      kind: "note",
      message: engineEvent.type,
      createdAt: engineEvent.createdAt,
      data: { engineEvent }
    })),
    verificationResults: [],
    humanRequests: [],
    memoryCommits: [],
    artifacts: [],
    workflowRevisions: [],
    workflowContexts: []
  };
}

function event<TEvent extends EngineEvent>(input: Omit<TEvent, "runId" | "createdAt" | "sequence"> & { sequence: number }): TEvent {
  return {
    ...input,
    runId: "run_1",
    createdAt: baseCreatedAt
  } as TEvent;
}

test("extracts runtime script events into workflow and agent timeline items", () => {
  const detail = enrichRunDetail(runDetailWithEvents([
    event({ type: "runtime_script_started", sequence: 1, contractId: "contract_1" }),
    event({ type: "runtime_phase_started", sequence: 2, label: "Plan" }),
    event({ type: "agent:start", sequence: 3, label: "Scout", prompt: "Find files", callSite: "agent:1:Scout" }),
    event({
      type: "agent:done",
      sequence: 4,
      label: "Scout",
      callSite: "agent:1:Scout",
      result: "Found files",
      session: { sessionId: "session_1", threadUrl: "codex://thread/thread_1" }
    }),
    event({ type: "agent:cached", sequence: 5, label: "Scout", callSite: "agent:1:Scout" }),
    event({ type: "agent:error", sequence: 6, label: "Reviewer", callSite: "agent:2:Reviewer", error: "Failed review" }),
    event({ type: "runtime_parallel_started", sequence: 7, label: "Review files", count: 2 }),
    event({ type: "runtime_parallel_completed", sequence: 8, label: "Review files", count: 2 }),
    event({ type: "runtime_pipeline_started", sequence: 9, label: "Summarize", count: 3 }),
    event({ type: "runtime_pipeline_completed", sequence: 10, label: "Summarize", count: 3 }),
    event({ type: "runtime_phase_done", sequence: 11, label: "Plan", status: "ok" }),
    event({ type: "runtime_log", sequence: 12, message: "Runtime note" }),
    event({ type: "runtime_script_done", sequence: 13, contractId: "contract_1", status: "completed", result: "ok" })
  ]));

  const workflow = detail.timeline.find((section) => section.id === "workflow");

  expect(detail.engineEvents.map((candidate) => candidate.type)).toEqual([
    "runtime_script_started",
    "runtime_phase_started",
    "agent:start",
    "agent:done",
    "agent:cached",
    "agent:error",
    "runtime_parallel_started",
    "runtime_parallel_completed",
    "runtime_pipeline_started",
    "runtime_pipeline_completed",
    "runtime_phase_done",
    "runtime_log",
    "runtime_script_done"
  ]);
  expect(workflow?.items).toEqual([
    expect.objectContaining({ kind: "run", label: "Runtime script contract_1", status: "started" }),
    expect.objectContaining({ kind: "phase", label: "Plan", status: "started" }),
    expect.objectContaining({ kind: "agent", label: "Scout", status: "started", message: "Find files" }),
    expect.objectContaining({
      kind: "agent",
      label: "Scout",
      status: "completed",
      message: "Found files",
      session: expect.objectContaining({ sessionId: "session_1" })
    }),
    expect.objectContaining({ kind: "agent", label: "Scout", status: "completed", message: "agent:cached" }),
    expect.objectContaining({ kind: "agent", label: "Reviewer", status: "failed", message: "Failed review" }),
    expect.objectContaining({ kind: "parallel", label: "Review files", status: "started", message: "2" }),
    expect.objectContaining({ kind: "parallel", label: "Review files", status: "completed", message: "2" }),
    expect.objectContaining({ kind: "parallel", label: "Summarize", status: "started", pipeline: true, message: "3" }),
    expect.objectContaining({ kind: "parallel", label: "Summarize", status: "completed", pipeline: true, message: "3" }),
    expect.objectContaining({ kind: "phase", label: "Plan", status: "completed" }),
    expect.objectContaining({ kind: "run", label: "Runtime log", status: "completed", message: "Runtime note" }),
    expect.objectContaining({ kind: "run", label: "Runtime script contract_1", status: "completed" })
  ]);
});

test("keeps static workflow timeline output unchanged", () => {
  const detail = enrichRunDetail(runDetailWithEvents([
    event({ type: "run_started", sequence: 1 }),
    event({ type: "phase_started", sequence: 2, phaseId: "collect", title: "Collect" }),
    event({ type: "agent_started", sequence: 3, label: "Collector", prompt: "Collect facts", stepId: "collect" }),
    event({ type: "agent_done", sequence: 4, label: "Collector", result: "Collected facts", stepId: "collect", status: "ok" }),
    event({ type: "parallel_started", sequence: 5, label: "Review", count: 2 }),
    event({ type: "parallel_completed", sequence: 6, label: "Review", count: 2 }),
    event({ type: "phase_done", sequence: 7, phaseId: "collect", title: "Collect", status: "ok" })
  ]));

  expect(detail.timeline).toEqual([
    {
      id: "workflow",
      title: "工作流",
      items: [
        {
          kind: "run",
          label: "开始运行",
          status: "started",
          createdAt: baseCreatedAt,
          sequence: 1,
          stepId: undefined,
          phaseId: undefined,
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        },
        {
          kind: "phase",
          label: "Collect",
          status: "started",
          createdAt: baseCreatedAt,
          sequence: 2,
          stepId: "collect",
          phaseId: "collect",
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        },
        {
          kind: "agent",
          label: "Collector",
          status: "started",
          createdAt: baseCreatedAt,
          sequence: 3,
          stepId: "collect",
          phaseId: undefined,
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        },
        {
          kind: "agent",
          label: "Collector",
          status: "completed",
          createdAt: baseCreatedAt,
          sequence: 4,
          stepId: "collect",
          phaseId: undefined,
          pipeline: undefined,
          human: undefined,
          message: "Collected facts",
          session: undefined
        },
        {
          kind: "parallel",
          label: "Review",
          status: "started",
          createdAt: baseCreatedAt,
          sequence: 5,
          stepId: undefined,
          phaseId: undefined,
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        },
        {
          kind: "parallel",
          label: "Review",
          status: "completed",
          createdAt: baseCreatedAt,
          sequence: 6,
          stepId: undefined,
          phaseId: undefined,
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        },
        {
          kind: "phase",
          label: "Collect",
          status: "completed",
          createdAt: baseCreatedAt,
          sequence: 7,
          stepId: "collect",
          phaseId: "collect",
          pipeline: undefined,
          human: undefined,
          message: undefined,
          session: undefined
        }
      ]
    }
  ]);
});
