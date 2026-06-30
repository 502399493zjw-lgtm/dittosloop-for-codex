# Task 10 Report

## RED

- Added `plugins/dittosloop-for-codex/mcp/test/workspaceFiles.test.ts`.
- Initial RED command:
  - `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/workspaceFiles.test.ts`
- Observed failures:
  - `workflow.json` did not expose `workflow`, so static workspace rendering could not show the workflow kind.
  - runtime-script loops did not render a dedicated runtime source file.

## Implementation

- Updated `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts` so:
  - `workflow.json` now includes `workflow` for all formal contracts.
  - runtime-script workflows render `runtime.js` with the stored JavaScript source.
  - workspace file ordering places `runtime.js` next to `workflow.json`.
- Added focused coverage in `plugins/dittosloop-for-codex/mcp/test/workspaceFiles.test.ts` for:
  - static workflows preserving `body.steps` in both `workflow.json` and `contract.json`
  - runtime-script workflows preserving `workflow.kind === "runtime_script"` and rendering `runtime.js`
- Updated installed loop skill docs under `plugins/dittosloop-for-codex/skills/loop/` so they now distinguish:
  - `body.steps`
  - legacy `script.build`
  - `workflowKind: "runtime_script"` with `script`, optional `args`, optional `limits`, and required approval defaults
- Added runtime validation guidance that recommends a verifier sub-agent for dynamic runtime-script workflow verification.

## Verification

- `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/workspaceFiles.test.ts`
  - Passed: `1` file, `2` tests
- `cd plugins/dittosloop-for-codex/mcp && npm test -- --run test/workspace*.test.ts`
  - Passed: `1` file, `2` tests
- `cd plugins/dittosloop-for-codex/mcp && npm run typecheck`
  - Passed
- `cd plugins/dittosloop-for-codex/mcp && npm run build`
  - Passed; updated `plugins/dittosloop-for-codex/mcp/dist/index.js`
- `git diff --check`
  - Passed
