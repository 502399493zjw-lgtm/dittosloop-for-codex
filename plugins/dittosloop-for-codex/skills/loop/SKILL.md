---
name: loop
description: 当用户要求 Codex 使用 DittosLoop For Codex 创建、运行、检查、验证、修复或预览 Dittos loop 时使用。
---

# DittosLoop For Codex

## 概览

DittosLoop 会把委托给 Codex 的工作变成一个可见的本地 loop：合同、运行记录、事件、验证、人工请求、记忆、产物和浏览器预览。

运行时状态是事实来源。预览界面只展示本地 MCP 运行时记录的内容，不是可编辑状态。

结构化 loop 统一使用正式合同：`workflowKind: "runtime_script"` 加 JavaScript 字符串 `script`，并配套 verification criteria、validators、decision policy、repair policy、stop policy，以及可选的 Codex 项目绑定。

当用户说 dynamic workflow script、script-style workflow 或“动态 workflow 的 script”时，按 runtime script workflow 处理。

## 何时使用

当用户要求以下事项时使用：

- 把重复性或委托型工作变成 loop。
- 创建 loop 合同。
- 启动或检查 loop run。
- 记录 run 进度、验证、记忆或产物。
- 在活跃 run 中向用户请求决策。
- 修复或修订活跃 workflow。
- 打开 DittosLoop 预览界面。

不要把它用于隐藏后台自动化。在当前 MVP 中，loop 工作必须可见、明确、可由用户检查。

## 创建前交互门

创建 loop 前，必须先给用户一个可读方案，而不是直接调用工具。

最小顺序：

1. 展示 `Loop Draft`：目标、边界、触发方式、触发条件、脚本编排方式、脚本职责、输出、需要用户确认的点。
2. 当验证标准重要时，再展示 `Rubric Draft`。
3. 对模糊、高影响或涉及外部平台、登录态、成本、频率、自动触发或副作用的 loop，等待用户确认或纠正后才创建合同。
4. 只有明显低风险且细节可安全推断的 loop，才可以说明默认值后继续创建。

`Loop Draft` 必须显式列出触发合同：手动触发、定时触发、事件触发或只创建不自动运行；涉及定时/重复运行时要列出频率、时区、停止条件和是否需要每次人工确认。不要把“以后再说”默认为手动或定时，除非你把默认值写出来并得到用户接受。

不得只给 Rubric Draft。Rubric Draft 不是 Loop Draft 的替代品。

## 核心不变量

- 创建 loop 使用 `create_loop_contract`，但必须先通过创建前交互门。
- Dynamic workflow script 使用 `workflowKind: "runtime_script"` 加字符串 `script`。
- 用户可见正式 run 使用 `start_codex_session` 启动。
- 正式 workflow 执行前必须已绑定真实的宿主 Codex thread；只有 `launchRequest` 或 requested 状态不够。
- 绑定完成后，只有承载该 run 的可见 worker thread 才能推进 workflow 和回写 task 结果；触发它的源会话只负责启动、绑定、查看状态和向用户报告。
- 如果当前会话不是已绑定的 worker thread，不要代替 worker 调用 `execute_workflow_attempt`、执行搜索/写报告或 `record_session_result` 填充 task。唯一例外是用户明确要求当前会话做故障恢复；此时必须先说明这是 manual recovery，并写入事件记录。
- Runtime script 需要审批时，先检查 active script，再调用 `approve_runtime_script`。
- 除非 blocker 明确，否则完成 run 前必须先记录验证。
- 活跃 run 中的用户决策要先用 `record_human_request` 记录，再向用户询问，并用 `resolve_human_request` 关闭。
- 预览界面仅用于展示；不要把它当成可编辑状态。
- task session 结果回写要使用精确定位符，并在可用时使用 `idempotencyKey`。
- 当前 task session 仅支持省略 `sessionPolicy` 或 `sessionPolicy: "new"`。
- 如果 workflow 工具返回 `sessionResult`，最终回复必须把 `sessionResult.result` 或 `sessionResult.finalAnswer` 作为主答案直接给用户；verification 说明、artifacts 和文件链接只能附后，不得用摘要、报告位置或链接替代验证后的 workflow result。
- Workflow result 是唯一对外答案源。Chat/session 最终回复只能透传或引用验证后的 `sessionResult.result`、`sessionResult.finalAnswer` 或已完成 run 的 `result`，不得重新改写、压缩或拼接一份平行答案；执行说明、verification 和 artifacts 必须单独附后。

