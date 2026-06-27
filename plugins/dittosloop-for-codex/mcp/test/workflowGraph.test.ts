import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { compileExecutionGraph } from "../src/workflowGraph/compileGraph.js";
import { createInitialNodeRuns } from "../src/workflowGraph/nodeRuns.js";
import {
  advanceContainerNodeRuns,
  buildPipelineInputSnapshot,
  deriveRunnableNodeIds
} from "../src/workflowGraph/scheduler.js";
import { buildWorkflowView } from "../src/workflowGraph/workflowView.js";
import type { RunDetail } from "../src/types.js";

const fixedTime = "2026-06-27T00:00:00.000Z";

describe("workflow graph compiler", () => {
  test("compiles stable root phase parallel task and pipeline nodes", () => {
    const contract = compileContract(
      {
        id: "loop_graph",
        title: "Graph loop",
        goal: "Build stable graph state",
        body: {
          steps: [
            {
              id: "collect",
              kind: "parallel",
              label: "Collect",
              children: [
                { id: "scan-a", kind: "task", runtime: "codex", label: "Scan A", prompt: "Scan A" },
                { id: "scan-b", kind: "agent", label: "Scan B", prompt: "Scan B" }
              ]
            },
            {
              id: "produce",
              kind: "phase",
              label: "Produce",
              pipeline: true,
              children: [
                { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" },
                { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review", human: true }
              ]
            }
          ]
        },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "done", label: "Done", requirement: "Done", severity: "must" }]
        }
      },
      fixedTime
    );

    const graph = compileExecutionGraph({
      contract,
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      compiledAt: fixedTime,
      snapshotId: "graph_1"
    });

    expect(graph.nodes.map((node) => [node.nodeId, node.kind, node.sourceStepId])).toEqual([
      ["root", "root", undefined],
      ["root/parallel:collect", "parallel", "collect"],
      ["root/parallel:collect/task:scan-a", "task", "scan-a"],
      ["root/parallel:collect/task:scan-b", "task", "scan-b"],
      ["root/phase:produce", "phase", "produce"],
      ["root/phase:produce/task:draft", "task", "draft"],
      ["root/phase:produce/human:review", "human", "review"],
      ["root/verification", "verification", undefined]
    ]);
    expect(graph.edges).toEqual(expect.arrayContaining([
      { fromNodeId: "root", toNodeId: "root/parallel:collect", kind: "contains" },
      { fromNodeId: "root/parallel:collect", toNodeId: "root/parallel:collect/task:scan-a", kind: "parallel_child" },
      { fromNodeId: "root/phase:produce/task:draft", toNodeId: "root/phase:produce/human:review", kind: "sequence" },
      { fromNodeId: "root/phase:produce/task:draft", toNodeId: "root/phase:produce/human:review", kind: "pipeline_data" },
      { fromNodeId: "root/phase:produce", toNodeId: "root/verification", kind: "verification_after" }
    ]));
    expect(graph.graphHash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("produces the same graph hash for the same frozen contract snapshot", () => {
    const contract = compileContract(
      {
        id: "loop_hash",
        title: "Hash loop",
        goal: "Stable hash",
        body: { steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }] },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    const first = compileExecutionGraph({
      contract,
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      compiledAt: fixedTime,
      snapshotId: "graph_1"
    });
    const second = compileExecutionGraph({
      contract,
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      compiledAt: fixedTime,
      snapshotId: "graph_2"
    });

    expect(second.graphHash).toBe(first.graphHash);
    expect(second.nodes).toEqual(first.nodes);
    expect(second.edges).toEqual(first.edges);
  });
});

describe("workflow view", () => {
  test("builds durable node status from graph node runs instead of engine events", () => {
    const contract = compileContract(
      {
        id: "loop_view",
        title: "View loop",
        goal: "Show durable status",
        body: { steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }] },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "done", label: "Done", requirement: "Status is durable", severity: "must" }]
        }
      },
      fixedTime
    );
    const graph = compileExecutionGraph({
      contract,
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      compiledAt: fixedTime,
      snapshotId: "graph_1"
    });
    const nodeRuns = createInitialNodeRuns(graph, fixedTime).map((nodeRun) => {
      if (nodeRun.nodeId === "root") return { ...nodeRun, status: "running" as const };
      if (nodeRun.nodeId === "root/task:scan") return { ...nodeRun, status: "completed" as const };
      return nodeRun;
    });
    const detail: RunDetail = {
      run: {
        id: "run_1",
        loopId: "loop_view",
        status: "running",
        goal: "Show durable status",
        trigger: "manual",
        createdAt: fixedTime,
        updatedAt: fixedTime
      },
      loop: {
        id: "loop_view",
        title: "View loop",
        intent: "Show durable status",
        trigger: { mode: "manual" },
        verification: { checks: [] },
        status: "active",
        createdAt: fixedTime,
        updatedAt: fixedTime
      },
      attempts: [{ id: "attempt_1", runId: "run_1", status: "running", createdAt: fixedTime }],
      events: [
        {
          id: "event_noise",
          runId: "run_1",
          kind: "note",
          message: "event stream is audit only",
          createdAt: fixedTime,
          data: {
            engineEvent: {
              type: "agent_done",
              runId: "run_1",
              sequence: 1,
              createdAt: fixedTime,
              stepId: "scan",
              status: "failed"
            }
          }
        }
      ],
      verificationResults: [],
      humanRequests: [],
      memoryCommits: [],
      artifacts: [],
      workflowRevisions: [],
      workflowContexts: [
        {
          id: "workflow_1",
          runId: "run_1",
          loopId: "loop_view",
          attemptId: "attempt_1",
          contractId: contract.id,
          contractSnapshot: contract,
          executionGraphSnapshot: graph,
          nodeRuns,
          status: "running",
          cursor: { state: "executing" },
          vars: {},
          steps: {},
          taskRuns: [],
          pendingSessionIds: [],
          idempotencyKeys: [],
          createdAt: fixedTime,
          updatedAt: fixedTime
        }
      ]
    };

    const view = buildWorkflowView(detail);

    expect(view).toMatchObject({
      version: 1,
      runId: "run_1",
      attemptId: "attempt_1",
      workflowContextId: "workflow_1",
      snapshotId: "graph_1",
      scheduler: { mode: "dual_write", runnableNodeIds: [] },
      progress: { total: 3, completed: 1, running: 1, waiting: 0, failed: 0 },
      nodes: [
        expect.objectContaining({ nodeId: "root", kind: "root", status: "running" }),
        expect.objectContaining({ nodeId: "root/task:scan", kind: "task", status: "completed" }),
        expect.objectContaining({ nodeId: "root/verification", kind: "verification", status: "pending" })
      ],
      auditRefs: [{ eventId: "event_noise", type: "note" }]
    });
  });
});

