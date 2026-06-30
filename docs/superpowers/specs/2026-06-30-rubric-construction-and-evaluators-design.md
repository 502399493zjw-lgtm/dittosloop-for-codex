# Rubric Construction and Evaluator Selection Design

## Context

The loop skill already has `verification` v2 concepts: criteria, validators, decision policy, evidence, and repair behavior. The current rubric guidance is too generic, so loop creation can produce broad validators that mark many criteria as covered without forcing calibrated evidence.

The user specifically wants discovery-style loops to behave like a radar: weak signals are allowed, but the result must distinguish confirmed findings, pending verification, and low-confidence leads. The user also asked to account for script evaluator cases.

## Goal

Improve the loop skill's rubric construction guidance so Codex designs verification from the intended judgment mode, failure risks, and evaluator fit before creating the formal contract.

The updated skill guidance should make Codex:

- Choose a human-facing rubric strategy / judgment mode before drafting criteria.
- Separate workflow requirements, rubric criteria, and validator evidence contracts.
- Build criteria from likely failure risks instead of vague quality ideals.
- Use the discovery-radar pattern when weak evidence is acceptable but confidence inflation is not.
- Select script evaluators only for deterministic or machine-checkable checks, and combine them with rubric agents or human review when judgment is qualitative.

## Non-Goals

- Do not change the runtime verification schema.
- Do not add new MCP tools.
- Do not alter existing verification aggregation behavior.
- Do not update the installed plugin cache directly from this change.
- Do not require lengthy rubric workshops for low-risk loops.

## Design

Update `plugins/dittosloop-for-codex/skills/loop/references/define-rubric.md`.

Add a rubric construction method:

1. Pick a rubric strategy / judgment mode: `strict-audit`, `discovery-radar`, `action-runner`, `creative-output`, or `code-change`. This is not the JSON `verification.mode` field.
2. Separate three layers:
   - workflow requirement: what the worker must produce;
   - rubric criterion: the acceptance condition;
   - validator evidence contract: what proof lets the verifier pass or fail it.
3. List failure risks first, then convert each material risk into one or more criteria.
4. Split validators by judgment type.
5. Define evidence and failure handling before writing JSON.

Add a discovery-radar pattern:

- Weak leads are allowed. Miscalibrated certainty is not.
- Findings must be labeled as confirmed, pending verification, or low confidence.
- Evidence limitations must remain visible.
- Unsupported or noisy signals must not be promoted to confirmed conclusions.

Add script evaluator guidance:

- Use scripts for deterministic checks such as schema shape, required fields, counts, enum values, date windows, duplicate detection, source IDs, unresolved TODO markers, and cross-reference integrity.
- Do not use scripts as the only validator for domain judgment, credibility, qualitative relevance, strategic usefulness, or user-taste decisions.
- In hybrid verification, let scripts produce metrics and structural failures, then let rubric agents or humans judge interpretation.
- Keep the existing evaluator-builder requirements: visible subagent, fixture or dry-run sample, self-check, checksum, and `verification_result_v1` stdout.

## Expected User Experience

When a user asks for a discovery loop, Codex should propose criteria that make confidence calibration explicit instead of treating every lead as a pass/fail fact.

When a user asks for a format-heavy or data-heavy loop, Codex should consider a script evaluator, but only for the parts that are objectively checkable.

## Testing

Update `test/loop-skill-memory.test.mjs` with focused assertions that `define-rubric.md` contains:

- The five rubric strategies.
- The strategy is not the JSON `verification.mode` field.
- The three-layer distinction between workflow requirement, rubric criterion, and validator evidence contract.
- Failure-risk-first construction.
- The discovery-radar calibration rule.
- Script evaluator fit and anti-fit guidance.

Run the targeted Node test, then the full repository check.

## Risks

The main risk is over-prescribing verification and making loop creation feel heavy. The guidance should preserve the existing lightweight rule: only surface detailed rubric discussion when verification quality materially affects the loop.
