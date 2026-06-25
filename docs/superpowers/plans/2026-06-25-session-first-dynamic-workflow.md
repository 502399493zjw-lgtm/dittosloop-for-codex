# Session-First Dynamic Workflow Implementation Plan

> Required implementation style: use test-first changes for behavior, keep edits inside `dittosloop-for-codex`, and preserve existing local state compatibility.

**Goal:** Finish the session-first redesign so `start_codex_session` is the visible entry point, workflow execution happens inside that Codex session, and dynamic workflow behavior matches the local Claude Code dynamic workflow standard.

## Global Constraints

- Do not expose `start_loop_run` through MCP.
- Do not expose `resume_loop_run` through MCP.
- Remove `startLoopRun` as a product-level service path; tests should create visible session runs or call lower-level setup helpers.
- Remove `resumeLoopRun`; continuation should happen by targeted session result writeback or repeated workflow execution inside the existing run.
- Preserve legacy state reads.
- Keep `agent` accepted as a compatibility alias, but prefer `task` with `runtime: "codex"` in new docs and tests.
- Avoid duplicate Codex task launches during resumed execution.

## Task 1: Lock The Missing Behavior With Tests

- [x] Add service tests for a two-step Codex workflow:
  - `start_codex_session`
  - `execute_workflow_attempt`
  - first task suspends
  - `record_session_result` for first task completes only that task
  - workflow automatically resumes to the second task
  - first task is not relaunched
  - final result completes the run
- [x] Add a service restart resume test proving persisted workflow context can continue after a new service instance reads local state.
- [x] Add a parallel fan-in resume test where completed children are cached and existing pending children are not relaunched.
- [x] Add contract validation tests for `task.subagent`.
- [x] Add MCP tests for revision tools.
- [x] Add preview tests for workflow context and revision visibility.
- [x] Update or remove tests that call `service.startLoopRun`.

## Task 2: Add Resumable Engine Cache

- [x] Add completed-step output cache to the runner/engine dependency surface.
- [x] Have `runFlow` return cached output for completed `agent` or `task` step ids.
- [x] Ensure cached steps do not call the Codex executor.
- [x] Preserve event clarity for resumed runs.

## Task 3: Make `record_session_result` Continue Workflows

- [x] Detect targeted workflow task result by `workflowContextId`, `taskRunId`, `stepId`, or `sessionId`.
- [x] Mark only the targeted task completed for non-final results.
- [x] If remaining executable steps exist and no sibling session is already pending, resume `execute_workflow_attempt` automatically.
- [x] If no executable steps remain, record final verification and complete the run.
- [x] Keep idempotency protection for repeated writebacks.

## Task 4: Add Codex Subagent Spec

- [x] Add `CodexSubagentSpec` to contract types.
- [x] Validate `task.subagent` and legacy `agent.subagent` if present.
- [x] Include subagent details in workflow execution plan steps.
- [x] Include subagent details in Codex session bridge requests.

## Task 5: Add Workflow Revision Tools

- [x] Expose `propose_workflow_revision`, `list_workflow_revisions`, `promote_workflow_revision`, and `reject_workflow_revision`.
- [x] Store immutable revision records with status, rationale, author session, timestamps, and promoted/rejected metadata.
- [x] Promotion updates the active formal contract.
- [x] Rejection records reason without deleting the draft.

## Task 6: Remove Old Product Path

- [x] Delete `startLoopRun` from `LoopService` or reduce it to a private test-free helper.
- [x] Delete unused `startLoopRunSchema`.
- [x] Delete `resumeLoopRun`, `resume_loop_run`, and their tests/tool registration.
- [x] Update README and skill docs to describe only the session-first flow.
- [x] Mark the older 2026-06-24 runtime spec as superseded for launch semantics.

## Task 7: Preview And Verification

- [x] Show workflow contexts and task runs in preview detail.
- [x] Show pending sessions, workflow revisions, and promoted active revision in preview detail.
- [x] Cover preview API output for context cursor, task runs, pending sessions, promoted revisions, and grouped engine events.
- [x] Run MCP unit tests.
- [x] Run repository check.
- [x] Re-run `rg "start_loop_run|startLoopRun|resume_loop_run|resumeLoopRun"` and explain any remaining historical references.

## Task 8: Post-Audit Dynamic Workflow Hardening

- [x] Include `runId`, `attemptId`, `workflowContextId`, and in-session workflow callback instructions in the generated Codex session prompt.
- [x] Reject contradictory `taskRunId` / `sessionId` / `stepId` result locators before mutating workflow context.
- [x] Resolve `taskRunId`-only writeback back to the original Codex subagent session and step.
- [x] Keep `needs_human` task results suspended, not completed-cacheable.
- [x] Preserve promoted workflow revision contract snapshots as immutable proposal records while updating the active formal contract separately.
- [x] Update MCP tool description and spec text so `record_session_result` can complete, suspend, or resume the workflow.
- [x] Restrict current public `sessionPolicy` support to omitted or `"new"` and reject reuse policies at the MCP schema boundary.
- [x] Link workflow `needs_human` task results to human requests so `resolve_human_request` writes the user answer back and resumes the suspended workflow.
- [x] Persist task `subagent` specs in `WorkflowTaskRun` and show role/model/tools/permission hints in preview detail.
- [x] Pass `subagent` specs through the Codex session bridge while documenting that DittosLoop transports, but does not enforce, tool allowlists.
- [x] Use an all-settle parallel barrier so sibling Codex tasks all reach a terminal or suspended state before workflow execution returns.
- [x] Emit synthetic task/parallel completion events for resumed parallel fan-in so preview history closes open parallel blocks.
- [x] Make completed workflow contexts replay-safe: repeated `execute_workflow_attempt` calls do not relaunch tasks.
- [x] Resume suspended workflows against their stored launch snapshot even after a workflow revision is promoted.

## Task 9: Final Verification After Hardening

- [x] Run targeted service, MCP, bridge, preview, and contract tests.
- [x] Run the full MCP test suite.
- [x] Run MCP build.
- [x] Run repository check.
- [x] Re-run the removed-path search and classify remaining references.
