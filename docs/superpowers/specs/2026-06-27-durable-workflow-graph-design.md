# Durable Workflow Graph Design

Status: ready for review before implementation planning starts.

## Context

The current DittosLoop For Codex workflow runtime can complete useful work, but its orchestration model is replay-shaped. `execute_workflow_attempt` runs the stored body again, `runBody` starts from `body.steps`, and `runFlow` skips already completed task steps through `completedStepOutputs`. That prevents duplicate Codex work, but the replay still emits workflow events such as `agent_done` for cached steps. The preview then reads those events back into a task board, so repeated execution can make the UI look unstable even when the business task was not relaunched.

This is a runtime semantics issue, not only a presentation issue. The next workflow layer should make a stable execution graph and durable node states the source of truth. Events should become an audit trail and compatibility surface, not the thing the preview must parse to understand task state.

## Goals

- Compile each workflow attempt into a stable, immutable `ExecutionGraphSnapshot`.
- Persist one `WorkflowNodeRun` record per graph node that participates in execution or visible progress.
- Resume by scheduler state, not by replaying the entire workflow body.
- Emit business lifecycle events only for real node state transitions.
- Expose a `workflowView` read model that the preview can use as its task-board source.
- Keep existing formal contract authoring with `body.steps` and `script.build`.
- Preserve current session-first launch, targeted `record_session_result`, human request, verification v2, and revision behavior.
- Migrate incrementally so existing runs and timeline-based preview data continue to load.

## Non-Goals

- Do not add a JavaScript workflow VM or runtime `if`/`while` script execution.
- Do not make the preview editable or a source of truth.
- Do not introduce hidden background work in the MVP; scheduler advancement remains explicit through existing MCP/session calls.
- Do not remove legacy `events` or timeline support during the first migration.
- Do not redesign agent profiles, skill preflight, or final verification policy in this spec.
- Do not make optional workflow quality-control patterns a top-level product concept. Contract authors may still model extra quality steps as ordinary workflow nodes when the loop requires them.

## Current Model To Replace

The current path is:

1. `execute_workflow_attempt` locates the run, attempt, and `WorkflowContext`.
2. It prepares a completed-step output cache from `WorkflowContext.steps`.
3. `LoopRunner` invokes `runBody(contract.body, api)`.
4. `runBody` sequentially walks `body.steps`, recursively entering phases and parallel groups.
5. `runFlow.agent()` returns cached output for completed steps, but still emits `agent_done`.
6. If a Codex task suspends, service records engine events and waits for `record_session_result`.
7. Preview derives workflow timeline sections from engine events.

That model uses `WorkflowContext` as a replay cache. The desired model uses it as, or replaces it with, scheduler state.

## Target Model

```text
FormalLoopContract
  -> compileExecutionGraph(contractSnapshot)
  -> ExecutionGraphSnapshot
  -> WorkflowNodeRun[]
  -> scheduler tick
  -> workflowView
```

`body.steps` and `script.build` remain authoring inputs. They are not the resume source. On attempt creation, the runtime compiles the contract snapshot into a graph snapshot. After that, resume reads the graph and node runs directly.

## Data Model

### ExecutionGraphSnapshot

An attempt-scoped immutable graph.

```ts
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
```

The snapshot is created once for an attempt. Contract revisions promoted later do not change it. A later attempt may compile a new snapshot.

### ExecutionGraphNode

```ts
export type ExecutionGraphNodeKind =
  | "root"
  | "phase"
  | "parallel"
  | "task"
  | "human"
  | "verification";

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
```

`phase` and `parallel` are graph nodes, not only visual labels. They may be completed by the scheduler when their child dependency policy is satisfied. This gives the preview stable containers and avoids deriving phase state from event ordering.

`human` is a graph node even if it is authored today as a task with `human: true`. That separates user waiting state from Codex task execution.

`verification` is represented in `workflowView` and may be a terminal graph node once scheduler execution owns the full run lifecycle. During early migration it can be projected from existing verification state.

