# Canonical Loop Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align DittosLoop For Codex loop files and durable loop status with the canonical Dittos Loop model while keeping Codex App as the bound execution runtime.

**Architecture:** Keep `start_codex_session` as the only visible launch path. Treat Codex sessions as run execution surfaces, while loop status, run history, memory, and workflow evolution are projected as durable loop-owned package files.

**Tech Stack:** TypeScript ES2022, NodeNext modules, Vitest, JSON-backed local state, MCP SDK, vanilla preview UI.

## Global Constraints

- Do not reintroduce `start_loop_run` or `resume_loop_run`.
- Keep Codex App binding; do not add a second runtime dependency.
- Keep existing state readable.
- Preserve session-first workflow behavior and existing MCP tools.
- Add tests before production behavior changes.

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

- [ ] **Step 1: Write failing service tests**

Add expectations to the loop file test proving the file list includes canonical status, runs, workflow, evolution, and Codex session paths.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "renders loop directory files"`

Expected: FAIL because the new canonical paths are missing.

- [ ] **Step 3: Implement canonical file rendering**

Add pure helpers in `workspaceFiles.ts` that derive lifecycle, active run, run history, memory commits, and workflow revision projections from state.

- [ ] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "renders loop directory files"`

Expected: PASS.

### Task 2: Status Semantics

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`

**Interfaces:**
- Produces: canonical `LoopState.lifecycle`, `activeRunStatus`, `runIndex`, `lastRunId`, `lastRunAt`, `lastOutcome`, `consecutiveFailedRuns`, and `memoryRevision` in `status.json`.
- Consumes: existing loop status, runs, attempts, and memory commits.

- [ ] **Step 1: Write failing status projection assertions**

Assert that completed runs produce `lastOutcome: "succeeded"` and failed runs produce `lastOutcome: "failed"` in `status.json`.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "canonical status"`

Expected: FAIL until `status.json` exists and maps statuses.

- [ ] **Step 3: Implement status projection**

Map for-Codex statuses to canonical status without changing the existing stored `RunStatus` union in this task.

- [ ] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "canonical status|renders loop directory files"`

Expected: PASS.

### Task 3: Evolution Records

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`

**Interfaces:**
- Produces: `evolution/revisions.json` with active revision, proposal records, promotion/rejection decisions, and `evolution/memory-commits.json` with durable memory history.
- Consumes: existing workflow revisions and memory commits.

- [ ] **Step 1: Write failing evolution assertions**

Assert that proposed/promoted workflow revisions and memory commits appear under `evolution/`.

- [ ] **Step 2: Run focused test and verify failure**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "workflow revisions"`

Expected: FAIL for missing evolution files.

- [ ] **Step 3: Implement evolution projection**

Serialize immutable revision records and memory commits in chronological order.

- [ ] **Step 4: Run focused tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts`

Expected: PASS.

### Task 4: Verification

**Files:**
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

- [ ] **Step 1: Run MCP tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test`

Expected: PASS.

- [ ] **Step 2: Run build**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: Inspect diff**

Run: `git diff --stat && git diff --check`

Expected: Only canonical loop package files and tests changed; no whitespace errors.
