# Run Detail And Attempt Repair Design

## Status

Approved direction: continue development by deepening the local run model before adding hosted services, background triggers, or release polish.

## Context

The current `DittosLoop For Codex` MVP can create loop contracts, trigger runs, append events, record verification results, record human requests, commit memory, attach artifacts, expose MCP tools, and render a local preview.

The next product gap is that a run is still too flat. Dittos Loop's core idea is not just "a record exists"; it is that each run is visible, attempts are inspectable, verification can fail, repair can happen under the same run, and human decisions are recorded instead of disappearing into chat context.

## Goals

- Make each run a first-class inspectable unit in the preview.
- Add attempt lifecycle support: start, complete, fail, and summarize attempts.
- Attach verification results to an attempt when available.
- Move a run into `repairing` when verification fails and a repair attempt is needed.
- Let human requests be resolved with a response.
- Show the complete run detail in the browser preview: timeline, attempts, verification, human requests, memory, and artifacts.
- Keep everything local-first and explicit.

## Non-Goals

- Do not add cron, webhook, GitHub, Lark, or event triggers.
- Do not connect to hosted `dittosloop.com`.
- Do not introduce background hidden execution.
- Do not redesign the whole preview into a full app shell.
- Do not add editing controls inside the preview; runtime tools remain the write path.

## User Experience

From Codex, a run should feel like a small visible work session:

1. The user or skill triggers a run.
2. Codex starts an attempt before doing substantive work.
3. Codex appends useful events while working.
4. Codex completes the attempt with a summary and status.
5. Codex records verification against the attempt.
6. If verification passes, Codex completes the run.
7. If verification fails, Codex marks the run as `repairing`, starts another attempt, and records the repair work under the same run.
8. If user input is needed, Codex records a human request and keeps the run visible as waiting.
9. When the user answers, Codex resolves the human request and can continue the run.

In the preview, the user should be able to select a run and see why it is in its current state without reading raw JSON.

## Data Model Changes

### Existing Records To Extend

`RunAttempt` already exists in the type model but has not been used by the service or MCP surface. It should become active with:

- `id`
- `runId`
- `status`: `running`, `completed`, or `failed`
- `summary`
- `createdAt`
- `completedAt`

`VerificationResult` should gain:

- optional `attemptId`

`HumanRequest` should gain:

- `status`: `open` or `resolved`
- optional `response`

Existing stored files should keep loading. The store normalization layer should fill new fields conservatively:

- missing human request status becomes `open`
- missing attempts remain an empty array
- missing `attemptId` stays absent

## Service API Changes

Add these methods to `LoopService`:

- `startAttempt(runId, input?)`
- `completeAttempt(attemptId, input?)`
- `resolveHumanRequest(requestId, input)`
- `markRunRepairing(runId, input?)`
- `getRunDetail(runId)`

`recordVerification(runId, input)` should accept optional `attemptId`. If the verification status is `failed`, it should not automatically start repair, but it may update the run to `repairing` when the caller explicitly asks through a boolean such as `repair: true`.

`getRunDetail(runId)` should return a composed view:

- the run
- its loop contract
- attempts for the run
- events for the run
- verification results for the run
- human requests for the run
- memory commits connected to the run
- artifacts for the run

## MCP Tool Changes

Add MCP tools:

- `start_attempt`
- `complete_attempt`
- `resolve_human_request`
- `mark_run_repairing`
- `get_run_detail`

Update `record_verification` input schema:

- optional `attemptId`
- optional `repair`

The existing tools should continue to work with their current inputs.

## Preview Changes

The preview should remain a compact operational interface. It should add a detail panel next to the run list.

Desktop layout:

- Left: loop list
- Middle: run list
- Right: selected run detail

Mobile layout:

- Stacked panels
- Run detail appears below the run list

Run detail sections:

- Header: run id, loop title, status, updated time
- Attempts: newest last, status and summary
- Timeline: run events
- Verification: status, summary, checks
- Human Requests: open/resolved status and response
- Memory: summaries committed during the run
- Artifacts: local paths or URLs

The UI should still load from `/api/snapshot` for the list view. A new `/api/runs/:runId` endpoint can return the composed run detail.

## Error Handling

- Starting an attempt for an unknown run should fail clearly.
- Completing an unknown attempt should fail clearly.
- Completing an already completed attempt should be idempotent only if the incoming status and summary match; otherwise it should fail.
- Resolving an unknown human request should fail clearly.
- Resolving an already resolved human request should return the existing resolved request if the response matches.
- `getRunDetail` for an unknown run should return a 404 in the preview API and an MCP tool error in Codex.

## Testing

Use TDD for all behavior changes.

Service tests:

- start and complete an attempt under a run
- record verification with `attemptId`
- failed verification with repair request moves the run to `repairing`
- resolve a human request with response
- get composed run detail
- preserve compatibility when reading old state without human request status

MCP tests:

- register the new tool names
- call new handlers and inspect JSON responses
- keep existing handlers compatible

Preview server tests:

- `/api/runs/:runId` returns composed detail
- unknown run detail returns 404

UI smoke tests:

- page shell still loads
- sample snapshot renders list metrics
- selected run detail renders attempts and verification

## Acceptance Criteria

- Existing MVP tests still pass.
- New service, MCP, and preview tests cover the run detail flow.
- `npm test` passes.
- `npm run build` passes.
- Codex plugin validator passes.
- Local preview smoke test confirms `/api/snapshot`, `/api/runs/:runId`, and the page shell respond.
- README documents the richer run lifecycle and new tools.

## Future Work

After this increment, the next natural work is install/release polish: versioning, scripted build checks, GitHub marketplace instructions, and a friendlier sample-data smoke flow.
