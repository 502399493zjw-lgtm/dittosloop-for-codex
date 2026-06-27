# Inspect Loop

Read this when the user wants to inspect loop state, run history, a single run, or the browser preview.

## Runtime State

- Use `get_run_detail` when the user wants to inspect one run in detail.
- Use `get_snapshot` when the user wants the full runtime state.
- Use `get_preview_url` when the user wants the visual loop view.

For graph-backed runs, treat `workflowView` from run detail or preview state as the task-board read model. It is derived from durable graph and node-run state.

Events and timeline entries are audit/history surfaces and legacy fallback. Do not reconstruct graph task state from them when `workflowView` is present.

Open preview URLs in Codex's in-app browser or right-side preview surface when the user asks for the visual loop view.

The preview displays runtime state. It is not the source of truth and should not be treated as editable state.

Old compatibility runs may still appear in preview state. New user-visible runs should start with a Codex session request rather than a compatibility path.
