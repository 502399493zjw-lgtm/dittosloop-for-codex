# Durable Workflow Graph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace replay-shaped workflow orchestration with a durable execution graph, persistent node runs, scheduler-driven resume, and a preview-facing workflow view.

**Architecture:** Contracts still author workflow shape through `body.steps` or `script.build`, but each attempt compiles the frozen contract snapshot into an immutable `ExecutionGraphSnapshot`. Runtime state advances `WorkflowNodeRun` records through guarded scheduler transitions; preview reads `workflowView` instead of reconstructing task state from engine events. Migration is incremental: graph read model, dual-write node runs, scheduler for sequential/pipeline, scheduler for parallel, then event downgrade.

**Tech Stack:** TypeScript, Vitest, Node.js 20, existing LoopService/LoopStore JSON state, existing Codex session bridge, existing preview JavaScript/CSS, existing repository validation scripts.

## Global Constraints

- Work only in `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/.worktrees/durable-workflow-graph-design`.
- Keep `body.steps` and `script.build` as authoring inputs.
- Do not add a JavaScript workflow VM or runtime `if`/`while` execution.
- Do not make the preview editable or a source of truth.
- Do not introduce hidden background work; scheduler advancement is triggered by existing MCP/session calls.
- Existing state without graph fields must remain readable.
- Existing timeline data must remain renderable as legacy fallback.
- Preserve targeted `record_session_result`, output schema validation, human requests, verification v2, workflow revisions, memory, artifacts, and session launch behavior.
- Business lifecycle events for graph-scheduled runs are emitted only for real node-run state transitions.
- Use TDD for every behavior change: write the focused failing test, confirm the expected failure, implement the smallest passing change, then run the focused and relevant broader tests.
- Do not merge this branch without explicit user approval.

---

## File Structure

- Create `plugins/dittosloop-for-codex/mcp/src/workflowGraph/types.ts`: graph, node-run, scheduler, and workflow-view type definitions.
- Create `plugins/dittosloop-for-codex/mcp/src/workflowGraph/compileGraph.ts`: pure graph compiler from a frozen `FormalLoopContract`.
- Create `plugins/dittosloop-for-codex/mcp/src/workflowGraph/nodeRuns.ts`: initial node-run creation, state transition helpers, and legacy task-run projection helpers.
- Create `plugins/dittosloop-for-codex/mcp/src/workflowGraph/workflowView.ts`: pure `WorkflowView` read-model builder.
- Create `plugins/dittosloop-for-codex/mcp/src/workflowGraph/scheduler.ts`: pure dependency resolution, runnable-node selection, container advancement, and pipeline input freezing.
- Modify `plugins/dittosloop-for-codex/mcp/src/types.ts`: add optional graph fields on `WorkflowContext`, add `workflowView` to `RunDetail`, and re-export shared graph types where useful.
- Modify `plugins/dittosloop-for-codex/mcp/src/store.ts`: normalize old states without graph fields and preserve new fields.
- Modify `plugins/dittosloop-for-codex/mcp/src/service.ts`: compile graph snapshots when contexts are prepared, dual-write node runs, route graph contexts through scheduler execution, and limit legacy synthesized events to legacy contexts.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`: expose reusable workflow launch-plan flattening or move it to graph/compiler helpers so scheduler requests keep existing session metadata.
- Modify `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`: stop emitting completion events for cache hits once graph scheduler owns new contexts.
- Modify `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`: attach `workflowView` to preview run detail and keep timeline fallback.
- Modify `plugins/dittosloop-for-codex/mcp/src/previewServer.ts`: return enriched detail with `workflowView`.
- Modify `plugins/dittosloop-for-codex/preview/app.js`: prefer `detail.workflowView` for phase rail and task cards.
- Modify `plugins/dittosloop-for-codex/preview/styles.css`: only if workflow-view status classes need existing visual parity.
- Add tests under `plugins/dittosloop-for-codex/mcp/test/`: graph compiler, workflow view, scheduler, service migration, dual-write, sequential resume, parallel fan-in, preview API, and regression tests for legacy timeline fallback.

## Shared Interfaces

All tasks use these names and shapes. If implementation discovers a required shape change, update this plan before task execution continues.

```ts
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

---

### Task 1: Pure Graph Compiler

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/types.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/compileGraph.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts`

**Interfaces:**
- Consumes: `FormalLoopContract`, `resolveEffectiveProfilesByStep`, `effectiveProfileToSubagent`.
- Produces: `compileExecutionGraph(input: CompileExecutionGraphInput): ExecutionGraphSnapshot`.

- [ ] **Step 1: Write failing compiler tests**

Add `plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts`:

```ts
import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { compileExecutionGraph } from "../src/workflowGraph/compileGraph.js";

