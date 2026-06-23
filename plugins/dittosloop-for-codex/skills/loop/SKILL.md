---
name: loop
description: Use when the user asks Codex to create, run, inspect, verify, repair, or preview a Dittos loop using DittosLoop For Codex.
---

# DittosLoop For Codex

## Overview

DittosLoop turns delegated Codex work into a visible local loop: a contract, runs, events, verification, human requests, memory, artifacts, and a browser preview.

The runtime state is the source of truth. The preview only displays what the local MCP runtime records.

## When to Use

Use this when the user asks to:

- Turn recurring or delegated work into a loop
- Start or inspect a loop run
- Record run progress, verification, memory, or artifacts
- Ask the user for a decision inside an active run
- Open the DittosLoop preview

Do not use this for hidden background automation. In this MVP, loop work should be visible, explicit, and user-inspectable.

## Workflow

1. Shape the loop contract: title, intent, manual trigger, and verification checks.
2. Use `create_loop` for a new contract, or `list_loops` before reusing an existing one.
3. Use `trigger_run` before doing run-specific work.
4. Use `start_attempt` before doing substantive loop work.
5. Use `append_event` for meaningful progress notes.
6. Use `complete_attempt` when an attempt completes or fails.
7. Use `record_verification` after running checks or manual review; include `attemptId` when the result belongs to a specific attempt.
8. If verification fails and repair work is needed, set `repair: true` on `record_verification` or call `mark_run_repairing`.
9. Use `record_human_request` when a decision is needed before continuing.
10. Use `resolve_human_request` once the user answers a recorded request.
11. Use `commit_memory` for durable lessons or preferences.
12. Use `add_artifact` for useful local files, preview URLs, reports, or outputs.
13. Use `complete_run` only after verification is recorded or the blocker is explicit.
14. Use `get_run_detail` when the user wants to inspect a single run in detail.
15. Use `get_preview_url` and open that URL in Codex's in-app browser when the user wants the visual loop view.

## Tool Map

| Need | Tool |
| --- | --- |
| New loop contract | `create_loop` |
| Existing loops | `list_loops` |
| Start a visible run | `trigger_run` |
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

## Contract Shape

Keep the first contract small and actionable:

```text
Title: short responsibility name
Intent: why this loop exists
Trigger: manual for the MVP
Verification checks: commands, review steps, or observable outcomes
```

If the user gives a vague request, propose one compact contract and ask only for missing safety-critical details.

## Common Mistakes

- Creating a loop without verification checks
- Completing a run before recording what was verified
- Recording verification without `attemptId` when an attempt produced the result
- Treating the preview as editable state
- Adding hidden recurrence or hooks in the MVP
- Asking for user input without recording the open request
- Continuing after the user answers without calling `resolve_human_request`
