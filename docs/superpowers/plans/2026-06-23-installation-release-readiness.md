# DittosLoop For Codex Installation And Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the plugin repository easier to install, validate, preview with sample data, and share from GitHub.

**Architecture:** Add repo-level validation and documentation around the existing plugin. The validator is a dependency-free Node script that checks current manifest, marketplace, MCP, skill, preview, and build files. Sample data remains static JSON outside runtime code.

**Tech Stack:** Node.js built-in modules, `node:test`, Codex plugin manifest JSON, repo marketplace JSON, existing TypeScript MCP runtime.

## Global Constraints

- The plugin display name is `DittosLoop For Codex`.
- The normalized plugin id is `dittosloop-for-codex`.
- Build this repository as a GitHub-ready Codex plugin marketplace repo.
- Do not change core loop runtime behavior in this release-readiness pass.
- Do not store secrets or personal runtime state in committed files.
- Manifest paths must be relative to the plugin root and `./`-prefixed.

---

## Task 1: Repository Validator

**Files:**
- Create: `package.json`
- Create: `scripts/validate-plugin.mjs`
- Create: `test/validate-plugin.test.mjs`

**Interfaces:**
- Produces: `validatePlugin(rootDir: string): Promise<{ ok: true; checks: string[] } | { ok: false; errors: string[]; checks: string[] }>`
- Produces CLI behavior: `node scripts/validate-plugin.mjs` exits `0` on success and `1` on validation errors.

- [ ] **Step 1: Write failing validator tests**

Create `test/validate-plugin.test.mjs` with one success test against the repo and one failure test against a temporary broken fixture.

- [ ] **Step 2: Verify RED**

Run `node --test test/validate-plugin.test.mjs`.

Expected: failure because `scripts/validate-plugin.mjs` does not exist.

- [ ] **Step 3: Implement validator and root scripts**

Create `scripts/validate-plugin.mjs` and root `package.json` scripts:

```json
{
  "scripts": {
    "validate": "node scripts/validate-plugin.mjs",
    "test": "node --test test/*.test.mjs",
    "check": "npm run test && npm run validate && npm --prefix plugins/dittosloop-for-codex/mcp test && npm --prefix plugins/dittosloop-for-codex/mcp run build"
  }
}
```

- [ ] **Step 4: Verify GREEN**

Run `npm test` and `npm run validate`.

Expected: both pass.

## Task 2: Sample Preview State

**Files:**
- Create: `examples/state.sample.json`

**Interfaces:**
- Produces: a valid state file that can be copied to any `DITTOSLOOP_DATA_DIR/state.json`.

- [ ] **Step 1: Add sample state**

Create a state file with one loop, one run, one attempt, one verification result, one human request, one memory commit, one artifact, and timeline events.

- [ ] **Step 2: Validate with existing preview API**

Start the built runtime using a temp data directory containing the sample state and fetch `/api/snapshot` plus `/api/runs/<run-id>`.

Expected: both endpoints include sample ids.

## Task 3: Documentation And Final Verification

**Files:**
- Modify: `README.md`

**Interfaces:**
- Produces: clear local install, GitHub install, sample preview, development, and reinstall guidance.

- [ ] **Step 1: Update README**

Add quick check, install, sample preview, and development loop sections.

- [ ] **Step 2: Run full verification**

Run `npm run check`, `node --check scripts/validate-plugin.mjs`, and a preview smoke test with sample data.

Expected: all checks pass.

- [ ] **Step 3: Commit**

Commit the release-readiness changes.