const fixedTime = "2026-06-27T00:00:00.000Z";

describe("workflow graph compiler", () => {
  test("compiles stable root phase parallel task and pipeline nodes", () => {
    const contract = compileContract({
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
    }, fixedTime);

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
    const contract = compileContract({
      id: "loop_hash",
      title: "Hash loop",
      goal: "Stable hash",
      body: { steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }] },
      verification: { mode: "after_workflow", rubrics: [] }
    }, fixedTime);

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
```

- [ ] **Step 2: Run the focused test and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts
```

Expected: FAIL because `src/workflowGraph/compileGraph.ts` does not exist.

- [ ] **Step 3: Add graph types and compiler**

Create the interfaces in `workflowGraph/types.ts` using the shared interfaces above. In `compileGraph.ts`, implement:

```ts
export interface CompileExecutionGraphInput {
  contract: FormalLoopContract;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  compiledAt: string;
  snapshotId: string;
}

export function compileExecutionGraph(input: CompileExecutionGraphInput): ExecutionGraphSnapshot;
```

Compiler rules:

- Always create `root` first and `root/verification` last.
- Convert `agent` and `task` to `kind: "task"` unless `task.human === true`, which becomes `kind: "human"`.
- Use `root/<container-kind>:<step.id>/<node-kind>:<step.id>` ids.
- Use `contains` edges for parent-child membership.
- Use `sequence` edges between top-level ordered nodes and ordered phase children.
- Use `parallel_child` from a parallel node to each child.
- Use `pipeline_data` between adjacent children inside a `phase` with `pipeline: true`.
- Use `verification_after` from the last top-level executable/container node to `root/verification`.
- Compute `graphHash` with `createHash("sha256")` over stable JSON of `{ compilerVersion, nodes, edges }`, excluding `snapshotId`, `compiledAt`, `runId`, `attemptId`, and `workflowContextId`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workflowGraph plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts
git commit -m "feat: add durable workflow graph compiler"
```

### Task 2: Context Graph State And Store Compatibility

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/store.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/nodeRuns.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/store.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

**Interfaces:**
- Consumes: `ExecutionGraphSnapshot`.
- Produces: optional `WorkflowContext.executionGraphSnapshot`, optional `WorkflowContext.nodeRuns`, and `createInitialNodeRuns(snapshot, now): WorkflowNodeRun[]`.

- [ ] **Step 1: Add failing normalization and launch tests**

Add a store test proving old state loads without graph fields:

```ts
test("normalizes workflow contexts without durable graph fields", async () => {
  const dir = await createTempDir();
  await writeFile(join(dir, "state.json"), `${JSON.stringify({
    version: 2,
    workflowContexts: [{
      id: "workflow_1",
      runId: "run_1",
      loopId: "loop_1",
      attemptId: "attempt_1",
      status: "ready",
      cursor: { state: "created" },
      vars: {},
      steps: {},
      taskRuns: [],
      pendingSessionIds: [],
      idempotencyKeys: [],
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z"
    }]
  })}\n`, "utf8");

  await expect(new LoopStore(dir).readState()).resolves.toMatchObject({
    workflowContexts: [{
      id: "workflow_1",
      executionGraphSnapshot: undefined,
      nodeRuns: undefined
    }]
  });
});
```

Add a service test proving a new session launch stores graph state:

```ts
test("prepares workflow context with immutable graph snapshot and node runs", async () => {
  const service = await createServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Graph launch",
    goal: "Create graph state",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run graph launch" });
  const detail = await service.getRunDetail(launch.run.id);
  const context = detail.workflowContexts[0];

  expect(context.executionGraphSnapshot).toMatchObject({
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    contractId: loop.id
  });
  expect(context.nodeRuns?.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
    ["root", "pending"],
    ["root/task:scan", "pending"],
    ["root/verification", "pending"]
  ]);
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- store.test.ts service.test.ts -t "graph"
```

Expected: FAIL because `WorkflowContext` lacks graph fields and service does not compile snapshots.

- [ ] **Step 3: Add optional state fields and initial node runs**

In `types.ts`, import graph types and extend `WorkflowContext`:

```ts
executionGraphSnapshot?: ExecutionGraphSnapshot;
nodeRuns?: WorkflowNodeRun[];
```

In `nodeRuns.ts`, implement:

```ts
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
```

In `service.ts`, update `createWorkflowContext` to compile graph state when `contract` is present. Use `this.nextId("graph")` in the caller before creating a context because `createWorkflowContext` is currently a standalone helper.

In `prepareWorkflowContext`, if an existing context has no `executionGraphSnapshot` and has `contractSnapshot`, lazily compile and store graph fields before returning the context.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- store.test.ts service.test.ts -t "graph"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/mcp/src/store.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/src/workflowGraph plugins/dittosloop-for-codex/mcp/test/store.test.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts
git commit -m "feat: persist workflow graph state on contexts"
```

### Task 3: Workflow View Read Model

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/workflowView.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `RunDetail`, `ExecutionGraphSnapshot`, `WorkflowNodeRun[]`, `HumanRequest[]`, `VerificationResultRecord[]`, `RunEvent[]`.
- Produces: `buildWorkflowView(detail: RunDetail): WorkflowView | undefined`.

- [ ] **Step 1: Write failing workflow-view tests**

Append to `workflowGraph.test.ts`:

```ts
test("builds workflow view from graph and node runs without engine events", () => {
  const detail = makeRunDetailWithGraph({
    nodeStatuses: {
      "root": "running",
      "root/task:scan": "completed",
      "root/verification": "pending"
    },
    events: []
  });

  const view = buildWorkflowView(detail);

  expect(view).toMatchObject({
    version: 1,
    runId: "run_1",
    attemptId: "attempt_1",
    workflowContextId: "workflow_1",
    scheduler: { mode: "dual_write" },
    progress: { total: 3, completed: 1, running: 1, waiting: 0, failed: 0 }
  });
  expect(view?.nodes.map((node) => [node.nodeId, node.status])).toEqual([
    ["root", "running"],
    ["root/task:scan", "completed"],
    ["root/verification", "pending"]
  ]);
});
```

Add a preview API test:

```ts
test("preview run detail exposes workflowView when graph state exists", async () => {
  const service = await createServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "View loop",
    goal: "Expose workflow view",
    body: { steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }] },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run view loop" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const detail = await fetchJson<any>(`${server.url}/api/runs/${launch.run.id}`);

  expect(detail.workflowView).toMatchObject({
    version: 1,
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    nodes: expect.arrayContaining([expect.objectContaining({ nodeId: "root/task:scan" })])
  });
});
```

- [ ] **Step 2: Run tests and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts previewServer.test.ts -t "workflow view|workflowView"
```

Expected: FAIL because `buildWorkflowView` and `detail.workflowView` do not exist.

- [ ] **Step 3: Implement view builder**

In `workflowView.ts`, implement:

```ts
export function buildWorkflowView(detail: RunDetail): WorkflowView | undefined;
```

Rules:

- Pick the newest workflow context for `detail.run.id`.
- If the context has graph state, build nodes by joining `executionGraphSnapshot.nodes` with `nodeRuns`.
- If the context has no graph state but has `taskRuns`, return a `legacy` view with one task node per task run.
- Do not read `engineEvents` to determine node status.
- `auditRefs` may reference events by id and inferred `stepId`, but audit refs do not drive status.
- `scheduler.mode` is `legacy` for no graph, `dual_write` for graph plus legacy execution, and `scheduler` after Task 6 adds an explicit context runtime mode.

Update `PreviewRunDetail` to include `workflowView?: WorkflowView`. In `enrichRunDetail`, call `buildWorkflowView(detail)`.

- [ ] **Step 4: Run focused tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts previewServer.test.ts -t "workflow view|workflowView"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workflowGraph/workflowView.ts plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "feat: expose workflow view read model"
```

### Task 4: Preview Consumes Workflow View

**Files:**
- Modify: `plugins/dittosloop-for-codex/preview/app.js`
- Modify: `plugins/dittosloop-for-codex/preview/styles.css`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `detail.workflowView`.
- Produces: phase rail and agent cards generated from workflow-view nodes before timeline fallback.

- [ ] **Step 1: Write failing preview source tests**

Add assertions to `previewServer.test.ts`:

```ts
test("preview prefers workflowView for workflow phase display", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("workflowViewPhases(detail.workflowView");
  expect(app).toContain("workflowViewNodeAgent");
  expect(app).toContain("detail.workflowView?.nodes");
  expect(app).toContain("workflowViewStatus");
});
```

- [ ] **Step 2: Run preview source test and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- previewServer.test.ts -t "workflowView"
```

Expected: FAIL because the preview app still builds workflow phases from timeline sections.

- [ ] **Step 3: Add workflow-view phase mapping**

In `app.js`, update `buildRunPhases(detail)` so the first workflow source is:

```js
const workflowViewPhasesList = workflowViewPhases(detail.workflowView, run.status);
if (workflowViewPhasesList.length) {
  phases.push(...workflowViewPhasesList);
}
```

Add:

```js
function workflowViewPhases(workflowView, fallbackStatus) {
  const nodes = workflowView?.nodes ?? [];
  if (!nodes.length) return [];
  const visibleNodes = nodes.filter((node) => node.kind !== "root");
  const phaseNodes = visibleNodes.filter((node) => node.kind === "phase" || node.kind === "parallel");
  const executableNodes = visibleNodes.filter((node) => node.kind === "task" || node.kind === "human" || node.kind === "verification");
  if (!phaseNodes.length) {
    return [{
      id: "workflow-view",
      name: "工作流执行",
      status: workflowViewStatus(workflowView.status || fallbackStatus),
      agents: executableNodes.map(workflowViewNodeAgent)
    }];
  }
  return phaseNodes.map((phase) => {
    const agents = executableNodes
      .filter((node) => node.parentNodeId === phase.nodeId || node.phaseNodeId === phase.nodeId)
      .map(workflowViewNodeAgent);
    return {
      id: phase.nodeId,
      name: phase.label,
      status: agentsStatus(agents, workflowViewStatus(phase.status)),
      agents
    };
  }).filter((phase) => phase.agents.length);
}

function workflowViewNodeAgent(node) {
  return {
    id: node.nodeId,
    avatar: node.kind === "verification" ? "验" : node.kind === "human" ? "人" : agentInitial({ name: node.label }),
    name: node.label,
    status: workflowViewStatus(node.status),
    description: node.resultSummary || node.errorSummary,
    meta: [node.taskRunId, node.sessionId].filter(Boolean).join(" · "),
    threadId: undefined,
    threadTitle: undefined,
    threadUrl: undefined,
    showSessionLink: false
  };
}

function workflowViewStatus(status) {
  if (status === "waiting_for_session" || status === "waiting_for_human" || status === "waiting_for_validator") return "requested";
  if (status === "ready" || status === "dispatching") return "running";
  if (status === "not_started" || status === "pending") return "requested";
  return timelineStatus(status);
}
```

Keep timeline fallback when `workflowViewPhases` returns an empty list.

- [ ] **Step 4: Run preview tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- previewServer.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/preview/app.js plugins/dittosloop-for-codex/preview/styles.css plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "feat: render preview workflow board from workflow view"
```

### Task 5: Dual-Write Node Runs During Legacy Execution

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/nodeRuns.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`

**Interfaces:**
- Consumes: legacy `WorkflowTaskRun` lifecycle methods.
- Produces: synchronized `WorkflowNodeRun` status, `taskRunId`, `sessionId`, output, error, and idempotency keys.

- [ ] **Step 1: Write failing dual-write tests**

Add a service test:

```ts
test("dual-writes node runs when a workflow task suspends and resumes", async () => {
  const { bridge } = createPendingSessionBridge();
  const service = await createServiceWithStore(await makeTempStore(), { sessionBridge: bridge });
  const loop = await service.createLoopContract({
    title: "Dual write",
    goal: "Persist node run state",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect" },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review" }
      ]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run dual write" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  let context = (await service.getRunDetail(launch.run.id)).workflowContexts[0];
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:collect")).toMatchObject({
    status: "waiting_for_session",
    taskRunId: "task_1",
    sessionId: "session_1"
  });

  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    workflowContextId: context.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collect done",
    result: "COLLECTED"
  });

  context = (await service.getRunDetail(launch.run.id)).workflowContexts[0];
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:collect")).toMatchObject({
    status: "completed",
    output: "COLLECTED",
    idempotencyKeys: ["collect:done"]
  });
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:review")).toMatchObject({
    status: "waiting_for_session",
    sessionId: "session_2"
  });
});
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "dual-writes node runs"
```

Expected: FAIL because node runs remain pending.

- [ ] **Step 3: Implement node-run transition helpers**

In `nodeRuns.ts`, add:

```ts
export function findNodeIdForStep(snapshot: ExecutionGraphSnapshot, stepId: string): string | undefined;

