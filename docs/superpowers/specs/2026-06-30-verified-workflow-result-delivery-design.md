# Verified Workflow Result Delivery Design

Review status: draft for user review on 2026-06-30.

Branch: `fde-verified-workflow-result`

## Problem

DittosLoop runs can finish with a verified workflow result recorded in runtime state, but the visible Codex session and preview can still communicate the wrong thing:

- The top-level Codex reply may describe where the report is, or summarize the report, instead of directly returning the workflow result requested by the user.
- The preview timeline can keep stale verification lifecycle events such as `started` or `needs_human` in the main phase display after a later persisted verification result has passed.
- The user sees misleading chips such as "running" or "waiting for you" even when there is no active human request and the latest verification result is already terminal.

The runtime state is already the source of truth. The missing piece is a strict delivery contract for agents and a preview projection that treats persisted workflow and verification results as authoritative over historical lifecycle events.

## Goals

- When a run reaches a terminal verified state, the current Codex session must directly output the verified workflow result, not a summary of it and not only a file link.
- Preserve artifacts and file links as secondary supporting information after the direct result.
- Make the preview's primary run detail reflect the latest persisted verification result and active human request state.
- Keep historical lifecycle events available as audit trail without allowing stale events to drive active status chips.
- Cover the stale verification event regression with tests before implementation.

## Non-Goals

- Do not change the DittosLoop runtime state machine.
- Do not remove engine lifecycle events from the API.
- Do not change verification v2 schemas, validator contracts, or repair policy behavior.
- Do not introduce hosted/background automation.
- Do not rewrite the preview architecture or replace the workflow view model.

## Definitions

**Verified workflow result** means the user-facing result after workflow execution and verification have reached a terminal decision.

Result selection order:

1. `sessionResult.finalAnswer` returned by workflow-facing MCP tools.
2. `run.result`.
3. The latest completed non-verification workflow task result.
4. For failed or blocked states only, the latest verification summary or active human request question.

`run.summary` can be used only as a fallback when no direct result exists. It must not replace a richer workflow result.

**Current verification decision** means the latest persisted verification result in `detail.verificationResults`, ordered by creation time or append order. If present, it is more authoritative for current state than engine lifecycle events.

**Active human request** means a human request with `status === "open"`. Historical `human_request` or `needs_human` events are not active requests after they are resolved or superseded by a later passed verification result.

## Required Behavior

### Codex Session Delivery

When the loop skill runs, checks, or resumes a DittosLoop workflow and the returned tool response includes `sessionResult`:

- If `sessionResult.status === "completed"`, the final assistant answer must directly include `sessionResult.finalAnswer` as the main answer.
- If `sessionResult.result` is present and richer than `finalAnswer`, include that exact result text instead of rewriting it.
- If artifacts are present, list artifact links after the direct result.
- If verification metadata is present, mention the verification status only after the direct result.
- Do not replace the result with a paraphrase, report-location explanation, or manually written summary.
- Do not call a result final when `sessionResult.status === "waiting_for_human"` or the latest verification status is `needs_human`; ask for the active human decision instead.

### Preview Run Detail

The run detail page must show the direct verified workflow result as a first-class output block whenever `run.status` is `completed`, `failed`, or `waiting_for_human` and a result can be derived.

The output block should prefer:

1. `run.result`.
2. Latest completed non-verification workflow task result.
3. `run.summary`.

This keeps a terse run summary from hiding the more useful task result.

### Verification Phase Projection

The preview phase rail must use canonical verification agents derived from `detail.verificationResults` when any persisted verification result exists.

Historical engine verification events may remain in the timeline section, but they must not create active phase chips that conflict with the latest persisted verification decision.

When the latest persisted verification is `passed`:

- Verification phase status is `passed`.
- Older `started` and `needs_human` events are historical only.
- The main phase rail must not show "running" or "waiting for you" for verification.

When the latest persisted verification is `needs_human`:

- The phase rail may show "waiting for you" only if there is an active open human request, or if the verification result itself is the current unresolved decision.
- The direct output block must not present the result as final.

When there are no persisted verification results:

- Existing engine event timeline behavior remains the fallback.

### Human Request Projection

The preview may show "waiting for you" only when:

- `detail.humanRequests` contains at least one open request, or
- the current persisted verification decision is `needs_human` and has not been superseded by a later terminal result.

Resolved or superseded human events must remain historical audit entries, not active blockers.

## Proposed Implementation

### Skill Documentation

Update `plugins/dittosloop-for-codex/skills/loop/SKILL.md` and `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md` with a "Verified result delivery" rule.

The rule should instruct agents to use the session result envelope directly and to keep artifacts/verification notes secondary.

Add or extend `test/loop-skill-memory.test.mjs` so the installed skill docs are required to mention:

- `sessionResult.finalAnswer`
- direct verified workflow result delivery
- no summary-only or link-only replacement

### Session Result Envelope

Update `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts` so `buildWorkflowSessionResultEnvelope()` uses the same direct result preference as this spec:

1. `detail.run.result`
2. latest completed non-verification workflow task result
3. `detail.run.summary`

This prevents a terse summary from masking the richer workflow result in tool responses that the current Codex session is expected to relay.

Add a regression test in `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts` that completes a workflow with both a run summary and a completed task result, and expects `sessionResult.finalAnswer` plus `sessionResult.result` to equal the task result when `run.result` is absent.

### Preview Adapter

Update `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts` so verification timeline construction no longer drops persisted verification results when engine verification events exist.

The adapter should expose both:

- historical engine verification events, for audit trail
- persisted verification result items, for terminal evidence

If the latest persisted verification result is terminal, stale `started` lifecycle items should not be treated as the final current status.

Add a regression test in `plugins/dittosloop-for-codex/mcp/test/previewAdapter.test.ts`:

- Given engine events containing `verification_started`, `validator_started`, `verification_decided: needs_human`, and then a persisted verification result with `status: "passed"`,
- `enrichRunDetail()` returns a verification timeline that includes the passed persisted result,
- the latest terminal verification item is `passed`.

### Preview Frontend

Update `plugins/dittosloop-for-codex/preview/app.js` so `buildRunPhases()` prefers canonical verification agents from `detail.verificationResults` over `timelineSectionPhase()` for the verification phase.

Also update `runFinalOutput()` so direct result selection prefers `run.result`, then latest completed non-verification task result, then `run.summary`.

Add or extend preview server source checks in `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts` to verify the preview script contains:

- canonical verification phase preference
- direct run output preference that does not let `run.summary` mask a task result

## Acceptance Criteria

- A completed run with stale verification lifecycle events and a later passed persisted verification result shows verification as passed in the primary phase rail.
- The same run does not show "running" or "waiting for you" unless there is an active open human request or latest unresolved `needs_human` decision.
- The final output block shows the direct workflow result, not merely the run summary, when a completed task result exists.
- The DittosLoop loop skill instructs future Codex agents to return the verified workflow result directly in the current session.
- Tests fail before the implementation change and pass after the implementation change.

## Verification Plan

Run the focused checks first:

```bash
node --test test/loop-skill-memory.test.mjs
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts previewAdapter.test.ts previewServer.test.ts
```

Before merging, run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
npm --prefix plugins/dittosloop-for-codex/mcp test
npm run test
npm run validate
git diff --check
git status --short
```
