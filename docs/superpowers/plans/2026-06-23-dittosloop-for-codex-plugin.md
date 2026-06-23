# DittosLoop For Codex Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a locally runnable, GitHub-ready Codex plugin named `DittosLoop For Codex`.

**Architecture:** The repo root is a Codex marketplace source. The plugin lives under `plugins/dittosloop-for-codex`, bundles one skill, one stdio MCP server, and a local browser preview served by the same runtime process. The MCP runtime owns JSON-backed loop state and exposes explicit tools for loop creation, run triggering, event recording, verification, memory, artifacts, and preview URL discovery.

**Tech Stack:** Codex plugin manifest and marketplace JSON, Node.js 22, TypeScript, Vitest, `@modelcontextprotocol/sdk`, plain HTML/CSS/JS for the preview.

## Global Constraints

- The plugin display name is `DittosLoop For Codex`.
- The normalized plugin id is `dittosloop-for-codex`.
- Build this repository as a GitHub-ready Codex plugin marketplace repo.
- The first runnable milestone should work locally on this machine before any public or team sharing step.
- Keep Dittos Loop product code and Codex plugin code separate.
- The installed plugin should bundle a skill, a local MCP runtime, and a browser preview experience.
- The preview should be opened through Codex's in-app browser or right-side preview surface as a local URL served by the runtime.
- The preview is not the source of truth. The runtime owns loop contracts, run history, attempts, verification results, human requests, memory commits, and artifact references.
- Avoid hidden background work in the MVP. A loop run should be visible, triggerable, and inspectable.
- Do not depend on plugin-bundled hooks for core behavior.
- Do not store secrets or personal runtime state in committed files.
- Local state should live outside committed files, under a documented user data directory.
- Manifest paths must be relative to the plugin root and `./`-prefixed.

---

## File Structure

- `README.md`: user-facing local and GitHub install guide.
- `.gitignore`: excludes dependencies, build output, coverage, and local state.
- `.agents/plugins/marketplace.json`: repo marketplace entry pointing to `./plugins/dittosloop-for-codex`.
- `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`: plugin manifest with skill and MCP server paths.
- `plugins/dittosloop-for-codex/.mcp.json`: plugin-scoped MCP server launch config.
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: installed behavior for loop creation and loop running.
- `plugins/dittosloop-for-codex/mcp/package.json`: runtime package scripts and dependencies.
- `plugins/dittosloop-for-codex/mcp/tsconfig.json`: runtime TypeScript compiler config.
- `plugins/dittosloop-for-codex/mcp/vitest.config.ts`: runtime test config.
- `plugins/dittosloop-for-codex/mcp/src/types.ts`: record types, status unions, and input types.
- `plugins/dittosloop-for-codex/mcp/src/id.ts`: predictable id creation helper with test injection.
- `plugins/dittosloop-for-codex/mcp/src/store.ts`: JSON file persistence and immutable updates.
- `plugins/dittosloop-for-codex/mcp/src/service.ts`: loop operations consumed by MCP tools and preview API.
- `plugins/dittosloop-for-codex/mcp/src/previewServer.ts`: local HTTP server for preview UI and JSON APIs.
- `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`: stdio MCP tool registration.
- `plugins/dittosloop-for-codex/mcp/src/index.ts`: process entrypoint.
- `plugins/dittosloop-for-codex/mcp/test/*.test.ts`: unit and smoke tests.
- `plugins/dittosloop-for-codex/preview/index.html`: preview shell.
- `plugins/dittosloop-for-codex/preview/styles.css`: preview styling.
- `plugins/dittosloop-for-codex/preview/app.js`: preview data loading and rendering.

## Task 1: Scaffold Marketplace And Plugin Shell