export function updateNodeRunForTaskRunning(
  context: WorkflowContext,
  input: { stepId: string; taskRunId: string; timestamp: string }
): WorkflowContext;

export function updateNodeRunForTaskSession(
  context: WorkflowContext,
  input: { stepId: string; taskRunId: string; sessionId: string; timestamp: string }
): WorkflowContext;

export function updateNodeRunForTaskResult(
  context: WorkflowContext,
  input: { stepId: string; taskRunId?: string; sessionId?: string; status: "passed" | "failed" | "needs_human"; result?: string; summary: string; idempotencyKey?: string; timestamp: string }
): WorkflowContext;
```

Status mapping:

- `markWorkflowTaskRunning` sets node run to `running` and stores `taskRunId`.
- `attachWorkflowTaskSession` sets `running` with `sessionId`.
- `suspendWorkflowTaskForSession` sets `waiting_for_session`.
- `completeWorkflowTask` and passed `recordSessionResult` set `completed`.
- failed result sets `failed`.
- `needs_human` result sets `waiting_for_human`.

Patch the existing service lifecycle helpers to call these node-run helpers inside the same `updateState` mutation that updates `steps` and `taskRuns`.

- [ ] **Step 4: Add idempotency regression**

Add:

```ts
async function startTwoStepPendingWorkflow(service: LoopService) {
  const loop = await service.createLoopContract({
    title: "Dual write workflow",
    goal: "Track node runs while legacy execution still launches sessions",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect notes." },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review notes." }
      ]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run dual write workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  return launch;
}

