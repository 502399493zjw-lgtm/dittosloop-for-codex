import type {
  ExecutionGraphEdge,
  ExecutionGraphNode,
  ExecutionGraphSnapshot,
  WorkflowNodeRun,
  WorkflowNodeRunStatus
} from "./types.js";

const runnableStatuses = new Set<WorkflowNodeRunStatus>(["pending", "ready"]);
const activeStatuses = new Set<WorkflowNodeRunStatus>([
  "dispatching",
  "running",
  "waiting_for_session",
  "waiting_for_human",
  "waiting_for_validator",
  "completed"
]);
const terminalStatuses = new Set<WorkflowNodeRunStatus>(["completed", "failed", "skipped", "canceled"]);

export function deriveRunnableNodeIds(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[]
): string[] {
  const runsByNodeId = nodeRunMap(nodeRuns);
  const nodesById = nodeMap(snapshot);

  return snapshot.nodes
    .filter((node) => isDispatchableNode(node) || node.kind === "verification")
    .filter((node) => {
      const nodeRun = runsByNodeId.get(node.nodeId);
      if (!nodeRun || !runnableStatuses.has(nodeRun.status)) {
        return false;
      }

      if (node.kind === "verification") {
        return workflowNodesComplete(snapshot, runsByNodeId);
      }

      return requiredPredecessorsComplete(snapshot, node, nodesById, runsByNodeId);
    })
    .sort((left, right) => left.order - right.order || left.nodeId.localeCompare(right.nodeId))
    .map((node) => node.nodeId);
}

export function advanceContainerNodeRuns(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  timestamp: string
): WorkflowNodeRun[] {
  const nodesById = nodeMap(snapshot);
  let nextRuns = nodeRuns;
  let changed = true;

  while (changed) {
    changed = false;
    const runsByNodeId = nodeRunMap(nextRuns);
    const advancedRuns = nextRuns.map((nodeRun) => {
      const node = nodesById.get(nodeRun.nodeId);
      if (!node || !isContainerNode(node)) {
        return nodeRun;
      }

      const children = childNodeIds(snapshot, node.nodeId)
        .map((nodeId) => runsByNodeId.get(nodeId))
        .filter((run): run is WorkflowNodeRun => Boolean(run));
      if (children.length === 0) {
        return nodeRun;
      }

      if (children.every((child) => child.status === "completed") && nodeRun.status !== "completed") {
        changed = true;
        return {
          ...nodeRun,
          status: "completed" as const,
          updatedAt: timestamp,
          completedAt: nodeRun.completedAt ?? timestamp
        };
      }

      if (children.some((child) => activeStatuses.has(child.status)) && nodeRun.status === "pending") {
        changed = true;
        return {
          ...nodeRun,
          status: "running" as const,
          startedAt: nodeRun.startedAt ?? timestamp,
          updatedAt: timestamp
        };
      }

      return nodeRun;
    });
    nextRuns = advancedRuns;
  }

  return nextRuns;
}

export function startAncestorContainerNodeRuns(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  nodeId: string,
  timestamp: string
): WorkflowNodeRun[] {
  const nodesById = nodeMap(snapshot);
  const node = nodesById.get(nodeId);
  if (!node) {
    return nodeRuns;
  }

  const ancestorNodeIds = new Set(
    ancestorNodes(node, nodesById)
      .filter((ancestor) => isContainerNode(ancestor))
      .map((ancestor) => ancestor.nodeId)
  );
  if (ancestorNodeIds.size === 0) {
    return nodeRuns;
  }

  return nodeRuns.map((nodeRun) =>
    ancestorNodeIds.has(nodeRun.nodeId) && runnableStatuses.has(nodeRun.status)
      ? {
          ...nodeRun,
          status: "running" as const,
          startedAt: nodeRun.startedAt ?? timestamp,
          updatedAt: timestamp
        }
      : nodeRun
  );
}

export function buildPipelineInputSnapshot(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  nodeId: string
): Record<string, unknown> | undefined {
  const upstream = snapshot.edges
    .filter((edge) => edge.kind === "pipeline_data" && edge.toNodeId === nodeId)
    .map((edge) => pipelineUpstreamSnapshot(snapshot, nodeRuns, edge))
    .filter((value): value is { nodeId: string; sourceStepId?: string; output: unknown } => Boolean(value));

  return upstream.length > 0 ? { upstream } : undefined;
}

