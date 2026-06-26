# Task 3 Report: LoopRunner Verification V2 Integration

## Commit

- `feat: wire verification v2 into loop runner`

## Files Changed

- `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`
- `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`

## Implementation Notes

- `LoopRunner` now routes `verification.version === 2` policies through `runVerificationV2()` instead of the legacy no-verifier auto-pass fallback.
- Legacy runtime-shaped contracts without `version: 2` still keep the existing `verifier` / `createPassedDecision()` behavior.
- `LoopRunResult.verification` now supports both legacy `VerificationDecision` and `VerificationResultV2`.
- `LoopRunnerOptions` accepts `commandExecutor` and forwards it to v2 command validators.
- Engine event types now include `validator_started`, `validator_done`, and `verification_decided`.
- `runVerificationV2()` accepts an `emit` callback and emits validator start/done events plus the aggregated verification decision.
- `VerificationResultV2` includes a legacy-compatible `checks` snapshot and decision-derived `repairInstructions` / `humanQuestion` fields so existing consumers can read common verification fields while v2-specific data remains available via `validatorResults` and `decision`.

## Semantic Choices And Concerns

- For a v2 `rubric_agent` without a prior recorded result, the runner does not auto-pass. The current v2 verifier returns `needs_human`, so `LoopRunner` returns `waiting_for_human` with `shouldRepair: false` under existing status/repair semantics.
- This intentionally differs from the brief's example expectation of `repairing` / `failed`; it follows the actual v2 aggregation behavior and the user's instruction to prefer current v2 runner semantics.
- `npm run typecheck` still fails outside Task 3 write scope because `src/service.ts` and `src/workspaceFiles.ts` still read legacy `verification.rubrics` from `VerificationPolicyV2`. No Task 3 implementation files remain in the typecheck error list.

## Verification

- Initial red run:
  - `npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts engine.test.ts`
  - Failed because `LoopRunner.verify()` still read `contract.verification.rubrics` for v2 contracts.
- Final required tests:
  - `npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts engine.test.ts`
  - PASS: 2 files, 9 tests.
- Additional required test after touching `verificationV2.ts`:
  - `npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts`
  - PASS: 1 file, 9 tests.
- Additional check:
  - `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
  - FAILS only on out-of-scope legacy `verification.rubrics` reads in `src/service.ts` and `src/workspaceFiles.ts`.
