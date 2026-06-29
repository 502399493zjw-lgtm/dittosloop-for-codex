# Runtime Script Dynamic Workflow Release Review

Date: 2026-06-29
Branch: `runtime-script-workflow-spec`
Task: 12 - Release-Ready Review Package

## Review Summary

The branch is release-ready for the runtime script dynamic workflow milestone. The implementation cleanly separates runtime JavaScript orchestration from the existing static workflow graph path, preserves both legacy `body.steps` and `script.build` compatibility, journals completed runtime `agent()` calls for replay-safe resume, and enforces verifier sub-agent isolation before a run can be marked verified. Final release readiness depends on the fresh verification commands listed below.

## Runtime Script Versus `body.steps`

- `body.steps` remains the static workflow surface. Static loops still normalize into `workflow.kind === "static_steps"` and continue through the existing graph scheduler and node-run execution path.
- Runtime scripts are stored as `workflow.kind === "runtime_script"` with JavaScript source in `workflow.source`. They do not synthesize or persist `body.steps`, and runtime workflow contexts do not rely on `executionGraphSnapshot`.
- Execution branches at runtime in `LoopService.executeWorkflowAttempt()`: static workflows continue through graph or `LoopRunner`, while runtime scripts go through `executeRuntimeScriptWorkflowAttempt()` and `runRuntimeScriptInVm()`.
- The runtime scheduler injects `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and `budget`, so orchestration decisions happen during script execution rather than contract compilation time.

## `script.build` Compatibility

- Legacy builder-AST input is still accepted only as the object form `script.build`.
- Builder AST contracts continue to compile into static `body.steps` and normalize to `workflow.kind === "static_steps"`.
- The explicit runtime path remains opt-in: string `script` requires `workflowKind: "runtime_script"`.
- Contract and MCP tests cover the compatibility split so existing static loops still create, load, preview, compile, and run while runtime scripts stay separate from the static graph contract.

## Replay Journal Key Computation

Replay reuse is keyed deterministically in `runtimeAgentJournalKey()` from:

- `contractId`
- `scriptHash = sha256(runtime script source)`
- `argsHash = sha256(stableStringify(args ?? {}))`
- `callSite`
- `promptHash = sha256(prompt)`
- `optionsHash = sha256(stableStringify(options ?? {}))`

This matches the design and validation requirements that replay safety changes when the script, args, call site, prompt, or runtime agent options change.

## Waiting, Resume, and Duplicate Session Avoidance

- Runtime `agent()` calls derive a deterministic idempotency key from the replay journal key before launching a sub-agent session.
- `runRuntimeScriptCodexSessionStep()` first looks up an existing workflow task run by that idempotency key.
- If the matching task run is already completed, it returns the recorded output immediately.
- If the matching task run is suspended or still in flight, it reads the existing session result instead of creating another session.
- Only the first pass without an existing task run creates a new Codex session and attaches it to the workflow task.
- Service-level tests cover the first launch, suspension, rerun reuse of the same pending session, completion writeback, and replay cache hits with no duplicate worker sessions.
- End-to-end coverage also proves replay survives service restart by reusing persisted journal entries from the same store data directory.

## Verifier Sub-Agent Validation Coverage

- Verification V2 rubric-agent validators default `allowSelfReview` to `false`.
- Runtime-script verification launches a dedicated verifier task with step id `verification:<validatorId>`, keeping verifier sessions distinct from worker sessions.
- `recordValidatorResult()` rejects writeback without the launched verifier session identity when a verifier session exists, rejects mismatched verifier sessions, and rejects worker-session reuse when self-review is disallowed.
- The runtime-script verification suite covers the required `DW-SUBAGENT-003` behavior: separate visible verifier session, wait state before validator writeback, blocked self-review, and successful completion only after the verifier result is recorded.
- A live smoke harness exists behind `DITTOSLOOP_RUNTIME_SCRIPT_LIVE=1` to validate the same worker/verifier split with the real host-mediated sub-agent bridge.

## Verification Commands

Fresh pre-commit verification completed on 2026-06-29:

```bash
cd "plugins/dittosloop-for-codex/mcp"
npm test
npm run typecheck
npm run build
cd ../..
git diff --check
git status --short
```

Results:

- `npm test`
  - Passed: `26 passed | 1 skipped (files)`, `337 passed | 1 skipped (tests)`.
- `npm run typecheck`
  - Passed.
- `npm run build`
  - Passed. Output included `dist/index.js  1.1mb`.
  - Generated bundle changes are synchronized in `plugins/dittosloop-for-codex/mcp/dist/index.js`.
- `git diff --check`
  - Passed with no diff formatting errors.
- `git status --short`
  - Clean after the latest verification commits.
