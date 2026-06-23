# DittosLoop For Codex

`DittosLoop For Codex` is a local-first Codex plugin that turns delegated work into visible Dittos loops. It bundles a skill, a local MCP runtime, JSON-backed loop state, and a browser preview for loop contracts, runs, verification, human requests, memory, and artifacts.

This repo is shaped as a GitHub-ready Codex plugin marketplace source. The first milestone is local install and local preview.

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

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop Local` marketplace.

After installing or reinstalling the plugin, restart Codex and start a new thread so the bundled skill and MCP tools are loaded fresh.

## GitHub Setup

After cloning a shared copy of this repo:

```bash
cd dittosloop-for-codex
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
codex plugin marketplace add "$(pwd)"
```

For a public or private GitHub marketplace source that Codex can access, add the repo source instead of the local path:

```bash
codex plugin marketplace add owner/dittosloop-for-codex --ref main
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

The preview has three compact panels: loop contracts, recent runs, and the selected run detail. Run detail shows attempts, timeline events, verification results, human requests, memory, and artifacts from the local JSON state.

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

1. `trigger_run` creates the run.
2. `start_attempt` begins visible work under that run.
3. `complete_attempt` records the attempt outcome.
4. `record_verification` can attach results to `attemptId`.
5. Failed verification with `repair: true` moves the run to `repairing`.
6. `record_human_request` keeps user decisions visible when work pauses.
7. `resolve_human_request` closes a user decision with the response.
8. `get_run_detail` returns the composed view shown in the preview.

## MCP Tools

- `create_loop`
- `list_loops`
- `trigger_run`
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
