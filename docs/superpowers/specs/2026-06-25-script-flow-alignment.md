# Script-Flow Alignment Design

## Status

Superseded for runtime orchestration by
`2026-06-27-durable-workflow-graph-design.md`. This document remains useful for the restricted
script/builder authoring decision, but its replay/cache execution notes describe the pre-graph
migration model and should not be read as current scheduler semantics.

The script/builder front-end still compiles structured authoring input into contract body
steps. New graph-backed attempts then compile that body into an immutable execution graph and
advance durable node-run state. Replay/cache behavior is legacy and migration behavior, not the
primary workflow orchestration model.

## Background: the CC "script design"

CC dynamic-workflows are authored as a small **script** that calls a handful of structured
primitives — `phase`, `agent`/`task`, `parallel`, `pipeline`, `log`, `budget`, `human` — and
returns a single aggregate value. The orchestration is "visible execution": each step is a
node the user can watch, and the runtime owns suspend/resume, memoization, and replay. The
script reads like imperative code but is really a declarative description of a step graph.

DittosLoop had the *execution* half of that model before the durable graph migration:

- `runFlow` (engine/runFlow.ts) exposes a `FlowApi` with `phase`, `agent`, `parallel`,
  `log`, `commit`.
- `runBody` (engine/runBody.ts) walks a `Step[]` and replays it through that `FlowApi`.
- `runFlow`'s `agent()` already does **suspend-on-uncached + memoize-by-stepId**:
  `completedStepOutputs[stepId]` short-circuits, otherwise the executor runs and may throw
  `CodexSessionPendingError` to suspend.
- `parallel.ts` is the **all-settle barrier**.
- `WorkflowContext.contractSnapshot` is the **replay boundary**.

What is missing relative to the CC model is the *authoring* half:

1. A serializable builder DSL so a script reads like `phase(...)`/`task(...)`/`parallel(...)`
   instead of a hand-written nested `Step[]` literal.
2. `pipeline` (sequential data hand-off) and `budget`/`human` as first-class primitives.
3. A single aggregate `return` convention so the script's return value becomes the run output.
4. `outputSchema` enforcement at `record_session_result` writeback (the field exists on
   `TaskStep` today but is never enforced).

## A/B Decision

### Option A — real JS sandbox

Run the user's script as live JavaScript inside a sandbox (`vm`/isolated-vm/QuickJS). The
`FlowApi` is handed in as the host object; `await api.task(...)` actually suspends the JS
continuation when a Codex session is pending.

### Option B — restricted, serializable builder DSL

The script calls pure builder functions (`phase`, `task`, `parallel`, `pipeline`, `log`,
`budget`, `human`) that **construct and return a plain `Step[]` / contract object** — no live
suspension, no host effects. The builder output compiles to the existing `ExecutionBody`
(`Step[]`) and is executed by the unchanged `runBody`/`runFlow` engine.

### Decision: **Option B (restricted builder DSL).**

Reasoning, weighed against the four hard constraints of this product:

1. **Session-first visible execution.** Execution is *not* driven by the script process. It is
   driven by `execute_workflow_attempt` running inside a visible Codex session and writing
   back via `record_session_result`. A live JS continuation (A) would have to suspend across
   an MCP round-trip to a *different* process (the visible Codex session) and resume later —
   i.e. serialize a JS continuation across `record_session_result`. That is exactly what the
   builder model avoids: B's "continuation" is the persisted `WorkflowContext` + `Step[]`,
   which is already how resume works today.

2. **Cross-session async writeback.** Task results arrive asynchronously via a *separate* tool
   call, possibly minutes later. B already handles this: `runFlow` re-runs the whole `Step[]`,
   memoizing completed steps by `stepId` and suspending on the first uncached one. A would need
   a serialized, resumable JS heap — heavy and fragile.

