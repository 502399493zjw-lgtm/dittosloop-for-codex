# DittosLoop For Codex Development Guide

This file is for developing this repository. It is not the installed plugin's user-facing instruction set.

## Project Boundary

- The plugin display name is `DittosLoop For Codex`.
- The plugin identifier and folder name are `dittosloop-for-codex`.
- Build this repository as a GitHub-ready Codex plugin marketplace repo.
- The first runnable milestone should work locally on this machine before any public or team sharing step.
- Keep Dittos Loop product code and Codex plugin code separate. Treat `/Users/edisonzhong/projects/dittos-loop` as source context, not as the plugin workspace.

## Product Shape

- The installed plugin should bundle a skill, a local MCP runtime, and a browser preview experience.
- The preview should be opened through Codex's in-app browser or right-side preview surface as a local URL served by the runtime.
- The preview is not the source of truth. The runtime owns loop contracts, run history, attempts, verification results, human requests, memory commits, and artifact references.
- Avoid hidden background work in the MVP. A loop run should be visible, triggerable, and inspectable.
- Do not depend on plugin-bundled hooks for core behavior until Codex plugin hook support is stable in the user's installed version.

## Development Rules

- Use official Codex plugin docs as the source of truth for manifest and marketplace behavior.
- Keep manifest paths relative to the plugin root and `./`-prefixed.
- Use `AGENTS.md` only for repo development conventions. Put installed behavior in plugin skills and runtime code.
- Keep implementation small and testable. Prefer a local-first runtime with explicit commands over premature hosted services.
- Do not store user secrets in the repo.
- Local state should live outside committed files, under a documented user data directory.
- Any generated marketplace or manifest file must validate before being handed back.

## Documentation Flow

- Design specs live under `docs/superpowers/specs/`.
- Implementation plans live under `docs/superpowers/plans/`.
- The spec must be reviewed before implementation starts.
- The implementation plan must be reviewed before task execution starts.

