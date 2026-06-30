# Remove Fake Codex Thread Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Codex thread URLs real host-provided metadata instead of synthesized links.

**Architecture:** Keep the existing runtime shape and change only the thread metadata boundary. `threadId` remains optional identity metadata; `threadUrl` becomes the sole signal that a visible Codex thread can be opened.

**Tech Stack:** TypeScript, Vitest, MCP runtime service, preview API.

## Global Constraints

- Work in an isolated git worktree and branch.
- Use TDD: write failing tests before implementation.
- Do not remove DittosLoop `sessionId`.
- Do not add MCP tools or change Verification v2 schemas.
- Rebuild generated `dist/index.js` after source changes.

---

### Task 1: Lock Thread URL Semantics

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

**Interfaces:**
- Consumes: `DittosLoopService.recordCodexThread(runId, input)`
- Consumes: `DittosLoopService.openCodexSession(runId)`
- Produces: assertions that only host-provided `threadUrl` makes a session openable

- [ ] **Step 1: Write the failing service test**

Change the existing test named `opens a recorded Codex thread when only the thread id is provided` so it expects:

```ts
expect(updated.codexSession?.threadId).toBe("019ef4e5-21f0-7131-be8c-708f720e49de");
expect(updated.codexSession?.threadUrl).toBeUndefined();
expect(opened).toMatchObject({
  runId: launch.run.id,
  status: "unavailable",
  threadId: "019ef4e5-21f0-7131-be8c-708f720e49de"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/service.test.ts -t "only the thread id"`

Expected: FAIL because the service currently synthesizes `codex://thread/{threadId}`.

- [ ] **Step 3: Add MCP-level coverage**

Update the `record_codex_thread` MCP content test to assert `threadUrl` is absent when omitted from input.

- [ ] **Step 4: Run targeted MCP test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts -t "codex thread writeback"`

Expected: FAIL because the tool result currently contains a synthetic URL.

### Task 2: Remove Synthetic Thread URLs

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`

**Interfaces:**
- Produces: `OpenCodexSessionResult.recordThread` without `threadUrlTemplate`
- Produces: `record_codex_thread` description that asks for a real host URL when available

- [ ] **Step 1: Implement minimal runtime change**

Remove fallback URL generation from `recordCodexThread`, `openCodexSession`, and subagent normalization. Keep `threadId` as metadata.

- [ ] **Step 2: Update writeback instruction type**

Make `threadUrlTemplate` disappear from `OpenCodexSessionResult.recordThread`.

- [ ] **Step 3: Update MCP tool description**

Mention that `threadUrl` should be passed only when the host has a real openable URL.

- [ ] **Step 4: Run targeted tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/service.test.ts test/mcpServer.test.ts`

Expected: PASS.

### Task 3: Preserve Preview Without Real Threads

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`

**Interfaces:**
- Consumes: preview APIs `/api/snapshot`, `/api/runs/:runId`, `/api/runs/:runId/open-codex-session`
- Produces: coverage that workflow and verification detail render without synthetic thread metadata

- [ ] **Step 1: Add or update preview assertion**

Ensure a run with no host thread still exposes run detail, workflow context, task runs, and verification results.

- [ ] **Step 2: Remove fake E2E thread attachment when it is not needed**

Delete fake `record_codex_thread` setup from the suspended workflow E2E path unless the case explicitly verifies an attached host URL.

- [ ] **Step 3: Run targeted tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewServer.test.ts test/e2eWorkflow.test.ts`

Expected: PASS.

### Task 4: Build And Verify

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/dist/index.js`

**Interfaces:**
- Produces: generated runtime bundle matching source

- [ ] **Step 1: Build**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp run build`

Expected: exit 0 and updated `dist/index.js`.

- [ ] **Step 2: Run project checks**

Run: `npm run check`

Expected: exit 0.

- [ ] **Step 3: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-30-remove-fake-codex-thread-links-design.md \
  docs/superpowers/plans/2026-06-30-remove-fake-codex-thread-links.md \
  plugins/dittosloop-for-codex/mcp/src/service.ts \
  plugins/dittosloop-for-codex/mcp/src/mcpServer.ts \
  plugins/dittosloop-for-codex/mcp/test/service.test.ts \
  plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts \
  plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts \
  plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts \
  plugins/dittosloop-for-codex/mcp/dist/index.js
git commit -m "fix: stop synthesizing codex thread links"
```

Expected: branch contains one reviewable commit.