**Files:**
- Create: `.gitignore`
- Create: `README.md`
- Create: `.agents/plugins/marketplace.json`
- Create: `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`
- Create: `plugins/dittosloop-for-codex/.mcp.json`
- Create: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`

**Interfaces:**
- Consumes: the design spec and official plugin manifest schema.
- Produces: a repo marketplace and plugin shell that Codex can discover after the marketplace is added.

- [ ] **Step 1: Scaffold the plugin shell**

Run from the repo root:

```bash
python3 /Users/edisonzhong/.codex/skills/.system/plugin-creator/scripts/create_basic_plugin.py \
  dittosloop-for-codex \
  --path /Users/edisonzhong/Documents/dittos\ loop/dittosloop-for-codex/plugins \
  --marketplace-path /Users/edisonzhong/Documents/dittos\ loop/dittosloop-for-codex/.agents/plugins/marketplace.json \
  --with-skills \
  --with-assets \
  --with-mcp \
  --with-marketplace \
  --category Productivity
```

Expected: plugin directory, manifest, skill directory, `.mcp.json`, assets directory, and repo marketplace are created.

- [ ] **Step 2: Replace the generated manifest with project metadata**

Write `plugins/dittosloop-for-codex/.codex-plugin/plugin.json`:

```json
{
  "name": "dittosloop-for-codex",
  "version": "0.1.0",
  "description": "Turn Codex work into visible local Dittos loops with run history, verification, memory, and preview.",
  "author": {
    "name": "Dittos Loop"
  },
  "license": "MIT",
  "keywords": ["codex", "loop", "automation", "verification"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "DittosLoop For Codex",
    "shortDescription": "Create and inspect local Dittos loops from Codex",
    "longDescription": "DittosLoop For Codex helps turn delegated work into durable, visible local loops. It records loop contracts, runs, attempts, verification results, human requests, memory summaries, artifacts, and exposes a local preview URL for Codex's in-app browser.",
    "developerName": "Dittos Loop",
    "category": "Productivity",
    "capabilities": ["Interactive", "Read", "Write"],
    "defaultPrompt": [
      "Turn this responsibility into a loop",
      "Show my Dittos loops",
      "Trigger this loop and verify it"
    ],
    "brandColor": "#2563EB"
  }
}
```

- [ ] **Step 3: Write the MCP launch config**

Write `plugins/dittosloop-for-codex/.mcp.json`:

```json
{
  "mcpServers": {
    "dittosloop": {
      "command": "node",
      "args": ["./mcp/dist/index.js"],
      "cwd": ".",
      "startup_timeout_sec": 20,
      "tool_timeout_sec": 60
    }
  }
}
```

- [ ] **Step 4: Write the marketplace entry**

Ensure `.agents/plugins/marketplace.json` contains:

```json
{
  "name": "dittosloop-local",
  "interface": {
    "displayName": "DittosLoop Local"
  },
  "plugins": [
    {
      "name": "dittosloop-for-codex",
      "source": {
        "source": "local",
        "path": "./plugins/dittosloop-for-codex"
      },
      "policy": {
        "installation": "AVAILABLE",
        "authentication": "ON_INSTALL"
      },
      "category": "Productivity"
    }
  ]
}
```

- [ ] **Step 5: Add first user-facing README**

Write `README.md` with local install, GitHub install shape, development commands, and data directory notes.

- [ ] **Step 6: Commit scaffold**

```bash
git add .gitignore README.md .agents plugins/dittosloop-for-codex
git commit -m "feat: scaffold dittosloop codex plugin"
```

## Task 2: Runtime Package, Types, And JSON Store

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/package.json`
- Create: `plugins/dittosloop-for-codex/mcp/tsconfig.json`
- Create: `plugins/dittosloop-for-codex/mcp/vitest.config.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/id.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/store.ts`
- Create: `plugins/dittosloop-for-codex/mcp/test/store.test.ts`

**Interfaces:**
- Consumes: no earlier runtime code.
- Produces: `LoopStore`, `createEmptyState()`, `readState()`, `writeState()`, `updateState(mutator)`, and exported record types for later tasks.

- [ ] **Step 1: Write the failing store test**

