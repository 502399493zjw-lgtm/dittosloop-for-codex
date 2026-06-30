# Task 6 Report

- Status: DONE_WITH_CONCERNS
- Commits: initial implementation `9db6564 feat: wire runtime script service execution`, session-resume fix `814819e fix: journal runtime script session resumes`; runtime input-boundary fix included in the current diff.

## Red test evidence

- Command: `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts`
- Expected failing symptom before implementation: `Error: Execution graph compilation requires body.steps`

## Review fix evidence

- Task reviewer finding: async runtime-script sub-agent completions were not journaled on `recordSessionResult()`, and completed runtime-script sub-agent sessions were not visible in `run.codexSession.subagents`.
- Added RED coverage in `test/service.runtimeScript.test.ts`:
  - immediate completed runtime-script `agent()` sessions must appear in run subagent metadata.
  - pending session -> `recordSessionResult()` -> resume must reuse the journal entry, avoid a duplicate `createSession()`, run verification against the final script result, and expose completed subagent metadata.
- RED command before fix: `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts`
  - Failed with missing completed runtime-script subagent metadata and no verifier call after pending-session writeback.
- Second task reviewer finding: `compileContract()` still accepted direct `workflow: { kind: "runtime_script", source }` input, bypassing the explicit `workflowKind: "runtime_script"` plus string `script` contract.
- Added RED coverage:
  - `test/service.runtimeScript.test.ts` rejects direct runtime workflow object creation through `LoopService`.
  - `test/contract.test.ts` rejects runtime workflow objects for external `compileContract()` while preserving stored runtime workflow objects through the explicit internal recompile helper.
- RED command before input-boundary fix: `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts`
  - Failed because direct runtime workflow object input resolved to a contract instead of rejecting.

## Verification commands and results

- `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts`
  - Passed (`4` tests)
- `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts test/contract.test.ts`
  - Passed (`35` tests)
- `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/service.runtimeScript.test.ts test/service.test.ts test/mcpServer.test.ts`
  - Passed (`136` tests)
- `cd plugins/dittosloop-for-codex/mcp && npm run typecheck`
  - Passed
- `cd plugins/dittosloop-for-codex/mcp && npm run build`
  - Passed and refreshed `dist/index.js`
- `git diff --check`
  - Passed

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/runtimeScript/scheduler.ts`
- `plugins/dittosloop-for-codex/mcp/src/types.ts`
- `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.runtimeScript.test.ts`
- `plugins/dittosloop-for-codex/mcp/dist/index.js`
- `.superpowers/sdd/task-6-report.md`

## Notes/concerns

- Task 6 now executes `runtime_script` contracts end to end, stores runtime-script context state, avoids graph snapshot compilation, records runtime-script engine events, and verifies against the script result.
- The service-backed runtime-script bridge now stores runtime-script journal identity on task runs, backfills the journal from `recordSessionResult()`, and resumes scripts from cached completed agent calls instead of completing the whole workflow from a sub-agent result.
- Completed runtime-script `agent()` sessions now flow through the existing completed-session bookkeeping so they are visible in `run.codexSession.subagents`.
- External runtime-script creation now only accepts the explicit `workflowKind: "runtime_script"` plus string `script` shape; direct runtime workflow objects are reserved for internal stored-contract recompilation.
- Approval policy validation is currently structural at execution time; this task does not add a separate manual-approval gate before runtime-script execution.
