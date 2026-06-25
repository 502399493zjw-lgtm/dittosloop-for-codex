# Canonical Loop Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align DittosLoop For Codex loop files and durable loop status with the current Dittos Loop engine model while keeping Codex App as the bound execution runtime.

**Architecture:** Keep `start_codex_session` as the only visible launch path. Treat Codex sessions as run execution surfaces, while loop status, run history, memory, and workflow evolution are projected as durable loop-owned package files.

**Tech Stack:** TypeScript ES2022, NodeNext modules, Vitest, JSON-backed local state, MCP SDK, vanilla preview UI.

## Global Constraints

- Do not reintroduce `start_loop_run` or `resume_loop_run`.
- Keep Codex App binding; do not add a second runtime dependency.
- Keep existing state readable.
- Preserve session-first workflow behavior and existing MCP tools.
- Add tests before production behavior changes.

## Source Alignment

The current `dittos-loop` engine source uses a compact per-loop `LoopState` persisted beside the loop spec:

- `cursor`
- `consecutiveFailures`
- `paused`
- `pausedReason?: "failures" | "budget" | "escalation"`
- `running`
- `runCount`
- `lastRunAt`

Run history is a separate per-loop index with `LoopRunRecordStatus = "queued" | "running" | "waiting_for_human" | "repairing" | "completed" | "failed" | "canceled"`. Memory is an append-only `<loopId>.md` surface, not a versioned `memoryRevision` state field. For Codex therefore keeps Codex session runs as the execution surface, but derives and persists loop-owned operational state using these engine-aligned fields.

---

### Task 1: Canonical Directory Projection

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`

**Interfaces:**
- Produces: `status.json`, `runs/index.json`, per-run `runs/<runId>/*`, `workflow/workflow.json`, `evolution/revisions.json`, `evolution/memory-commits.json`, and `codex/session.json` from `listLoopFiles(loopId)`.
- Consumes: existing `LoopState`, `LoopRun`, `RunAttempt`, `RunEvent`, `VerificationResult`, `HumanRequest`, `MemoryCommit`, `WorkflowRevision`, and `WorkflowContext`.

- [x] **Step 1: Write failing service tests**

Add expectations to the loop file test proving the file list includes canonical status, runs, workflow, evolution, and Codex session paths.

- [x] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "renders loop directory files"`

Expected: FAIL because the new canonical paths are missing.

- [x] **Step 3: Implement canonical file rendering**

Add pure helpers in `workspaceFiles.ts` that derive lifecycle, active run, run history, memory commits, and workflow revision projections from state.

- [x] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "renders loop directory files"`

Expected: PASS.

### Task 2: Engine-Aligned Status Semantics

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/store.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/store.ts`
- Add: `plugins/dittosloop-for-codex/mcp/src/loopOperationalState.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`

**Interfaces:**
- Produces: engine-aligned per-loop operational state with `cursor`, `consecutiveFailures`, `paused`, `pausedReason`, `running`, `runCount`, `lastRunAt`, and optional active Codex run references in `status.json`.
- Consumes: existing loop status, runs, attempts, memory commits, and previously stored `loopStates`.

- [x] **Step 1: Write failing status projection assertions**

Assert that completed runs produce `LoopRunRecordStatus: "completed"`, failed runs produce `"failed"`, active Codex runs preserve `"running"`, `"waiting_for_human"`, and `"repairing"`, and the loop state tracks `runCount`, `running`, `lastRunAt`, and `consecutiveFailures`.

- [x] **Step 2: Run focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts store.test.ts -t "canonical loop operational state|canonical status"`

Expected: FAIL until `loopStates` and `status.json` use engine-aligned fields.

- [x] **Step 3: Implement status projection**

Derive `loopStates` during store normalization and render the same object through `status.json`. Preserve for-Codex `RunStatus`, and project loop run records into the engine's wider run status vocabulary.

- [x] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- store.test.ts service.test.ts -t "canonical loop operational state|derives canonical loop operational state|renders loop directory files|projects canonical status"`

Expected: PASS.

- [x] **Step 5: Enforce claim-run behavior on Codex entry**

Make `start_codex_session` reject a paused loop or any loop that already has a non-terminal active run, matching `dittos-loop`'s `claimRun` no-overlap rule while keeping Codex as the execution runtime.

### Task 3: Evolution Records

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`

**Interfaces:**
- Produces: `evolution/revisions.json` with active revision, proposal records, promotion/rejection decisions, and `evolution/memory-commits.json` with durable memory history.
- Consumes: existing workflow revisions and memory commits.

- [x] **Step 1: Write failing evolution assertions**

Assert that proposed/promoted workflow revisions and memory commits appear under `evolution/`.

- [x] **Step 2: Run focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "workflow revisions"`

Expected: FAIL for missing evolution files.

- [x] **Step 3: Implement evolution projection**

Serialize immutable revision records and memory commits in chronological order.

- [x] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts`

Expected: PASS.

### Task 4: Verification

**Files:**
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

- [x] **Step 1: Run MCP tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test`

Expected: PASS.

- [x] **Step 2: Run build**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp run build`

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run: `git diff --stat && git diff --check`

Expected: Only canonical loop package files and tests changed; no whitespace errors.

### Task 5: Engine Parity Work

**Status:** In progress after the initial canonical package commits.

- [x] Persist memory as a first-class append-only loop surface shaped like `<loopId>.md`, while keeping `evolution/memory-commits.json` as a history projection.
- [ ] Add explicit pause/resume controls that update `paused`, `pausedReason`, and `consecutiveFailures` like the engine API.
- [ ] Add threshold-driven pausing for repeated failed Codex runs, budget stops, and escalation stops.
- [ ] Split run history more cleanly from detailed run event timelines, matching the engine's `LoopRunStore` plus per-run event stream distinction.