export function workflowNodesComplete(
  snapshot: ExecutionGraphSnapshot,
  runsByNodeId: Map<string, WorkflowNodeRun>
): boolean {
  return snapshot.nodes
    .filter((node) => node.kind !== "root" && node.kind !== "verification")
    .every((node) => runsByNodeId.get(node.nodeId)?.status === "completed");
}

function requiredPredecessorsComplete(
  snapshot: ExecutionGraphSnapshot,
  node: ExecutionGraphNode,
  nodesById: Map<string, ExecutionGraphNode>,
  runsByNodeId: Map<string, WorkflowNodeRun>
): boolean {
  return requiredPredecessorNodeIds(snapshot, node, nodesById).every(
    (nodeId) => runsByNodeId.get(nodeId)?.status === "completed"
  );
}

function requiredPredecessorNodeIds(
  snapshot: ExecutionGraphSnapshot,
  node: ExecutionGraphNode,
  nodesById: Map<string, ExecutionGraphNode>
): string[] {
  const predecessorIds = new Set<string>();
  for (const ancestor of ancestorNodes(node, nodesById)) {
    for (const predecessorId of incomingBlockingPredecessorIds(snapshot, ancestor.nodeId)) {
      predecessorIds.add(predecessorId);
    }
  }
  for (const predecessorId of incomingBlockingPredecessorIds(snapshot, node.nodeId)) {
    predecessorIds.add(predecessorId);
  }
  return [...predecessorIds];
}

function incomingBlockingPredecessorIds(snapshot: ExecutionGraphSnapshot, nodeId: string): string[] {
  return snapshot.edges
    .filter(
      (edge) =>
        edge.toNodeId === nodeId &&
        (edge.kind === "sequence" || edge.kind === "pipeline_data" || edge.kind === "verification_after")
    )
    .map((edge) => edge.fromNodeId);
}

function ancestorNodes(
  node: ExecutionGraphNode,
  nodesById: Map<string, ExecutionGraphNode>
): ExecutionGraphNode[] {
  const ancestors: ExecutionGraphNode[] = [];
  let current = node.parentNodeId ? nodesById.get(node.parentNodeId) : undefined;
  while (current) {
    ancestors.unshift(current);
    current = current.parentNodeId ? nodesById.get(current.parentNodeId) : undefined;
  }
  return ancestors;
}

function pipelineUpstreamSnapshot(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  edge: ExecutionGraphEdge
): { nodeId: string; sourceStepId?: string; output: unknown } | undefined {
  const upstreamNode = snapshot.nodes.find((node) => node.nodeId === edge.fromNodeId);
  const upstreamRun = nodeRuns.find((nodeRun) => nodeRun.nodeId === edge.fromNodeId);
  if (!upstreamRun || upstreamRun.status !== "completed") {
    return undefined;
  }

  return {
    nodeId: edge.fromNodeId,
    ...(upstreamNode?.sourceStepId ? { sourceStepId: upstreamNode.sourceStepId } : {}),
    output: upstreamRun.output
  };
}

function childNodeIds(snapshot: ExecutionGraphSnapshot, nodeId: string): string[] {
  return snapshot.edges
    .filter((edge) => edge.kind === "contains" && edge.fromNodeId === nodeId)
    .map((edge) => edge.toNodeId);
}

function nodeMap(snapshot: ExecutionGraphSnapshot): Map<string, ExecutionGraphNode> {
  return new Map(snapshot.nodes.map((node) => [node.nodeId, node]));
}

function nodeRunMap(nodeRuns: WorkflowNodeRun[]): Map<string, WorkflowNodeRun> {
  return new Map(nodeRuns.map((nodeRun) => [nodeRun.nodeId, nodeRun]));
}

function isDispatchableNode(node: ExecutionGraphNode): boolean {
  return node.kind === "task" || node.kind === "human";
}

function isContainerNode(node: ExecutionGraphNode): boolean {
  return node.kind === "phase" || node.kind === "parallel";
}
