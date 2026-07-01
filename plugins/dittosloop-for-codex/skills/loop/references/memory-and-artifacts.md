# Memory and Artifacts

Read this when a loop needs durable context, durable lessons, or references to files and URLs.

## Reading Memory

Use the injected bounded memory excerpt first.

When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.

Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.

## Committing Memory

After verifier results are visible and before the final user-facing reply, the top-level visible Codex session must run a memory sweep.

Check whether the run produced durable context worth keeping, including:

- 新增长期监控对象。
- 候选账号/来源种子。
- 稳定关键词。
- 平台访问限制和可用入口经验。
- `confirmed` 升级/降级规则。
- 用户纠正过的输出偏好。
- 反复出现的噪声模式。
- Durable lessons, boundaries, repair rules, or workflow insights.

If any durable candidate exists, call `commit_memory`. If none exists, internally treat the sweep as `no durable memory`.

When memory is written, the final user-facing reply must mention that memory was written and summarize the memory's category or purpose in one sentence. This is an execution note, not a replacement for the workflow result.

Do not let lower-level workflow tasks decide long-term memory ownership by themselves; they should surface observations in their task results.

## Artifacts

Use `add_artifact` for useful local files, preview URLs, reports, or outputs.

Artifact references should help the user or a future run inspect what was produced without treating the preview as source-of-truth state.
