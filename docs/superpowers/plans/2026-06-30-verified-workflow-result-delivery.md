# Verified Workflow Result Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DittosLoop return and display the verified workflow result directly in the current Codex session and preview, while keeping stale verification lifecycle events as history only.

**Architecture:** Keep runtime state as the source of truth. Update the MCP session-result envelope to prefer direct workflow output, update the loop skill so agents relay that envelope directly, merge persisted verification results into preview timeline data, and make the frontend phase rail prefer canonical persisted verification results over historical engine events.

**Tech Stack:** TypeScript, Vitest, Node.js built-in test runner, browser preview JavaScript, Codex plugin skill Markdown.

## Global Constraints

- Work in isolated worktree `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/.worktrees/fde-verified-workflow-result` on branch `fde-verified-workflow-result`.
- Runtime state is the source of truth; preview remains read-only display.
- Do not change the DittosLoop runtime state machine.
- Do not remove engine lifecycle events from the API.
- Do not change verification v2 schemas, validator contracts, or repair policy behavior.
- Do not introduce hosted/background automation.
- Do not rewrite the preview architecture or replace the workflow view model.
- Use TDD: write the failing test before implementation in each task.
- Rebuild generated `plugins/dittosloop-for-codex/mcp/dist/index.js` after TypeScript source changes.

---

### Task 1: Skill Delivery Contract

