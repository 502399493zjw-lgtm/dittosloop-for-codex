# 检查 Loop

当用户想检查 loop state、run history、单个 run 或浏览器预览时，阅读此文件。

## Runtime State

- 当用户想检查单个 run 详情时，使用 `get_run_detail`。
- 当用户想查看完整 runtime state 时，使用 `get_snapshot`。
- 当用户想看可视 loop 视图时，使用 `get_preview_url`。

对 graph-backed runs，把 run detail 或 preview state 中的 `workflowView` 当作 task-board read model。它来自持久 graph 和 node-run state。

Events 和 timeline entries 是审计与历史展示。存在 `workflowView` 时，不要用它们重建 graph task state。

当用户要求可视 loop 视图时，在 Codex 的 in-app browser 或右侧 preview surface 打开 preview URL。

Preview 展示 runtime state。它不是事实来源，也不应被当成可编辑状态。