3. **Cross-restart replay.** A fresh service process must read stored state and continue. B's
   state is plain JSON (`WorkflowContext`, `contractSnapshot: FormalLoopContract`). A would need
   to persist and rehydrate a sandbox heap/continuation across process restarts — not viable
   with `vm`, and a large dependency with isolated-vm/QuickJS.

4. **Revision auditing.** Revisions are diffable, promotable, immutable `FormalLoopContract`
   snapshots. A builder DSL compiles to that same serializable contract, so revisions stay
   diffable JSON. A live script is opaque to diff/promotion.

**Net:** B delivers capability ≈ the CC script (the same primitives, same visible nodes) while
remaining serializable, replayable, and sandbox-free. The builder is a thin pure function over
the data model we already persist and replay. A buys nothing the constraints reward and costs a
sandbox runtime, a continuation serializer, and a new replay boundary.

The builder is the **compile front-end**; `Step[]` is the **compiled IR / snapshot**; `runBody`
+ `runFlow` + `WorkflowContext` are the unchanged **execution back-end**. This is the minimal
increment: the step array is demoted from "the authoring format" to "compile output and replay
snapshot," and `contractSnapshot` remains the replay boundary unchanged.

## New Primitive API (the builder)

New module `src/script/builder.ts`. Pure, synchronous, no I/O. Returns nodes that are exactly
the existing `Step` union plus a thin pipeline marker that compiles down to `Step[]`.

```ts
// src/script/builder.ts
import type { CodexSubagentSpec, Step } from "../contract/types.js";

export interface TaskOpts {
  id: string;
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  outputSchema?: Record<string, unknown>; // JSON-schema-ish; enforced at writeback
  subagent?: CodexSubagentSpec;
}

// task / agent — a single visible Codex node.
export function task(opts: TaskOpts): Step;          // -> { kind: "task", runtime: "codex", ... }
export function agent(opts: Omit<TaskOpts, "outputSchema">): Step; // alias -> { kind: "agent", ... }

// phase — sequential group, lifecycle-bracketed (phase_started/phase_done).
export function phase(id: string, label: string, children: Step[]): Step; // -> { kind: "phase", ... }

// parallel — all-settle fan-out (maps to ParallelStep / parallel.ts barrier).
export function parallel(id: string, label: string, children: Step[]): Step; // -> { kind: "parallel", ... }

// pipeline — sequential hand-off; sugar for an ordered phase. Children run in order and the
// runtime threads each child's memoized output to the next via the executor prompt context.
export function pipeline(id: string, label: string, children: Step[]): Step;

// log — non-executable annotation node; compiles to a log marker step (no Codex session).
export function log(message: string): ScriptDirective;

// budget — sets/overrides contract.budgetUsd for this script (script-level directive).
export function budget(usd: number): ScriptDirective;

// human — an explicit human-input node; compiles to a task step that always suspends with
// needs_human semantics (no Codex session; resolved via resolve_human_request writeback).
export function human(id: string, label: string, question: string): Step;

// Single aggregate return: the script returns one workflow() object; its `steps` becomes
// ExecutionBody.steps and directives (log/budget) are folded into the contract.
export interface ScriptWorkflow {
  steps: Step[];
  budgetUsd?: number;
  logs?: string[];
}
export function workflow(input: {
  steps: Array<Step | ScriptDirective>;
  // optional top-level metadata mirrors createLoopContract fields
}): ScriptWorkflow;
```

Authoring example (the "script"):

```ts
return workflow({
  steps: [
    log("daily upstream scan"),
    budget(2),
    phase("collect", "Collect", [
      parallel("scan", "Scan sources", [
        task({ id: "scan-a", label: "Scan A", prompt: "..." }),
        task({ id: "scan-b", label: "Scan B", prompt: "..." })
      ])
    ]),
    pipeline("produce", "Produce report", [
      task({ id: "draft", label: "Draft", prompt: "...", outputSchema: { type: "object", required: ["summary"] } }),
      task({ id: "review", label: "Review", prompt: "..." })
    ]),
    human("signoff", "Human sign-off", "Approve the report?")
  ]
});
```

