STATUS: DONE

Commits created:
- `fix: isolate failed runtime script child sessions`

Files changed:
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/src/runtimeScript/scheduler.ts`
- `plugins/dittosloop-for-codex/mcp/src/runtimeScript/sandbox.ts`
- `plugins/dittosloop-for-codex/mcp/test/runtimeScript/sandbox.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/runtimeScript/serviceSubagentBridge.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.runtimeScript.test.ts`
- `plugins/dittosloop-for-codex/mcp/dist/index.js`
- `.superpowers/sdd/final-review-fix-2-report.md`

RED test failures observed before implementation:
- `test/runtimeScript/sandbox.test.ts`
  - `pipeline stage callbacks receive previous value, original item, and item index`
  - Observed second stage argument as the item index and third argument as `undefined` instead of `(previousValue, originalItem, itemIndex)`.
- `test/runtimeScript/serviceSubagentBridge.test.ts`
  - `failed runtime script child session inside parallel is isolated as null while siblings finish`
  - Runtime script execution threw `bad exploded` instead of converting the failed child session into an isolated `null` branch result.
- `test/service.runtimeScript.test.ts`
  - `failed pending runtime script child session resumes as null once sibling writebacks are complete`
  - After recording the final failed child-session writeback, `recordSessionResult()` returned run status `failed` instead of keeping the runtime script run resumable.

Verification commands and results:
- `npm test -- --run test/runtimeScript/sandbox.test.ts test/runtimeScript/serviceSubagentBridge.test.ts test/service.runtimeScript.test.ts`
  - Passed: `3` files, `33` tests.
- `npm run typecheck`
  - Passed.
- `npm test`
  - Passed: `26` files, `337` tests; `1` live test skipped.
- `npm run build`
  - Passed and regenerated `plugins/dittosloop-for-codex/mcp/dist/index.js`.
- `git diff --check`
  - Passed.

Concerns:
- None.