describe("workflow graph scheduler", () => {
  test("scheduler returns only the next sequential runnable task", () => {
    const { graph, nodeRuns } = makeSequentialGraphState(["draft", "review"]);

    expect(deriveRunnableNodeIds(graph, nodeRuns)).toEqual(["root/task:draft"]);

    const afterDraft = nodeRuns.map((nodeRun) =>
      nodeRun.nodeId === "root/task:draft" ? { ...nodeRun, status: "completed" as const } : nodeRun
    );

    expect(deriveRunnableNodeIds(graph, afterDraft)).toEqual(["root/task:review"]);
  });

  test("pipeline input snapshot freezes upstream output before dispatch", () => {
    const { graph, nodeRuns } = makePipelineGraphState({ draftOutput: "DRAFT-OUTPUT" });

    expect(buildPipelineInputSnapshot(graph, nodeRuns, "root/phase:produce/task:review")).toEqual({
      upstream: [{ nodeId: "root/phase:produce/task:draft", sourceStepId: "draft", output: "DRAFT-OUTPUT" }]
    });
  });

  test("parallel children fan out before the fan-in task becomes runnable", () => {
    const { graph, nodeRuns } = makeParallelFanInGraphState();

    expect(deriveRunnableNodeIds(graph, nodeRuns)).toEqual([
      "root/parallel:parallel-collect/task:left",
      "root/parallel:parallel-collect/task:right"
    ]);

    const afterChildren = advanceContainerNodeRuns(
      graph,
      nodeRuns.map((nodeRun) =>
        nodeRun.nodeId === "root/parallel:parallel-collect/task:left" ||
        nodeRun.nodeId === "root/parallel:parallel-collect/task:right"
          ? { ...nodeRun, status: "completed" as const }
          : nodeRun
      ),
      fixedTime
    );

    expect(deriveRunnableNodeIds(graph, afterChildren)).toEqual(["root/task:join"]);
  });
});

