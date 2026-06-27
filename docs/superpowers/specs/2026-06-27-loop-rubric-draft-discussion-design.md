# Loop Rubric Draft Discussion Design

## Context

The loop skill already models verification as `criteria`, `validators`, `decision`, `repairPolicy`, and `stopPolicy`. Creation guidance also tells Codex to mention the verification criteria, validators, and decision policy after creating a loop.

The missing behavior is earlier in the creation conversation: when a user asks Codex to design a loop, Codex should make the rubric design visible before committing the formal contract. Users should be able to confirm or correct the proposed acceptance standards, especially the distinction between hard requirements and nice-to-have quality signals.

## Goal

When creating a new Dittos loop, Codex should include a compact `Rubric Draft` in the pre-creation conversation whenever verification expectations are material to the loop design.

## Non-Goals

- Do not change the runtime verification schema.
- Do not add new MCP tools.
- Do not require lengthy rubric workshops for small, safe loops.
- Do not change workflow style selection rules.
- Do not update the installed plugin cache directly from this change.

## Design

Update `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`.

Under `Creation Method`, add guidance that Codex should surface a `Rubric Draft` before `create_loop_contract` when the loop's acceptance standards are not trivial. The draft should be short and user-facing, not a raw JSON dump.

The draft should cover:

- Success criteria: what the loop result must satisfy.
- Severity: which criteria are `must` versus `should`.
- Validators: whether checks are handled by automated commands, rubric agents, human review, or a mix.
- Evidence: what proof should be attached to a score or pass/fail decision.
- Failure handling: whether failed verification retries, asks the user, or fails the run.

The guidance should keep the interaction lightweight:

- For obvious, low-risk loops, Codex can state the inferred rubric and continue.
- For vague or high-impact loops, Codex should ask the user to confirm or correct the rubric before creating the contract.
- Codex should not ask for every schema field unless the answer affects safety, cost, permissions, external side effects, or verification outcomes.

## Expected User Experience

For a vague request like "make a loop to review release notes," Codex should respond with a compact draft:

```text
Rubric Draft
- Must: release notes are accurate against the code changes.
- Must: user-facing risks and breaking changes are called out with evidence.
- Should: wording is concise and grouped by audience.
- Validator: rubric review with evidence required.
- Failure handling: repair once, then ask if still failing.
```

Then Codex should ask the user to confirm or correct the rubric before creating the loop.

For a small, clear request, Codex can fold the draft into the contract summary and proceed with reasonable defaults.

## Testing

Update `test/loop-skill-memory.test.mjs` so the create-loop guidance test asserts the new rubric discussion behavior:

- `Rubric Draft` appears in `create-loop.md`.
- The guidance mentions `must` and `should` criteria.
- The guidance mentions validators and evidence.
- The guidance mentions failure handling through repair, asking the user, or failing the run.

Run `npm test` after implementation.

## Risks

The main risk is making loop creation too chatty. The guidance should explicitly prefer a compact rubric draft and should continue to make safe defaults for low-risk details.

## Review Notes

This is a skill documentation behavior change only. It should be implemented with a small documentation edit plus a focused regression test.
