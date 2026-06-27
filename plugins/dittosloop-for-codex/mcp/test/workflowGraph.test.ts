import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { compileExecutionGraph } from "../src/workflowGraph/compileGraph.js";

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
