import type { ExecutionGraphSnapshot, WorkflowNodeRun } from "./types.js";

export function createInitialNodeRuns(snapshot: ExecutionGraphSnapshot, now: string): WorkflowNodeRun[] {
  return snapshot.nodes.map((node, index) => ({
    nodeRunId: `${snapshot.snapshotId}:node:${index + 1}`,
    nodeId: node.nodeId,
    runId: snapshot.runId,
    attemptId: snapshot.attemptId,
    workflowContextId: snapshot.workflowContextId,
    epoch: 1,
    status: "pending",
    idempotencyKeys: [],
    createdAt: now,
    updatedAt: now
  }));
}
