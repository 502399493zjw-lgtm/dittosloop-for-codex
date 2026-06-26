# Task 4 Report: Verification V2 Service State

## Status

DONE_WITH_CONCERNS pending the existing Task 6 workspaceFiles type cleanup.

## Commit

- `f9d0d68 feat: persist verification v2 results`
- `7b08ce1 fix: harden verification v2 service state`
- Second follow-up: `fix: preserve unmarked legacy verification contracts`

## Files Changed

- `plugins/dittosloop-for-codex/mcp/src/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

## Review Fixes

- `recordValidatorResult` now rejects new validator writeback unless the target workflow context is already in `running` or `waiting_for_validator` verification state and has completed worker output to verify.
- The idempotency replay path remains allowed for already-recorded validator writebacks.
- Legacy compatibility now uses a service compile-time verification input marker instead of shape matching. Contracts created from legacy input keep legacy behavior after compile-time migration, while explicit v2 policies keep async v2 behavior even if they have the default migrated legacy shape.
- Added regression coverage for validator writeback before worker completion and explicit v2 legacy-like rubric-agent policies.
- Unmarked historical v2 contracts now retain a legacy compatibility fallback only when they match the default legacy migration shape.
- Marked explicit v2 contracts still use async v2 verification even when their policy shape matches the default legacy migration output.
- Added regression coverage for persisted legacy-migrated contracts that predate the marker.

## State Machine Semantics

- `LoopState.verificationResults` and `RunDetail.verificationResults` now accept legacy `VerificationResult` and persisted `VerificationResultV2`.
- `WorkflowContext.verification` tracks `not_started`, `running`, `waiting_for_validator`, `completed`, and `failed`, plus validator results, pending validator ids, idempotency keys, aggregate decision, and persisted result id.
- For explicit v2 workflow contracts, a worker `recordSessionResult(... status: "passed")` records the task output and starts verification, but does not append a verification result and does not complete the run.
- External rubric-agent validators write back through `recordValidatorResult(runId, input)`.
- `recordValidatorResult` validates the target workflow context, attempt, verification phase, completed worker output, validator id, result type, and `idempotencyKey`; duplicate idempotency keys return the already persisted v2 result instead of appending another one.
- Once all pending external validators are recorded, service calls `runVerificationV2()` with `priorValidatorResults`, persists the v2 result, and finalizes the run/attempt/context.
- Passed v2 decisions complete the workflow and run.
- Needs-human v2 decisions use the existing waiting-for-human flow and create a human request.
- Failed v2 decisions fail the workflow/run unless repair attempts remain.
- Repairable failed v2 decisions move the run and workflow context to repairing. The repair reason includes failed validator ids and failed criterion ids.
- Legacy rubric contracts migrated by `compileContract()` keep legacy service behavior through a service-side compatibility projection, so old verifier rendering and old workflow tests continue to pass.
- Historical persisted contracts without the service marker still use legacy behavior when their v2 policy matches the default legacy migration shape.

## Tests

- PASS: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts`
  - 2 test files passed.
  - 74 tests passed.
- CONCERN: `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
  - Fails only in `src/workspaceFiles.ts`.
  - Remaining errors are the known follow-up area from the brief:
    - `verification.rubrics` still read from v2 `VerificationPolicyV2`.
    - workspace rendering still assumes old `check.name` shape.

## Risks

- `workspaceFiles.ts` still needs Task 6 migration for v2 criteria/result rendering.
- `recordValidatorResult` currently supports external `rubric_agent` writeback only; command and score validators remain runner-owned.
