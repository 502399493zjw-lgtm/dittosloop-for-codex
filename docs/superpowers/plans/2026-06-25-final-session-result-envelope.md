# Final Session Result Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a session-facing final result envelope to workflow MCP responses so the main Codex session can answer directly after workflow completion.

**Architecture:** Keep `LoopService` as the state transition owner. Add a response helper at the MCP boundary that preserves existing top-level run fields while adding `{ run, sessionResult? }`, using `get_run_detail` to derive a concise final envelope only for terminal or waiting states.

**Tech Stack:** TypeScript, MCP SDK, Zod, Vitest.

## Global Constraints

- Preserve existing run state and workflow runtime behavior.
- Do not expose hidden background work.
- Keep implementation local-first and testable.
- Do not change Claude Code source context.
- Use TDD: write failing MCP response-shape tests before production changes.

---

### Task 1: Add Workflow Response Envelope

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`

**Interfaces:**
- Consumes: `LoopService.executeWorkflowAttempt(runId, { attemptId })`, `LoopService.recordSessionResult(runId, input)`, and `LoopService.getRunDetail(runId)`.
- Produces: MCP JSON response shape `LoopRun & { run: LoopRun, sessionResult?: WorkflowSessionResultEnvelope }` for `execute_workflow_attempt` and `record_session_result`.

- [ ] **Step 1: Write the failing final completion test**

Add expectations to the existing `exposes workflow execution and precise session result writeback as MCP content` test:

```ts
expect(run).toMatchObject({
  run: {
    id: launch.run.id,
    status: "running",
    codexSession: {
      status: "requested",
      subagents: [{ role: "Scan", status: "requested" }]
    }
  }
});
expect(run.sessionResult).toBeUndefined();

expect(completed).toMatchObject({
  run: {
    id: launch.run.id,
    status: "completed"
  },
  sessionResult: {
    status: "completed",
    finalAnswer: "Daily report body",
    summary: "Worker result passed verification",
    result: "Daily report body",
    verification: {
      status: "passed",
      summary: "Worker result passed verification"
    },
    artifacts: []
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts`

Expected: FAIL because `execute_workflow_attempt` and `record_session_result` still return a bare run object.

- [ ] **Step 3: Add the minimal MCP response helper**

In `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`, add local helper types and functions:

```ts
type WorkflowToolResponse = LoopRun & {
  run: Awaited<ReturnType<LoopService["executeWorkflowAttempt"]>>;
  sessionResult?: {
    status: "completed" | "failed" | "waiting_for_human";
    finalAnswer: string;
    summary: string;
    result?: unknown;
    verification?: {
      status: "passed" | "failed" | "skipped";
      summary: string;
      checks: Array<{ name: string; status: "passed" | "failed" | "skipped"; output?: string }>;
    };
    artifacts: Array<{ id: string; runId: string; title: string; path?: string; url?: string; kind?: string; createdAt: string }>;
    humanRequest?: { id: string; question: string };
  };
};
```

Add a `toWorkflowToolResponse(service, run)` helper that calls `service.getRunDetail(run.id)`, finds the latest completed workflow task with a result, latest verification, and latest open human request, and returns `{ run }` while the run is still `running` or `repairing`.

- [ ] **Step 4: Use the helper from workflow tools**

Change only these handlers:

```ts
execute_workflow_attempt: async (input) => {
  const args = executeWorkflowAttemptSchema.parse(input);
  const run = await service.executeWorkflowAttempt(args.runId, {
    attemptId: args.attemptId
  });
  return toToolResult(await toWorkflowToolResponse(service, run));
},
record_session_result: async (input) => {
  const args = recordSessionResultSchema.parse(input);
  const run = await service.recordSessionResult(args.runId, {
    workflowContextId: args.workflowContextId,
    attemptId: args.attemptId,
    taskRunId: args.taskRunId,
    sessionId: args.sessionId,
    stepId: args.stepId,
    idempotencyKey: args.idempotencyKey,
    status: args.status,
    pausedReason: args.pausedReason,
    summary: args.summary,
    result: args.result,
    checks: args.checks,
    humanQuestion: args.humanQuestion
  });
  return toToolResult(await toWorkflowToolResponse(service, run));
},
```

- [ ] **Step 5: Run targeted tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts e2eWorkflow.test.ts service.test.ts`

Expected: PASS.

- [ ] **Step 6: Run build**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp run build`

Expected: PASS.

- [ ] **Step 7: Commit**

Commit after tests pass:

```bash
git add docs/superpowers/specs/2026-06-25-final-session-result-envelope-design.md docs/superpowers/plans/2026-06-25-final-session-result-envelope.md plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts plugins/dittosloop-for-codex/mcp/src/mcpServer.ts
git commit -m "feat: return workflow session result envelope"
```

## Self-Review

- Spec coverage: The task covers response shape, compatibility, final answer derivation, and tests.
- Placeholder scan: No placeholder tasks or undecided fields remain.
- Type consistency: `sessionResult` fields match the spec and are built at the MCP boundary.
