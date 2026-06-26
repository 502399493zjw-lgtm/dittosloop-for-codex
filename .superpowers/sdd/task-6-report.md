# Task 6 Report: Workspace Files And Preview Rendering

## Changes

- Updated formal v2 workspace rendering to emit `verification.md` with Criteria, Validators, and Decision sections.
- Preserved legacy workspace compatibility: v1/legacy contracts still emit `rubrics.md`, and legacy-like verification checks with `name`/`output` or `rubricId`/`evidence` still render without throwing.
- Expanded `status.json` `latestVerification` summaries for v2 results with `version`, `status`, `decision`, validator status, score, max score, threshold, exit code, and evidence excerpts.
- Added preview timeline support for v2 engine events: `validator_started`, `validator_done`, and `verification_decided`.
- Added fallback preview rendering for persisted `VerificationResultV2` records when no engine verification events are present.
- Fixed the v2 workspace typecheck issues around `verification.rubrics` and legacy `check.name` access.

## Tests

- Added Task 6 failing tests first for v2 workspace files/status output, legacy fallback rendering, v2 validator lifecycle preview events, and persisted v2 fallback timeline evidence.
- `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts previewServer.test.ts`
  - Passed: 2 test files, 116 tests.
- `npm --prefix plugins/dittosloop-for-codex/mcp run typecheck`
  - Passed.

## Known Risks

- `verification.md` uses the existing `LoopWorkspaceFile.kind` value `rubrics` internally because adding a new public workspace file kind would require editing Task 6 scope-external type definitions. The visible workspace path and content are v2-specific.
