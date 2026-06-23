# Run Detail Attempt Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build first-class run detail, attempt lifecycle, repair state, and right-side preview detail for DittosLoop For Codex.

**Architecture:** Keep the model local-first: `LoopService` owns all state transitions, MCP tools expose the write/read surface, the preview server exposes composed read APIs, and the static preview renders lists from `/api/snapshot` plus details from `/api/runs/:runId`. Existing JSON state remains compatible through store normalization.

**Tech Stack:** TypeScript, Vitest, Node HTTP server, static HTML/CSS/JavaScript, Codex plugin manifest.

## Global Constraints

- Do not add cron, webhook, GitHub, Lark, event triggers, hosted services, or hidden background execution.
- Runtime tools remain the write path; the preview is read-only.
- Existing MVP tool inputs continue to work.
- Stored state without `attempts`, human request `status`, human request `response`, or verification `attemptId` must still load.
- Use TDD for service, MCP, preview server, and preview behavior.
- Run `npm test`, `npm run build`, Codex plugin validation, and a local preview smoke check before completion.

---

## File Structure

- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/types.ts`
  - Adds `RunDetail`, `HumanRequestStatus`, `VerificationResult.attemptId`, `HumanRequest.status`, and `HumanRequest.response`.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/store.ts`
  - Normalizes old state into the new shape.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/service.ts`
  - Implements attempt lifecycle, repair state, request resolution, and run detail composition.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
  - Adds schemas, handlers, and registered tools.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/previewServer.ts`
  - Adds `/api/runs/:runId` and 404 handling for unknown runs.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/index.html`
  - Adds the run detail panel.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/app.js`
  - Loads selected run details and renders attempts, events, verification, human requests, memory, and artifacts.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/styles.css`
  - Supports the three-panel desktop layout and stacked mobile layout.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/README.md`
  - Documents the richer lifecycle and new MCP tools.
- Modify `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/skills/loop/SKILL.md`
  - Teaches Codex to start attempts and record verification with `attemptId`.

## Task 1: Service Model And Store Compatibility

**Files:**
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/store.ts`
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/service.ts`
- Test: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/test/store.test.ts`

**Interfaces:**
- Consumes: existing `LoopService`, `LoopStore`, and `LoopState`.
- Produces:
  - `startAttempt(runId: string, input?: StartAttemptInput): Promise<RunAttempt>`
  - `completeAttempt(attemptId: string, input?: CompleteAttemptInput): Promise<RunAttempt>`
  - `markRunRepairing(runId: string, input?: MarkRunRepairingInput): Promise<LoopRun>`
  - `resolveHumanRequest(requestId: string, input: ResolveHumanRequestInput): Promise<HumanRequest>`
  - `getRunDetail(runId: string): Promise<RunDetail>`
  - `recordVerification(runId: string, input: RecordVerificationInput): Promise<VerificationResult>`

- [ ] **Step 1: Write failing service tests**

Add these tests to `mcp/test/service.test.ts`:

```ts
test("starts and completes an attempt under a run", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });

  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  const completed = await service.completeAttempt(attempt.id, {
    status: "completed",
    summary: "Tests passed"
  });

  expect(completed).toMatchObject({
    id: "attempt_1",
    runId: run.id,
    status: "completed",
    summary: "Tests passed",
    completedAt: fixedTime
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    attempts: [{ id: "attempt_1", runId: run.id, status: "completed" }],
    events: [
      { kind: "attempt_started", runId: run.id, message: "First pass" },
      { kind: "attempt_completed", runId: run.id, message: "Tests passed" }
    ]
  });
});

test("records failed verification against an attempt and marks run repairing when requested", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id);

  const result = await service.recordVerification(run.id, {
    attemptId: attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true,
    checks: [{ name: "npm run build", status: "failed", output: "TS error" }]
  });

  expect(result).toMatchObject({ runId: run.id, attemptId: attempt.id, status: "failed" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: run.id, status: "repairing", updatedAt: fixedTime }],
    verificationResults: [{ id: "verification_1", attemptId: attempt.id }]
  });
});

test("resolves a human request with a response", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const request = await service.recordHumanRequest(run.id, { question: "Continue with repair?" });

  const resolved = await service.resolveHumanRequest(request.id, { response: "Yes, continue." });

  expect(resolved).toMatchObject({
    id: request.id,
    status: "resolved",
    response: "Yes, continue.",
    resolvedAt: fixedTime
  });
});