Create `plugins/dittosloop-for-codex/mcp/test/store.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LoopStore } from "../src/store.js";

describe("LoopStore", () => {
  test("creates an empty state file and persists updates", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "dittosloop-store-"));
    const store = new LoopStore(dataDir);

    const initial = await store.readState();
    expect(initial.loops).toEqual([]);
    expect(initial.runs).toEqual([]);

    await store.updateState((state) => ({
      ...state,
      loops: [
        {
          id: "loop_1",
          title: "Inbox triage",
          goal: "Keep launch inbox clean",
          scope: "Unread launch messages",
          triggerMode: "manual",
          workflowSummary: "Review, summarize, and flag blockers.",
          verificationPolicy: "Report checked message count.",
          memoryPolicy: "Remember unresolved blockers.",
          stopConditions: ["User disables the loop"],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ]
    }));

    const saved = await store.readState();
    expect(saved.loops).toHaveLength(1);
    expect(saved.loops[0]?.title).toBe("Inbox triage");

    const raw = JSON.parse(await readFile(join(dataDir, "state.json"), "utf8"));
    expect(raw.version).toBe(1);
  });
});
```

- [ ] **Step 2: Run the test to verify RED**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- store.test.ts
```

Expected: failure because the runtime package and `LoopStore` do not exist.

- [ ] **Step 3: Create package and minimal store implementation**

Create package config, TypeScript config, status unions and store implementation. `LoopStore` writes `state.json` atomically enough for the local MVP by writing a temp file then renaming it.

- [ ] **Step 4: Run the test to verify GREEN**

```bash
cd plugins/dittosloop-for-codex/mcp
npm install
npm test -- store.test.ts
```

Expected: the store test passes.

- [ ] **Step 5: Commit runtime foundation**

```bash
git add plugins/dittosloop-for-codex/mcp
git commit -m "feat: add local loop state store"
```

## Task 3: Loop Service Operations

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Create: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`

**Interfaces:**
- Consumes: `LoopStore` and record types from Task 2.
- Produces: `LoopService` methods `createLoop`, `listLoops`, `triggerRun`, `appendEvent`, `recordVerification`, `recordHumanRequest`, `commitMemory`, `addArtifact`, `completeRun`, `getSnapshot`, and `getPreviewUrl`.

- [ ] **Step 1: Write failing service tests**

Create `service.test.ts` with three behaviors:

```ts
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";

async function createService() {
  const dataDir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  return new LoopService({
    store: new LoopStore(dataDir),
    now: () => "2026-06-23T10:00:00.000Z",
    nextId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888"
  });
}

describe("LoopService", () => {
  test("creates a loop contract with explicit fields", async () => {
    const service = await createService();
    const loop = await service.createLoop({
      title: "Daily launch review",
      goal: "Catch launch blockers every day",
      scope: "Launch docs and open review comments",
      triggerMode: "manual",
      workflowSummary: "Inspect, summarize, verify, and report.",
      verificationPolicy: "Verify reviewed files and blockers count.",
      memoryPolicy: "Remember unresolved launch blockers.",
      stopConditions: ["User says stop"]
    });

    expect(loop.id).toBe("loop_1");
    expect(loop.title).toBe("Daily launch review");
    expect(await service.listLoops()).toHaveLength(1);
  });

  test("creates one visible run and appends events under that run", async () => {
    const service = await createService();
    const loop = await service.createLoop({
      title: "Manual review",
      goal: "Review manually",
      scope: "One repo",
      triggerMode: "manual",
      workflowSummary: "Review and report.",
      verificationPolicy: "Summarize checks.",
      memoryPolicy: "No durable memory.",
      stopConditions: ["User disables it"]
    });

    const run = await service.triggerRun({ loopId: loop.id, triggerReason: "manual test" });
    await service.appendEvent({
      runId: run.id,
      kind: "attempt_started",
      title: "Attempt started",
      message: "Codex started the first attempt."
    });

    const snapshot = await service.getSnapshot();
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.events).toHaveLength(1);
    expect(snapshot.events[0]?.runId).toBe(run.id);
  });

  test("records verification and returns a preview URL", async () => {
    const service = await createService();
    const loop = await service.createLoop({
      title: "Verify review",
      goal: "Review with evidence",
      scope: "One folder",
      triggerMode: "manual",
      workflowSummary: "Review and verify.",
      verificationPolicy: "Checks must pass.",
      memoryPolicy: "Summarize findings.",
      stopConditions: ["User disables it"]
    });
    const run = await service.triggerRun({ loopId: loop.id, triggerReason: "manual" });

    const result = await service.recordVerification({
      runId: run.id,
      status: "passed",
      checks: [{ name: "tests", status: "passed", evidence: "1 test passed" }]
    });

    expect(result.status).toBe("passed");
    expect(await service.getPreviewUrl()).toBe("http://127.0.0.1:47888");
  });
});
```

