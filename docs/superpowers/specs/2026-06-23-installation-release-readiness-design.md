# DittosLoop For Codex Installation And Release Readiness Design

## Status

Approved continuation: make the existing local-first plugin easier to install, validate, demo, and share from GitHub without changing core loop behavior.

## Context

The plugin already has a working manifest, repo marketplace entry, MCP runtime, loop skill, and browser preview. The next gap is install confidence: someone cloning the repo should be able to understand the install path, run one validation command, load example state for the preview, and know what must be rebuilt after code changes.

The official Codex plugin guidance says plugins are appropriate when workflows should be shared, and marketplace entries should point at plugin folders with paths relative to the marketplace root. This repository already matches that shape with `.agents/plugins/marketplace.json` and `plugins/dittosloop-for-codex`.

## Goals

- Add a repository-level validation command that checks the plugin manifest, marketplace entry, MCP config, skill location, preview files, and built runtime entrypoint.
- Add a committed sample state file that exercises loop contracts, run detail, attempts, verification, human requests, memory, and artifacts in the preview.
- Document a clear local install flow, GitHub marketplace flow, development loop, and smoke-test flow.
- Keep validation local, dependency-light, and safe to run before publishing or sharing.
- Preserve the current plugin id `dittosloop-for-codex` and display name `DittosLoop For Codex`.

## Non-Goals

- Do not add hosted services, cron triggers, webhook triggers, or background workers.
- Do not rewrite the runtime data model.
- Do not install the plugin globally as part of validation.
- Do not commit local runtime state or user-specific data.

## Design

The repo root gets a small Node-based validation script and root package scripts. The validator reads real project files instead of relying on remembered assumptions. It fails with actionable messages when required paths, metadata, marketplace policy, or built runtime output are missing.

The sample state lives under `examples/` as static JSON. It is not consumed automatically by the plugin, but README commands can copy it into a temporary or local data directory before starting the preview runtime. Keeping it static makes the preview demo reproducible and keeps local state outside committed files.

The README becomes the main install handoff. It should separate four flows: quick verification, local install from this checkout, GitHub marketplace install after cloning, and development after edits. It should also explain that Codex should be restarted and a new thread started after plugin install or reinstall.

## Files

- `package.json`: root scripts for validation and full checks.
- `scripts/validate-plugin.mjs`: dependency-free plugin/package validator.
- `test/validate-plugin.test.mjs`: Node test coverage for validator success and failure paths.
- `examples/state.sample.json`: preview-ready sample Dittos loop state.
- `README.md`: install, GitHub sharing, sample preview, and maintenance instructions.
- `docs/superpowers/plans/2026-06-23-installation-release-readiness.md`: implementation plan.

## Validation

- Run the validator directly.
- Run the validator test suite and verify it fails before the implementation exists.
- Run all runtime tests.
- Run the TypeScript build.
- Run the root full-check command.
- Smoke-test the preview API against `examples/state.sample.json`.