### Compilation rules (builder → existing model)

| Primitive | Compiles to | Engine path |
|---|---|---|
| `task(opts)` | `TaskStep { kind:"task", runtime:"codex" }` | `runBody` → `api.agent()` → executor → Codex session |
| `agent(opts)` | `AgentStep { kind:"agent" }` (compat alias) | same executor path |
| `phase(id,label,children)` | `PhaseStep` | `runBody` → `api.phase()` bracket |
| `parallel(id,label,children)` | `ParallelStep` | `runBody` → `api.parallel()` → all-settle barrier |
| `pipeline(id,label,children)` | `PhaseStep` + ordered children + `pipeline:true` marker on the phase | `runBody` runs children in order (already sequential); marker lets the executor inject prior memoized output into the next child's prompt context |
| `log(msg)` | `ScriptDirective`, folded into `contract` log + emitted as `log` engine event during replay | `api.log()` |
| `budget(usd)` | folds into `contract.budgetUsd` | existing `budgetUsd` plumbing |
| `human(id,label,q)` | `TaskStep { kind:"task", runtime:"codex", human:true, prompt:q }` that suspends `needs_human` | `record_session_result(status:"needs_human")` → linked `HumanRequest` → `resolve_human_request` writeback (already implemented) |
| `workflow({steps})` aggregate return | `ExecutionBody { steps }` + contract fields | unchanged `prepareWorkflowContext` / `contractSnapshot` |

`pipeline` is deliberately the *only* genuinely new structural concept, and even it is a
`PhaseStep` with a boolean marker — children already execute sequentially in `runBody` (the
`phase` branch awaits each child in order). The marker is metadata so the executor can thread
the previous completed step's memoized output into the next step's prompt context. No new
engine control flow.

### Where the script runs

The builder is invoked at **contract authoring time**, not at execution time. Two entry points,
both producing a `FormalLoopContract` exactly as today:

1. **`create_loop_contract` (extended):** accept an optional `script` string OR a pre-built
   `body.steps` (current path). If `script` is present, evaluate it through the builder to
   produce `body.steps`. Evaluation is *not* a sandbox: the script is a TS/JSON module that only
   imports the builder; in the MCP boundary the safe form is a **declarative builder-call list**
   (see "Serialization" below), not arbitrary JS. The default and recommended authoring path
   over MCP stays the structured `body.steps` array; `script` is convenience sugar that compiles
   to the identical array.
2. **`propose_workflow_revision` (extended):** same — a revision may carry a `script` that
   compiles to a new `body.steps`, then flows through the existing revision/promote machinery.

### Serialization (why this is sandbox-free)

Over the MCP wire the "script" is **not** executable JS. It is a JSON list of builder calls
(a small AST), e.g.:

```json
{ "build": [
  { "fn": "log", "args": ["daily upstream scan"] },
  { "fn": "task", "args": [{ "id": "scan-a", "label": "Scan A", "prompt": "..." }] }
]}
```

`src/script/evalScript.ts` interprets that AST by dispatching to the pure builder functions.
There is no `eval`, no `vm`, no host access — only structured construction of `Step[]`. This is
what makes the model fully serializable, diffable for revisions, and replayable after restart.
(Local in-repo TS authors may still write real builder calls and serialize the result, but the
runtime only ever ingests the JSON AST or the already-compiled `Step[]`.)

## Mapping to existing execution (exact)

- **Step array + WorkflowContext.** Unchanged. `workflow().steps` *is* `ExecutionBody.steps`.
  `prepareWorkflowContext` stores it as `contractSnapshot` (service.ts:2371). Replay uses the
  snapshot, not the live contract (service.ts:433-435) — preserved.
- **All-settle barrier.** Unchanged `parallel.ts`. `parallel(...)` compiles to `ParallelStep`,
  which `runBody` (runBody.ts:34-37) sends to `api.parallel()`.