- [ ] **Step 2: Run tests to verify RED**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- service.test.ts
```

Expected: failure because `LoopService` does not exist.

- [ ] **Step 3: Implement service methods minimally**

Implement the service using `LoopStore.updateState`. Validate required ids by throwing clear `Error` messages such as `Loop not found: <id>` and `Run not found: <id>`.

- [ ] **Step 4: Run tests to verify GREEN**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- service.test.ts
```

Expected: service tests pass.

- [ ] **Step 5: Commit service operations**

```bash
git add plugins/dittosloop-for-codex/mcp/src plugins/dittosloop-for-codex/mcp/test
git commit -m "feat: add loop runtime service"
```

## Task 4: Preview HTTP Server And Static UI

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/previewServer.ts`
- Create: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Create: `plugins/dittosloop-for-codex/preview/index.html`
- Create: `plugins/dittosloop-for-codex/preview/styles.css`
- Create: `plugins/dittosloop-for-codex/preview/app.js`

**Interfaces:**
- Consumes: `LoopService.getSnapshot()`.
- Produces: `startPreviewServer({ service, host, port, staticDir })`, `GET /api/snapshot`, and a local preview page.

- [ ] **Step 1: Write failing preview server test**

Create a test that starts the server on port `0`, calls `/api/snapshot`, and verifies JSON includes `loops`, `runs`, and `events`.

- [ ] **Step 2: Run test to verify RED**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- previewServer.test.ts
```

Expected: failure because `startPreviewServer` does not exist.

- [ ] **Step 3: Implement preview server and static UI**

Use Node's built-in `http` module. Serve `/api/snapshot` as JSON, `/` as `preview/index.html`, and static files under `/styles.css` and `/app.js`.

- [ ] **Step 4: Run test to verify GREEN**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- previewServer.test.ts
```

Expected: preview server test passes.

- [ ] **Step 5: Commit preview**

```bash
git add plugins/dittosloop-for-codex/mcp/src/previewServer.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts plugins/dittosloop-for-codex/preview
git commit -m "feat: add loop preview server"
```

## Task 5: MCP Server Tools And Process Entrypoint

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/index.ts`
- Create: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/package.json`

**Interfaces:**
- Consumes: `LoopService` and preview server from Tasks 3 and 4.
- Produces: stdio MCP server tools `create_loop`, `list_loops`, `trigger_run`, `append_event`, `record_verification`, `record_human_request`, `commit_memory`, `add_artifact`, `complete_run`, `get_snapshot`, and `get_preview_url`.

- [ ] **Step 1: Write failing MCP tool registry test**

Test the exported `createToolHandlers(service)` helper directly so the test does not depend on stdio transport. Verify `create_loop`, `trigger_run`, and `get_preview_url` handlers call the service and return structured JSON.

- [ ] **Step 2: Run test to verify RED**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- mcpServer.test.ts
```

Expected: failure because `createToolHandlers` does not exist.

- [ ] **Step 3: Implement MCP handlers and stdio registration**

Use `@modelcontextprotocol/sdk` for stdio transport. Keep handler logic separate from SDK registration so it remains unit-testable.

