---
name: loop
description: Use when the user asks Codex to create, run, inspect, verify, repair, or preview a Dittos loop using DittosLoop For Codex.
---

# DittosLoop For Codex

## Overview

DittosLoop turns delegated Codex work into a visible local loop: a contract, runs, events, verification, human requests, memory, artifacts, and a browser preview.

The runtime state is the source of truth. The preview only displays what the local MCP runtime records.

The plugin includes an independent formal runtime. For structured loops, use formal contracts with a workflow body, verification rubrics, repair policy, stop policy, and optional Codex project binding. The visible entry is a Codex session: create the run/session first, then call the local workflow engine from inside that session so run, attempt, workflow context, task runs, and result writeback stay on one path.

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
2. For a formal contract, choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop. New loops should be formal runtime contracts, even when the workflow is compact. Prefer `task` steps with `runtime: "codex"`; old `agent` steps are compatibility aliases. Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
4. Use `list_loops` before reusing an existing loop.
5. Use `start_codex_session` to create the visible run, attempt, Codex session request, workflow context, and bounded memory excerpt.
6. Use the injected memory excerpt first. When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.
7. From that Codex session, use `execute_workflow_attempt` with the returned `runId` and `attemptId` to run the local workflow engine in the same context.
8. When a Codex task session finishes outside the immediate engine call, use `record_session_result` with `workflowContextId`, `attemptId`, `taskRunId` or `sessionId` or `stepId`, and an `idempotencyKey` to write back the exact task result. When multiple locators are provided, they must identify the same task run. `needs_human` suspends the exact task and opens a linked human request when possible.
9. Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.
10. When a task needs a local Codex specialist, put the desired `subagent` role/model/tools/permissions on the task. DittosLoop records and passes these hints to the Codex host bridge; it does not enforce tool allowlists itself.
11. When the active Codex session discovers that the workflow should change, use the workflow revision tools from that same visible session with the current `runId` and `attemptId`: propose a revision, list drafts, then promote or reject it explicitly.
12. Do not create new compatibility runs. Old compatibility runs may still appear in preview state, but new user-visible runs should start with a Codex session request.
13. Use `start_attempt` only for substantive manual follow-up work outside the normal workflow attempt.
14. Use `append_event` for meaningful progress notes.
15. Use `complete_attempt` when a manual attempt completes or fails.
16. Use `record_verification` after running checks or manual review; include `attemptId` when the result belongs to a specific attempt.
17. If verification fails and repair work is needed, set `repair: true` on `record_verification` or call `mark_run_repairing`.
18. Use `record_human_request` when a decision is needed before continuing.
19. Use `resolve_human_request` once the user answers a recorded request; if the request is linked to a workflow task, this also writes the answer back and resumes the workflow.
20. After verifier results are visible, the top-level visible Codex session decides whether there is a durable lesson, preference, boundary, repair rule, or workflow insight worth keeping. If yes, call `commit_memory`.
21. Use `add_artifact` for useful local files, preview URLs, reports, or outputs.
22. Use `complete_run` only after verification is recorded or the blocker is explicit.
23. Use `get_run_detail` when the user wants to inspect a single run in detail.
24. Use `get_preview_url` and open that URL in Codex's in-app browser when the user wants the visual loop view.

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

## Contract Shape

Keep the first formal contract small and actionable:

```text
Title: short responsibility name
Goal: what the loop is responsible for
Body: ordered phase, task(runtime: codex), compatibility agent, and parallel steps
Session policy: omit it or use sessionPolicy: "new"; reuse-run/reuse-step are not supported yet
Subagent: optional role/model/tools/permissions hints for Codex task sessions
Verification rubrics: must/should checks
Repair policy: whether failed verification should retry, ask the user, or fail
Stop policy: when the loop should stop
Project binding: optional Codex project id, label, and path
```

## Workflow Style Selection

Workflow style describes how the loop produces the candidate result. Verification is a separate outer layer: every formal loop should still define rubrics, repair policy, and stop policy.

Choose one style before building `body.steps`, then make the chosen style visible in the step labels and final summary.

| Style | Use when | Body shape |
| --- | --- | --- |
| `Pipeline` | Work has natural dependencies or ordered stages | Sequential `phase` or `task(runtime: codex)` steps, each consuming the prior output |
| `Fan-out/Fan-in` | Work can be split by source, module, object, or domain | A planning or setup task, a `parallel` step with named specialist tasks, then a merge/synthesis task |
| `Multi-perspective Vote` | The loop needs judgment, tradeoff analysis, risk review, or subjective quality calls | Multiple independent perspective tasks, then an arbiter/judge task that compares, weighs, or votes |
| `Single Expert` | The task is small, low-risk, and does not benefit from decomposition | One `task(runtime: codex)` step; only use this when the compact shape is intentional |

When the request involves monitoring, reports, research, audits, multiple sources, multiple files, or competing judgments, do not collapse it into `Single Expert` without explaining why. Prefer `Fan-out/Fan-in` for separable evidence gathering and `Multi-perspective Vote` for judgment-heavy review.

The final response after creating a formal loop should state the selected workflow style, the task names and responsibilities, the verifier rubrics, and the repair/stop policy.

If the user gives a vague request, propose one compact contract and ask only for missing safety-critical details.

## Common Mistakes

- Creating a loop without verification checks
- Starting a new visible run through a direct engine-only path; use `start_codex_session` then `execute_workflow_attempt`
- Using `reuse-run` or `reuse-step`; current workflow task sessions only support new sessions
- Assuming `subagent.tools` are enforced by DittosLoop; they are recorded and passed through to the Codex host
- Treating verifier/repair as a workflow style instead of the outer validation layer
- Collapsing multi-source, multi-module, or judgment-heavy formal loops into one generic worker task
- Completing a run before recording what was verified
- Recording session or verification results without precise `attemptId`, `workflowContextId`, `taskRunId`, `sessionId`, `stepId`, or `idempotencyKey` when available
- Treating the preview as editable state
- Adding hidden recurrence or hooks in the MVP
- Asking for user input without recording the open request
- Continuing after the user answers without calling `resolve_human_request`
