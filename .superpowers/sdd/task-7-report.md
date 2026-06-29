# Task 7 Report: Service-Backed Sub-Agent Bridge and Resume Semantics

## RED Evidence

- Added focused coverage in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/serviceSubagentBridge.test.ts` before changing service implementation.
- Initial run:

  ```bash
  cd plugins/dittosloop-for-codex/mcp
  npm test -- --run test/runtimeScript/serviceSubagentBridge.test.ts
  ```

- Failure symptom:
  - `rerun with same runtime script call site reuses the pending session` failed.
  - Expected the rerun to read `session_1` again, but `readResult` was only called once.
  - This showed `executeWorkflowAttempt()` returned early while a runtime-script session was open instead of letting the bridge resume/read the existing task session.

## Changed Files

- `plugins/dittosloop-for-codex/mcp/src/service.ts`
  - Allows runtime-script workflow attempts to re-enter execution while a session is open; static workflows keep the existing early return.
  - Adds private service-backed runtime-script Codex session handling keyed by `runtimeScript.key`/`idempotencyKey`.
  - Derives runtime-script task `stepId` values as `runtime:${callSite}` while preserving the original `callSite` in the journal key.
  - Reuses existing completed, running, or suspended task runs before creating a new session.
  - Updates the original task on completed or failed bridge results.
  - Keeps new task/session creation only for missing task runs.
- `plugins/dittosloop-for-codex/mcp/test/runtimeScript/serviceSubagentBridge.test.ts`
  - Covers first session creation, pending suspension, pending-session reuse, resume after `recordSessionResult()`, completed journal cache, and failed bridge result behavior.
- `plugins/dittosloop-for-codex/mcp/dist/index.js`
  - Rebuilt generated MCP bundle.

## Verification

All required commands passed:

```bash
cd plugins/dittosloop-for-codex/mcp
npm test -- --run test/runtimeScript/serviceSubagentBridge.test.ts
npm test -- --run test/runtimeScript/serviceSubagentBridge.test.ts test/service.runtimeScript.test.ts
npm test -- --run test/service.runtimeScript.test.ts test/service.test.ts
npm run typecheck
npm run build
git diff --check
```

Observed results:

- `test/runtimeScript/serviceSubagentBridge.test.ts`: 6 tests passed.
- `test/runtimeScript/serviceSubagentBridge.test.ts` and `test/service.runtimeScript.test.ts`: 10 tests passed.
- `test/service.runtimeScript.test.ts` and `test/service.test.ts`: 104 tests passed.
- Typecheck passed.
- Build passed.
- `git diff --check` produced no whitespace errors.

## Remaining Risks

- Task 8 approval gate remains intentionally untouched.
- Runtime scripts still do not compile to graph snapshots and the direct external `workflow.kind = "runtime_script"` input remains closed.
- Completed task reuse is implemented in the service bridge, while the normal resumed-script path is usually intercepted earlier by the runtime journal cache after `recordSessionResult()`.
