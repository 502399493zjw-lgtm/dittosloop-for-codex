# DittosLoop For Codex

`DittosLoop For Codex` is a local-first Codex plugin that turns delegated work into visible Dittos loops. It bundles a skill, a local MCP runtime, JSON-backed loop state, and a browser preview for loop contracts, runs, verification, human requests, memory, and artifacts.

This repo is shaped as a GitHub-ready Codex plugin marketplace source. The first milestone is local install and local preview.

The plugin owns its own formal Live Loop runtime. It copies the main Dittos Loop engine concepts into this repo instead of importing the main Dittos Loop project at runtime. Structured contracts can define a workflow body, verification rubrics, repair policy, stop policy, and Codex project binding; engine-backed runs execute that body through the plugin's local engine and expose engine events to the preview.

## Quick Install

Add the public GitHub marketplace source:

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop` marketplace.

After installing or updating the plugin, restart Codex and start a new thread so the bundled skill and MCP runtime are loaded fresh.

## Quick Update

If you already installed the plugin from this GitHub marketplace source, refresh the marketplace:

```bash
codex plugin marketplace upgrade dittosloop
```

Then restart Codex or start a new thread. Codex may not show a separate update button for installed marketplace plugins; refreshing the marketplace source is the update path for Git-backed installs.

If you added the marketplace with a different name, replace `dittosloop` with that configured marketplace name.

## Quick Check

From the repo root:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

`npm run check` builds the MCP runtime, runs the repository validator, and runs the runtime tests.

## What It Includes

- `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`: Codex plugin manifest
- `.agents/plugins/marketplace.json`: marketplace entry for this repo
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: installed loop workflow
- `plugins/dittosloop-for-codex/mcp`: TypeScript MCP runtime
- `plugins/dittosloop-for-codex/preview`: local preview UI
- `scripts/validate-plugin.mjs`: local plugin/package validator
- `examples/state.sample.json`: preview-ready sample loop state

## Local Setup

Build and validate the runtime before installing the plugin:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

Add this repo as a Codex marketplace source:

```bash
codex plugin marketplace add "$(pwd)"
```

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop` marketplace.

After installing or reinstalling the plugin, restart Codex and start a new thread so the bundled skill and MCP tools are loaded fresh. For an existing Git-backed install, refresh the source with `codex plugin marketplace upgrade dittosloop` first.

## GitHub Setup

After cloning a shared copy of this repo:

```bash
cd dittosloop-for-codex
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
codex plugin marketplace add "$(pwd)"
```

For the public GitHub marketplace source, add the repo source instead of the local path:

```bash
codex plugin marketplace add 502399493zjw-lgtm/dittosloop-for-codex --ref main
```

The marketplace entry points to `./plugins/dittosloop-for-codex`, so the same repository shape works locally and from GitHub.

## Runtime Data

By default, local loop state is stored outside the repo:

```text
~/.codex/dittosloop-for-codex/state.json
```

You can override it when launching the MCP runtime:

```bash
DITTOSLOOP_DATA_DIR="/path/to/data" DITTOSLOOP_PREVIEW_PORT=47888 npm start
```

## Preview

The MCP runtime starts a local preview at:

```text
http://127.0.0.1:47888
```

The plugin exposes `get_preview_url` so Codex can open the same view in the in-app browser or right-side preview surface.

The preview has three compact panels: loop contracts, recent runs, and the selected run detail. Run detail shows attempts, workflow runtime state, workflow revision drafts, timeline events, verification results, human requests, memory, and artifacts from the local JSON state.

For session-first workflow runs, `/api/runs/:id` also includes `workflowContexts`, `workflowRevisions`, `engineEvents`, and a grouped `timeline` derived from runtime events. The old record fields remain in place so existing preview code and compatibility workflows keep working.

To preview the sample state without installing the plugin:

```bash
npm run build
tmpdir="$(mktemp -d)"
cp examples/state.sample.json "$tmpdir/state.json"
DITTOSLOOP_DATA_DIR="$tmpdir" DITTOSLOOP_PREVIEW_PORT=47888 \
  npm --prefix plugins/dittosloop-for-codex/mcp start
```

Open `http://127.0.0.1:47888` and select `Release Readiness Loop`.

## Run Detail Flow

1. `create_loop_contract` creates a formal contract when the loop should have a structured workflow body, rubrics, repair policy, and stop policy.
2. `start_codex_session` is the user-visible entry point. It creates the run, starts the first attempt, records the Codex session request, and returns the launch prompt/request for the host app.
3. `record_codex_thread` links the real Codex App thread once the host creates it. This is a top-level run/thread binding, not per-task workflow result writeback.
4. `execute_workflow_attempt` runs the formal workflow from inside that visible session. Codex-owned workflow steps can request local Codex tasks and suspend while waiting for precise results.
5. `record_session_result` writes back the result for a specific `workflowContextId`, `attemptId`, `sessionId`, `taskRunId`, or `stepId`. If multiple task locators are provided, they must all identify the same task run. Completed workflow steps are reused when execution resumes, while `needs_human` suspends the context without caching a completed task result and opens a linked human request when possible.
6. `propose_workflow_revision`, `promote_workflow_revision`, and `reject_workflow_revision` let the visible session edit the local workflow contract and keep revision history. Each write requires the current `runId` and `attemptId`.
7. `record_verification` can attach verifier results to `attemptId`; failed verification with `repair: true` moves the run and workflow context to `repairing`.
8. `record_human_request` keeps user decisions visible when work pauses.
9. `resolve_human_request` closes a user decision with the response. If the request belongs to a suspended workflow task, the response is written back as that task result and the workflow continues.
10. `commit_memory` stores durable lessons or preferences.
11. `add_artifact` references useful local files, preview URLs, reports, or outputs.
12. `complete_run` closes the run after verification or a clear blocker.
13. `get_run_detail` returns the composed view shown in the preview.

Legacy compatibility flow:

Legacy JSON state still loads and migrates. New user-visible runs should use `start_codex_session`.

Current workflow task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`. Reuse policies are reserved for future work. `subagent` specs, including tool and permission hints, are stored, shown in preview, and passed to the Codex host bridge; DittosLoop does not enforce tool allowlists itself.

## MCP Tools

- `create_loop_contract`
- `list_loops`
- `start_codex_session`
- `execute_workflow_attempt`
- `propose_workflow_revision`
- `list_workflow_revisions`
- `promote_workflow_revision`
- `reject_workflow_revision`
- `record_codex_thread`
- `record_session_result`
- `open_codex_session`
- `start_attempt`
- `complete_attempt`
- `append_event`
- `record_verification`
- `record_human_request`
- `resolve_human_request`
- `commit_memory`
- `add_artifact`
- `mark_run_repairing`
- `complete_run`
- `get_run_detail`
- `get_snapshot`
- `get_preview_url`

## Development

Use the repo-level commands for day-to-day checks:

```bash
npm test
npm run validate
npm run check
```

The MCP package can still be exercised directly:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
npm --prefix plugins/dittosloop-for-codex/mcp run build
```

When manifest metadata or MCP tools change, rebuild, run `npm run check`, reinstall or refresh the plugin from the marketplace, restart Codex, and test in a new thread.

## Sharing

For GitHub sharing, keep the marketplace file at `.agents/plugins/marketplace.json` and the plugin at `plugins/dittosloop-for-codex`. Users can add the cloned repo as a marketplace source, build the runtime, run `npm run check`, and install the plugin from Codex.

This plugin is local-first. It does not upload runtime state, and committed examples are sample data only.
