# Task 1 Report

## Status

DONE

## Summary of changes

- Added `static_steps` and `runtime_script` workflow contract types, with optional `FormalLoopContract.body` for runtime script contracts.
- Normalized contract compilation so static `body.steps` and legacy `script.build` remain static workflows, while string `script` requires `workflowKind: "runtime_script"` and defaults approval to `{ required: true }`.
- Added runtime script validation for JavaScript language, non-empty source, a 100,000 character source limit, positive integer limits, approval policy, journal shape, and no `body.steps`.
- Extended rubric-agent validators with required `prompt`, optional score controls, verifier `subagent`, and `allowSelfReview`, with compiler defaults for older v2 and legacy migrations.
- Updated `create_loop_contract` schema guardrails for static/runtime compatibility errors.
- Added focused contract and MCP schema tests for the required static, legacy script, runtime script, rejection, and rubric-agent cases.
- Added minimal static-workflow compatibility guards in service/runner/graph/profile helpers so existing static execution paths typecheck with runtime contracts that do not have `body.steps`.

## Tests

- Baseline before edits:
  - `npm test -- --run test/contract.test.ts test/mcpServer.test.ts`
  - Passed: 2 files, 52 tests.
- RED after adding tests:
  - `npm test -- --run test/contract.test.ts test/mcpServer.test.ts`
  - Failed as expected: 8 failed, 53 passed; missing runtime workflow normalization/schema behavior.
- GREEN after implementation:
  - `npm test -- --run test/contract.test.ts test/mcpServer.test.ts`
  - Passed: 2 files, 61 tests.
- First typecheck after implementation:
  - `npm run typecheck`
  - Failed as expected on optional static `body` call sites in `agentProfiles.ts`, `loopRunner.ts`, `service.ts`, and `compileGraph.ts`.
- Final verification:
  - `npm test -- --run test/contract.test.ts test/mcpServer.test.ts`
  - Passed: 2 files, 62 tests.
  - `npm run typecheck`
  - Passed.

## Files changed

- `.superpowers/sdd/task-1-report.md`
- `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/src/workflowGraph/compileGraph.ts`
- `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

## Concerns or follow-ups

- Runtime VM execution, journal behavior, service execution, and preview events were intentionally not implemented in this slice.
- Untracked `plugins/dittosloop-for-codex/mcp/src/runtimeScript/` and `plugins/dittosloop-for-codex/mcp/test/runtimeScript/` files were present in the worktree and left uncommitted as unrelated work.
