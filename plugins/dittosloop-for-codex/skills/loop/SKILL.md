---
name: loop
description: Use when the user asks Codex to create, run, inspect, verify, repair, or preview a Dittos loop using DittosLoop For Codex.
---

# DittosLoop For Codex

## Overview

DittosLoop turns delegated Codex work into a visible local loop: a contract, runs, events, verification, human requests, memory, artifacts, and a browser preview.

The runtime state is the source of truth. The preview only displays what the local MCP runtime records.

The plugin includes an independent formal runtime. For structured loops, use formal contracts with a workflow body, verification rubrics, repair policy, stop policy, and optional Codex project binding. The runtime executes the workflow through local engine code and records engine events; it does not import the main Dittos Loop project at runtime.

## When to Use

Use this when the user asks to:

- Turn recurring or delegated work into a loop
- Start or inspect a loop run
- Record run progress, verification, memory, or artifacts
- Ask the user for a decision inside an active run
- Open the DittosLoop preview

Do not use this for hidden background automation. In this MVP, loop work should be visible, explicit, and user-inspectable.

## Workflow

1. Shape the loop contract: title, goal or intent, manual trigger, verification expectations, and whether it needs a structured workflow body.
2. Use `create_loop_contract` when the loop needs engine-backed workflow steps, rubrics, repair policy, or stop policy.
3. Use `create_loop` only for compatibility-style manual loops with simple verification checks.
4. Use `list_loops` before reusing an existing loop.
5. Use `start_loop_run` for formal engine-backed contracts.
6. Use `trigger_run` for legacy manual runs.
7. Use `start_codex_session` when the user should open or inspect a visible Codex worker session; this records a host-mediated session request.
8. Use `start_attempt` before doing substantive manual loop work.
9. Use `append_event` for meaningful progress notes.
10. Use `complete_attempt` when an attempt completes or fails.
11. Use `record_verification` after running checks or manual review; include `attemptId` when the result belongs to a specific attempt.
12. If verification fails and repair work is needed, set `repair: true` on `record_verification` or call `mark_run_repairing`.
13. Use `record_human_request` when a decision is needed before continuing.
14. Use `resolve_human_request` once the user answers a recorded request.
15. Use `commit_memory` for durable lessons or preferences.
16. Use `add_artifact` for useful local files, preview URLs, reports, or outputs.
17. Use `complete_run` only after verification is recorded or the blocker is explicit.
18. Use `get_run_detail` when the user wants to inspect a single run in detail.
19. Use `get_preview_url` and open that URL in Codex's in-app browser when the user wants the visual loop view.

## Tool Map

| Need | Tool |
| --- | --- |
| New compatibility loop contract | `create_loop` |
| New formal runtime contract | `create_loop_contract` |
| Existing loops | `list_loops` |
| Start a formal engine-backed run | `start_loop_run` |
| Start a compatibility run | `trigger_run` |
| Request visible Codex worker session | `start_codex_session` |
| Attach created Codex thread | `record_codex_thread` |
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

For formal runtime contracts, include:

```text
Goal: what the loop is responsible for
Body: ordered phase, agent, and parallel steps
Verification rubrics: must/should checks
Repair policy: whether failed verification should retry, ask the user, or fail
Stop policy: when the loop should stop
Project binding: optional Codex project id, label, and path
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
