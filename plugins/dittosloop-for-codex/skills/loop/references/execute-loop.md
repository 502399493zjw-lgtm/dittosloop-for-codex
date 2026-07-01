# 执行 Loop

当运行已有 loop，或从可见 workflow attempt 回写 task 结果时，阅读此文件。

## 可见执行流程

1. 复用已有 loop 前，先使用 `list_loops`。
2. 使用 `start_codex_session` 创建可见 run、attempt、host Codex thread request、workflow context 和有界 memory excerpt。
3. 如果 host 没有自动创建可见 Codex thread，使用返回的 `launchRequest.prompt` 通过 Codex thread 工具创建真实 thread，然后立刻调用 `record_codex_thread`，写入真实 `threadId`；只有 host 提供可打开 URL 时才写入 `threadUrl`。
4. 不要把 workflow `sessionId` 当成可见 Codex thread。`sessionId` 只标识 loop runtime 内部的 pending task session。
5. 当 workflow 使用 worker profile 信息时，预期 `start_codex_session` 会执行 best-effort 本地检查，并把有效 profile snapshot 记录到 pending 或 running task state。
6. Required profile skills 缺失或未知会阻止 `start_codex_session`，除非请求显式设置 `allowDegradedProfiles: true`。
7. Advisory profile skill failures 可以警告，但不阻止启动。
8. 优先使用注入的 memory excerpt。当需要更持久上下文时，用 `loopId`、`limit` 和 `offset` 调用 `read_loop_memory`。
9. 只有在 `record_codex_thread` 已成功记录真实 `threadId` 或真实 `threadUrl` 后，才能在同一个 Codex session 中使用返回的 `runId` 和 `attemptId` 调用 `execute_workflow_attempt`，推进 runtime script scheduler。
10. 如果 loop contract 是 `workflow.kind = "runtime_script"` 且需要审批，先检查 active script，再调用 `approve_runtime_script`，然后执行 workflow attempt。
11. 如果无法绑定真实 Codex thread，不要执行 workflow；使用 `open_codex_session` 查看缺失信息并停止为 blocker。
12. 只有在 normal workflow attempt 外有实质性手工跟进工作时，才使用 `start_attempt`。
13. 用 `append_event` 记录有意义的进度。
14. 手工 attempt 完成或失败时使用 `complete_attempt`。
15. 运行检查或人工 review 后使用 `record_verification`；当结果属于特定 attempt 时带上 `attemptId`。
16. 当 runtime script loop 需要动态 workflow 验证时，优先使用独立 verifier 子 agent，让 JavaScript 驱动的 worker 结果由另一个可见 session 审查。
17. 只有在验证已记录或 blocker 明确时，才使用 `complete_run`。

## 验证后结果交付

当 `execute_workflow_attempt`、`record_session_result`、`record_validator_result` 或 `complete_run` 返回 `sessionResult` 时，当前可见 Codex session 的最终回复必须直接使用该 envelope。

- `sessionResult.status === "completed"` 时，把 `sessionResult.result` 或 `sessionResult.finalAnswer` 作为主答案直接输出给用户。
- `sessionResult.status === "waiting_for_human"` 时，输出打开的 `humanRequest.question` 或 `sessionResult.finalAnswer`，不要把候选结果称为最终结果。
- `sessionResult.artifacts`、文件链接和 verification 状态只能放在主答案之后。
- 不得用 summary-only、报告位置说明、文件链接或重新改写的摘要替代验证后的 workflow result。

runtime script 执行会运行 JavaScript 源码，使用 journal/cache 记录复用已完成的 `agent()` 调用，发出 runtime script events，并把 script 的最终返回值作为 workflow result。

## Task Result 回写

当 Codex task session 在 immediate engine call 之外完成时，使用 `record_session_result` 精确回写 task 结果。

包含：

- `workflowContextId`
- `attemptId`
- `taskRunId`、`sessionId` 或 `stepId`
- `idempotencyKey`

当提供多个定位符时，它们必须指向同一个 task run。

当 task 必须因为用户决策而挂起时，使用 `needs_human`。`needs_human` 会挂起精确 task，并在可能时打开关联的 human request。

记录 task result 后，runtime 会更新目标 node run，并可能继续变为 runnable 的 workflow nodes。对 graph-backed runs，应通过 run detail 或 preview 的 `workflowView` 检查 task board；lifecycle events 是审计和历史记录，不是 task-board truth 的来源。

Workflow tasks 可以在工作时调用 `read_loop_memory`。它们应该在 task results 中返回持久观察，而不是自行决定长期 memory writes。
