# Task 4 Report: Carry effective profiles through workflow execution and sessions

## What I implemented

- Propagated `EffectiveAgentProfile` snapshots through workflow launch plans, engine execution plans, agent requests/options, Codex session requests/refs, workflow task runs, and Codex session subagent summaries.
- Kept legacy `subagent` populated with `effectiveProfileToSubagent(...)` everywhere a workflow step is launched or sent to a session bridge.
- Preserved effective profile snapshots on pending/running workflow task state so later workflow revisions do not mutate already-launched task environments.
- Preserved per-step `profilePreflight` snapshots on task runs and Codex session subagent summaries by slicing Task 3's launch report rather than recomputing provider checks.
- Added prompt text that lists declared/effective agent profile expectations, required/advisory skills, preflight results, and the required best-effort wording without claiming native Codex skill enforcement.
- Ensured legacy inline `subagent` workflows also expose a legacy effective profile while keeping the original `subagent` shape compatible.
- Added pass-through support for `agentProfile` in the concrete host-mediated session bridge so session requests/refs carry the same snapshot as the typed bridge contract.

## Tests run and exact results

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
✓ test/service.test.ts (74 tests | 71 skipped) 51ms
Test Files  1 passed (1)
Tests  3 passed | 71 skipped (74)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts
✓ test/sessionBridge.test.ts (2 tests) 7ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- e2eWorkflow.test.ts
✓ test/e2eWorkflow.test.ts (2 tests) 129ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
> dittosloop-mcp@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
$ git diff --check
No output.
```

## TDD Evidence

### RED

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
2 failed | 72 skipped

FAIL test/service.test.ts > LoopService > agent profile snapshots flow through workflow sessions and task runs
expected request agentProfile and legacy subagent; received no agentProfile and subagent: undefined

FAIL test/service.test.ts > LoopService > agent profile snapshots remain stable when resuming after a workflow revision
expected taskRun?.agentProfile; received undefined
```

Why expected: workflow execution had not yet resolved effective profiles into launch/session/task state, so only the old optional inline `subagent` path existed.

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts
1 failed | 1 passed

FAIL test/sessionBridge.test.ts > HostMediatedSessionBridge > records profile snapshots on requests and refs
expected recorded top-level agentProfile; received undefined
```

Why expected: the bridge request/ref contract and host-mediated bridge only persisted legacy `subagent` data.

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- e2eWorkflow.test.ts
1 failed | 1 passed

FAIL test/e2eWorkflow.test.ts > workflow e2e > suspends for Codex subagents and completes after session results
expected launch plan step agentProfile; received undefined
```

Why expected: launch plans did not expose effective profile snapshots for legacy inline `subagent` workflows.

### GREEN

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
✓ test/service.test.ts (74 tests | 71 skipped) 51ms
Test Files  1 passed (1)
Tests  3 passed | 71 skipped (74)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts
✓ test/sessionBridge.test.ts (2 tests) 7ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- e2eWorkflow.test.ts
✓ test/e2eWorkflow.test.ts (2 tests) 129ms
Test Files  1 passed (1)
Tests  2 passed (2)
```

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/engine/runBody.ts`
- `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`
- `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- `plugins/dittosloop-for-codex/mcp/src/codex/sessionBridge.ts`
- `plugins/dittosloop-for-codex/mcp/src/codex/hostMediatedBridge.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/sessionBridge.test.ts`
- `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`
- `.superpowers/sdd/task-4-report.md`

## Self-review findings

- Verified effective profiles are resolved once at launch/execution boundaries and then stored as snapshots on requests, refs, task runs, and summaries.
- Verified workflow revision coverage keeps an already-running task's profile snapshot stable after the contract profile changes.
- Verified prompt wording says DittosLoop records expectations and performs best-effort checks, and does not claim native Codex skill enforcement.
- Verified legacy `subagent` compatibility remains intact for inline subagent workflows and profile-derived workflows.
- Verified `git diff --check` produced no whitespace warnings.

## Any concerns

- `plugins/dittosloop-for-codex/mcp/src/codex/hostMediatedBridge.ts` was not in the Task 4 owned-file list, but a one-line pass-through was needed for the concrete bridge to preserve the new `agentProfile` field in `sessionBridge.test.ts` and runtime refs. I kept the edit narrowly scoped.

## Fix after Task 4 review

- Reviewer issue: `profilePreflightForStep` returned the aggregate launch `report.status` after filtering the step-local `checks`, `warnings`, and `blockers`, so a clean step could inherit a degraded status from another step.
- Fix: recomputed the per-step `profilePreflight.status` from the filtered step-local warnings/blockers using the same launch semantics, and kept the regression test focused on one passing step plus one degraded step.

### RED

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
> @dittosloop/for-codex-mcp@0.1.0 test
> vitest run service.test.ts -t agent profile

FAIL test/service.test.ts > agent profile step preflight status stays local to each step
AssertionError: expected { status: 'degraded', … } to match object { status: 'passed' }

Expected: { status: "passed" }
Received: { status: "degraded" }
```

Why this failed as expected: step A's filtered checks were clean, but `profilePreflightForStep` still returned the aggregate degraded launch status caused by step B's missing required skill under `allowDegradedProfiles: true`.

### GREEN

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
> @dittosloop/for-codex-mcp@0.1.0 test
> vitest run service.test.ts -t agent profile

✓ test/service.test.ts (75 tests | 71 skipped) 24ms
Test Files  1 passed (1)
Tests  4 passed | 71 skipped (75)
```

```text
$ npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
> @dittosloop/for-codex-mcp@0.1.0 typecheck
> tsc -p tsconfig.json --noEmit
```

```text
$ git diff --check
No output.
```

### Commands run

- `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"` (RED)
- `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"` (GREEN)
- `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
- `git diff --check`