function makeSequentialGraphState(stepIds: string[]) {
  const contract = compileContract(
    {
      id: "loop_scheduler_sequential",
      title: "Scheduler sequential",
      goal: "Derive runnable sequential nodes",
      body: {
        steps: stepIds.map((stepId) => ({
          id: stepId,
          kind: "task" as const,
          runtime: "codex" as const,
          label: stepId,
          prompt: stepId
        }))
      },
      verification: { mode: "after_workflow", rubrics: [] }
    },
    fixedTime
  );
  const graph = compileExecutionGraph({
    contract,
    runId: "run_1",
    attemptId: "attempt_1",
    workflowContextId: "workflow_1",
    compiledAt: fixedTime,
    snapshotId: "graph_1"
  });
  return { graph, nodeRuns: createInitialNodeRuns(graph, fixedTime) };
}

function makePipelineGraphState(input: { draftOutput: string }) {
  const contract = compileContract(
    {
      id: "loop_scheduler_pipeline",
      title: "Scheduler pipeline",
      goal: "Freeze pipeline inputs",
      body: {
        steps: [
          {
            id: "produce",
            kind: "phase",
            label: "Produce",
            pipeline: true,
            children: [
              { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" },
              { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review" }
            ]
          }
        ]
      },
      verification: { mode: "after_workflow", rubrics: [] }
    },
    fixedTime
  );
  const graph = compileExecutionGraph({
    contract,
    runId: "run_1",
    attemptId: "attempt_1",
    workflowContextId: "workflow_1",
    compiledAt: fixedTime,
    snapshotId: "graph_1"
  });
  const nodeRuns = createInitialNodeRuns(graph, fixedTime).map((nodeRun) =>
    nodeRun.nodeId === "root/phase:produce/task:draft"
      ? { ...nodeRun, status: "completed" as const, output: input.draftOutput }
      : nodeRun
  );
  return { graph, nodeRuns };
}

function makeParallelFanInGraphState() {
  const contract = compileContract(
    {
      id: "loop_scheduler_parallel",
      title: "Scheduler parallel",
      goal: "Fan out and fan in parallel branches",
      body: {
        steps: [
          {
            id: "parallel-collect",
            kind: "parallel",
            label: "Parallel collect",
            children: [
              { id: "left", kind: "task", runtime: "codex", label: "Left", prompt: "Left" },
              { id: "right", kind: "task", runtime: "codex", label: "Right", prompt: "Right" }
            ]
          },
          { id: "join", kind: "task", runtime: "codex", label: "Join", prompt: "Join" }
        ]
      },
      verification: { mode: "after_workflow", rubrics: [] }
    },
    fixedTime
  );
  const graph = compileExecutionGraph({
    contract,
    runId: "run_1",
    attemptId: "attempt_1",
    workflowContextId: "workflow_1",
    compiledAt: fixedTime,
    snapshotId: "graph_1"
  });
  return { graph, nodeRuns: createInitialNodeRuns(graph, fixedTime) };
}
