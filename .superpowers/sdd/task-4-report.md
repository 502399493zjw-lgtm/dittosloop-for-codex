# Task 4 Report: Verification V2 Service State

## Status

DONE_WITH_CONCERNS pending the existing Task 6 workspaceFiles type cleanup.

## Commit

- Commit message: `feat: persist verification v2 results`

## Files Changed

- `plugins/dittosloop-for-codex/mcp/src/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

## State Machine Semantics

- `LoopState.verificationResults` and `RunDetail.verificationResults` now accept legacy `VerificationResult` and persisted `VerificationResultV2`.
- `WorkflowContext.verification` tracks `not_started`, `running`, `waiting_for_validator`, `completed`, and `failed`, plus validator results, pending validator ids, idempotency keys, aggregate decision, and persisted result id.
- For explicit v2 workflow contracts, a worker `recordSessionResult(... status: "passed")` records the task output and starts verification, but does not append a verification result and does not complete the run.
- External rubric-agent validators write back through `recordValidatorResult(runId, input)`.
- `recordValidatorResult` validates the target workflow context, attempt, validator id, result type, and `idempotencyKey`; duplicate idempotency keys return the already persisted v2 result instead of appending another one.
- Once all pending external validators are recorded, service calls `runVerificationV2()` with `priorValidatorResults`, persists the v2 result, and finalizes the run/attempt/context.
- Passed v2 decisions complete the workflow and run.
- Needs-human v2 decisions use the existing waiting-for-human flow and create a human request.
- Failed v2 decisions fail the workflow/run unless repair attempts remain.
- Repairable failed v2 decisions move the run and workflow context to repairing. The repair reason includes failed validator ids and failed criterion ids.
- Legacy rubric contracts migrated by `compileContract()` keep legacy service behavior through a service-side compatibility projection, so old verifier rendering and old workflow tests continue to pass.

## Tests

- PASS: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts`
  - 2 test files passed.
  - 71 tests passed.
- CONCERN: `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
  - Fails only in `src/workspaceFiles.ts`.
  - Remaining errors are the known follow-up area from the brief:
    - `verification.rubrics` still read from v2 `VerificationPolicyV2`.
    - workspace rendering still assumes old `check.name` shape.

## Risks

- `workspaceFiles.ts` still needs Task 6 migration for v2 criteria/result rendering.
- The service compatibility heuristic treats the default compile-time `rubric-agent` migration shape as legacy-compatible. Explicit v2 policies should use non-default validator configuration when they require async writeback semantics.
- `recordValidatorResult` currently supports external `rubric_agent` writeback only; command and score validators remain runner-owned.
