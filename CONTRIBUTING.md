# Contributing

Thanks for helping improve DittosLoop For Codex.

## Development Setup

Install the MCP runtime dependencies and run the repository checks from the
repo root:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp install
npm run check
```

`npm run check` builds the MCP runtime, verifies generated files, runs the root
tests, validates the plugin bundle, and runs the MCP test suite.

## Repository Shape

- The Codex plugin lives under `plugins/dittosloop-for-codex`.
- The plugin manifest is `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`.
- The marketplace entry is `.agents/plugins/marketplace.json`.
- The MCP runtime is TypeScript and lives under `plugins/dittosloop-for-codex/mcp`.
- The preview UI lives under `plugins/dittosloop-for-codex/preview`.
- The reminder hooks live under `plugins/dittosloop-for-codex/hooks`.

## Development Rules

- Keep runtime state, local experiments, and secrets out of the repository.
- Do not commit personal absolute paths or machine-specific setup notes.
- Keep generated plugin paths relative to the plugin root and `./`-prefixed.
- Keep `plugins/dittosloop-for-codex/mcp/dist/index.js` in sync with source;
  Git-backed plugin installs rely on the tracked built entrypoint.
- Hooks are a reminder/discovery layer. Core loop state and execution behavior
  belong in the MCP runtime.
- The npm packages are marked private to prevent accidental npm publication;
  the supported distribution path is the Codex plugin marketplace repo.

## Pull Requests

Before opening a PR, run:

```bash
npm run check
npm --prefix plugins/dittosloop-for-codex/mcp audit --audit-level=high
```

In the PR description, include:

- What changed.
- Why it changed.
- The checks you ran.
- Any known risk or follow-up.
