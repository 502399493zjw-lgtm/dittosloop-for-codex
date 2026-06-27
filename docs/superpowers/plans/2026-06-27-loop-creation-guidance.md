# Loop Creation Guidance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update the DittosLoop loop creation skill guidance so agents clarify vague loop requests lightly, create safer formal contracts, and return the created loop ID plus local board URL.

**Architecture:** This is a Markdown skill-instruction change with a targeted Node `node:test` coverage update. The behavior belongs in `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`, because that file is the lifecycle reference agents read before creating new loops. Existing runtime, preview server, MCP tools, and generated files remain unchanged.

**Tech Stack:** Markdown skill references, Node.js built-in test runner, existing `npm test` repository checks.

## Global Constraints

- Do not change MCP runtime behavior.
- Do not change preview server behavior or UI.
- Do not add hidden background automation.
- Do not require long discovery interviews for every new loop.
- Do not require opening the in-app browser unless the user explicitly asks to view the preview.
- Do not move preview inspection rules out of `references/inspect-loop.md`.
- Keep installed behavior in plugin skill files, not repository `AGENTS.md`.
- Keep manifest paths and plugin identifiers unchanged.

---

### Task 1: Add Creation Guidance And Preview Link Instructions

**Files:**
- Modify: `test/loop-skill-memory.test.mjs`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`

**Interfaces:**
- Consumes: existing `readSkillFile(relativePath)` helper in `test/loop-skill-memory.test.mjs`.
- Produces: tested prose in `references/create-loop.md` that documents the creation method, `get_preview_url`, `loopId`, local board URL, and preview URL failure fallback.

- [ ] **Step 1: Add a failing skill guidance test**

Append this test to `test/loop-skill-memory.test.mjs`:

```js
test("create loop guidance describes clarification, creation, and preview handoff", async () => {
  const createLoop = await readSkillFile("references/create-loop.md");

  assert.match(createLoop, /## Creation Method/);
  assert.match(createLoop, /Restate the inferred loop goal, boundary, trigger, and expected outputs/);
  assert.match(createLoop, /Make reasonable defaults for low-risk details/);
  assert.match(
    createLoop,
    /safety, permissions, cost, destructive actions, external side effects, project binding, or verification/
  );
  assert.match(createLoop, /compact contract draft/);
  assert.match(createLoop, /get_preview_url/);
  assert.match(createLoop, /loopId/);
  assert.match(createLoop, /local DittosLoop board URL/);
  assert.match(createLoop, /local board URL could not be retrieved/);
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```bash
node --test test/loop-skill-memory.test.mjs
```

Expected: FAIL because `create-loop.md` does not yet contain `## Creation Method`, `get_preview_url`, `loopId`, or the local board URL fallback wording.

- [ ] **Step 3: Update the creation reference with the minimal guidance**

Edit `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md` so the top of the file reads:

```markdown
# Create Loop

Read this when the user wants a new Dittos loop or a new formal loop contract.

## Creation Method

Before calling `create_loop_contract`, keep the interaction lightweight and explicit:

1. Restate the inferred loop goal, boundary, trigger, and expected outputs.
2. Make reasonable defaults for low-risk details instead of asking for every missing field.
3. Ask follow-up questions only for missing details that affect safety, permissions, cost, destructive actions, external side effects, project binding, or verification.
4. If the request is vague but safe, propose a compact contract draft and ask the user to confirm or correct it.
5. Convert the agreed or safely inferred shape into a formal loop contract.

## Creation Flow
```

Then update the creation flow list so it includes the preview URL handoff after contract creation:

```markdown
1. Shape the loop contract: title, goal or intent, manual trigger, verification expectations, and whether it needs a structured workflow body.
2. Choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop.
4. After `create_loop_contract` succeeds, call `get_preview_url` so the user can inspect the created loop.
5. New loops should be formal runtime contracts, even when the workflow is compact.
6. Prefer `task` steps with `runtime: "codex"`; old `agent` steps are compatibility aliases.
7. Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
8. Prefer top-level `agentProfiles` plus per-task `agentProfileRef` for reusable Codex task guidance.
9. Put required installed skills in `requiredSkills` on the profile and use `allowDegradedProfiles: true` only as an explicit escape hatch for real-world testing.
10. Keep legacy `subagent` hints only for compatibility with older task shapes.
11. DittosLoop records expectations and runs a best-effort local preflight; it does not claim native Codex skill enforcement or tool allowlist enforcement.
```

Replace the final response paragraph with:

```markdown
The final response after creating a formal loop should state the created `loopId`, the local DittosLoop board URL from `get_preview_url`, the selected workflow style, the task names and responsibilities, the verification criteria, validators, decision policy, and repair/stop policy.

If `get_preview_url` fails or is unavailable, still report the created `loopId` and state that the local board URL could not be retrieved.
```

- [ ] **Step 4: Run the targeted test and confirm GREEN**

Run:

```bash
node --test test/loop-skill-memory.test.mjs
```

Expected: PASS, including the new `create loop guidance describes clarification, creation, and preview handoff` test.

- [ ] **Step 5: Run repository root tests**

Run:

```bash
npm test
```

Expected: PASS for all root tests, including skill structure, plugin validation fixtures, and generated-file checks.

- [ ] **Step 6: Inspect the final diff**

Run:

```bash
git diff -- test/loop-skill-memory.test.mjs plugins/dittosloop-for-codex/skills/loop/references/create-loop.md
```

Expected: The diff only changes the targeted test file and `create-loop.md`. It should not modify runtime, preview UI, generated MCP output, manifests, or unrelated docs.

- [ ] **Step 7: Commit implementation**

Run:

```bash
git add test/loop-skill-memory.test.mjs plugins/dittosloop-for-codex/skills/loop/references/create-loop.md
git commit -m "docs: clarify loop creation guidance"
```

Expected: A commit is created on branch `docs/loop-create-preview-link`.

## Self-Review

- Spec coverage: Task 1 covers vague-request handling, low-risk defaults, critical follow-up questions, compact contract drafts, `get_preview_url`, `loopId`, local board URL reporting, and the unavailable-link fallback.
- Placeholder scan: The plan contains no deferred fields, blank implementation sections, or placeholder tasks.
- Type consistency: No runtime types are introduced; file paths, helper names, tool names, and literal phrases match the existing skill docs and test helper.
