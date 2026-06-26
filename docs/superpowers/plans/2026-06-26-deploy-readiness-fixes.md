# DittosLoop For Codex Deploy Readiness Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and verification-before-completion for this plan. Keep changes in the `codex/deploy-readiness-fixes` worktree.

**Goal:** Make the current plugin branch safe to share as a Git-backed Codex plugin install target by shipping a runnable MCP entrypoint and stable plugin hook paths.

**Architecture:** Keep the existing plugin layout and MCP command. Change the MCP build artifact from untracked TypeScript output to a tracked bundled Node ESM entrypoint. Add validator coverage for the release assumptions that were missed.

**Tech Stack:** Node.js, `node:test`, TypeScript, esbuild, Codex plugin manifest JSON, Codex hooks JSON.

## Global Constraints

- Do not edit the main worktree.
- Preserve plugin id `dittosloop-for-codex`.
- Preserve display name `DittosLoop For Codex`.
- Preserve `.mcp.json` command shape: `node ./mcp/dist/index.js`.
- Keep local state outside committed files.
- Do not merge the branch without explicit approval.

## Task 1: Add RED Validator Coverage

**Files:**
- Modify: `test/validate-plugin.test.mjs`

**Steps:**
- [ ] Add a fixture variant with hook commands using `./hooks/loopable-reminder.mjs` and assert validation fails with an actionable hook path error.
- [ ] Add a git-backed fixture where `mcp/dist/index.js` exists but is not tracked, and assert validation fails with an actionable distributable entrypoint error.
- [ ] Run `node --test test/validate-plugin.test.mjs`.
- [ ] Confirm the new tests fail before implementation.

## Task 2: Implement Validator Rules

**Files:**
- Modify: `scripts/validate-plugin.mjs`
- Modify: `test/validate-plugin.test.mjs`

**Steps:**
- [ ] Add a hook command rule requiring `${PLUGIN_ROOT}/hooks/loopable-reminder.mjs` in every command hook.
- [ ] Add a git-aware rule that checks whether `plugins/dittosloop-for-codex/mcp/dist/index.js` is tracked when `.git` metadata is available.
- [ ] Keep the validator usable in non-git temporary fixtures by skipping the git-tracked check when git metadata is unavailable.
- [ ] Update the valid fixture to use the `PLUGIN_ROOT` hook command.
- [ ] Run `node --test test/validate-plugin.test.mjs`.

## Task 3: Bundle And Track The MCP Runtime

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/package.json`
- Modify: `.gitignore`
- Generate/track: `plugins/dittosloop-for-codex/mcp/dist/index.js`

**Steps:**
- [ ] Add an explicit `esbuild` dev dependency to the MCP package.
- [ ] Change the MCP build script to run TypeScript type checking with `--noEmit`, then bundle `src/index.ts` to `dist/index.js` for Node ESM.
- [ ] Keep `npm --prefix plugins/dittosloop-for-codex/mcp start` working.
- [ ] Update `.gitignore` so only the required distributable `dist/index.js` can be tracked.
- [ ] Run `npm --prefix plugins/dittosloop-for-codex/mcp install` if the lockfile must update.
- [ ] Run `npm --prefix plugins/dittosloop-for-codex/mcp run build`.

## Task 4: Stabilize Plugin Hook Paths

**Files:**
- Modify: `plugins/dittosloop-for-codex/hooks/hooks.json`

**Steps:**
- [ ] Replace every `node ./hooks/loopable-reminder.mjs ...` command with `node "${PLUGIN_ROOT}/hooks/loopable-reminder.mjs" ...`.
- [ ] Run the root validator and confirm hook path checks pass.

## Task 5: Verify Clean Distribution

**Files:**
- No planned source edits.

**Steps:**
- [ ] Run `npm run check`.
- [ ] Create a temporary copy from git-tracked files only.
- [ ] Confirm the copied tree has no `plugins/dittosloop-for-codex/mcp/node_modules`.
- [ ] Start `node plugins/dittosloop-for-codex/mcp/dist/index.js` from the copied tree with a temporary `DITTOSLOOP_DATA_DIR` and preview port.
- [ ] Fetch `/api/snapshot` and `/api/templates`.
- [ ] Stop the smoke-test runtime.
- [ ] Record any remaining deploy risks.