test("duplicate workflow task writeback does not duplicate node-run completion", async () => {
  const { service } = await createPendingServiceWithSequentialIds();
  const launch = await startTwoStepPendingWorkflow(service);

  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collected notes.",
    result: "COLLECTED"
  });
  const afterFirst = await service.getRunDetail(launch.run.id);
  const firstContext = afterFirst.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);
  const firstCollectRun = firstContext?.nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:collect");

  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collected notes replay.",
    result: "COLLECTED"
  });
  const afterSecond = await service.getRunDetail(launch.run.id);
  const secondContext = afterSecond.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);
  const secondCollectRun = secondContext?.nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:collect");

  expect(secondCollectRun?.idempotencyKeys.filter((key) => key === "collect:done")).toHaveLength(1);
  expect(secondCollectRun?.completedAt).toBe(firstCollectRun?.completedAt);
});
```

Keep the helper in the same test file so later scheduler tests can reuse the identical launch/writeback fixture without duplicating the full contract setup.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts -t "dual-write|duplicate workflow task writeback|suspended task workflow"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workflowGraph/nodeRuns.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts
git commit -m "feat: dual-write workflow node runs"
```

### Task 6: Sequential And Pipeline Scheduler

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/scheduler.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

**Interfaces:**
- Consumes: `ExecutionGraphSnapshot`, `WorkflowNodeRun[]`.
- Produces: `deriveRunnableNodeIds`, `advanceContainerNodeRuns`, `buildPipelineInputSnapshot`, and a service graph execution path.

