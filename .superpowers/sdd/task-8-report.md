# Task 8 Report: Runtime Script Approval Gate

## RED Evidence

- Added focused coverage in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/approval.test.ts` before changing service or MCP code.
- Initial run:

  ```bash
  cd plugins/dittosloop-for-codex/mcp
  npm test -- --run test/runtimeScript/approval.test.ts
  ```

- Failure symptoms:
  - `unapproved runtime script is blocked before execution and verification` failed because execution fell through into runtime verification logic instead of stopping before the VM.
  - `approval tool persists approval and allows runtime script execution` failed because `approve_runtime_script` did not exist.
  - `approval state is persisted on the active runtime script contract` failed because `LoopService.approveRuntimeScript()` did not exist.
  - `static workflows do not require runtime script approval` exposed a bad test executor shape, which I corrected to match the repository's `Executor` interface before continuing.

## Changed Files

- `plugins/dittosloop-for-codex/mcp/src/service.ts`
  - Added `approveRuntimeScript()` to persist `approvedAt` / `approvedBy` on the active runtime-script contract.
  - Propagates approval metadata into non-terminal runtime-script `workflowContext.contractSnapshot` records so a run started before approval can continue after approval.
  - Gates `executeRuntimeScriptWorkflowAttempt()` before VM execution when approval is required but absent.
  - Marks the workflow context as waiting for human input and records a single reusable approval request instead of entering execution.
- `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
  - Added MCP-visible `approve_runtime_script` with the preferred `{ loopId, approvedBy }` input shape.
- `plugins/dittosloop-for-codex/mcp/test/runtimeScript/approval.test.ts`
  - Covers blocked unapproved execution, approval-driven execution, approval persistence, and static workflow non-regression.
- `plugins/dittosloop-for-codex/mcp/dist/index.js`
  - Rebuilt generated MCP bundle.

## Verification

Required commands run:

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- --run test/runtimeScript/approval.test.ts
npm run typecheck
npm run build
cd ../..
git diff --check
```

Observed results:

- `test/runtimeScript/approval.test.ts`: 4 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed and refreshed `dist/index.js`.
- `git diff --check`: passed with no whitespace errors.

## Remaining Risks

- The approval request is persisted as a human request on the run, but there is not yet a dedicated "approval resolved" helper; the current flow expects approval to happen through `approve_runtime_script`, after which re-running `execute_workflow_attempt` continues normally.
- Static workflow behavior is covered by the focused regression in this task, but I did not run the broader MCP or service suites beyond the commands required by the brief.

## Follow-up Fix: MCP Tool Surface Test

- Main-controller revalidation exposed one missed MCP assertion:
  - `npm test -- --run test/runtimeScript/approval.test.ts test/mcpServer.test.ts`
  - `test/mcpServer.test.ts > registers the DittosLoop tool surface`
  - The registered tool list did not include the newly added `approve_runtime_script` entry.
- Updated `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts` to:
  - include `approve_runtime_script` in the exact registered tool order;
  - assert that `client.listTools()` exposes the new tool with `loopId` and `approvedBy` input schema properties.

### Follow-up Verification

Commands run:

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- --run test/runtimeScript/approval.test.ts test/mcpServer.test.ts
npm run typecheck
npm run build
cd ../..
git diff --check
```

Observed results:

- `test/runtimeScript/approval.test.ts test/mcpServer.test.ts`: 36 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; `dist/index.js` content was unchanged.
- `git diff --check`: passed with no whitespace errors.
