# Tool Reference

Read this when exact MCP tool purpose, required fields, or call caveats matter.

## Tool Map

| Need | Tool |
| --- | --- |
| New formal runtime contract | `create_loop_contract` |
| Existing loops | `list_loops` |
| Start visible loop session | `start_codex_session` |
| Read durable loop memory | `read_loop_memory` |
| Execute workflow in that session | `execute_workflow_attempt` |
| Attach created Codex thread | `record_codex_thread` |
| Write back exact Codex task result | `record_session_result` |
| Draft a workflow change from the visible session | `propose_workflow_revision` |
| Inspect workflow change history | `list_workflow_revisions` |
| Make a workflow draft active | `promote_workflow_revision` |
| Decline a workflow draft | `reject_workflow_revision` |
| Start visible work under a run | `start_attempt` |
| Finish an attempt | `complete_attempt` |
| Progress note | `append_event` |
| Check result | `record_verification` |
| User decision | `record_human_request` |
| Close user decision | `resolve_human_request` |
| Durable summary | `commit_memory` |
| File or URL reference | `add_artifact` |
| Repair state | `mark_run_repairing` |
| Finish run | `complete_run` |
| Single run detail | `get_run_detail` |
| Full state | `get_snapshot` |
| Browser preview | `get_preview_url` |

## Exact Caveats

- Use `create_loop_contract` for every new loop.
- Use `list_loops` before reusing an existing loop.
- Use `start_codex_session` to create the visible run, attempt, Codex session request, workflow context, and bounded memory excerpt.
- Use `execute_workflow_attempt` with the returned `runId` and `attemptId` so run, attempt, workflow context, task runs, and result writeback stay on one path.
- Use `record_session_result` with `workflowContextId`, `attemptId`, `taskRunId` or `sessionId` or `stepId`, and an `idempotencyKey` to write back exact Codex task results.
- When multiple locators are provided, they must identify the same task run.
- `needs_human` on `record_session_result` suspends the exact task and opens a linked human request when possible.
- Use `record_verification` after checks or manual review; include `attemptId` when the result belongs to a specific attempt.
- Set `repair: true` on `record_verification` or call `mark_run_repairing` when failed verification needs repair work.
- Use `complete_run` only after verification is recorded or the blocker is explicit.
- Use `get_preview_url` and open that URL in Codex's in-app browser when the user wants the visual loop view.