- [ ] **Step 1: Write failing pure scheduler tests**

Add:

```ts
test("scheduler returns only the next sequential runnable task", () => {
  const { graph, nodeRuns } = makeSequentialGraphState(["draft", "review"]);

  expect(deriveRunnableNodeIds(graph, nodeRuns)).toEqual(["root/task:draft"]);

  const afterDraft = nodeRuns.map((nodeRun) =>
    nodeRun.nodeId === "root/task:draft" ? { ...nodeRun, status: "completed" as const } : nodeRun
  );

  expect(deriveRunnableNodeIds(graph, afterDraft)).toEqual(["root/task:review"]);
});

test("pipeline input snapshot freezes upstream output before dispatch", () => {
  const { graph, nodeRuns } = makePipelineGraphState({
    draftOutput: "DRAFT-OUTPUT"
  });

  expect(buildPipelineInputSnapshot(graph, nodeRuns, "root/phase:produce/task:review")).toEqual({
    upstream: [{ nodeId: "root/phase:produce/task:draft", sourceStepId: "draft", output: "DRAFT-OUTPUT" }]
  });
});
```

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts -t "scheduler|pipeline input"
```

Expected: FAIL because scheduler helpers do not exist.

- [ ] **Step 3: Implement pure scheduler helpers**

In `scheduler.ts`, implement:

```ts
export function deriveRunnableNodeIds(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[]
): string[];

export function advanceContainerNodeRuns(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  timestamp: string
): WorkflowNodeRun[];