- **Suspend-on-uncached + memoize-by-stepId.** Unchanged `runFlow.ts:33-45`:
  `completedStepOutputs[stepId]` short-circuits; uncached steps run the executor, which may throw
  `CodexSessionPendingError` to suspend. The builder changes nothing here — it only changes how
  the `Step[]` was authored.
- **Pipeline data hand-off.** Adds: when a `PhaseStep` carries `pipeline: true`, the executor
  (`createWorkflowContextExecutor` in service.ts) reads the prior sibling's memoized output from
  `WorkflowContext.steps[prevStepId].output` and injects it into the next child's `AgentRequest`
  prompt context. This is the only execution-path addition and is purely additive (no behavior
  change for non-pipeline phases).
- **Single aggregate return.** `runFlow` already returns `flowResult.result` as the run output
  (loopRunner.ts:95). `runBody` returns `unknown[]`. We add an optional final aggregation so the
  script's conceptual single return maps to the run's `output`. Minimal form: keep `runBody`'s
  array return; the "single aggregate" is the array of step outputs, surfaced unchanged.

## Schema enforcement at writeback

Today `TaskStep.outputSchema` is accepted (mcpServer.ts:94) and stored but **never enforced**.
Add enforcement at `record_session_result`:

1. When `record_session_result` resolves its target `WorkflowTaskRun` and the originating step
   has an `outputSchema`, validate `input.result` against it **before** writing completed-step
   output / task result cache.
2. Validation lives in new `src/script/validateOutput.ts` (a tiny JSON-shape checker:
   `type`, `required`, `properties` — no new dependency; if a real validator is desired later,
   swap the impl). For `status: "passed"` with a non-conforming `result`, reject the writeback
   with a precise error and do **not** mutate `WorkflowContext` (mirrors the existing
   "contradictory locators rejected before mutating state" guarantee).
3. `status: "needs_human"` and `status: "failed"` skip output-schema validation (no completed
   output is written anyway — consistent with session-first spec lines 86-88).
4. The step's `outputSchema` is read from `contractSnapshot` (the replay boundary), not the live
   contract, so a promoted revision cannot retroactively change validation of an in-flight task.

## Backward compatibility

- **`agent` stays an alias.** `agent()` builder emits `AgentStep`; `validateContract` and
  `runBody` already normalize agent/task through the same executor path. No removal.
- **Old `body.steps` contracts run unchanged.** A contract authored as a raw `Step[]` (no
  script) takes the current path verbatim. The builder is purely additive.
- **Session-first spec is not touched.** `start_codex_session` remains the only launch tool;
  `start_loop_run`/`resume_loop_run` stay absent; `record_session_result` precise writeback,
  revisions, persistent resume, and the all-settle barrier are all preserved. The step array is
  demoted to compile-output/snapshot IR; `contractSnapshot` is still the replay boundary.

## File-by-file change plan (minimal increment)

1. **`src/contract/types.ts`**
   - Add optional `pipeline?: boolean` to `PhaseStep` (marker for pipeline hand-off).
   - Add optional `human?: boolean` to `TaskStep` (marks a human-input node).
   - No other type changes; `outputSchema` already present.

2. **`src/script/builder.ts`** (new)
   - Pure builders: `task`, `agent`, `phase`, `parallel`, `pipeline`, `log`, `budget`, `human`,
     `workflow`. Each returns plain `Step` / `ScriptDirective` / `ScriptWorkflow` objects.
   - `workflow()` folds `log`/`budget` directives into `{ steps, budgetUsd, logs }`.

3. **`src/script/evalScript.ts`** (new)
   - `evalScriptAst(ast: ScriptAst): ScriptWorkflow` — interprets the JSON builder-call AST by
     dispatching to `builder.ts`. No `eval`/`vm`. Throws on unknown `fn`.

