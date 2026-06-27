import type { WorkflowContext } from "../types.js";
import type { ExecutionGraphSnapshot, WorkflowNodeRun, WorkflowNodeRunStatus } from "./types.js";

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

export function findNodeIdForStep(snapshot: ExecutionGraphSnapshot, stepId: string): string | undefined {
  return snapshot.nodes.find((node) => node.sourceStepId === stepId)?.nodeId;
}

export function updateNodeRunForTaskRunning(
  context: WorkflowContext,
  input: { stepId: string; taskRunId: string; timestamp: string }
): WorkflowContext {
  return updateNodeRunForStep(context, input.stepId, (nodeRun) => ({
    ...nodeRun,
    status: "running",
    taskRunId: input.taskRunId,
    startedAt: nodeRun.startedAt ?? input.timestamp,
    updatedAt: input.timestamp
  }));
}

export function updateNodeRunForTaskSession(
  context: WorkflowContext,
  input: { stepId: string; taskRunId: string; sessionId: string; timestamp: string }
): WorkflowContext {
  return updateNodeRunForStep(context, input.stepId, (nodeRun) => ({
    ...nodeRun,
    status: "running",
    taskRunId: input.taskRunId,
    sessionId: input.sessionId,
    startedAt: nodeRun.startedAt ?? input.timestamp,
    updatedAt: input.timestamp
  }));
}

export function updateNodeRunForTaskWaitingForSession(
  context: WorkflowContext,
  input: { stepId: string; taskRunId: string; sessionId: string; timestamp: string }
): WorkflowContext {
  return updateNodeRunForStep(context, input.stepId, (nodeRun) => ({
    ...nodeRun,
    status: "waiting_for_session",
    taskRunId: input.taskRunId,
    sessionId: input.sessionId,
    startedAt: nodeRun.startedAt ?? input.timestamp,
    updatedAt: input.timestamp
  }));
}

export function updateNodeRunForTaskResult(
  context: WorkflowContext,
  input: {
    stepId: string;
    taskRunId?: string;
    sessionId?: string;
    status: "passed" | "failed" | "needs_human";
    result?: string;
    summary: string;
    idempotencyKey?: string;
    timestamp: string;
  }
): WorkflowContext {
  return updateNodeRunForStep(context, input.stepId, (nodeRun) => {
    if (input.idempotencyKey && nodeRun.idempotencyKeys.includes(input.idempotencyKey)) {
      return nodeRun;
    }

    const status = nodeRunStatusForTaskResult(input.status);
    return {
      ...nodeRun,
      status,
      ...(input.taskRunId ? { taskRunId: input.taskRunId } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      ...(input.status === "failed"
        ? { error: input.result ?? input.summary, output: undefined }
        : input.status === "needs_human"
          ? { error: undefined }
          : { output: input.result ?? input.summary, error: undefined }),
      idempotencyKeys: input.idempotencyKey ? appendUnique(nodeRun.idempotencyKeys, input.idempotencyKey) : nodeRun.idempotencyKeys,
      updatedAt: input.timestamp,
      ...(status === "completed" || status === "failed"
        ? { completedAt: nodeRun.completedAt ?? input.timestamp }
        : { completedAt: undefined })
    };
  });
}

function updateNodeRunForStep(
  context: WorkflowContext,
  stepId: string,
  update: (nodeRun: WorkflowNodeRun) => WorkflowNodeRun
): WorkflowContext {
  if (!context.executionGraphSnapshot || !context.nodeRuns) {
    return context;
  }

  const nodeId = findNodeIdForStep(context.executionGraphSnapshot, stepId);
  if (!nodeId) {
    return context;
  }

  return {
    ...context,
    nodeRuns: context.nodeRuns.map((nodeRun) => nodeRun.nodeId === nodeId ? update(nodeRun) : nodeRun)
  };
}

function nodeRunStatusForTaskResult(status: "passed" | "failed" | "needs_human"): WorkflowNodeRunStatus {
  if (status === "passed") return "completed";
  if (status === "failed") return "failed";
  return "waiting_for_human";
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}