export function buildPipelineInputSnapshot(
  snapshot: ExecutionGraphSnapshot,
  nodeRuns: WorkflowNodeRun[],
  nodeId: string
): Record<string, unknown> | undefined;
```

Rules:

- A `task` or `human` node is runnable when all incoming `sequence` and `verification_after` predecessors are completed and the node run status is `pending` or `ready`.
- A `verification` node is runnable when all non-root executable/container nodes are terminal and verification has not run.
- A `phase` or `parallel` node is never dispatched externally; `advanceContainerNodeRuns` starts and completes it based on child states.
- Pipeline input is a snapshot object built from completed upstream `pipeline_data` predecessors before dispatch.

- [ ] **Step 4: Extract verification execution for scheduler reuse**

Move verification-running logic from private `LoopRunner.verify` into a new exported helper:

```ts
// plugins/dittosloop-for-codex/mcp/src/runner/contractVerification.ts
export async function runContractVerification(input: {
  contract: FormalLoopContract;
  result: unknown;
  runId: string;
  attemptId: string;
  now: () => string;
  verifier?: LoopVerifier;
  commandExecutor?: CommandExecutor;
  emit?: (event: EngineEventInput) => void;
}): Promise<VerificationDecision | VerificationResultV2>;
```

Update `LoopRunner` to call this helper without changing existing runner behavior.

- [ ] **Step 5: Write failing service scheduler tests**

Add:

```ts
test("scheduler resumes a sequential workflow without replaying completed nodes", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createServiceWithStore(await makeTempStore(), { sessionBridge: bridge });
  const loop = await service.createLoopContract({
    title: "Scheduler sequential",
    goal: "Resume from node runs",
    body: {
      steps: [
        { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review" }
      ]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run scheduler sequential" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "draft:done",
    status: "passed",
    summary: "Draft done",
    result: "DRAFT"
  });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["draft", "review"]);
  const detail = await service.getRunDetail(launch.run.id);
  const agentDoneEvents = detail.events
    .map((event) => event.data?.engineEvent)
    .filter((event: any) => event?.type === "agent_done" && event.stepId === "draft");
  expect(agentDoneEvents).toHaveLength(1);
});
```

- [ ] **Step 6: Route graph contexts through scheduler**

In `service.ts`, add:

```ts
private async executeGraphWorkflowAttempt(
  run: LoopRun,
  attempt: RunAttempt,
  workflowContext: WorkflowContext,
  contract: FormalLoopContract,
  input: ExecuteWorkflowAttemptInput
): Promise<LoopRun>;
```

Execution loop:

1. Read current context inside `updateState`.
2. Call `advanceContainerNodeRuns`.
3. If pending session/human/validator exists, return current run.
4. Get `deriveRunnableNodeIds`.
5. Dispatch the first runnable task/human node for sequential phase.
6. Store `inputSnapshot` before dispatch when `buildPipelineInputSnapshot` returns data.
7. Use the existing `runCodexSessionStep` path, passing `stepId`, `phaseId`, `label`, `prompt`, `subagent`, and `agentProfile`.
8. When all workflow nodes are complete, run verification through `runContractVerification`.
9. Finalize run/attempt/context through the same v2/legacy paths currently used by `executeWorkflowAttempt`.

New contexts with graph state use scheduler mode. Contexts without graph state use the legacy runner path.

- [ ] **Step 7: Run focused scheduler tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts service.test.ts -t "scheduler|pipeline"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workflowGraph/scheduler.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/src/runner plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts
git commit -m "feat: run sequential workflows with graph scheduler"
```