4. **`src/script/validateOutput.ts`** (new)
   - `validateOutputAgainstSchema(result: string, schema: Record<string, unknown>): void` —
     parse `result` as JSON, check `type`/`required`/`properties`; throw a precise error on
     mismatch. Used only at writeback.

5. **`src/contract/compileContract.ts`**
   - `compileContract` accepts an optional pre-resolved `body` from a script. Add a sibling
     `compileScriptContract(input, ast, now)` that runs `evalScriptAst` then `compileContract`.
   - Keep `compileContract(input)` unchanged for the raw-`Step[]` path.

6. **`src/contract/validateContract.ts`**
   - In `validateStep`: allow `pipeline?: boolean` on phase and `human?: boolean` on task; if
     `human` is true, `prompt` (the question) is required and `runtime` must be `"codex"`.
   - No other rule changes.

7. **`src/mcpServer.ts`**
   - Extend `createLoopContractSchema` and `proposeWorkflowRevisionSchema` with optional
     `script` (the JSON builder-call AST schema) as an alternative to `body`. Add a `.refine`
     that exactly one of `body`/`script` is present.
   - Add `pipeline` to the `phase` branch of `stepSchema`; add `human`, keep `outputSchema` on
     `taskStepSchema`.
   - No changes to `recordSessionResultSchema` shape (validation is server-side).

8. **`src/service.ts`**
   - `createLoopContract` / `proposeWorkflowRevision`: if `script` present, call
     `compileScriptContract` to produce `body.steps`; else existing path.
   - `createWorkflowContextExecutor` / `runCodexSessionStep`: when the step's owning phase has
     `pipeline: true`, inject the prior sibling step's memoized output
     (`WorkflowContext.steps[prevStepId].output`) into the `AgentRequest.prompt` context.
   - `recordSessionResult` (and `completeWorkflowContextFromSessionResult`): for
     `status: "passed"`, look up the target step's `outputSchema` from `contractSnapshot`; if
     present, call `validateOutputAgainstSchema(input.result, schema)` **before** any state
     mutation; reject on mismatch without mutating `WorkflowContext`.

9. **`src/runner/loopRunner.ts`**
   - `flattenWorkflowSteps`: carry `pipeline` / `human` flags into
     `WorkflowExecutionPlanStep` so preview can render them. No control-flow change.

10. **`src/engine/runBody.ts`**
    - For a `PhaseStep` with `pipeline: true`, no new awaiting logic is needed (children already
      run sequentially); pass a `pipeline` hint into `api.agent` opts so the executor can thread
      prior output. One-line opts addition.

11. **`src/engine/types.ts`**
    - Add optional `pipeline?: boolean` and `human?: boolean` to `WorkflowExecutionPlanStep` and
      `AgentOptions` (for the pipeline prompt-threading hint). Additive only.

12. **`src/preview/eventAdapter.ts` + `preview/app.js`**
    - Render `pipeline` phases distinctly from plain phases (label badge "管道") and `human`
      task nodes (badge "人工"). Additive rendering; falls back to existing phase/agent cards.

## Tests to add / change

1. **`mcp/test/script/builder.test.ts`** (new) — each builder returns the exact expected
   `Step` shape; `agent` is a structural alias of `task` minus `runtime`/`outputSchema`;
   `workflow()` folds `budget`/`log` directives.
2. **`mcp/test/script/evalScript.test.ts`** (new) — a JSON builder-call AST compiles to the same
   `Step[]` as the equivalent hand-written literal; unknown `fn` throws; no `eval`/`vm` reachable
   (assert by interpreting a malicious-looking string is treated as a plain prompt arg, not code).
3. **`mcp/test/script/validateOutput.test.ts`** (new) — conforming JSON passes; missing
   `required` key throws; non-JSON `result` throws.
4. **`mcp/test/contract.test.ts`** (change) — `pipeline` phase and `human` task validate;
   `human` task without a prompt/question is rejected; raw-`Step[]` contracts still validate.
