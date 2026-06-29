STATUS: complete

Commit hash: initial Task 4 commit bc8178cc9488fc8785f69eaeaa4d22b6d4f3374c. Review fix commit aad4eff06b4544f8eb395310bb32db61295a7a9c. Worker cleanup fix commit hash is reported in the task response.

Change summary:
- Added runtime script scheduler API for agent, parallel, pipeline, phase, and log.
- Added VM sandbox execution with validation, injected runtime API, deep-frozen args, and read-only budget limits.
- Aligned RuntimeScriptRunInput.journal with the persisted runtimeScript/journal.ts interface.
- Added sandbox tests covering agent execution, parallel concurrency/order, pipeline output shape, runtime control flow, journal cache hit, limits, and validation blocking.
- Review fix: moved runtime script execution into a terminable worker thread while keeping parent-side scheduler/journal/bridge agent semantics.
- Review fix: added required count fields to runtime_parallel_started/runtime_parallel_completed and runtime_pipeline_started/runtime_pipeline_completed event payloads.
- Review fix: updated parallel concurrency tests to use structured-cloneable args and agent bridge observation.
- Review fix: closed the worker parentPort after final done/error messages so completed runtime scripts do not leave idle worker threads alive.
- Added a child-process regression test proving a successful runtime script can finish without a manual process.exit() and the process exits naturally.

Test command results:
- TDD red check: npm test -- --run test/runtimeScript/sandbox.test.ts failed before the worker cleanup fix because the new natural-exit child-process probe timed out.
- npm test -- --run test/runtimeScript/sandbox.test.ts: passed, 12 tests.
- npm run typecheck: passed.
- npm run build: passed.

Concerns:
- Task 6 still needs to wire runtime script execution into service.ts.
- Task 5 still needs preview/timeline event adaptation.
