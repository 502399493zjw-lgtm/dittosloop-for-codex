# Loop Rubric Draft Discussion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the DittosLoop creation skill to surface a compact `Rubric Draft` for user discussion before creating loops with material verification expectations.

**Architecture:** This is a skill documentation change guarded by the existing Node test suite. The implementation updates the `create-loop.md` reference file and extends the existing loop skill guidance test so future edits keep the rubric discussion behavior.

**Tech Stack:** Markdown skill references, Node.js built-in test runner, `node:assert/strict`.

## Global Constraints

- Do not change the runtime verification schema.
- Do not add new MCP tools.
- Do not require lengthy rubric workshops for small, safe loops.
- Do not change workflow style selection rules.
- Do not update the installed plugin cache directly from this change.
- Keep implementation small and testable.
- Put installed behavior in plugin skills and runtime code, not `AGENTS.md`.

---

### Task 1: Add Rubric Draft Creation Guidance

**Files:**
- Modify: `test/loop-skill-memory.test.mjs`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`

**Interfaces:**
- Consumes: Existing helper `readSkillFile(relativePath)` in `test/loop-skill-memory.test.mjs`.
- Produces: Updated create-loop guidance containing the literal `Rubric Draft` phrase and explicit references to `must`, `should`, validators, evidence, and failure handling.

- [ ] **Step 1: Add failing assertions to the create-loop guidance test**

In `test/loop-skill-memory.test.mjs`, extend the existing test named `"create loop guidance describes clarification, creation, and preview handoff"` by adding these assertions after the existing `compact contract draft` assertion:

```js
  assert.match(createLoop, /Rubric Draft/);
  assert.match(createLoop, /must/);
  assert.match(createLoop, /should/);
  assert.match(createLoop, /validators/);
  assert.match(createLoop, /evidence/);
  assert.match(createLoop, /repair, ask the user, or fail/);
```

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm test -- --test-name-pattern "create loop guidance describes clarification, creation, and preview handoff"
```

Expected: FAIL because `create-loop.md` does not yet contain `Rubric Draft`.

- [ ] **Step 3: Add compact rubric discussion guidance**

In `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`, update `## Creation Method` so it includes this guidance before the existing final conversion step:

```markdown
4. When verification expectations are material, show a compact `Rubric Draft` before creating the contract. Include success criteria, `must` versus `should` severity, validators, evidence requirements, and failure handling.
5. For obvious, low-risk loops, state the inferred rubric and continue with reasonable defaults. For vague or high-impact loops, ask the user to confirm or correct the rubric before creating the contract.
6. If the request is vague but safe, propose a compact contract draft and ask the user to confirm or correct it.
7. Convert the agreed or safely inferred shape into a formal loop contract.
```

Then add this short explanatory block immediately after the numbered list:

````markdown
Use a user-facing rubric draft instead of raw JSON:

```text
Rubric Draft
- Must: the result satisfies the loop's primary goal with evidence.
- Should: the result follows the user's preferred format and tone.
- Validators: automated checks, rubric agents, human review, or a mix.
- Evidence: command output, cited sources, artifact links, or reviewer notes.
- Failure handling: repair, ask the user, or fail the run.
```
````

The surrounding text must keep the lightweight-creation rule intact: do not ask for every schema field unless it affects safety, cost, permissions, external side effects, project binding, or verification outcomes.

- [ ] **Step 4: Run the targeted test and verify it passes**

Run:

```bash
npm test -- --test-name-pattern "create loop guidance describes clarification, creation, and preview handoff"
```

Expected: PASS for the targeted test.

- [ ] **Step 5: Run the full repository test suite**

Run:

```bash
npm test
```

Expected: all tests pass, including the loop skill guidance tests.

- [ ] **Step 6: Review the diff**

Run:

```bash
git diff -- test/loop-skill-memory.test.mjs plugins/dittosloop-for-codex/skills/loop/references/create-loop.md
```

Expected: the diff only changes the rubric draft test assertions and the create-loop skill guidance.

- [ ] **Step 7: Commit the implementation**

Run:

```bash
git add test/loop-skill-memory.test.mjs plugins/dittosloop-for-codex/skills/loop/references/create-loop.md
git commit -m "docs: discuss rubric drafts during loop creation"
```

Expected: one implementation commit on the current worktree branch.

---

## Self-Review Checklist

- [ ] The plan covers every requirement in `docs/superpowers/specs/2026-06-27-loop-rubric-draft-discussion-design.md`.
- [ ] The implementation does not change runtime schemas or MCP tools.
- [ ] The guidance keeps loop creation lightweight and avoids lengthy rubric workshops.
- [ ] The regression test checks `Rubric Draft`, `must`, `should`, validators, evidence, and failure handling.
- [ ] `npm test` is the final verification command.
