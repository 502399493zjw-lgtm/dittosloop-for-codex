# Task 3 Report: Local conservative skill preflight

## What I implemented

- Added local profile skill preflight support in `plugins/dittosloop-for-codex/mcp/src/codex/skillPreflight.ts`.
- Added `SkillAvailabilityProvider` injection to `LoopServiceOptions` and used it from `startCodexSessionRun`.
- Added preflight result types in `plugins/dittosloop-for-codex/mcp/src/types.ts` and stored the report at `run.codexSession.profilePreflight`.
- Ensured preflight runs before any run-state mutation in `startCodexSessionRun`.
- Blocked required `missing` and `unknown` checks by default.
- Allowed degraded starts when `allowDegradedProfiles: true`, with the resulting report stored as `status: "degraded"`.
- Preserved non-blocking advisory behavior by recording advisory `missing` and `unknown` results as warnings.
- Kept runs without effective profiles or skill requirements harmless by omitting `profilePreflight` when there are no checks.

## Tests run and exact results

1. `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"`
   - Final result: passed
   - Output summary:
     - `Test Files  1 passed (1)`
     - `Tests  5 passed | 65 skipped (70)`

2. `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
   - Final result: passed
   - Output summary:
     - `tsc -p tsconfig.json --noEmit`

## TDD Evidence

### RED

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"
```

Relevant failing output:

```text
FAIL  test/service.test.ts > profile preflight allows starting when required skills are available
AssertionError: expected undefined to deeply equal { status: 'passed', …(4) }

FAIL  test/service.test.ts > profile preflight blocks required missing skills by default
AssertionError: promise resolved "{ run: { id: 'run_1', …(10) }, …(3) }" instead of rejecting

FAIL  test/service.test.ts > profile preflight blocks required unknown skills by default
AssertionError: promise resolved "{ run: { id: 'run_1', …(10) }, …(3) }" instead of rejecting

FAIL  test/service.test.ts > profile preflight stores advisory missing and unknown skills as warnings
AssertionError: expected undefined to match object { status: 'warning', …(2) }

FAIL  test/service.test.ts > profile preflight allows degraded start when required skills cannot be confirmed
AssertionError: expected undefined to match object { status: 'degraded', …(3) }
```

Why this failure was expected:

- The service did not yet run any profile skill preflight.
- `startCodexSessionRun` was not blocking required unavailable skills.
- `run.codexSession.profilePreflight` was not being populated.

### GREEN

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"
```

Relevant passing output:

```text
✓ test/service.test.ts (70 tests | 65 skipped) 9ms

Test Files  1 passed (1)
Tests  5 passed | 65 skipped (70)
```

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/codex/skillPreflight.ts`
- `plugins/dittosloop-for-codex/mcp/src/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

## Self-review findings

- Kept the new behavior inside the owned Task 3 files only.
- Did not change MCP schemas, preview behavior, workspace-file generation, installed skill docs, or Task 4 propagation paths.
- Verified blocking happens before run creation, so blocked preflight does not create partial run state.
- Kept `profilePreflight` absent when there are no checks, which avoids disturbing unrelated snapshots and existing tests.
- Used only built-in Node APIs for the default provider.

## Concerns

- The default plugin skill lookup recursively scans `$CODEX_HOME/plugins/cache/<pluginId>`. That is conservative and dependency-free, but it may be a little chatty if a plugin cache tree becomes very large.
