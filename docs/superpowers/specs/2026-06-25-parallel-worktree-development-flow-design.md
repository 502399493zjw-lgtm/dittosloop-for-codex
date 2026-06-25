# Parallel Worktree Development Flow Design

## Status

Proposed for review.

## Problem

The repository already requires reviewed specs and implementation plans before development work starts, but it does not define how multiple active development efforts should be isolated, reviewed, and merged. Without a shared rule, new feature and fix work can happen directly in the main working tree, which makes parallel work harder to review and increases the risk of accidental merges or stale-branch conflicts.

## Goals

- Require every new development task to start in its own git worktree.
- Keep the main working tree available for coordination, review, release checks, and final merges.
- Make each development line responsible for its own implementation and verification loop.
- Require review before merge.
- Require explicit user approval after review before any merge.
- Prevent automatic merging.
- Require deliberate branch updating, conflict resolution, and verification when the target branch has moved.
- Clean up worktrees and branches only after the approved merge is confirmed.

## Non-Goals

- Do not require every development line to have a separate spec and implementation plan beyond the repository's existing documentation flow.
- Do not prescribe a specific branch naming convention beyond making names task-related.
- Do not require a specific PR hosting provider or review tool.
- Do not automate merge decisions.

## Proposed Repository Rule

Add a new `Parallel Development Flow` section to `AGENTS.md` after `Development Rules`:

```md
## Parallel Development Flow

- Start every new development task in a separate git worktree. Do not do new feature or fix work directly in the main working tree.
- Name each worktree and branch after the concrete task being developed.
- Keep the main working tree available for coordination, review, release checks, and final merges.
- Each worktree owns its own implementation and verification loop. Before requesting review, run the relevant tests/checks for that line and record any known gaps.
- When the work is ready, open a PR or prepare a reviewable branch. Do not merge directly from an active worktree without review.
- Address review feedback inside the same worktree/branch and re-run the relevant verification after changes.
- Merging requires explicit user approval after review is complete. Never auto-merge.
- Before merging, check whether the target branch moved. Rebase or otherwise update the branch deliberately, resolve conflicts in the worktree, and re-run verification after the update.
- After an approved merge, clean up the worktree and branch only when the merged state is confirmed.
```

## Acceptance Checks

- `AGENTS.md` contains the new `Parallel Development Flow` section.
- The new section requires a separate git worktree for every new development task.
- The new section requires review before merging.
- The new section requires explicit user approval before merge.
- The new section forbids automatic merging.
- The new section calls out target-branch movement, rebase/update, conflict resolution, and post-update verification.
- The new section does not add a requirement that every development line must have an independent spec/plan pair.