- [ ] **Step 4: Build runtime**

```bash
cd plugins/dittosloop-for-codex/mcp
npm run build
```

Expected: `dist/index.js` exists.

- [ ] **Step 5: Run tests to verify GREEN**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- mcpServer.test.ts
```

Expected: MCP handler tests pass.

- [ ] **Step 6: Commit MCP server**

```bash
git add plugins/dittosloop-for-codex/mcp
git commit -m "feat: expose dittosloop mcp tools"
```

## Task 6: Installed Skill And Documentation

**Files:**
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: MCP tool names from Task 5.
- Produces: installed Codex guidance for when and how to create, trigger, inspect, repair, and complete loops.

- [ ] **Step 1: Write installed skill**

The skill must instruct Codex to:

```md
---
name: loop
description: Use when the user asks to create, inspect, trigger, or continue a Dittos loop in Codex.
---

# DittosLoop For Codex

Use this skill when the user wants durable Codex responsibility: turning delegated work into a loop, creating a visible run, recording attempts, verification, human requests, memory, artifacts, or opening the loop preview.

Before saving a new loop, draft the loop contract and ask for explicit confirmation.

Use the bundled DittosLoop MCP tools as the source of truth. The preview URL is for inspection only.
```

- [ ] **Step 2: Expand README**

Document local development, local install, GitHub marketplace install shape, data directory, runtime scripts, and smoke checks.

- [ ] **Step 3: Commit docs and skill**

```bash
git add README.md plugins/dittosloop-for-codex/skills/loop/SKILL.md
git commit -m "docs: add dittosloop plugin usage guide"
```

## Task 7: Validation, Local Marketplace, And Smoke Checks

**Files:**
- Modify only if validation identifies a concrete manifest or docs issue.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: evidence that the local MVP builds, tests, validates, and can be surfaced from the repo marketplace.

- [ ] **Step 1: Install validator dependency if needed**

```bash
python3 -m pip install --user PyYAML
```

Expected: `yaml` import becomes available to the plugin validator.

- [ ] **Step 2: Validate plugin manifest**

```bash
python3 /Users/edisonzhong/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py \
  /Users/edisonzhong/Documents/dittos\ loop/dittosloop-for-codex/plugins/dittosloop-for-codex
```

Expected: validator exits successfully.

- [ ] **Step 3: Run runtime tests**

```bash
cd plugins/dittosloop-for-codex/mcp
npm test
npm run build
```

Expected: all tests and build pass.

- [ ] **Step 4: Add the repo marketplace to Codex**

```bash
codex plugin marketplace add /Users/edisonzhong/Documents/dittos\ loop/dittosloop-for-codex
```

Expected: Codex accepts the local marketplace root.

- [ ] **Step 5: Confirm marketplace visibility**

```bash
codex plugin marketplace upgrade dittosloop-local
```

Expected: Codex refreshes the local marketplace without an error.

- [ ] **Step 6: Run a local runtime smoke test**

Start the runtime process manually with a temporary data directory:

```bash
cd plugins/dittosloop-for-codex/mcp
DITTOSLOOP_DATA_DIR="$(mktemp -d)" DITTOSLOOP_PREVIEW_PORT=47888 npm run start
```

In a separate check, request `http://127.0.0.1:47888/api/snapshot` and verify it returns JSON with `loops`, `runs`, and `events`.

- [ ] **Step 7: Commit validation fixes**

If validation required changes:

```bash
git add .
git commit -m "fix: align plugin validation"
```

If no changes were needed, record the clean status in the final report.

## Self-Review

- Spec coverage: marketplace repo, plugin manifest, skill, MCP runtime, local JSON state, preview URL, testing, and local installation are all covered by Tasks 1-7.
- Unresolved marker scan: the plan names concrete files, commands, and interfaces.
- Type consistency: later tasks consume `LoopStore`, `LoopService`, `startPreviewServer`, and `createToolHandlers` with names introduced in earlier tasks.
