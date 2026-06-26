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

---

## Fix report: review findings follow-up

### What I fixed

- Updated plugin skill lookup in `plugins/dittosloop-for-codex/mcp/src/codex/skillPreflight.ts` so it checks the direct cache-root layout at `$CODEX_HOME/plugins/cache/<pluginId>/skills/<skillId>/SKILL.md` before walking nested directories, while keeping recursive support for versioned and nested plugin layouts.
- Updated `startCodexSessionRun` in `plugins/dittosloop-for-codex/mcp/src/service.ts` to use one frozen formal-contract snapshot for both profile preflight and run launch construction, preventing the stored `profilePreflight` report from describing a different profile set than the workflow contract used to launch the run.
- Added focused regression coverage in `plugins/dittosloop-for-codex/mcp/test/service.test.ts` for both the direct plugin-skill layout and the contract-drift mismatch.

### RED command/output and why expected

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"
```

Relevant failing output:

```text
FAIL  test/service.test.ts > profile preflight finds plugin skills stored directly under the plugin cache root
AssertionError: expected { status: 'missing', …(1) } to deeply equal { status: 'passed', …(2) }

FAIL  test/service.test.ts > profile preflight keeps the launched run on the same contract snapshot used for preflight
AssertionError: expected [ Array(1) ] to deeply equal [ ObjectContaining{…} ]
Received workflow plan step label/prompt from the drifted contract ("Write"/"Write the final brief.")
```

Why this failure was expected:

- The plugin lookup only searched child directories beneath the plugin root, so it skipped skills stored directly under the plugin cache root.
- `startCodexSessionRun` computed preflight from the first state read but rebuilt the launch workflow from a later re-read contract inside `updateState`, so a contract revision slipping in between those reads could make the stored preflight describe different profiles than the launched workflow.

### GREEN command/output

Commands:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
```

Relevant passing output:

```text
✓ test/service.test.ts (72 tests | 65 skipped) 12ms

Test Files  1 passed (1)
Tests  7 passed | 65 skipped (72)

> @dittosloop/for-codex-mcp@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

### Files changed

- `plugins/dittosloop-for-codex/mcp/src/codex/skillPreflight.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- `.superpowers/sdd/task-3-report.md`

### Concerns

- None beyond the existing note that recursive plugin-cache scanning is conservative and may do extra directory reads on unusually large plugin cache trees.
