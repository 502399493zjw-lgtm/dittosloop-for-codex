# Task 1 Report

## What I implemented

- Added formal workflow agent profile contract types in `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`:
  - `SkillRequirementSource`
  - `SkillRequirement`
  - `AgentProfile`
  - `EffectiveAgentProfile`
  - `agentProfiles?: Record<string, AgentProfile>` on `FormalLoopContract`
  - `agentProfileRef?: string` on `AgentStep` and `TaskStep`
- Added `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts` with:
  - `resolveEffectiveAgentProfile`
  - `resolveEffectiveProfilesByStep`
  - `effectiveProfileToSubagent`
- Implemented normalization rules:
  - `agentProfileRef` resolves declared profiles first
  - legacy `subagent.ref` can resolve a declared profile when no `agentProfileRef` is present
  - inline `subagent` values override declared profile defaults
  - `subagent.tools` maps to `allowedTools`
  - inline-only subagents normalize into `source: "legacy-inline"` effective profiles
- Extended contract validation in `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts` for:
  - declared profile shape and key/id consistency
  - missing `agentProfileRef`
  - invalid skill requirement ids
  - invalid skill requirement sources
  - invalid declared `allowedTools`
  - invalid declared profile permissions
  - invalid declared profile `timeoutMs`
- Updated `applyContractPatch` in `plugins/dittosloop-for-codex/mcp/src/service.ts` to preserve `agentProfiles` across workflow revisions.
- Added focused contract tests in `plugins/dittosloop-for-codex/mcp/test/contract.test.ts` for the new validation and normalization behavior.

## Tests run and exact results

1. `npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts`
   - Result: `✓ test/contract.test.ts (12 tests) 4ms`
   - Summary: `Test Files  1 passed (1)` / `Tests  12 passed (12)`
2. `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
   - Result: exit code `0`

## TDD Evidence

### RED

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
```

Relevant failing output:

```text
FAIL  test/contract.test.ts [ test/contract.test.ts ]
Error: Cannot find module '../src/contract/agentProfiles.js'
Caused by: ... Does the file exist?
Test Files  1 failed (1)
Tests  no tests
```

Why this failure was expected:

- The new tests imported `resolveEffectiveAgentProfile` from `agentProfiles.ts` and exercised `agentProfiles` / `agentProfileRef` before any production implementation existed, so the suite failed on the missing Task 1 contract surface.

### GREEN

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
```

Relevant passing output:

```text
✓ test/contract.test.ts (12 tests) 4ms
Test Files  1 passed (1)
Tests  12 passed (12)
```

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

## Self-review findings

- Confirmed the implementation stayed inside Task 1 ownership and did not modify MCP schemas, preview, session propagation, workspace-file generation, or installed skill docs.
- Confirmed the new validation errors are actionable and mention the relevant contract field path.
- Confirmed `EffectiveAgentProfile` requires `requiredSkills` and `advisorySkills` arrays via `Omit<...>` narrowing.
- Confirmed `agentProfiles` survive contract patch application in `service.ts`.

## Any concerns

- No blocking concerns. The new helper exports are currently exercised from tests and are ready for later tasks that will wire them into runtime/session behavior.

---

## Fix Report: Review follow-up for Task 1

### What I fixed

- Updated `resolveEffectiveAgentProfile` so `agentProfileRef` only resolves to a declared profile and returns `undefined` when the referenced profile is missing, even if inline `subagent` values are present.
- Hardened `validateContract` so each `agentProfiles` entry is checked as a non-null object before field access, producing an actionable error like `agentProfiles.<id> must be an object`.
- Added focused regression tests for both behaviors in `contract.test.ts`.

### RED command/output and why expected

Command:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
```

Relevant failing output:

```text
× formal loop contracts > does not synthesize a declared effective profile when agentProfileRef is missing but inline subagent exists
  → expected { id: 'missing-profile', … } to be undefined
× formal loop contracts > reports malformed agentProfiles entries as actionable validation errors
  → expected [Function] to throw error matching /agentProfiles\.broken must be an object/i but got 'Cannot read properties of null (reading 'id')'
Test Files  1 failed (1)
Tests  2 failed | 12 passed (14)
```

Why this was expected:

- The existing resolver still treated inline `subagent` values as a fallback when `agentProfileRef` was present but unresolved.
- The existing validator dereferenced `profile.id` without first confirming the profile entry was a non-null object.

### GREEN command/output

Commands:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
```

Relevant passing output:

```text
✓ test/contract.test.ts (14 tests)
Test Files  1 passed (1)
Tests  14 passed (14)
```

```text
> tsc -p tsconfig.json --noEmit
```

### Files changed

- `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts`
- `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`
- `.superpowers/sdd/task-1-report.md`

### Any concerns

- No additional concerns in this fix scope.
