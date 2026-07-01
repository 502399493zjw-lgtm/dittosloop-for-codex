# Codex Thread Binding Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent formal workflow execution unless the requested top-level Codex session has a real host thread binding.

**Architecture:** The MCP runtime still records launch intent with `start_codex_session`; Codex App host creation remains outside the MCP process. The MCP `execute_workflow_attempt` handler becomes the product boundary gate and refuses to advance unbound requested sessions.

**Tech Stack:** TypeScript, Vitest, DittosLoop MCP runtime, Codex App host thread metadata.

## Global Constraints

- Do not add loop-specific verification criteria for Codex thread binding.
- Do not synthesize fake `threadUrl` values.
- Do not expose a user-facing bypass in the MCP schema.
- Update generated `dist/index.js` after source changes.

---

### Task 1: Add MCP Boundary Coverage

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

**Interfaces:**
- Consumes: `createToolHandlers(service).execute_workflow_attempt(input)`
- Produces: failing coverage for unbound requested Codex sessions

- [x] **Step 1: Write the failing test**

Add a test that creates a formal loop, starts a Codex session, and calls `execute_workflow_attempt` before `record_codex_thread`.

- [x] **Step 2: Verify red**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts -t "rejects workflow execution before the requested Codex thread is bound"`

Expected: FAIL because the handler currently allows execution.

### Task 2: Implement the Gate

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Modify as needed: MCP E2E tests that execute workflows through the handler

**Interfaces:**
- Produces: `assertCodexThreadBoundForWorkflowExecution(run: LoopRun): void`

- [x] **Step 1: Add the helper**

The helper should return when no top-level Codex session exists, or when the session is not `mode: "new_session"`, or when `threadId` or `threadUrl` is present.

- [x] **Step 2: Call it from `execute_workflow_attempt`**

Read the run detail before executing and throw a clear recovery error when the session is unbound.

- [x] **Step 3: Update intentional execution tests**

Before calling `execute_workflow_attempt`, call `record_codex_thread` with a concrete `threadId` and `threadUrl`.

- [x] **Step 4: Verify green**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts`

Expected: PASS.

### Task 3: Update Skill Documentation

**Files:**
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/tool-reference.md`

**Interfaces:**
- Produces: user-facing execution instructions matching the runtime gate

- [x] **Step 1: Remove stale fallback language**

Replace any guidance that says a local workflow may complete before host thread binding.

- [x] **Step 2: State the new invariant**

Document that `execute_workflow_attempt` must only run after `record_codex_thread`.

### Task 4: Build And Verify

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/dist/index.js`

**Interfaces:**
- Produces: generated MCP bundle matching source

- [x] **Step 1: Build**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp run build`

Expected: exit 0 and update `dist/index.js`.

- [x] **Step 2: Run checks**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test`

Expected: exit 0.