### ExecutionGraphEdge

```ts
export type ExecutionGraphEdgeKind = "sequence" | "contains" | "parallel_child" | "pipeline_data" | "verification_after";

export interface ExecutionGraphEdge {
  fromNodeId: string;
  toNodeId: string;
  kind: ExecutionGraphEdgeKind;
}
```

Sequential steps use `sequence`. Parent/child structure uses `contains`. Parallel branches use `parallel_child` plus a fan-in policy on the parent `parallel` node. Pipeline handoff is an explicit `pipeline_data` edge so the scheduler can freeze the upstream output into the downstream node's input snapshot.

### WorkflowNodeRun

```ts
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
```

`WorkflowTaskRun` remains during migration. `WorkflowNodeRun` is the scheduler-facing record. Early implementations may project node runs from existing task runs, then dual-write both, and only later make node runs authoritative.

## Node Ids

Node ids must be stable inside a graph snapshot and deterministic for the same contract snapshot. Preferred ids are namespaced from authored step ids:

```text
root
root/phase:collect
root/phase:collect/parallel:scan
root/phase:collect/parallel:scan/task:scan-docs
```

If a legacy step lacks a usable id, the compiler may use a path index fallback such as `root/phase:collect/task:2`, but new contracts should keep requiring explicit ids for executable nodes. The `graphHash` must include normalized nodes and edges so accidental graph changes are visible.

## Scheduler Semantics

`execute_workflow_attempt` becomes a scheduler tick over durable graph state.

At a high level:

```text
load run, attempt, workflow context
ensure immutable ExecutionGraphSnapshot exists
load WorkflowNodeRun records
derive ready nodes from dependency edges
claim runnable nodes idempotently
dispatch external Codex sessions or complete internal container nodes
record only real state transitions
return run state when waiting or complete
```

The scheduler must be safe to call repeatedly. Repeated ticks may observe completed work, but they must not dispatch a completed node again and must not emit a second business completion event for the same node run.

### Dependency Rules

- A `task` node becomes ready when all required predecessor nodes are `completed`.
- A `phase` node starts when its first child becomes active and completes after all children required by its sequence policy complete.
- A `parallel` node starts when its children are ready and completes after every required child reaches a terminal status.
- A pipeline child receives an `inputSnapshot` containing selected upstream outputs before it dispatches.
- A `human` node waits through `HumanRequest` and completes only through linked resolution/writeback.
- Verification continues to use the existing v2 verification path during migration, then can become a terminal scheduler node.

### State Transitions

State transitions are guarded. The service should reject or ignore stale transitions, for example:

- a session result for a different attempt,
- a result for a node that is already completed with another idempotency key,
- a scheduler claim after another tick already claimed the node,
- a writeback whose `taskRunId`, `sessionId`, and `stepId` do not resolve to the same node run.

Use a context-level version, lease, or compare-and-set guard when the local store supports it. The MVP local JSON store can implement this by reading, validating, mutating in one store update, and rechecking node status inside the update callback.

## Event Semantics

Events are still useful, but they should not be the source of workflow state.

New rules:

- A business lifecycle event is emitted only when a node run changes state.
- Cache hits, replay, preview enrichment, and resume scans do not emit `agent_done`, `phase_done`, or `parallel_completed`.
- Low-level diagnostic events may record scheduler ticks, cache observations, or migration decisions, but preview task-board state must not depend on them.
- Legacy runs keep timeline fallback through existing engine events.

The desired direction is:

```text
WorkflowNodeRun state transition -> event audit entry
workflowView -> preview task board
events -> drill-down/audit/history
```

## Workflow View

`/api/runs/:id` should expose a `workflowView` alongside existing run detail fields.

```ts
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
```

