STATUS: complete

Commit hash: initial Task 4 commit bc8178cc9488fc8785f69eaeaa4d22b6d4f3374c. Review fix commit hash is reported in the task response.

Change summary:
- Added runtime script scheduler API for agent, parallel, pipeline, phase, and log.
- Added VM sandbox execution with validation, injected runtime API, deep-frozen args, and read-only budget limits.
- Aligned RuntimeScriptRunInput.journal with the persisted runtimeScript/journal.ts interface.
- Added sandbox tests covering agent execution, parallel concurrency/order, pipeline output shape, runtime control flow, journal cache hit, limits, and validation blocking.
- Review fix: moved runtime script execution into a terminable worker thread while keeping parent-side scheduler/journal/bridge agent semantics.
- Review fix: added required count fields to runtime_parallel_started/runtime_parallel_completed and runtime_pipeline_started/runtime_pipeline_completed event payloads.
- Review fix: updated parallel concurrency tests to use structured-cloneable args and agent bridge observation.

Test command results:
- npm test -- --run test/runtimeScript/sandbox.test.ts: passed, 11 tests.
- npm run typecheck: passed.
- npm run build: passed.

Concerns:
- Task 6 still needs to wire runtime script execution into service.ts.
- Task 5 still needs preview/timeline event adaptation.