5. **`mcp/test/service.test.ts`** (change) —
   - `create_loop_contract` with a `script` AST yields a contract whose `body.steps` equals the
     equivalent hand-written contract.
   - `record_session_result(status:"passed")` with a `result` violating the step's `outputSchema`
     is rejected **and leaves `WorkflowContext` unmutated** (assert no completed-step output, no
     idempotency key appended).
   - Pipeline: a 2-step pipeline threads step-1's memoized output into step-2's prompt context;
     after restart-style re-run, step-1 is not relaunched (memoize-by-stepId preserved).
6. **`mcp/test/engine.test.ts`** (change) — `pipeline` phase emits ordered
   `phase_started → agent_* (a) → agent_* (b) → phase_done`; all-settle behavior for `parallel`
   unchanged.
7. **`mcp/test/mcpServer.test.ts`** (change) — `create_loop_contract`/`propose_workflow_revision`
   accept `script`; reject when both `body` and `script` are present; reject when neither is.
8. **`mcp/test/e2eWorkflow.test.ts`** (change) — author a loop via `script`, start a Codex
   session, suspend on the first task, record its result, resume to the second without
   relaunching; confirm the run output is the single aggregate of step outputs.
9. **`mcp/test/previewServer.test.ts`** (change) — preview renders `pipeline` and `human` badges
   and still renders existing phase/parallel/agent nodes.

## Acceptance Checklist

**New capability**

- [ ] Builder emits exactly the existing `Step` union (+ `pipeline`/`human` markers) and
      compiles to `ExecutionBody.steps` with no engine control-flow change.
- [ ] `script` authoring is a serializable JSON builder-call AST; no `eval`/`vm`/sandbox is
      introduced anywhere.
- [ ] `pipeline` threads each child's memoized output into the next child's prompt context.
- [ ] `human` node suspends `needs_human` and resolves through the existing
      `resolve_human_request` writeback path.
- [ ] `outputSchema` is enforced at `record_session_result` for `status:"passed"`, read from
      `contractSnapshot`, rejecting non-conforming results **before** mutating `WorkflowContext`.
- [ ] `budget`/`log` directives fold into the compiled contract.
- [ ] Single aggregate return: run output is the aggregate of step outputs (unchanged
      `runFlow`/`runBody` return surfaced through to the run).

**No regression of `2026-06-25-session-first-dynamic-workflow-design.md`**

- [ ] `start_codex_session` remains the only MCP launch tool; `start_loop_run` /
      `resume_loop_run` remain absent from handler registration and service product APIs.
- [ ] `record_session_result` precise writeback (`taskRunId`/`sessionId`/`stepId`/`attemptId`/
      `idempotencyKey`) is unchanged; contradictory locators still rejected before mutation.
- [ ] Workflow revisions remain immutable, run/attempt-scoped, diffable JSON; a `script`-authored
      revision flows through `propose`/`promote`/`reject` unchanged.
- [ ] Persistent resumable execution: suspended workflows resume from persisted
      `WorkflowContext` + `contractSnapshot` after service restart without relaunching completed
      steps; `contractSnapshot` is still the replay boundary.
- [ ] All-settle barrier (`parallel.ts`) unchanged; parallel fan-in resumes exactly once after
      all pending siblings settle; completed children not relaunched.
- [ ] Suspended contexts continue from their launch snapshot even if a revision is promoted
      mid-flight.
- [ ] `sessionPolicy` still accepts only `"new"`.

**Build/verify gate**

- [ ] `npm run typecheck` (`tsc -p tsconfig.json --noEmit`) passes in
      `plugins/dittosloop-for-codex/mcp`.
- [ ] `npm test` (`vitest run`) passes, including all new/changed tests above.
- [ ] `rg "start_loop_run|startLoopRun|resume_loop_run|resumeLoopRun"` still has no product-path
      hits outside stale-history docs or negative tests.
