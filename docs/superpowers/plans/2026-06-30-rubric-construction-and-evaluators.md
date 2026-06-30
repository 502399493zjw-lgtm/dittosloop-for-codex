# Rubric Construction and Evaluator Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the DittosLoop loop skill to construct rubrics by human-facing rubric strategy, failure risk, and evaluator fit, including discovery-radar and script evaluator cases.

**Architecture:** This is a skill documentation change guarded by Node tests. The implementation updates `define-rubric.md` and extends the loop skill documentation regression test.

**Tech Stack:** Markdown skill references, Node.js built-in test runner, `node:assert/strict`.

## Global Constraints

- Do not change the runtime verification schema.
- Do not add new MCP tools.
- Do not update the installed plugin cache directly.
- Keep loop creation lightweight for low-risk loops.
- Keep evaluator-builder behavior visible and explicit when custom script evaluators are needed.

---

### Task 1: Add Regression Tests

**Files:**
- Modify: `test/loop-skill-memory.test.mjs`

- [ ] Add a test that asserts `define-rubric.md` describes the five rubric strategies and says they are not the JSON `verification.mode` field.
- [ ] Add assertions for the three-layer split: workflow requirement, rubric criterion, validator evidence contract.
- [ ] Add assertions for failure-risk-first rubric construction.
- [ ] Add assertions for the discovery-radar calibration rule and confirmed / pending verification / low confidence labels.
- [ ] Add assertions for script evaluator fit and anti-fit guidance.
- [ ] Run the targeted test and confirm it fails before changing the skill reference.

### Task 2: Update Rubric Guidance

**Files:**
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/define-rubric.md`

- [ ] Add the rubric construction method.
- [ ] Add the rubric strategy list.
- [ ] Add the discovery-radar pattern.
- [ ] Expand validator selection guidance for script evaluators.
- [ ] Preserve the existing evaluator-builder requirements.

### Task 3: Verify

- [ ] Run the targeted Node test.
- [ ] Run `npm run check`.
- [ ] Review the diff and ensure it only touches the intended documentation and tests.

## Self-Review Checklist

- [ ] The guidance makes confidence calibration explicit for discovery loops.
- [ ] Script evaluators are recommended for deterministic checks only.
- [ ] Qualitative judgment still routes to rubric agents or human review.
- [ ] The skill avoids raw JSON as the first user-facing rubric discussion.
- [ ] Existing runtime schema and MCP behavior are unchanged.
