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
2. For a formal contract, choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop. New loops should be formal runtime contracts, even when the workflow is compact.
4. Use `list_loops` before reusing an existing loop.
5. Use `start_loop_run` for formal engine-backed contracts when the run should execute in the local workflow runtime.
6. Use `start_codex_session` when the user should open or inspect a visible Codex worker session; this records a host-mediated session request.
7. Do not create new compatibility runs. Old compatibility runs may still appear in preview state, but new user-visible runs should be associated with a Codex session request.
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
| New formal runtime contract | `create_loop_contract` |
| Existing loops | `list_loops` |
| Start a formal engine-backed run | `start_loop_run` |
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

Keep the first formal contract small and actionable:

```text
Title: short responsibility name
Goal: what the loop is responsible for
Body: ordered phase, agent, and parallel steps
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
| `Pipeline` | Work has natural dependencies or ordered stages | Sequential `phase` or `agent` steps, each consuming the prior output |
| `Fan-out/Fan-in` | Work can be split by source, module, object, or domain | A planning or setup step, a `parallel` step with named specialist agents, then a merge/synthesis agent |
| `Multi-perspective Vote` | The loop needs judgment, tradeoff analysis, risk review, or subjective quality calls | Multiple independent perspective agents, then an arbiter/judge agent that compares, weighs, or votes |
| `Single Expert` | The task is small, low-risk, and does not benefit from decomposition | One agent step; only use this when the compact shape is intentional |

When the request involves monitoring, reports, research, audits, multiple sources, multiple files, or competing judgments, do not collapse it into `Single Expert` without explaining why. Prefer `Fan-out/Fan-in` for separable evidence gathering and `Multi-perspective Vote` for judgment-heavy review.

The final response after creating a formal loop should state the selected workflow style, the agent names and responsibilities, the verifier rubrics, and the repair/stop policy.

If the user gives a vague request, propose one compact contract and ask only for missing safety-critical details.

## Common Mistakes

- Creating a loop without verification checks
- Treating verifier/repair as a workflow style instead of the outer validation layer
- Collapsing multi-source, multi-module, or judgment-heavy formal loops into one generic worker agent
- Completing a run before recording what was verified
- Recording verification without `attemptId` when an attempt produced the result
- Treating the preview as editable state
- Adding hidden recurrence or hooks in the MVP
- Asking for user input without recording the open request
- Continuing after the user answers without calling `resolve_human_request`
