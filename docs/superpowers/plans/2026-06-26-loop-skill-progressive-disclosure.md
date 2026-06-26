# Loop Skill Progressive Disclosure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the DittosLoop For Codex loop skill into a compact `SKILL.md` router plus lifecycle reference files and a tool reference, preserving current behavior.

**Architecture:** Keep one installed skill named `loop`. `SKILL.md` remains the trigger-loaded entry point and contains only the overview, invariants, and routing table. Detailed lifecycle guidance moves to one-level-deep Markdown files under `plugins/dittosloop-for-codex/skills/loop/references/`.

**Tech Stack:** Markdown skill files, Node built-in test runner, existing plugin validation script, existing `npm run check`.

## Global Constraints

- Keep the plugin display name `DittosLoop For Codex`.
- Keep the plugin identifier and folder name `dittosloop-for-codex`.
- Put installed behavior in plugin skills and runtime code, not repository `AGENTS.md`.
- Do not change MCP runtime behavior.
- Do not rename plugin identifiers, MCP tool names, or the skill name.
- Do not add hidden recurrence, background automation, or hook-dependent behavior.
- Keep references one level deep from `SKILL.md`.
- Preserve current loop runtime invariants from the existing flat skill.
- Use test-first changes for the skill structure and content checks.

---

## File Structure

- Modify `test/loop-skill-memory.test.mjs`: replace the flat-file memory-only test with structure and routing tests that read `SKILL.md` and all required reference files.
- Modify `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: reduce it to the compact entry point, stable invariants, and routing table.
- Create `plugins/dittosloop-for-codex/skills/loop/references/choose-workflow.md`: workflow style selection.
- Create `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`: new loop contract creation.
- Create `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`: visible run execution and task writeback.
- Create `plugins/dittosloop-for-codex/skills/loop/references/iterate-loop.md`: verification failure, repair, and workflow revisions.
- Create `plugins/dittosloop-for-codex/skills/loop/references/inspect-loop.md`: state inspection and preview.
- Create `plugins/dittosloop-for-codex/skills/loop/references/memory-and-artifacts.md`: durable memory and artifacts.
- Create `plugins/dittosloop-for-codex/skills/loop/references/human-requests.md`: open and resolve user decisions.
- Create `plugins/dittosloop-for-codex/skills/loop/references/tool-reference.md`: MCP tool map and exact caveats.

## Task 1: Add Failing Skill Structure Test

**Files:**
- Modify: `test/loop-skill-memory.test.mjs`

**Interfaces:**
- Consumes: existing skill file path `plugins/dittosloop-for-codex/skills/loop/SKILL.md`.
- Produces: tests that prove all required reference files exist, `SKILL.md` routes to them, memory rules moved to `memory-and-artifacts.md`, and task result caveats moved to `tool-reference.md`.

- [ ] **Step 1: Replace the old test with structure-focused checks**

Use Node's built-in test runner and `fs/promises`. The test should:

- Read `SKILL.md`.
- Assert front matter still contains `name: loop`.
- Assert `SKILL.md` mentions every expected reference path.
- Assert every expected reference file exists.
- Assert `SKILL.md` is shorter than the old 132-line flat version.
- Assert `memory-and-artifacts.md` documents `read_loop_memory`, `commit_memory`, and top-level visible Codex session ownership.
- Assert `tool-reference.md` documents `record_session_result`, `workflowContextId`, `attemptId`, `idempotencyKey`, and locator consistency.
- Assert `execute-loop.md` documents `start_codex_session`, `execute_workflow_attempt`, and `needs_human`.

- [ ] **Step 2: Run the targeted test and confirm RED**

Run: `node --test test/loop-skill-memory.test.mjs`

Expected: FAIL because the reference files do not exist yet and `SKILL.md` still contains the old flat content.

## Task 2: Split the Loop Skill

**Files:**
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/choose-workflow.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/iterate-loop.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/inspect-loop.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/memory-and-artifacts.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/human-requests.md`
- Create: `plugins/dittosloop-for-codex/skills/loop/references/tool-reference.md`

**Interfaces:**
- Consumes: existing flat `SKILL.md` instructions and the approved design spec.
- Produces: one compact entry point and eight one-level reference files.

- [ ] **Step 1: Rewrite `SKILL.md` as the compact router**

Keep the existing front matter. Include:

- Overview that runtime state is the source of truth and preview is display-only.
- Use cases and the warning against hidden background automation.
- Stable invariants from the design spec.
- Routing table from user intent to reference files.
- A note to read `references/tool-reference.md` for exact tool fields and caveats.
- Common mistakes limited to the highest-risk invariant violations.

- [ ] **Step 2: Create lifecycle reference files**

Move existing content into the named reference files, preserving behavior:

- `choose-workflow.md`: four workflow styles and the rule that verification is an outer layer.
- `create-loop.md`: contract shape, `create_loop_contract`, formal runtime contracts, `task(runtime: "codex")`, compatibility aliases, `sessionPolicy`, subagent hints, and final response summary.
- `execute-loop.md`: `list_loops`, `start_codex_session`, injected memory excerpt, `execute_workflow_attempt`, `record_session_result`, locator consistency, `needs_human`, events, verification, attempts, and completion.
- `iterate-loop.md`: failed verification, `repair: true`, `mark_run_repairing`, workflow revision tools, promote/reject lifecycle.
- `inspect-loop.md`: `get_run_detail`, `get_snapshot`, `get_preview_url`, preview source-of-truth boundary, compatibility run visibility.
- `memory-and-artifacts.md`: `read_loop_memory`, task observation ownership, post-verifier `commit_memory`, and `add_artifact`.
- `human-requests.md`: `record_human_request`, `resolve_human_request`, linked workflow task resume.
- `tool-reference.md`: full MCP tool map and precise `record_session_result` caveats.

- [ ] **Step 3: Run targeted test and confirm GREEN**

Run: `node --test test/loop-skill-memory.test.mjs`

Expected: PASS.

## Task 3: Full Validation and Commit

**Files:**
- Validate all changed files.

**Interfaces:**
- Consumes: completed Task 1 and Task 2 changes.
- Produces: passing repository validation and an implementation commit.

- [ ] **Step 1: Run full repository validation**

Run: `npm run check`

Expected: build passes, repository tests pass, plugin validation passes, MCP tests pass.

- [ ] **Step 2: Inspect final diff**

Run: `git status --short`

Expected: changed plan, changed test, changed `SKILL.md`, and eight new reference files.

- [ ] **Step 3: Commit implementation**

Commit message: `docs: split loop skill into progressive references`

Expected: implementation commit created on branch `codex/skill-progressive-disclosure`.

## Self-Review

- Spec coverage: Task 2 covers compact `SKILL.md`, lifecycle split, `tool-reference.md`, preserved invariants, and one-level references. Task 1 and Task 3 cover validation.
- Deferred-work scan: This plan contains no deferred implementation fields, blank sections, or unspecified file paths.
- Type consistency: No runtime types are introduced; file names and tool names match the approved design spec and existing skill.
