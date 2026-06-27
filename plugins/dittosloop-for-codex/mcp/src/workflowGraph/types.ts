import type { CodexSubagentSpec } from "../contract/types.js";
import type { HumanRequest } from "../types.js";

export type ExecutionGraphNodeKind =
  | "root"
  | "phase"
  | "parallel"
  | "task"
  | "human"
  | "verification";

export interface ExecutionGraphSnapshot {
  snapshotId: string;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  contractId: string;
  contractRevisionId?: string;
  compilerVersion: number;
  graphHash: string;
  compiledAt: string;
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
}

export interface ExecutionGraphNode {
  nodeId: string;
  kind: ExecutionGraphNodeKind;
  sourceStepId?: string;
  parentNodeId?: string;
  phaseNodeId?: string;
  label: string;
  order: number;
  runtime?: "codex" | "internal";
  prompt?: string;
  pipeline?: boolean;
  human?: boolean;
  agentProfileRef?: string;
  subagent?: CodexSubagentSpec;
  outputSchema?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type ExecutionGraphEdgeKind =
  | "sequence"
  | "contains"
  | "parallel_child"
  | "pipeline_data"
  | "verification_after";

export interface ExecutionGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  kind: ExecutionGraphEdgeKind;
}

export type WorkflowNodeRunStatus =
  | "pending"
  | "ready"
  | "dispatching"
  | "running"
  | "waiting_for_session"
  | "waiting_for_human"
  | "waiting_for_validator"
  | "completed"
  | "failed"
  | "skipped"
  | "canceled";

export interface WorkflowNodeRun {
  nodeRunId: string;
  nodeId: string;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  epoch: number;
  status: WorkflowNodeRunStatus;
  inputSnapshot?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  sessionId?: string;
  taskRunId?: string;
  idempotencyKeys: string[];
  claimedBy?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

export interface WorkflowViewNode {
  nodeId: string;
  kind: ExecutionGraphNodeKind;
  label: string;
  status: WorkflowNodeRunStatus | string;
  order: number;
  sourceStepId?: string;
  parentNodeId?: string;
  phaseNodeId?: string;
  runtime?: "codex" | "internal";
  human?: boolean;
}

export interface WorkflowView {
  version: 1;
  runId: string;
  attemptId?: string;
  workflowContextId?: string;
  contractId?: string;
  contractRevisionId?: string;
  snapshotId?: string;
  graphHash?: string;
  status: string;
  progress: {
    total: number;
    completed: number;
    running: number;
    waiting: number;
    failed: number;
  };
  nodes: WorkflowViewNode[];
  edges: ExecutionGraphEdge[];
  scheduler: {
    mode: "legacy" | "dual_write" | "scheduler";
    waitingReason?: string;
    runnableNodeIds: string[];
  };
  humanRequests: HumanRequest[];
  verificationSummary?: Record<string, unknown>;
  auditRefs: Array<{ eventId: string; nodeId?: string; type: string }>;
  updatedAt: string;
}