## 偏好捕获

当用户针对 DittosLoop 的输出、循环行为、报告格式、验证方式、产物形态或交互流程给出纠正性反馈时：

1. 先将反馈应用到当前回答或当前活跃 loop 结果中。
2. 判断反馈对象：如果反馈影响当前业务 loop 的后续执行，走 workflow revision、verification 更新或 loop memory；如果反馈影响本 skill 的通用规则，不要写入某个业务 loop memory，应把它作为 skill 文档修订处理。
3. 如果该反馈看起来有助于改善当前 loop，用中文简短追问：“这个反馈要沉淀下来，用来改善整个 loop 吗？”
4. 用户明确同意后，再判断反馈应落到当前 workflow、任务输出要求、verification criteria/validators/decision policy、运行记录，还是长期记忆。
5. 如果反馈会影响当前 loop 之后的执行方式，应通过 workflow revision 更新当前 loop；如果反馈会影响验收标准，应更新 verification criteria/validators/decision policy。
6. 只有当反馈是可复用经验或偏好、且不需要改变当前 loop 结构时，才调用 `commit_memory`。
7. 不要存储密钥、临时 run ID、内部 attempt ID 或不必要的用户内容。
8. 如果用户表示反馈只是一次性的，只应用到当前输出，不沉淀。

## 路由

只读取当前请求需要的参考文件。

| 需求 | 读取 |
| --- | --- |
| 创建 loop 合同 | [references/create-loop.md](references/create-loop.md) |
| 定义或修订验收 rubric、criteria、validators、decision policy | [references/define-rubric.md](references/define-rubric.md) |
| 运行已有正式 loop | [references/execute-loop.md](references/execute-loop.md) |
| 回写、恢复或挂起 Codex task 结果 | [references/execute-loop.md](references/execute-loop.md)、[references/tool-reference.md](references/tool-reference.md) |
| 处理验证失败、修复或 workflow 修订 | [references/iterate-loop.md](references/iterate-loop.md) |
| 检查 run、snapshot 或 preview | [references/inspect-loop.md](references/inspect-loop.md) |
| 读取持久记忆或记录产物 | [references/memory-and-artifacts.md](references/memory-and-artifacts.md) |
| 在 run 中询问或解决用户决策 | [references/human-requests.md](references/human-requests.md) |
| 需要精确工具用途、字段或注意事项 | [references/tool-reference.md](references/tool-reference.md) |

## 常见错误

- 创建 loop 前只展示 `Rubric Draft`，没有展示 `Loop Draft` 或等待必要确认。
- 对外部平台监控、社媒采集、登录态、频率、成本、关键词歧义等场景做静默默认。
- 创建 runtime script 后，在审批前直接执行。
- 绕过 `start_codex_session` 启动用户可见 run；应使用 `start_codex_session`，绑定真实 Codex thread，再使用 `execute_workflow_attempt`。
- 创建了新的可见 Codex thread 后，源会话继续替 worker 搜索、整理报告或回写 task，导致“触发了新会话但还是源会话在整”。
- 在只有 launch request、没有真实 `threadId` 或 `threadUrl` 时执行正式 workflow。
- 在记录验证之前完成 run。
- 记录 session 或 verification 结果时缺少可用的精确 `attemptId`、`workflowContextId`、`taskRunId`、`sessionId`、`stepId` 或 `idempotencyKey`。
- 把 workflow task、session transcript 或手工摘要当成最终 chat 答案，导致 preview、history 和 chat 展示的结果层级不一致。
- 把 verifier 或 repair 写进 worker 主流程，而不是保留在外层验证或修复策略中。
- 在活跃 run 中询问用户输入时，没有先记录打开的 request。
