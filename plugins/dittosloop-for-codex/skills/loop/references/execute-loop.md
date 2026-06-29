# Execute Loop

Read this when running an existing loop or writing back task results from a visible workflow attempt.

## Visible Execution Flow

1. Use `list_loops` before reusing an existing loop.
2. Use `start_codex_session` to create the visible run, attempt, host Codex thread request, workflow context, and bounded memory excerpt.
3. If the host has not already created a visible Codex thread, use the returned `launchRequest.prompt` to create one through Codex's thread tool, then immediately call `record_codex_thread` with the new `threadId` and `threadUrl` (`codex://thread/{threadId}`).
4. Do not treat a workflow `sessionId` as a visible Codex thread. A `sessionId` only identifies a pending task session inside the loop runtime.
5. When the workflow uses `agentProfiles`, expect `start_codex_session` to run a best-effort local profile preflight and record the effective profile snapshot on the pending or running task state.
6. Required profile skills in `requiredSkills` block `start_codex_session` when they are missing or unknown unless the request explicitly sets `allowDegradedProfiles: true`.
7. Advisory profile skill failures may warn, but they do not block launch.
8. Use the injected memory excerpt first. When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.
9. From that Codex session, use `execute_workflow_attempt` with the returned `runId` and `attemptId` to advance the local workflow scheduler in the same context. For graph-backed runs, this is a scheduler tick over durable node state, not a replay of completed work.
10. Do not create new compatibility runs. Old compatibility runs may still appear in preview state, but new user-visible runs should start with a Codex thread request.
11. A local workflow may complete before the host thread is attached; keep using `open_codex_session` and `record_codex_thread` to recover the missing thread instead of treating the workflow `sessionId` as a real Codex `threadId`.
12. Use `start_attempt` only for substantive manual follow-up work outside the normal workflow attempt.
13. Use `append_event` for meaningful progress notes.
14. Use `complete_attempt` when a manual attempt completes or fails.
15. Use `record_verification` after running checks or manual review; include `attemptId` when the result belongs to a specific attempt.
16. When a runtime script loop needs dynamic workflow validation, prefer a separate verifier sub-agent so the JavaScript-driven worker result is reviewed by an independent visible session.
17. Use `complete_run` only after verification is recorded or the blocker is explicit.

## Task Result Writeback

When a Codex task session finishes outside the immediate engine call, use `record_session_result` to write back the exact task result.

Include:

- `workflowContextId`
- `attemptId`
- `taskRunId`, `sessionId`, or `stepId`
- `idempotencyKey`

When multiple locators are provided, they must identify the same task run.

Use `needs_human` when the task must suspend for a user decision. `needs_human` suspends the exact task and opens a linked human request when possible.

When a task result is recorded, the runtime updates the targeted node run and may continue newly runnable workflow nodes. For graph-backed runs, inspect the task board through run detail or preview `workflowView`; lifecycle events are audit/history entries and legacy fallback, not the source of task-board truth.

Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.

The generated `skill/dittosloop-for-codex-loop.md` guide is runtime output for that loop session. Do not describe it as an installed skill.
