---
name: loop
description: Use when the user asks Codex to create, run, inspect, verify, repair, or preview a Dittos loop using DittosLoop For Codex.
---

# DittosLoop For Codex

## Overview

DittosLoop turns delegated Codex work into a visible local loop: a contract, runs, events, verification, human requests, memory, artifacts, and a browser preview.

The runtime state is the source of truth. The preview only displays what the local MCP runtime records.

The plugin includes an independent formal runtime. For structured loops, use formal contracts with either `body.steps`, legacy `script.build`, or `workflowKind: "runtime_script"` plus a JavaScript `script`, alongside verification criteria, validators, decision policy, repair policy, stop policy, and optional Codex project binding.

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

## 偏好捕获

当用户针对 DittosLoop 的输出、循环行为、报告格式、验证方式、产物形态或交互流程给出纠正性反馈时：

1. 先将反馈应用到当前回答或当前活跃的 loop 结果中。
2. 如果该反馈看起来有助于改善当前 loop，用中文简短追问一句：
   “这个反馈要沉淀下来，用来改善整个 loop 吗？”
3. 用户明确同意后，先判断反馈应该落到哪里：当前 workflow、任务输出要求、verification criteria/validators/decision policy、运行记录，还是长期记忆。
4. 如果反馈会影响当前 loop 之后的执行方式，应通过 workflow revision 更新当前 loop；如果反馈会影响验收标准，应更新 verification criteria/validators/decision policy。
5. 只有当反馈是可复用经验或偏好、但不需要改变当前 loop 结构时，才调用 `commit_memory`。
6. 不要存储密钥、临时 run ID、内部 attempt ID 或不必要的用户内容。
7. 如果用户表示该反馈只是一次性的，只应用到当前输出，不沉淀。

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
