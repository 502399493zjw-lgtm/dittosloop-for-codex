# DittosLoop For Codex Plugin Design

## Status

Approved direction: build a GitHub-ready Codex plugin marketplace repository, with a local-first MVP that can be installed and tested on this machine first.

## Context

Dittos Loop already has a product repo at `/Users/edisonzhong/projects/dittos-loop`. That repo models durable loops as contracts, visible runs, attempts, verification, repair, human requests, memory, and previewable run history. The Codex plugin should reuse that product thinking, but it should not be embedded directly into the existing Dittos Loop app repo.

Codex plugins are installable bundles. The official shape centers on a `.codex-plugin/plugin.json` manifest and may include skills, MCP servers, apps, assets, and marketplace metadata. The current local Codex setup supports plugins and the in-app browser. Plugin-bundled hooks are not stable enough here to be core infrastructure, so hooks are future optional polish rather than MVP dependency.

## Goals

- Create an installable Codex plugin named `DittosLoop For Codex`.
- Make the repository shareable through GitHub as a Codex plugin marketplace source.
- Make the first milestone runnable locally before depending on public distribution.
- Let a Codex user turn a conversation or delegated responsibility into a loop contract.
- Let the user trigger and inspect loop runs from Codex.
- Show loop state in a local browser preview that can live in Codex's right-side preview/in-app browser.
- Preserve the Dittos Loop model: one visible run per trigger, with attempts, verification, repairs, human requests, memory commits, and artifacts under that run.

## Non-Goals

- Do not rebuild the full Dittos Loop web app in the plugin MVP.
- Do not require the hosted `dittosloop.com` service for local MVP usage.
- Do not hide background autonomous work behind implicit hooks.
- Do not ship event, cron, GitHub, Lark, or webhook triggers in the first milestone.
- Do not store secrets or personal runtime state in committed files.

## Approaches Considered

### Approach A: Personal Local Plugin Only

This would put the plugin directly under a personal Codex plugin directory. It is fastest for one machine, but later sharing would require a structural migration and separate marketplace work.

### Approach B: Add Plugin Code Inside Existing Dittos Loop Repo

This would keep product and plugin development together. It improves short-term code reuse, but the existing repo already has its own app, engine, branches, and deployment concerns. The plugin would inherit unrelated product complexity.

### Approach C: GitHub-Ready Marketplace Repo With Local-First MVP

This creates a dedicated repository whose root can act as a Codex plugin marketplace. Local installation uses the same structure that a future GitHub install will use. This is the chosen approach because it keeps the plugin clean, shareable, and testable without blocking on public distribution.

## Chosen Repository Shape

```txt
dittosloop-for-codex/
  AGENTS.md
  README.md
  .agents/
    plugins/
      marketplace.json
  plugins/
    dittosloop-for-codex/
      .codex-plugin/
        plugin.json
      skills/
        loop/
          SKILL.md
      mcp/
        package.json
        src/
      preview/
        package.json
        src/
      assets/
  docs/
    superpowers/
      specs/
      plans/
```

`AGENTS.md` is only for development of this repository. Installed plugin behavior belongs in `skills/`, `mcp/`, and the preview app.

## Installed Plugin Components

### Skill

The bundled skill teaches Codex how to recognize loopable work, compile the user's intent into a loop contract, ask for confirmation, run a loop visibly, record events, and decide between completion, repair, or human escalation.

The skill should prefer explicit user confirmation before saving a durable loop. It should not silently create recurring responsibilities.

### Local MCP Runtime

The runtime is the source of truth for local plugin state. It exposes tools for creating loops, listing loops, triggering a run, appending events, recording verification, recording human requests, committing memory summaries, listing artifacts, and returning the preview URL.

The runtime stores local data in a documented user data directory outside the repo. The implementation should support a configurable data directory for tests and development.

### Preview App

The preview app is a local web UI served by the runtime or alongside it. Codex can open this URL in the in-app browser/right-side preview. The UI shows current loop status, run timeline, attempts, verification results, human requests, artifacts, and memory changes.

The preview should be useful but not authoritative. If the browser refreshes, it reloads state from the runtime.

### Marketplace

The repo includes `.agents/plugins/marketplace.json` so it can be installed locally during development and later from GitHub. The marketplace entry points to `./plugins/dittosloop-for-codex`.

### Hooks

Hooks are not part of the MVP. A future version may add a light session-start hook that summarizes active loops, but the core runtime cannot depend on hooks because the current local feature flag for plugin hooks is not stable.

## Data Model

The MVP should use a small JSON-backed store with these records:

- `LoopContract`: id, title, goal, scope, trigger mode, workflow summary, verification policy, memory policy, stop conditions, created timestamp, updated timestamp.
- `LoopRun`: id, loop id, trigger reason, status, started timestamp, ended timestamp, visible session reference, summary.
- `RunAttempt`: id, run id, attempt number, status, started timestamp, ended timestamp, input summary, output summary, error summary.
- `VerificationResult`: id, run id, attempt id, status, checks, evidence, created timestamp.
- `HumanRequest`: id, run id, prompt, status, response, created timestamp, resolved timestamp.
- `MemoryCommit`: id, loop id, run id, before summary, after summary, created timestamp.
- `ArtifactRef`: id, run id, title, kind, path or URL, created timestamp.

## Core Flow

1. The user asks Codex to turn work into a loop.
2. The skill drafts a loop contract and asks the user to confirm.
3. After confirmation, Codex calls the runtime to save the loop.
4. The runtime returns the loop id and preview URL.
5. When the user triggers the loop, the runtime creates one visible run.
6. Codex performs one attempt and appends events as the work progresses.
7. Codex records verification results.
8. If verification passes, Codex records completion and memory updates.
9. If verification fails, Codex records repair attempts under the same run.
10. If human input is needed, Codex records a human request and waits visibly.

## First Milestone

The first milestone is local and manual:

- Create the repository skeleton.
- Create a valid plugin manifest and marketplace entry.
- Add one bundled skill for loop creation and execution behavior.
- Add a local runtime with JSON storage and MCP tools.
- Add a local preview that displays persisted loop and run state.
- Support manual loop creation, manual run trigger, event append, verification record, and preview URL retrieval.
- Validate the plugin manifest and install it from the local marketplace.

## Testing And Verification

- Validate `.codex-plugin/plugin.json` with the plugin creator validator.
- Run runtime unit tests against a temporary data directory.
- Run an MCP smoke test that creates a loop, triggers a run, appends an event, records verification, and reads the preview URL.
- Run a preview smoke test in a browser against sample runtime data.
- Verify the local marketplace entry appears to Codex.
- Verify the installed plugin exposes the skill in a new Codex thread.

## Distribution Path

Local development uses the repository path as a marketplace root. Future sharing uses the same root from GitHub, for example through `codex plugin marketplace add owner/repo` or an equivalent Codex app install flow when available.

The repo should document both local install and GitHub install. Versioning should start at `0.1.0` for the first local MVP and avoid public stability claims until install, runtime, and preview smoke tests pass.

## Open Design Decisions Resolved

- The display name is `DittosLoop For Codex`.
- The normalized plugin id is `dittosloop-for-codex`.
- `AGENTS.md` is for repository development only.
- GitHub-ready marketplace repo is the primary structure.
- Local-first MVP is the first implementation target.
- Right-side preview is implemented as a local URL opened by Codex, not as a manifest-declared custom side panel.
- Hooks are future optional polish, not MVP infrastructure.

