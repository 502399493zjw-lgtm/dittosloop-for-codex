# Execute Loop

Read this when running an existing loop or writing back task results from a visible workflow attempt.

## Visible Execution Flow

1. Use `list_loops` before reusing an existing loop.
2. Use `start_codex_session` to create the visible run, attempt, Codex session request, workflow context, and bounded memory excerpt.
3. Use the injected memory excerpt first. When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.
4. From that Codex session, use `execute_workflow_attempt` with the returned `runId` and `attemptId` to run the local workflow engine in the same context.
5. Do not create new compatibility runs. Old compatibility runs may still appear in preview state, but new user-visible runs should start with a Codex session request.
6. Use `start_attempt` only for substantive manual follow-up work outside the normal workflow attempt.
7. Use `append_event` for meaningful progress notes.
8. Use `complete_attempt` when a manual attempt completes or fails.
9. Use `record_verification` after running checks or manual review; include `attemptId` when the result belongs to a specific attempt.
10. Use `complete_run` only after verification is recorded or the blocker is explicit.

## Task Result Writeback

When a Codex task session finishes outside the immediate engine call, use `record_session_result` to write back the exact task result.

Include:

- `workflowContextId`
- `attemptId`
- `taskRunId`, `sessionId`, or `stepId`
- `idempotencyKey`

When multiple locators are provided, they must identify the same task run.

Use `needs_human` when the task must suspend for a user decision. `needs_human` suspends the exact task and opens a linked human request when possible.

Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.