**Files:**
- Modify: `test/loop-skill-memory.test.mjs`
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`

**Interfaces:**
- Consumes: workflow tool responses that contain `sessionResult.finalAnswer`, `sessionResult.result`, `sessionResult.artifacts`, and `sessionResult.verification`.
- Produces: installed skill guidance requiring the top-level Codex session to return the verified workflow result directly, with artifacts and verification notes secondary.

- [ ] **Step 1: Write the failing skill-doc test**

Add this test after `loop skill references preserve memory, execution, and writeback rules` in `test/loop-skill-memory.test.mjs`:

```js
test("loop skill requires direct delivery of verified workflow results", async () => {
  const skill = await readFile(skillPath, "utf8");
  const execution = await readSkillFile("references/execute-loop.md");
  const combined = `${skill}\n${execution}`;

  assert.match(combined, /sessionResult\.finalAnswer/);
  assert.match(combined, /验证后.*workflow result|已验证.*workflow 结果/);
  assert.match(combined, /直接.*主答案|主答案.*直接/);
  assert.match(combined, /不得.*摘要|不要.*摘要|summary-only/);
  assert.match(combined, /文件链接.*附后|链接.*次要|artifacts.*secondary/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/loop-skill-memory.test.mjs`

Expected: FAIL in `loop skill requires direct delivery of verified workflow results` because the current skill docs do not mention `sessionResult.finalAnswer` or the direct verified workflow result rule.

- [ ] **Step 3: Update the top-level skill invariant**

Add this bullet to `plugins/dittosloop-for-codex/skills/loop/SKILL.md` under `## 核心不变量`, after the verification-before-complete bullet:

```markdown
- 如果 workflow 工具返回 `sessionResult`，最终回复必须把 `sessionResult.result` 或 `sessionResult.finalAnswer` 作为主答案直接给用户；verification 说明、artifacts 和文件链接只能附后，不得用摘要、报告位置或链接替代验证后的 workflow result。
```

- [ ] **Step 4: Update execution reference delivery rules**

Add this section to `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md` after the visible execution flow list and before `runtime script 执行会运行 JavaScript 源码`:

```markdown
## 验证后结果交付

当 `execute_workflow_attempt`、`record_session_result`、`record_validator_result` 或 `complete_run` 返回 `sessionResult` 时，当前可见 Codex session 的最终回复必须直接使用该 envelope。

- `sessionResult.status === "completed"` 时，把 `sessionResult.result` 或 `sessionResult.finalAnswer` 作为主答案直接输出给用户。
- `sessionResult.status === "waiting_for_human"` 时，输出打开的 `humanRequest.question` 或 `sessionResult.finalAnswer`，不要把候选结果称为最终结果。
- `sessionResult.artifacts`、文件链接和 verification 状态只能放在主答案之后。
- 不得用 summary-only、报告位置说明、文件链接或重新改写的摘要替代验证后的 workflow result。
```

- [ ] **Step 5: Run skill-doc test to verify it passes**

Run: `node --test test/loop-skill-memory.test.mjs`

Expected: PASS with 8 tests.

- [ ] **Step 6: Commit**

Run:

```bash
git add docs/superpowers/specs/2026-06-30-verified-workflow-result-delivery-design.md \
  docs/superpowers/plans/2026-06-30-verified-workflow-result-delivery.md \
  test/loop-skill-memory.test.mjs \
  plugins/dittosloop-for-codex/skills/loop/SKILL.md \
  plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md
git commit -m "docs: require direct verified workflow result delivery"
```

Expected: one commit containing the spec, implementation plan, and skill delivery contract.

### Task 2: Session Result Envelope Priority

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`

**Interfaces:**
- Consumes: `buildWorkflowSessionResultEnvelope(detail, status)`.
- Produces: `sessionResult.finalAnswer`, `sessionResult.summary`, and `sessionResult.result` that prefer `run.result`, then latest completed non-verification workflow task result, then `run.summary`.

- [ ] **Step 1: Write the failing MCP test**

Add this test after `returns final output through the MCP complete_run writeback` in `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`:

```ts
test("session result envelope prefers workflow task result over run summary", async () => {
  const handlers = await createHandlers();

  const contract = readResult(await handlers.create_loop_contract({
    title: "Verified report handoff",
    goal: "Return the verified workflow result",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan updates" }]
    },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Manual report" }));

  await handlers.execute_workflow_attempt({
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  await handlers.record_session_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "scan",
    idempotencyKey: "session_1:verified-result",
    status: "passed",
    summary: "Worker summary",
    result: "Verified workflow report body"
  });

  const completed = readResult<{
    id: string;
    status: string;
    summary?: string;
    result?: string;
    sessionResult?: {
      status: string;
      finalAnswer: string;
      summary: string;
      result?: string;
    };
  }>(await handlers.complete_run({
    runId: launch.run.id,
    status: "completed",
    summary: "Brief run summary"
  }));

  expect(completed).toMatchObject({
    id: launch.run.id,
    status: "completed",
    summary: "Brief run summary",
    sessionResult: {
      status: "completed",
      finalAnswer: "Verified workflow report body",
      summary: "Verified workflow report body",
      result: "Verified workflow report body"
    }
  });
  expect(completed.result).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts -t "session result envelope prefers workflow task result"`

Expected: FAIL because `buildWorkflowSessionResultEnvelope()` currently chooses `detail.run.summary` before `latestTaskRun?.result`.

- [ ] **Step 3: Implement direct result priority**

In `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`, change:

```ts
const result = detail.run.result ?? detail.run.summary ?? latestTaskRun?.result;
```

to:

```ts
const result = detail.run.result ?? latestTaskRun?.result ?? detail.run.summary;
```

- [ ] **Step 4: Run targeted MCP test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts -t "session result envelope prefers workflow task result"`

Expected: PASS.

- [ ] **Step 5: Run full MCP server test file**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/mcpServer.ts \
  plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts
git commit -m "fix: prefer workflow result in session envelope"
```

Expected: one commit containing the MCP envelope priority fix.

### Task 3: Preview Adapter Verification Timeline

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewAdapter.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`

**Interfaces:**
- Consumes: `enrichRunDetail(detail)`, `buildTimeline(detail, engineEvents)`, `detail.verificationResults`.
- Produces: verification timeline sections that include both historical engine verification events and persisted verification result items.

- [ ] **Step 1: Write the failing preview adapter test**

Add this test to `plugins/dittosloop-for-codex/mcp/test/previewAdapter.test.ts` after `keeps static workflow timeline output unchanged`:

```ts
test("keeps persisted passed verification after stale lifecycle events", () => {
  const baseDetail = runDetailWithEvents([
    event({ type: "verification_started", sequence: 1, attemptId: "attempt_1" }),
    event({
      type: "validator_started",
      sequence: 2,
      attemptId: "attempt_1",
      validatorId: "independent-fde-monitor-review",
      validatorType: "rubric_agent"
    }),
    event({
      type: "verification_decided",
      sequence: 3,
      attemptId: "attempt_1",
      decision: {
        status: "needs_human",
        summary: "Verification needs_human",
        failedValidatorIds: [],
        needsHumanValidatorIds: ["independent-fde-monitor-review"],
        failedCriterionIds: [],
        uncoveredMustCriterionIds: [],
        warnings: [],
        humanQuestion: "Review the report manually."
      }
    })
  ]);
  const detail = enrichRunDetail({
    ...baseDetail,
    run: {
      ...baseDetail.run,
      status: "completed",
      result: "Verified workflow report body"
    },
    verificationResults: [
      {
        id: "verification_1",
        runId: "run_1",
        attemptId: "attempt_1",
        status: "passed",
        summary: "Independent review passed",
        checks: [{ name: "Independent review", status: "passed", evidence: "Report is complete." }],
        createdAt: "2026-06-23T00:05:00.000Z"
      }
    ]
  });

  const verification = detail.timeline.find((section) => section.id === "verification");
  const terminalItems = [...(verification?.items ?? [])]
    .reverse()
    .filter((item) => ["passed", "failed", "needs_human", "skipped"].includes(item.status));

  expect(verification?.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "开始验证", status: "started" }),
    expect.objectContaining({ label: "Validator independent-fde-monitor-review started", status: "started" }),
    expect.objectContaining({ label: "Verification needs_human", status: "needs_human" }),
    expect.objectContaining({ label: "Independent review passed", status: "passed" })
  ]));
  expect(terminalItems[0]).toMatchObject({ label: "Independent review passed", status: "passed" });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewAdapter.test.ts -t "keeps persisted passed verification"`

Expected: FAIL because persisted verification results are ignored whenever engine verification events exist.

- [ ] **Step 3: Implement merged verification timeline helper**

In `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`, replace:

```ts
const verification = verificationEvents.length > 0 ? verificationEvents : detail.verificationResults.flatMap(verificationToTimelineItems);
```

with:

```ts
const verification = mergeVerificationTimelineItems(verificationEvents, detail.verificationResults);
```

Then add these helpers after `verificationToTimelineItems()`:

```ts
function mergeVerificationTimelineItems(
  verificationEvents: PreviewTimelineItem[],
  verificationResults: VerificationResultRecord[]
): PreviewTimelineItem[] {
  const resultItems = verificationResults.flatMap(verificationToTimelineItems);
  if (!verificationEvents.length) return resultItems;
  if (!resultItems.length) return verificationEvents;
  return [...verificationEvents, ...resultItems].sort(compareTimelineItems);
}

function compareTimelineItems(left: PreviewTimelineItem, right: PreviewTimelineItem): number {
  const createdAt = (left.createdAt ?? "").localeCompare(right.createdAt ?? "");
  if (createdAt !== 0) return createdAt;
  return (left.sequence ?? Number.MAX_SAFE_INTEGER) - (right.sequence ?? Number.MAX_SAFE_INTEGER);
}
```

- [ ] **Step 4: Run preview adapter test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewAdapter.test.ts`

Expected: PASS with 3 tests.

- [ ] **Step 5: Run preview server verification timeline tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewServer.test.ts -t "verification"`

Expected: PASS. The existing tests for lifecycle events and persisted fallback evidence must still pass with merged timeline items.

- [ ] **Step 6: Commit**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts \
  plugins/dittosloop-for-codex/mcp/test/previewAdapter.test.ts
git commit -m "fix: include persisted verification in preview timeline"
```

Expected: one commit containing the preview adapter regression fix.

### Task 4: Preview Frontend Canonical State

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/preview/app.js`

**Interfaces:**
- Consumes: `detail.verificationResults`, `detail.timeline`, `detail.workflowContexts`, `run.result`, and `run.summary`.
- Produces: `buildRunPhases(detail)` that prefers canonical persisted verification results over timeline verification phases, and `runFinalOutput(detail)` that prefers direct workflow result over summary fallback.

- [ ] **Step 1: Write source-level preview regression checks**

Add this test after `preview script renders run detail as phase rail and agent cards` in `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`:

```ts
test("preview script prefers canonical verification results and direct workflow output", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("canonicalVerificationAgents(detail.verificationResults)");
  expect(app).toContain("canonicalVerificationPhase(verificationAgents)");
  expect(app).toContain("section.id === \"verification\" && verificationAgents.length");
  expect(app).toContain("if (run.result) return run.result;");
  expect(app).toContain("return taskRuns.at(-1)?.result ?? run.summary ?? \"\";");
  expect(app).not.toContain("const explicit = run.result || run.summary;");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewServer.test.ts -t "canonical verification results"`

Expected: FAIL because the preview script does not yet contain `canonicalVerificationAgents()` or the new output priority.

- [ ] **Step 3: Update final output priority**

In `plugins/dittosloop-for-codex/preview/app.js`, replace the explicit output block in `runFinalOutput(detail)`:

```js
const explicit = run.result || run.summary;
if (explicit) return explicit;
```

with:

```js
if (run.result) return run.result;
```

Then replace the final return:

```js
return taskRuns.at(-1)?.result ?? "";
```

with:

```js
return taskRuns.at(-1)?.result ?? run.summary ?? "";
```

- [ ] **Step 4: Add canonical verification helpers**

In `plugins/dittosloop-for-codex/preview/app.js`, replace the current `verificationAgents` inline mapping in `buildRunPhases(detail)`:

```js
const verificationAgents = detail.verificationResults.map((result) => ({
  id: result.id,
  avatar: result.status === "failed" ? "!" : "验",
  name: "验证结果",
  status: result.status,
  description: result.summary,
  meta: result.attemptId ? `Attempt ${result.attemptId}` : "Run level"
}));
```

with:

```js
const verificationAgents = canonicalVerificationAgents(detail.verificationResults);
```

Add these helper functions near `buildRunPhases(detail)`:

```js
function canonicalVerificationAgents(results) {
  return (results ?? []).map((result) => ({
    id: result.id,
    avatar: result.status === "failed" ? "!" : "验",
    name: "验证结果",
    status: result.status,
    description: result.summary,
    meta: result.attemptId ? `Attempt ${result.attemptId}` : "Run level"
  }));
}

function canonicalVerificationPhase(agents) {
  if (!agents.length) return null;
  const latest = agents.at(-1);
  return {
    id: "verification",
    name: "验证",
    status: timelineStatus(latest.status),
    agents
  };
}
```

- [ ] **Step 5: Prefer canonical verification over timeline verification phase**

In the `for (const section of detail.timeline ?? [])` loop inside `buildRunPhases(detail)`, add this guard before the existing workflow runtime guard:

```js
if (section.id === "verification" && verificationAgents.length) continue;
```

Then replace the existing verification phase append block:

```js
if (!phases.some((phase) => phase.id === "verification") && verificationAgents.length) {
  phases.push({
    id: "verification",
    name: "验证",
    status: verificationAgents.some((agent) => agent.status === "failed") ? "failed" : "passed",
    agents: verificationAgents
  });
}
```

with:

```js
const verificationPhase = canonicalVerificationPhase(verificationAgents);
if (!phases.some((phase) => phase.id === "verification") && verificationPhase) {
  phases.push(verificationPhase);
}
```

- [ ] **Step 6: Run preview source test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewServer.test.ts -t "canonical verification results"`

Expected: PASS.

- [ ] **Step 7: Run focused preview server tests**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- test/previewServer.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

Run:

```bash
git add plugins/dittosloop-for-codex/preview/app.js \
  plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "fix: show canonical verified result in preview"
```

Expected: one commit containing the preview frontend mapping fix.

### Task 5: Build And Full Verification

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/dist/index.js`

**Interfaces:**
- Produces: generated MCP bundle matching changed TypeScript source.
- Produces: final verified branch with source, docs, tests, preview assets, and generated bundle in sync.

- [ ] **Step 1: Build generated MCP bundle**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp run build`

Expected: exit 0 and `plugins/dittosloop-for-codex/mcp/dist/index.js` updated if source bundle output changed.

- [ ] **Step 2: Run focused verification commands**

Run:

```bash
node --test test/loop-skill-memory.test.mjs
npm --prefix plugins/dittosloop-for-codex/mcp test -- test/mcpServer.test.ts test/previewAdapter.test.ts test/previewServer.test.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Run full MCP verification**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
npm --prefix plugins/dittosloop-for-codex/mcp test
```

Expected: both commands exit 0.

- [ ] **Step 4: Run repository verification**

Run:

```bash
npm run verify:generated
npm run test
npm run validate
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Commit generated bundle**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/dist/index.js
git commit -m "build: update dittosloop mcp bundle"
```

Expected: commit is created only if `dist/index.js` changed. If there is no staged diff, skip this commit and keep the branch unchanged.

- [ ] **Step 6: Final status check**

Run: `git status --short`

Expected: clean working tree.