```ts
export interface WorkflowViewNode {
  nodeId: string;
  kind: ExecutionGraphNodeKind;
  label: string;
  status: WorkflowNodeRunStatus | "not_started";
  parentNodeId?: string;
  phaseNodeId?: string;
  order: number;
  dependsOn: string[];
  taskRunId?: string;
  sessionId?: string;
  agentProfileRef?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  resultSummary?: string;
  errorSummary?: string;
  artifactRefs?: ArtifactRef[];
}
```

The preview should prefer `workflowView.nodes` for the board. Existing `timeline` remains available for audit and old state.

## Compatibility And Migration

### Phase 1: Read Model Only

- Add `compileExecutionGraph(contractSnapshot)`.
- Add graph snapshot and workflow view types.
- Derive `workflowView` from existing `WorkflowContext.taskRuns`, verification results, human requests, and engine events where needed.
- Do not change execution behavior.

### Phase 2: Dual Write

- Keep `runBody`/`runFlow`/`LoopRunner` as the executor.
- Persist `ExecutionGraphSnapshot` on workflow context or attempt.
- Persist or project `WorkflowNodeRun` records for task and container nodes.
- Preview prefers `workflowView`; timeline remains fallback.

### Phase 3: Sequential Scheduler

- Add scheduler execution for sequential task and pipeline graphs.
- Preserve current targeted session writeback, idempotency, output schema, human request, and v2 verification behavior.
- Keep legacy runner behind a compatibility mode for old contexts.

### Phase 4: Parallel Scheduler

- Move parallel fan-out/fan-in from replay semantics into graph dependencies.
- Prove parallel children dispatch once, partial completion waits, and join/container nodes complete once.

### Phase 5: Event Downgrade

- For graph-scheduled runs, preview task board no longer reads lifecycle events.
- Events remain audit logs and old-run timeline fallback.

## Repair And Verification

The first graph scheduler should keep repair at the existing attempt level. If verification fails and `repairPolicy` allows another try, the service creates the next attempt/context and compiles a fresh graph snapshot for that attempt. Targeted in-place node repair epochs are explicitly out of scope for this design; a future spec must define them before implementation.

Verification remains the run-level acceptance layer. It may be projected into `workflowView` as a terminal status section, but it should not be conflated with ordinary workflow task state.

## Store Migration

Persisted state should remain loadable if it has no graph fields. New fields should be optional during normalization:

- `WorkflowContext.executionGraphSnapshot?`
- `WorkflowContext.nodeRuns?`

Old runs without graph data use legacy timeline projection. New runs get graph snapshots when their workflow context is prepared. If a graph snapshot is missing for an active context, the service may lazily compile one from `contractSnapshot` before the next tick, then store it.

## Acceptance Checks

- A graph compiler test proves the same contract snapshot produces stable nodes, edges, and graph hash.
- A snapshot immutability test proves a suspended attempt resumes with its original graph after the active contract is revised.
- A workflow view test proves preview board data can be built without reading engine lifecycle events.
- A legacy compatibility test proves old event-only runs still render a timeline.
- A sequential resume test proves repeated `execute_workflow_attempt` calls do not dispatch completed nodes.
- A duplicate writeback test proves repeated `record_session_result` with the same idempotency key does not create duplicate node completions.
- A stale writeback test rejects session results for the wrong attempt, context, or node.
- A pipeline test proves upstream output is frozen into downstream node input before dispatch.
- A parallel test proves fan-out children dispatch once and fan-in completes once.
- A verification test proves final verification still controls run completion and repair attempts.
- A restart test proves persisted graph state resumes without relying on engine events.

## Open Implementation Questions For The Plan

- Whether `ExecutionGraphSnapshot` lives directly on `WorkflowContext` or as a top-level state collection keyed by `snapshotId`.
- Whether `WorkflowNodeRun` should initially be top-level state or embedded under `WorkflowContext`.
- Which minimal store compare-and-set mechanism is enough for the local JSON store before a heavier persistence layer exists.
- Which preview surfaces switch first from timeline to `workflowView`.

These are implementation choices, not design blockers. The design requirement is that graph snapshot and node run state become the durable workflow source of truth before the legacy event timeline is retired.
