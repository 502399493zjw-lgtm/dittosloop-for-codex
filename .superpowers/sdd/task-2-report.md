# Task 2 Report

## What I implemented

- Extended the MCP Zod schemas in `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts` to accept:
  - `agentProfiles` on `create_loop_contract`
  - `agentProfileRef` on executable `agent` and `task` steps
  - `allowDegradedProfiles` on `start_codex_session`
- Added shared `skillRequirementSchema` and `agentProfileSchema` using the exact field set from the task brief.
- Passed `allowDegradedProfiles` from the `start_codex_session` MCP handler into `service.startCodexSessionRun`.
- Added the optional `allowDegradedProfiles` field to `StartCodexSessionRunInput` in `plugins/dittosloop-for-codex/mcp/src/service.ts` for type plumbing only.
- Added focused MCP tests covering the new schema acceptance and the `startCodexSessionRun` passthrough while keeping the existing subagent passthrough test unchanged.

## Tests run and exact results

1. `npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts`
   - Initial RED run: failed with 2 expected failures
   - Final GREEN run: `✓ test/mcpServer.test.ts (24 tests) 62ms`
2. `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
   - Passed: `tsc -p tsconfig.json --noEmit`

## TDD Evidence

### RED command

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts
```

### Relevant failing output

```text
FAIL  test/mcpServer.test.ts > accepts agent profile fields through the MCP schema boundary
AssertionError: expected { … } to match object { agentProfiles: { … }, … }

FAIL  test/mcpServer.test.ts > passes allowDegradedProfiles into startCodexSessionRun
AssertionError: expected "spy" to be called with arguments: [ 'loop_1', … ]
```

### Why the RED failure was expected

- `create_loop_contract` was stripping `agentProfiles` and `agentProfileRef` because those fields were not in the MCP schemas yet.
- `start_codex_session` was stripping `allowDegradedProfiles` before calling `service.startCodexSessionRun`.

### GREEN command

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts
```

### Relevant passing output

```text
✓ test/mcpServer.test.ts (24 tests) 62ms
Test Files  1 passed (1)
Tests  24 passed (24)
```

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

## Self-review findings

- Kept the change inside the MCP boundary and the single optional service input type addition allowed by the brief.
- Did not add preflight logic, runtime behavior, session propagation, preview changes, workspace-file generation, or skill doc updates.
- The `allowDegradedProfiles` test verifies handler-to-service plumbing directly, which matches the current task scope better than asserting persisted run behavior.

## Any concerns

- None for Task 2 scope.
