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
4. Use `append_event` for meaningful progress notes.
5. Use `record_verification` after running checks or manual review.
6. Use `record_human_request` when a decision is needed before continuing.
7. Use `commit_memory` for durable lessons or preferences.
8. Use `add_artifact` for useful local files, preview URLs, reports, or outputs.
9. Use `complete_run` only after verification is recorded or the blocker is explicit.
10. Use `get_preview_url` and open that URL in Codex's in-app browser when the user wants the visual loop view.

## Tool Map

| Need | Tool |
| --- | --- |
| New loop contract | `create_loop` |
| Existing loops | `list_loops` |
| Start a visible run | `trigger_run` |
| Progress note | `append_event` |
| Check result | `record_verification` |
| User decision | `record_human_request` |
| Durable summary | `commit_memory` |
| File or URL reference | `add_artifact` |
| Finish run | `complete_run` |
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
- Treating the preview as editable state
- Adding hidden recurrence or hooks in the MVP
- Asking for user input without recording the open request