### Task 7: Parallel Scheduler Fan-Out And Fan-In

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/workflowGraph/scheduler.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`

**Interfaces:**
- Consumes: `parallel_child` edges.
- Produces: all ready parallel children dispatch once, parallel container completes once after child terminal states.

- [ ] **Step 1: Write failing parallel scheduler tests**

Add pure test:

```ts
test("scheduler returns all ready parallel children and completes fan-in once", () => {
  const { graph, nodeRuns } = makeParallelGraphState(["scan-a", "scan-b"]);

  expect(deriveRunnableNodeIds(graph, nodeRuns)).toEqual([
    "root/parallel:collect/task:scan-a",
    "root/parallel:collect/task:scan-b"
  ]);

  const completedChildren = nodeRuns.map((nodeRun) =>
    nodeRun.nodeId.includes("/task:")
      ? { ...nodeRun, status: "completed" as const }
      : nodeRun
  );
  const advanced = advanceContainerNodeRuns(graph, completedChildren, fixedTime);

  expect(advanced.find((nodeRun) => nodeRun.nodeId === "root/parallel:collect")).toMatchObject({
    status: "completed",
    completedAt: fixedTime
  });
});
```

Add e2e regression:

```ts
async function startParallelCollectWorkflow(service: LoopService) {
  const loop = await service.createLoopContract({
    title: "Graph scheduler fan-out",
    goal: "Dispatch and join parallel workflow nodes once",
    body: {
      steps: [
        {
          id: "collect",
          kind: "parallel",
          label: "Collect",
          children: [
            { id: "scan-a", kind: "task", runtime: "codex", label: "Scan A", prompt: "Scan A." },
            { id: "scan-b", kind: "task", runtime: "codex", label: "Scan B", prompt: "Scan B." }
          ]
        }
      ]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run fan-out workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  return launch;
}

test("graph scheduler fan-out dispatches parallel children once and fan-in completes once", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const launch = await startParallelCollectWorkflow(service);

  expect(requests.map((request) => request.stepId)).toEqual(["scan-a", "scan-b"]);
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  expect(requests.map((request) => request.stepId)).toEqual(["scan-a", "scan-b"]);

  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "scan-a",
    idempotencyKey: "scan-a:done",
    status: "passed",
    summary: "Scan A done.",
    result: "A"
  });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_2",
    stepId: "scan-b",
    idempotencyKey: "scan-b:done",
    status: "passed",
    summary: "Scan B done.",
    result: "B"
  });

  const detail = await service.getRunDetail(launch.run.id);
  expect(requests.map((request) => request.stepId)).toEqual(["scan-a", "scan-b"]);
  expect(detail.workflowView?.nodes).toEqual(expect.arrayContaining([
    expect.objectContaining({ nodeId: "root/parallel:collect", status: "completed" }),
    expect.objectContaining({ nodeId: "root/parallel:collect/task:scan-a", status: "completed" }),
    expect.objectContaining({ nodeId: "root/parallel:collect/task:scan-b", status: "completed" })
  ]));
  const collectCompletionAudits = detail.events.filter((event) =>
    event.type === "node_transition" &&
    event.data?.nodeId === "root/parallel:collect" &&
    event.data?.toStatus === "completed"
  );
  expect(collectCompletionAudits).toHaveLength(1);
});
```

Put the helper next to the e2e test and keep the assertion on `requests` before and after the second execute call; that assertion is the regression guard for durable dispatch idempotency.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts e2eWorkflow.test.ts -t "parallel|fan-out|fan-in"
```

Expected: FAIL because service scheduler dispatches only one runnable node and container fan-in is incomplete.

- [ ] **Step 3: Implement parallel dispatch**

Update `executeGraphWorkflowAttempt`:

- If runnable nodes share the same direct `parallel_child` parent, dispatch all currently pending children in that group.
- Do not dispatch a child whose node run is already `running`, `waiting_for_session`, `completed`, `failed`, or has a `sessionId`.
- After dispatching all ready children, return run if any child is waiting for a Codex session.
- For completed-session bridge tests, continue the scheduler loop until the parallel container advances and the next sequential node becomes runnable.

- [ ] **Step 4: Run parallel tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workflowGraph.test.ts e2eWorkflow.test.ts -t "parallel|fan-out|fan-in"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workflowGraph/scheduler.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/workflowGraph.test.ts plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts
git commit -m "feat: schedule parallel workflow nodes durably"
```

### Task 8: Event Downgrade And Legacy Fallback

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/engine.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: graph scheduler state transitions.
- Produces: no duplicate lifecycle events from cache/replay for graph contexts; legacy event-only runs still render a timeline.

- [ ] **Step 1: Write failing event-semantics tests**

Add engine test:

```ts
test("runFlow cache hits return output without emitting agent_done", async () => {
  const events: EngineEvent[] = [];
  const out = await runFlow(
    (api) => api.agent("cached", { stepId: "scan", label: "Scan" }),
    {
      runId: "run_cache",
      executor: { async run() { throw new Error("executor must not run"); } },
      completedStepOutputs: { scan: "CACHED" },
      emit: (event) => events.push(event),
      now: () => "2026-06-27T00:00:00.000Z"
    }
  );

  expect(out.result).toBe("CACHED");
  expect(events.map((event) => event.type)).toEqual(["run_started", "run_completed"]);
});
```

Add service test:

```ts
test("graph scheduled repeated execute does not append duplicate agent completion events", async () => {
  const { service } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Event downgrade workflow",
    goal: "Do not emit replay completion events",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan once." }]
    },
    verification: { mode: "after_workflow", rubrics: [] }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run event downgrade workflow" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "scan",
    idempotencyKey: "scan:done",
    status: "passed",
    summary: "Scan done.",
    result: "DONE"
  });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const detail = await service.getRunDetail(launch.run.id);
  const agentDoneEvents = detail.events.filter((event) => event.data?.engineEvent?.type === "agent_done");
  const nodeCompletionAudits = detail.events.filter((event) =>
    event.type === "node_transition" &&
    event.data?.nodeId === "root/task:scan" &&
    event.data?.toStatus === "completed"
  );
  expect(agentDoneEvents.length + nodeCompletionAudits.length).toBe(1);
});
```

Keep this test independent from the Task 6 helper so it remains a small event-semantics regression.

- [ ] **Step 2: Run and confirm RED**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- engine.test.ts service.test.ts -t "cache hits|duplicate agent completion"
```

