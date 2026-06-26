# Task 5 Report: MCP Schema, Tools, And Codex Prompts

## Changes

- Updated the `create_loop_contract` MCP input schema to accept verification v2 contracts with `version: 2`, `criteria`, `validators`, and `decision`.
- Tightened the MCP create boundary so legacy `verification.rubrics` inputs are rejected with v2-focused validation errors.
- Added the `record_validator_result` MCP tool and handler, wired to `LoopService.recordValidatorResult`.
- Added validator-result input coverage for rubric-agent writeback fields, including `status`, `evidence`, `summary`, `output`, `criteriaResults`, `score`, and `maxScore`.
- Updated Codex loop creation and workflow session prompts to use criteria/validators/decision wording instead of rubrics, and to state that workflow task session status is not final verification.
- Kept legacy state/runtime compatibility paths in service code intact; the stricter behavior is scoped to MCP loop creation.

## Tests

- TDD red check: `npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts sessionBridge.test.ts` initially failed because the old MCP schema still required `verification.rubrics`, accepted the legacy shape, and did not expose `record_validator_result`.
- Passing: `npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts sessionBridge.test.ts`
  - 2 files passed
  - 26 tests passed
- Passing: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts`
  - 1 file passed
  - 72 tests passed

## Known Risks

- `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts` still fails in `e2eWorkflow.test.ts` because those tests create loops through the MCP boundary with legacy `verification.rubrics` input. That file is outside the Task 5 allowed modification list, and Task 5 intentionally tightens the MCP create entrypoint.
- `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck` still reports pre-existing or adjacent verification-v2 typing issues in `src/workspaceFiles.ts`, which is outside the Task 5 allowed modification list.
