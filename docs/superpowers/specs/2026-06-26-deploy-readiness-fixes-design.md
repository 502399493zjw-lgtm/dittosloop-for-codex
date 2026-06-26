# DittosLoop For Codex Deploy Readiness Fixes Design

## Status

Direction approved in thread on 2026-06-26. This document records the small fix scope before implementation in the `codex/deploy-readiness-fixes` worktree.

## Context

The `main` branch builds and passes the current test suite, but it is not yet safe to treat as a direct online/GitHub plugin install target.

The main release risk is distribution shape. The plugin MCP config starts `node ./mcp/dist/index.js`, while the built `mcp/dist` output is ignored and untracked. A clean Git-backed install can therefore miss the entrypoint. Even if plain TypeScript output were committed, the runtime still depends on MCP SDK and Zod packages that are not installed by a plugin marketplace checkout.

The hook config also starts `node ./hooks/loopable-reminder.mjs`. That depends on the current working directory matching the plugin root, which is fragile for plugin-installed hooks. Official Codex hook examples use `PLUGIN_ROOT` for plugin-owned scripts.

## Goals

- Make the plugin runtime launchable from a Git-backed install without requiring a post-install package install inside the MCP folder.
- Keep the MCP command stable: `node ./mcp/dist/index.js`.
- Bundle runtime dependencies into the built MCP entrypoint and track the distributable entrypoint in git.
- Update hooks to resolve plugin-owned scripts through `PLUGIN_ROOT`.
- Extend validation so future checks fail if the runtime entrypoint is missing from git-tracked distribution files or hooks regress to cwd-relative paths.
- Preserve current local-first behavior, preview behavior, data storage location, plugin id, and display name.

## Non-Goals

- Do not build a hosted Dittos Loop service.
- Do not add background workers, cron triggers, or webhooks.
- Do not change core loop runtime contracts or state schema.
- Do not store local runtime state, secrets, or user-specific config in the repo.
- Do not merge back to `main` without explicit user approval and review.

## Design

The MCP build becomes a distributable bundle. The `mcp` package will keep a separate type-check step and use a Node-targeted bundler to emit `dist/index.js` from `src/index.ts`. Runtime dependencies such as `@modelcontextprotocol/sdk` and `zod` should be included in that output so a plugin checkout can run the entrypoint without `mcp/node_modules`.

The root validator will continue to verify paths and metadata, then add two deployment checks:

- The configured MCP entrypoint must exist and, when git metadata is available, be tracked by git.
- Hook commands must reference the plugin script through `PLUGIN_ROOT` instead of `./hooks`.

The hook manifest will switch each command to `node "${PLUGIN_ROOT}/hooks/loopable-reminder.mjs" ...`. This follows Codex plugin hook conventions while retaining the same hook script and arguments.

The repository ignore rules will continue to ignore local build clutter, but explicitly allow the generated distributable MCP entrypoint required by Git-backed plugin installs.

## Validation

- Run validator tests and confirm the new tests fail before the implementation.
- Run validator tests again after the implementation.
- Run the full root check.
- Run a clean distribution smoke test from git-tracked files only, without `plugins/dittosloop-for-codex/mcp/node_modules`.
- Start the bundled MCP runtime with a temporary data directory and fetch preview endpoints.
