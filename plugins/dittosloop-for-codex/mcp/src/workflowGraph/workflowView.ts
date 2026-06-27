import type { RunDetail, WorkflowContext, WorkflowTaskRun } from "../types.js";
import type {
  ExecutionGraphSnapshot,
  WorkflowNodeRun,
  WorkflowNodeRunStatus,
  WorkflowView,
  WorkflowViewNode
} from "./types.js";

export function buildWorkflowView(detail: RunDetail): WorkflowView | undefined {
  const context = newestWorkflowContext(detail);
  if (!context) {
    return undefined;
  }

  if (context.executionGraphSnapshot && context.nodeRuns) {
    return buildGraphWorkflowView(detail, context, context.executionGraphSnapshot, context.nodeRuns);
  }

  if (context.taskRuns.length > 0) {
    return buildLegacyWorkflowView(detail, context);
  }

  return undefined;
}

function buildGraphWorkflowView(
  detail: RunDetail,
  context: WorkflowContext,
  graph: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[]
): WorkflowView {
  const runsByNodeId = new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
  const nodes: WorkflowViewNode[] = graph.nodes.map((node) => {
    const nodeRun = runsByNodeId.get(node.nodeId);
    return {
      nodeId: node.nodeId,
      kind: node.kind,
      label: node.label,
      status: nodeRun?.status ?? "pending",
      order: node.order,
      ...(node.sourceStepId ? { sourceStepId: node.sourceStepId } : {}),
      ...(node.parentNodeId ? { parentNodeId: node.parentNodeId } : {}),
      ...(node.phaseNodeId ? { phaseNodeId: node.phaseNodeId } : {}),
      ...(node.runtime ? { runtime: node.runtime } : {}),
      ...(node.human ? { human: node.human } : {})
    };
  });

  return {
    version: 1,
    runId: detail.run.id,
    attemptId: context.attemptId,
    workflowContextId: context.id,
    contractId: graph.contractId,
    ...(graph.contractRevisionId ? { contractRevisionId: graph.contractRevisionId } : {}),
    snapshotId: graph.snapshotId,
    graphHash: graph.graphHash,
    status: context.status,
    progress: progressForNodes(nodes),
    nodes,
    edges: graph.edges,
    scheduler: {
      mode: "dual_write",
      runnableNodeIds: []
    },
    humanRequests: humanRequestsForContext(detail, context),
    ...(context.verification ? { verificationSummary: verificationSummaryForContext(context) } : {}),
    auditRefs: auditRefsForRun(detail),
    updatedAt: context.updatedAt
  };
}

function buildLegacyWorkflowView(detail: RunDetail, context: WorkflowContext): WorkflowView {
  const nodes = context.taskRuns.map(legacyNodeForTaskRun);
  return {
    version: 1,
    runId: detail.run.id,
    attemptId: context.attemptId,
    workflowContextId: context.id,
    ...(context.contractId ? { contractId: context.contractId } : {}),
    ...(context.contractRevisionId ? { contractRevisionId: context.contractRevisionId } : {}),
    status: context.status,
    progress: progressForNodes(nodes),
    nodes,
    edges: [],
    scheduler: {
      mode: "legacy",
      runnableNodeIds: []
    },
    humanRequests: humanRequestsForContext(detail, context),
    ...(context.verification ? { verificationSummary: verificationSummaryForContext(context) } : {}),
    auditRefs: auditRefsForRun(detail),
    updatedAt: context.updatedAt
  };
}

function newestWorkflowContext(detail: RunDetail): WorkflowContext | undefined {
  return [...detail.workflowContexts]
    .filter((context) => context.runId === detail.run.id)
    .sort((left, right) => timestamp(right.updatedAt) - timestamp(left.updatedAt))[0];
}

function legacyNodeForTaskRun(taskRun: WorkflowTaskRun, index: number): WorkflowViewNode {
  return {
    nodeId: `legacy/task:${taskRun.id}`,
    kind: "task",
    label: taskRun.label ?? taskRun.stepId,
    status: taskRun.status,
    order: index + 1,
    sourceStepId: taskRun.stepId,
    ...(taskRun.phaseId ? { phaseNodeId: taskRun.phaseId } : {}),
    runtime: "codex"
  };
}

function progressForNodes(nodes: WorkflowViewNode[]): WorkflowView["progress"] {
  return nodes.reduce(
    (progress, node) => {
      progress.total += 1;
      if (node.status === "completed") progress.completed += 1;
      if (isRunningStatus(node.status)) progress.running += 1;
      if (isWaitingStatus(node.status)) progress.waiting += 1;
      if (node.status === "failed") progress.failed += 1;
      return progress;
    },
    { total: 0, completed: 0, running: 0, waiting: 0, failed: 0 }
  );
}

function isRunningStatus(status: WorkflowViewNode["status"]): status is WorkflowNodeRunStatus {
  return status === "running" || status === "dispatching";
}

function isWaitingStatus(status: WorkflowViewNode["status"]): boolean {
  return status === "suspended"
    || status === "ready"
    || status === "waiting_for_session"
    || status === "waiting_for_human"
    || status === "waiting_for_validator";
}

function humanRequestsForContext(detail: RunDetail, context: WorkflowContext): WorkflowView["humanRequests"] {
  return detail.humanRequests.filter((request) => {
    if (request.workflowContextId) {
      return request.workflowContextId === context.id;
    }
    if (request.attemptId) {
      return request.runId === detail.run.id && request.attemptId === context.attemptId;
    }
    return request.runId === detail.run.id;
  });
}

function verificationSummaryForContext(context: WorkflowContext): Record<string, unknown> {
  return {
    status: context.verification?.status,
    pendingValidatorIds: context.verification?.pendingValidatorIds ?? [],
    resultId: context.verification?.resultId,
    decision: context.verification?.decision
  };
}

function auditRefsForRun(detail: RunDetail): WorkflowView["auditRefs"] {
  return detail.events
    .filter((event) => event.runId === detail.run.id)
    .map((event) => ({ eventId: event.id, type: event.kind }));
}

function timestamp(value: string | undefined): number {
  const parsed = Date.parse(value ?? "");
  return Number.isNaN(parsed) ? 0 : parsed;
}
