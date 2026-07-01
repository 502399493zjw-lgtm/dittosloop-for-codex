# 工具参考

当需要精确 MCP 工具用途、必填字段或调用注意事项时，阅读此文件。

## 工具地图

| 需求 | 工具 |
| --- | --- |
| 新建正式 runtime contract | `create_loop_contract` |
| 查看已有 loops | `list_loops` |
| 暂停 loop | `pause_loop` |
| 恢复 loop | `resume_loop` |
| 为 loop run 请求可见 Codex thread | `start_codex_session` |
| 打开或补齐已请求的 Codex thread | `open_codex_session` |
| 审批 runtime script workflow | `approve_runtime_script` |
| 读取持久 loop memory | `read_loop_memory` |
| 在该 session 中执行 workflow | `execute_workflow_attempt` |
| 绑定已创建的 Codex thread | `record_codex_thread` |
| 精确回写 Codex task 结果 | `record_session_result` |
| 记录异步 validator 结果 | `record_validator_result` |
| 从可见 session 草拟 workflow 变更 | `propose_workflow_revision` |
| 查看 workflow 变更历史 | `list_workflow_revisions` |
| 让 workflow 草稿生效 | `promote_workflow_revision` |
| 拒绝 workflow 草稿 | `reject_workflow_revision` |
| 在 run 下开始可见工作 | `start_attempt` |
| 完成 attempt | `complete_attempt` |
| 进度记录 | `append_event` |
| 检查结果 | `record_verification` |
| 用户决策 | `record_human_request` |
| 关闭用户决策 | `resolve_human_request` |
| 持久摘要 | `commit_memory` |
| 文件或 URL 引用 | `add_artifact` |
| 修复状态 | `mark_run_repairing` |
| 完成 run | `complete_run` |
| 单个 run 详情 | `get_run_detail` |
| 完整状态 | `get_snapshot` |
| 浏览器预览 | `get_preview_url` |

## 精确注意事项

- 每个 loop 都使用 `create_loop_contract`。
- `create_loop_contract` 的 workflow 输入使用 `workflowKind: "runtime_script"` 加字符串 `script`。
- Runtime script contract input 还可以包含可选 `args` 和可选 `limits`；runtime script 默认需要审批，最终摘要中应明确说明。
- Runtime script 沙箱禁止 `Date`、`Math.random()`、`performance` 等非确定性全局对象；脚本应使用 `args.triggerTimeIso` / `args.observedTimeIso` 和 `args.runKey` / `args.dateKey`。
- Runtime 会自动注入上述观测时间参数；业务参数例如 `timezone`、`windowHours`、来源列表仍应由 loop 合同 `args` 显式传入，并由脚本 fail-fast 校验。
- 字符串 `script` 必须搭配 `workflowKind: "runtime_script"`。
- 当 runtime script 需要审批时，检查 active script 后使用 `approve_runtime_script`。
- 复用已有 loop 前使用 `list_loops`。
- 暂停或恢复已有 loop 时使用 `pause_loop` / `resume_loop`；不要使用 run-level pause/resume 名称。
- 使用 `start_codex_session` 创建可见 run、attempt、host Codex thread request、workflow context 和有界 memory excerpt。
- `start_codex_session` 返回 launch request；如果没有自动出现可见 Codex thread，用返回的 prompt 创建真实 thread，并调用 `record_codex_thread`。
- 当 thread 尚未绑定时，`open_codex_session` 可能返回 `launchRequest` 和 `recordThread`；用它们创建 Codex thread 并记录真实 `threadId`，只有 host 提供可打开 URL 时才记录 `threadUrl`。
- 不要混淆 workflow task `sessionId` 和 Codex thread ids。`sessionId` 只用于 `record_session_result` 定位。
- `execute_workflow_attempt` 要求正式 run 已绑定真实 Codex thread；只有 `launchRequest`、requested 状态或未绑定 thread 的 run 会被拒绝执行。
- 当存在 worker profile 信息时，`start_codex_session` 会记录有效 profile snapshot 并执行 best-effort 本地检查；它不提供原生 Codex skill enforcement。
- Required profile skills 状态为 missing 或 unknown 时会阻止启动，除非传入 `allowDegradedProfiles: true`。
- 使用返回的 `runId` 和 `attemptId` 调用 `execute_workflow_attempt`，让 run、attempt、workflow context、task runs 和 result writeback 保持在同一条路径。
- 使用 `record_session_result` 并带上 `workflowContextId`、`attemptId`、`taskRunId` 或 `sessionId` 或 `stepId`，以及 `idempotencyKey`，以便精确回写 Codex task 结果。
- 当提供多个定位符时，它们必须指向同一个 task run。
- `record_session_result` 上的 `needs_human` 会挂起精确 task，并在可能时打开关联 human request。
- 检查或人工 review 后使用 `record_verification`；当结果属于特定 attempt 时带上 `attemptId`。
- 异步 rubric-agent validator 或外部 validator 完成后使用 `record_validator_result` 回写结果。
- 对 runtime dynamic workflow validation，如果独立审查重要，优先使用 rubric-agent verifier 子 agent，并把它记录成可见 verifier outcome。
- 当验证失败需要修复工作时，在 `record_verification` 上设置 `repair: true`，或调用 `mark_run_repairing`。
- 只有在验证已记录或 blocker 明确时，才使用 `complete_run`。
- 当用户想看可视 loop 视图时，使用 `get_preview_url`，并在 Codex 的 in-app browser 中打开该 URL。
