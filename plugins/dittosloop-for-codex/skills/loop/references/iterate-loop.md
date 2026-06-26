# Iterate Loop

Read this when verification fails, repair work is needed, or an active Codex session discovers that the workflow should change.

## Repair

If verification fails and repair work is needed, set `repair: true` on `record_verification` or call `mark_run_repairing`.

Keep repair, verification, and follow-up events tied to the current `runId` and `attemptId` when available.

Do not complete a run until the verifier result is visible and the repair outcome or explicit blocker is recorded.

## Workflow Revisions

When the active Codex session discovers that the workflow should change, use the workflow revision tools from that same visible session with the current `runId` and `attemptId`:

1. Use `propose_workflow_revision` to draft the change.
2. Use `list_workflow_revisions` when you need to inspect drafts or history.
3. Use `promote_workflow_revision` to make a draft active.
4. Use `reject_workflow_revision` to decline a draft explicitly.

Record why the revision is needed in the draft summary or surrounding run events. Keep the repair and revision path visible to the user.