Expected: FAIL because cache hits currently emit `agent_done` and service still has completion-event synthesis paths.

- [ ] **Step 3: Implement event downgrade**

Changes:

- In `runFlow.agent`, return cached output without emitting `agent_done`.
- In `recordSessionResult`, call `workflowCompletionEngineEvents` only when the target context has no `executionGraphSnapshot`.
- For graph contexts, append audit `note` events with `data.nodeTransition` containing `{ nodeId, from, to, taskRunId, sessionId }`.
- Keep `extractEngineEvents` and timeline fallback for old runs.
- Keep `buildWorkflowView` independent from engine lifecycle event parsing.

- [ ] **Step 4: Run focused and preview tests, then commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- engine.test.ts service.test.ts previewServer.test.ts -t "cache hits|duplicate agent completion|legacy"
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts plugins/dittosloop-for-codex/mcp/test/engine.test.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "fix: make graph workflow events transition-based"
```

### Task 9: Full Verification And Documentation Alignment

**Files:**
- Modify: `docs/superpowers/specs/2026-06-27-durable-workflow-graph-design.md`
- Modify: `docs/superpowers/specs/2026-06-25-script-flow-alignment.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/inspect-loop.md`
- Modify: tests only if documentation validation requires string updates.

**Interfaces:**
- Consumes: completed scheduler implementation.
- Produces: docs that no longer describe new runs as replay/cache-driven or claim dynamic workflow parity that the runtime does not provide.

- [ ] **Step 1: Write failing docs/search checks**

Run:

```bash
rg -n "replay|completedStepOutputs|cache|dynamic workflow parity|Claude Code dynamic|agent_done" docs plugins/dittosloop-for-codex/skills
```

Classify every hit:

- Historical design docs may remain if marked as historical.
- Current user-facing docs must describe durable graph scheduler semantics.
- The new durable graph spec must still mention replay/cache only as the model being replaced.

- [ ] **Step 2: Update docs**

Make these concrete edits:

- In `2026-06-25-script-flow-alignment.md`, mark the old script-alignment conclusion as superseded by `2026-06-27-durable-workflow-graph-design.md`.
- In `execute-loop.md`, describe `execute_workflow_attempt` as advancing scheduler state for graph-backed runs.
- In `inspect-loop.md`, describe `workflowView` as the preview/source read model and events as audit history.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
npm --prefix plugins/dittosloop-for-codex/mcp run build
npm test
npm run verify:generated
npm run validate
npm run check
git diff --check
```

Expected:

- MCP Vitest suite passes.
- MCP build passes.
- Root tests pass.
- Generated-file verifier passes.
- Plugin validator passes.
- Repository check passes.
- Diff whitespace check passes.

- [ ] **Step 4: Commit final docs and verification updates**

Commit:

```bash
git add docs plugins/dittosloop-for-codex/skills plugins/dittosloop-for-codex/mcp/test
git commit -m "docs: align workflow docs with durable scheduler"
```

## Completion Audit

Before requesting final review, verify each requirement from `docs/superpowers/specs/2026-06-27-durable-workflow-graph-design.md`:

- Graph compiler creates stable immutable snapshots with deterministic node ids and graph hash.
- Contexts persist graph snapshots and node runs.
- Resume reads scheduler state and does not replay completed nodes.
- Sequential and pipeline workflows dispatch each executable node once.
- Parallel workflows dispatch each child once and complete fan-in once.
- `record_session_result` updates node runs idempotently and rejects stale locator mismatches.
- Output schema validation still rejects invalid passed task results before state mutation.
- Verification v2 still owns final run completion and repair decisions.
- Workflow revisions do not mutate existing attempt snapshots.
- Preview uses `workflowView` when present.
- Legacy event-only runs still render timeline fallback.
- Graph-scheduled repeated execute calls do not create duplicate lifecycle events.
- Full repository verification passes with fresh output.

Only after all items have direct evidence from tests, code inspection, and command output should the implementation be marked complete.