test("returns composed run detail", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.appendEvent(run.id, { message: "Checked package scripts" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  await service.recordHumanRequest(run.id, { question: "Ship it?" });
  await service.commitMemory(loop.id, { runId: run.id, summary: "Checks passed locally." });
  await service.addArtifact(run.id, { title: "Preview", url: "http://127.0.0.1:47888" });

  await expect(service.getRunDetail(run.id)).resolves.toMatchObject({
    run: { id: run.id },
    loop: { id: loop.id },
    attempts: [{ id: attempt.id }],
    events: [{ message: "Checked package scripts" }],
    verificationResults: [{ attemptId: attempt.id }],
    humanRequests: [{ status: "open" }],
    memoryCommits: [{ summary: "Checks passed locally." }],
    artifacts: [{ title: "Preview" }]
  });
});
```

- [ ] **Step 2: Write failing store compatibility test**

Add this test to `mcp/test/store.test.ts`:

```ts
test("normalizes old state without human request status", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 1,
      humanRequests: [
        {
          id: "human_1",
          runId: "run_1",
          question: "Continue?",
          createdAt: "2026-06-23T00:00:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    attempts: [],
    humanRequests: [{ id: "human_1", status: "open" }]
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/service.test.ts test/store.test.ts`

Expected: FAIL because `startAttempt`, `completeAttempt`, `resolveHumanRequest`, `getRunDetail`, `attemptId`, `repair`, and human request `status` are not implemented.

- [ ] **Step 4: Add minimal implementation**

Implementation shape:

```ts
export interface RunDetail {
  run: LoopRun;
  loop: LoopContract;
  attempts: RunAttempt[];
  events: RunEvent[];
  verificationResults: VerificationResult[];
  humanRequests: HumanRequest[];
  memoryCommits: MemoryCommit[];
  artifacts: ArtifactRef[];
}
```

```ts
async startAttempt(runId: string, input: StartAttemptInput = {}): Promise<RunAttempt> {
  const timestamp = this.now();
  const attempt: RunAttempt = {
    id: this.nextId("attempt"),
    runId,
    status: "running",
    summary: input.summary,
    createdAt: timestamp
  };

  await this.options.store.updateState((state) => {
    requireRun(state, runId);
    return {
      ...state,
      attempts: [...state.attempts, attempt],
      events: [...state.events, lifecycleEvent(this.nextId("event"), runId, "attempt_started", input.summary ?? "Attempt started", timestamp)]
    };
  });

  return attempt;
}
```

```ts
async completeAttempt(attemptId: string, input: CompleteAttemptInput = {}): Promise<RunAttempt> {
  const timestamp = this.now();
  const status = input.status ?? "completed";
  let completed: RunAttempt | undefined;

  await this.options.store.updateState((state) => {
    const attempt = requireAttempt(state, attemptId);
    if (attempt.completedAt) {
      if (attempt.status === status && attempt.summary === input.summary) return state;
      throw new Error(`Attempt already completed: ${attemptId}`);
    }
    completed = { ...attempt, status, summary: input.summary ?? attempt.summary, completedAt: timestamp };
    return {
      ...state,
      attempts: state.attempts.map((candidate) => (candidate.id === attemptId ? completed! : candidate)),
      events: [...state.events, lifecycleEvent(this.nextId("event"), attempt.runId, "attempt_completed", completed.summary ?? `Attempt ${status}`, timestamp)]
    };
  });

  return completed!;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/service.test.ts test/store.test.ts`

Expected: PASS for service and store tests.

- [ ] **Step 6: Commit**

```bash
git add plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/mcp/src/store.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/store.test.ts
git commit -m "feat: add run attempts and detail model"
```

## Task 2: MCP Tool Surface

**Files:**
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Test: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

**Interfaces:**
- Consumes: Task 1 service methods.
- Produces MCP handlers and tool names:
  - `start_attempt`
  - `complete_attempt`
  - `resolve_human_request`
  - `mark_run_repairing`
  - `get_run_detail`
  - updated `record_verification` input with `attemptId` and `repair`

- [ ] **Step 1: Write failing MCP handler test**

Add to `mcp/test/mcpServer.test.ts`:

```ts
test("exposes attempt and run detail operations as MCP content", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop({ title: "Code health", intent: "Keep checks visible" }));
  const run = readResult(await handlers.trigger_run({ loopId: loop.id, goal: "Run checks" }));

  const attempt = readResult(await handlers.start_attempt({ runId: run.id, summary: "First pass" }));
  await handlers.complete_attempt({ attemptId: attempt.id, status: "failed", summary: "Build failed" });
  await handlers.record_verification({
    runId: run.id,
    attemptId: attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true
  });
  const request = readResult(await handlers.record_human_request({ runId: run.id, question: "Continue?" }));
  await handlers.resolve_human_request({ requestId: request.id, response: "Continue." });
  await handlers.mark_run_repairing({ runId: run.id, reason: "Repair after build failure" });

  const detail = readResult(await handlers.get_run_detail({ runId: run.id }));

  expect(detail).toMatchObject({
    run: { id: run.id, status: "repairing" },
    attempts: [{ id: attempt.id, status: "failed" }],
    verificationResults: [{ attemptId: attempt.id }],
    humanRequests: [{ id: request.id, status: "resolved", response: "Continue." }]
  });
});
```

- [ ] **Step 2: Update registration test expectation**

Expected tool list:

```ts
expect(registeredTools).toEqual([
  "create_loop",
  "list_loops",
  "trigger_run",
  "start_attempt",
  "complete_attempt",
  "append_event",
  "record_verification",
  "record_human_request",
  "resolve_human_request",
  "commit_memory",
  "add_artifact",
  "mark_run_repairing",
  "complete_run",
  "get_run_detail",
  "get_snapshot",
  "get_preview_url"
]);
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test -- test/mcpServer.test.ts`

Expected: FAIL because new handlers and tool registrations are absent.

- [ ] **Step 4: Add schemas, handlers, and definitions**

Implementation shape:

```ts
const startAttemptSchema = z.object({
  runId: z.string().min(1),
  summary: z.string().optional()
});

const completeAttemptSchema = z.object({
  attemptId: z.string().min(1),
  status: z.enum(["completed", "failed"]).optional(),
  summary: z.string().optional()
});

const resolveHumanRequestSchema = z.object({
  requestId: z.string().min(1),
  response: z.string().min(1)
});

const markRunRepairingSchema = z.object({
  runId: z.string().min(1),
  reason: z.string().optional()
});

const getRunDetailSchema = z.object({
  runId: z.string().min(1)
});
```

Handler shape:

```ts
start_attempt: async (input) => {
  const args = startAttemptSchema.parse(input);
  return toToolResult(await service.startAttempt(args.runId, { summary: args.summary }));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- test/mcpServer.test.ts`

Expected: PASS for MCP tests.

- [ ] **Step 6: Commit**

```bash
git add plugins/dittosloop-for-codex/mcp/src/mcpServer.ts plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts
git commit -m "feat: expose run detail mcp tools"
```

## Task 3: Preview API

**Files:**
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/src/previewServer.ts`
- Test: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `LoopService.getRunDetail(runId)`.
- Produces: `GET /api/runs/:runId`.

- [ ] **Step 1: Write failing preview server tests**

Add to `mcp/test/previewServer.test.ts`:

```ts
test("serves composed run detail api", async () => {
  const service = await createService();
  const loop = await service.createLoop({ title: "Code health", intent: "Keep checks visible" });
  const run = await service.triggerRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail).toMatchObject({
    run: { id: run.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }]
  });
});

test("returns 404 for unknown run detail", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/run_missing`);
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body).toEqual({ error: "Run not found: run_missing" });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- test/previewServer.test.ts`

Expected: FAIL because `/api/runs/:runId` is served as a static 404 or generic server error.

- [ ] **Step 3: Implement the endpoint**

Implementation shape:

```ts
const runDetailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
if (runDetailMatch) {
  await sendJson(response, await options.service.getRunDetail(decodeURIComponent(runDetailMatch[1])));
  return;
}
```

Error handling shape:

```ts
if (error instanceof Error && error.message.startsWith("Run not found:")) {
  response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify({ error: error.message })}\n`);
  return;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- test/previewServer.test.ts`

Expected: PASS for preview server tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/dittosloop-for-codex/mcp/src/previewServer.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "feat: serve run detail preview api"
```

## Task 4: Preview Run Detail UI

**Files:**
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/index.html`
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/app.js`
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/preview/styles.css`
- Test: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `/api/snapshot` and `/api/runs/:runId`.
- Produces: three panels: loops, runs, and selected run detail.

- [ ] **Step 1: Write failing shell test**

Extend `serves the preview shell` in `mcp/test/previewServer.test.ts`:

```ts
expect(html).toContain("Run detail");
expect(html).toContain("id=\"run-detail\"");
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- test/previewServer.test.ts`

Expected: FAIL because the shell has no run detail panel.

- [ ] **Step 3: Update HTML**

Add the third panel inside `.workspace`:

```html
<div class="panel detail-panel">
  <div class="panel-heading">
    <h2>Run detail</h2>
  </div>
  <div id="run-detail" class="run-detail"></div>
</div>
```

- [ ] **Step 4: Update JavaScript rendering**

Implementation shape:

```js
let selectedRunId = null;

async function loadRunDetail(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Run detail request failed: ${response.status}`);
  }
  renderRunDetail(await response.json());
}
```

```js
function renderRunDetail(detail) {
  elements.runDetail.replaceChildren(
    text("div", "detail-title", detail.loop.title),
    text("div", "card-meta", `${detail.run.id} · ${detail.run.status}`),
    section("Attempts", detail.attempts.map((attempt) => item(attempt.status, attempt.summary ?? attempt.id))),
    section("Timeline", detail.events.map((event) => item(event.kind, event.message))),
    section("Verification", detail.verificationResults.map((result) => item(result.status, result.summary))),
    section("Human Requests", detail.humanRequests.map((request) => item(request.status, request.response ?? request.question))),
    section("Memory", detail.memoryCommits.map((commit) => item("memory", commit.summary))),
    section("Artifacts", detail.artifacts.map((artifact) => item(artifact.kind ?? "artifact", artifact.url ?? artifact.path ?? artifact.title)))
  );
}
```

- [ ] **Step 5: Update CSS layout**

Implementation shape:

```css
.workspace {
  grid-template-columns: minmax(0, 0.82fr) minmax(0, 1fr) minmax(320px, 1.18fr);
}

