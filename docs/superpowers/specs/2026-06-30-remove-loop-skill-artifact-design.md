# Remove Generated Loop Skill Artifact Design

## Context

Live Loop directory generation currently adds `skill/dittosloop-for-codex-loop.md` for every formal loop. The file is explanatory markdown only. It is not installed as a Codex skill, not consumed by runtime execution, and not used by preview interactions. Showing it under a `skill/` folder makes the loop appear to contain a local skill that users should inspect or maintain.

## Decision

Stop generating the per-loop `skill/dittosloop-for-codex-loop.md` artifact entirely. New Live Loop directory views should not include a `skill/` folder unless future runtime-owned data makes that folder meaningful.

Keep the useful Live Loop directory files that carry memory, workflow, runtime, verification, status, and contract data: `memory.md`, `workflow.json`, `runtime.js`, `verification.md`, `status.json`, and `contract.json`.

## Scope

- Remove the workspace file entry for `skill/dittosloop-for-codex-loop.md`.
- Remove the helper that builds its markdown content.
- Update tests that currently expect the generated skill artifact.
- Update installed loop-skill guidance so it no longer names the generated `skill/` path.
- Assert that `memory.md`, `workflow.json`, `runtime.js`, `verification.md`, `status.json`, and `contract.json` remain available where applicable.

## Non-Goals

- Do not remove the installed plugin skill under `plugins/dittosloop-for-codex/skills/loop`.
- Do not change loop execution, runtime script behavior, verification, memory, or preview file rendering.
- Do not introduce a replacement `runtime/` guide file.

## Testing

Add or update tests first so they fail while the generated skill artifact still exists, then update implementation until they pass. Run the focused workspace and documentation tests, then the repository test suite.
