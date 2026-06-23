# DittosLoop For Codex

`DittosLoop For Codex` is a local-first Codex plugin that turns delegated work into visible Dittos loops. It bundles a skill, a local MCP runtime, JSON-backed loop state, and a browser preview for loop contracts, runs, verification, human requests, memory, and artifacts.

This repo is shaped as a GitHub-ready Codex plugin marketplace source. The first milestone is local install and local preview.

## What It Includes

- `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`: Codex plugin manifest
- `.agents/plugins/marketplace.json`: marketplace entry for this repo
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: installed loop workflow
- `plugins/dittosloop-for-codex/mcp`: TypeScript MCP runtime
- `plugins/dittosloop-for-codex/preview`: local preview UI

## Local Setup

Build the runtime before installing the plugin:

```bash
cd "plugins/dittosloop-for-codex/mcp"
npm install
npm run build
```

Add this repo as a Codex marketplace source:

```bash
codex plugin marketplace add "/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex"
```

Then open Codex plugin settings and install `DittosLoop For Codex` from the `DittosLoop Local` marketplace.

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

## Development

From `plugins/dittosloop-for-codex/mcp`:

```bash
npm test
npm run build
```

To smoke-test the preview outside Codex:

```bash
npm run build
DITTOSLOOP_DATA_DIR="$(pwd)/../../.dittosloop-data" npm start
```

## Sharing

For GitHub sharing, keep the marketplace file at `.agents/plugins/marketplace.json` and the plugin at `plugins/dittosloop-for-codex`. Users can add the cloned repo as a marketplace source, build the runtime, and install the plugin from Codex.
