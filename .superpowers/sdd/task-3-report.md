# Task 3 Report: Session Prompt And Installed Skill Discipline

## What you implemented

- Updated `startCodexSessionRun` to read the default bounded loop memory window and inject it into the visible Codex session prompt.
- Extended `buildCodexSessionPrompt` to render a `Loop memory / 长期记忆` section plus explicit memory-discipline guidance.
- Added prompt guidance that the top-level visible Codex session decides whether to call `commit_memory` after verifier results are visible.
- Added prompt guidance that workflow tasks may surface durable observations in task results, but do not own long-term memory write policy.
- Updated the installed loop skill to document:
  - `start_codex_session` returning the bounded memory excerpt
  - `read_loop_memory` for additional durable context
  - workflow-task memory-read behavior
  - post-verifier `commit_memory` ownership by the top-level visible Codex session
- Added targeted tests for prompt injection and installed skill memory guidance.

## Tests run and results

- `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "bounded loop memory excerpt"`: PASS
- `node --test test/loop-skill-memory.test.mjs`: PASS

## TDD Evidence

### RED command

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "bounded loop memory excerpt"
node --test test/loop-skill-memory.test.mjs
```

### Relevant failing output

```text
AssertionError: expected '你正在启动 Dittos Live Loop 的一次运行：Code hea…' to contain 'Loop memory / 长期记忆'
```

```text
AssertionError [ERR_ASSERTION]: The input did not match the regular expression /read_loop_memory/
```

### Why expected

- The service did not yet pass `loopMemoryWindow(...)` into `buildCodexSessionPrompt`, so the visible session prompt had no memory excerpt or memory-discipline instructions.
- The installed loop skill did not yet mention `read_loop_memory` or post-verifier ownership for `commit_memory`.

### GREEN command

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "bounded loop memory excerpt"
node --test test/loop-skill-memory.test.mjs
```

### Relevant passing output

```text
✓ test/service.test.ts (63 tests | 62 skipped)
✔ loop skill documents memory reads and post-verifier memory ownership
```

## Files changed

- `plugins/dittosloop-for-codex/mcp/src/service.ts`
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- `test/loop-skill-memory.test.mjs`

## Self-review findings

- The implementation stays inside the owned write scope and does not add any hidden automatic memory writes.
- The prompt uses the existing default `loopMemoryWindow(state, loopId)` behavior, so the excerpt remains bounded to the current 80-line default and includes the truncation notice when applicable.
- The installed skill now clearly separates memory reads from memory write authority: workflow tasks may read and report durable observations, while the top-level visible Codex session decides whether to call `commit_memory` after verifier results are visible.
- I tightened one new prompt assertion after the first green attempt because a raw substring check for `Memory 2` also matched `Memory 20` through `Memory 29`. The final assertion checks exact memory lines, which matches the brief’s intended behavior.

## Issues or concerns

- No functional concerns with the implementation.
- Minor note: the original negative prompt assertion from the brief needed line-level matching to avoid false positives from `Memory 20+`.
