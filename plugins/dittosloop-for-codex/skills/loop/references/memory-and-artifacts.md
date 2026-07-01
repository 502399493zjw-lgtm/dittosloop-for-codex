# Memory and Artifacts

Read this when a loop needs durable context, durable lessons, or references to files and URLs.

## Reading Memory

Use the injected bounded memory excerpt first.

When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.

Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.

## Committing Memory

After verifier results are visible, the top-level visible Codex session decides whether there is a durable lesson, preference, boundary, repair rule, or workflow insight worth keeping.

If yes, call `commit_memory`.

When memory is written, the final user-facing reply must mention that memory was written and summarize the memory's category or purpose in one sentence. This is an execution note, not a replacement for the workflow result.

Do not let lower-level workflow tasks decide long-term memory ownership by themselves; they should surface observations in their task results.

## Artifacts

Use `add_artifact` for useful local files, preview URLs, reports, or outputs.

Artifact references should help the user or a future run inspect what was produced without treating the preview as source-of-truth state.