.run-detail {
  display: grid;
  gap: 14px;
  padding: 12px;
}

@media (max-width: 960px) {
  .workspace {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npm test -- test/previewServer.test.ts`

Expected: PASS for preview server tests.

- [ ] **Step 7: Commit**

```bash
git add plugins/dittosloop-for-codex/preview/index.html plugins/dittosloop-for-codex/preview/app.js plugins/dittosloop-for-codex/preview/styles.css plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "feat: render run detail preview panel"
```

## Task 5: Documentation And Final Verification

**Files:**
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/README.md`
- Modify: `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/plugins/dittosloop-for-codex/skills/loop/SKILL.md`

**Interfaces:**
- Consumes: new MCP tool names and run lifecycle.
- Produces: updated user-facing usage guidance.

- [ ] **Step 1: Update README lifecycle section**

Add a concise lifecycle example:

```md
### Run Detail Flow

1. `trigger_run` creates the run.
2. `start_attempt` begins visible work under that run.
3. `complete_attempt` records the attempt outcome.
4. `record_verification` can attach results to `attemptId`.
5. Failed verification with `repair: true` moves the run to `repairing`.
6. `resolve_human_request` closes a user decision with the response.
7. `get_run_detail` returns the composed view shown in the preview.
```

- [ ] **Step 2: Update loop skill guidance**

Add guidance:

```md
- Start an attempt with `start_attempt` before doing substantive loop work.
- Record verification with `attemptId` when the result belongs to a specific attempt.
- If verification fails and repair work is needed, set `repair: true` on `record_verification` or call `mark_run_repairing`.
- Resolve user questions with `resolve_human_request` once the user answers.
```

- [ ] **Step 3: Run full test suite**

Run: `npm test`

Expected: all test files pass with 0 failures.

- [ ] **Step 4: Run build**

Run: `npm run build`

Expected: TypeScript build exits 0.

- [ ] **Step 5: Run plugin validation**

Run from repo root:

```bash
.venv/bin/python - <<'PY'
import json
from pathlib import Path
import yaml

root = Path("plugins/dittosloop-for-codex")
manifest = json.loads((root / ".codex-plugin" / "plugin.json").read_text())
assert manifest["name"] == "DittosLoop For Codex"
for skill in manifest.get("skills", []):
    skill_path = root / skill["path"] / "SKILL.md"
    assert skill_path.exists(), skill_path
    content = skill_path.read_text()
    assert content.startswith("---\n"), skill_path
    yaml.safe_load(content.split("---", 2)[1])
print("plugin validation ok")
PY
```

Expected: `plugin validation ok`.

- [ ] **Step 6: Run local preview smoke check**

Run from `plugins/dittosloop-for-codex/mcp`:

```bash
node dist/index.js
```

Then request:

```bash
curl -sS http://127.0.0.1:47888/api/snapshot
curl -sS http://127.0.0.1:47888/
```

If a sample run exists in the local data directory, also request:

```bash
curl -sS http://127.0.0.1:47888/api/runs/<sample-run-id>
```

Expected: snapshot returns JSON, page shell returns HTML containing `Run detail`, and run detail returns composed JSON when a real run id is available.

- [ ] **Step 7: Commit**

```bash
git add plugins/dittosloop-for-codex/README.md plugins/dittosloop-for-codex/skills/loop/SKILL.md
git commit -m "docs: document run detail lifecycle"
```

- [ ] **Step 8: Final status**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree and recent commits show this increment.

