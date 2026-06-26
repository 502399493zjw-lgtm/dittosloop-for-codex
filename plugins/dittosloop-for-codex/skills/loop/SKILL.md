---
name: loop
description: Use when the user asks Codex to create, run, inspect, verify, repair, or preview a Dittos loop using DittosLoop For Codex.
---

# DittosLoop For Codex

## Overview

DittosLoop turns delegated Codex work into a visible local loop: a contract, runs, events, verification, human requests, memory, artifacts, and a browser preview.

The runtime state is the source of truth. The preview only displays what the local MCP runtime records.

The plugin includes an independent formal runtime. For structured loops, use formal contracts with a workflow body, verification rubrics, repair policy, stop policy, and optional Codex project binding.

## When to Use

Use this when the user asks to:

- Turn recurring or delegated work into a loop
- Create a loop contract
- Start or inspect a loop run
- Record run progress, verification, memory, or artifacts
- Ask the user for a decision inside an active run
- Repair or revise an active workflow
- Open the DittosLoop preview

Do not use this for hidden background automation. In this MVP, loop work should be visible, explicit, and user-inspectable.

## Core Invariants

- New loops use `create_loop_contract`.
- New user-visible formal runs start with `start_codex_session`.
- Formal workflow execution uses `execute_workflow_attempt` with the returned `runId` and `attemptId`.
- Verification is recorded before completion unless the blocker is explicit.
- User decisions inside active runs are recorded with `record_human_request` and closed with `resolve_human_request`.
- The preview is display-only; do not treat it as editable state.
- Task session result writeback uses precise locators and an `idempotencyKey` when available.
- Current task sessions support omitted `sessionPolicy` or `sessionPolicy: "new"` only.

## Routing

Read only the reference files needed for the current user request.

| Need | Read |
| --- | --- |
| Choose a workflow shape for a new or revised loop | [references/choose-workflow.md](references/choose-workflow.md) |
| Create a new loop contract | [references/choose-workflow.md](references/choose-workflow.md), [references/create-loop.md](references/create-loop.md) |
| Run an existing formal loop | [references/execute-loop.md](references/execute-loop.md) |
| Write back, resume, or suspend a Codex task result | [references/execute-loop.md](references/execute-loop.md), [references/tool-reference.md](references/tool-reference.md) |
| Handle failed verification, repair, or workflow revision | [references/iterate-loop.md](references/iterate-loop.md) |
| Inspect a run, snapshot, or preview | [references/inspect-loop.md](references/inspect-loop.md) |
| Read durable memory or record artifacts | [references/memory-and-artifacts.md](references/memory-and-artifacts.md) |
| Ask or resolve a user decision inside a run | [references/human-requests.md](references/human-requests.md) |
| Need exact tool purpose, fields, or caveats | [references/tool-reference.md](references/tool-reference.md) |

## Common Mistakes

- Starting a new visible run through a direct engine-only path; use `start_codex_session` then `execute_workflow_attempt`.
- Completing a run before recording what was verified.
- Using `reuse-run` or `reuse-step`; current workflow task sessions only support new sessions.
- Recording session or verification results without precise `attemptId`, `workflowContextId`, `taskRunId`, `sessionId`, `stepId`, or `idempotencyKey` when available.
- Treating verifier or repair behavior as the workflow style instead of the outer validation layer.
- Asking for user input inside an active run without recording the open request.
