# Loop Skill Progressive Disclosure Design

Status: ready for review before implementation planning starts.

## Context

The current `plugins/dittosloop-for-codex/skills/loop/SKILL.md` is a single 132-line instruction file. It contains all user-facing loop behavior in one place: when to use the skill, contract creation, workflow style selection, session-first execution, task result writeback, repair and revisions, verification, human requests, memory, artifacts, preview, tool map, and common mistakes.

That flat shape is still readable, but it will not scale well as DittosLoop For Codex grows. Agents need a small entry point that teaches the stable invariants and routes them to the right lifecycle reference only when the current task needs it.

## Goals

- Keep `SKILL.md` as the skill entry point, not a full manual.
- Split the primary flow by loop lifecycle: choose/create, execute, iterate or repair, inspect.
- Move MCP tool parameters and exact call rules into one bottom-layer `tool-reference.md`.
- Preserve current behavior and runtime invariants exactly unless a future implementation plan explicitly changes them.
- Keep the installed skill a single skill named `loop`; this is a documentation and instruction split, not a new plugin capability split.
- Make progressive disclosure explicit enough that the main agent can decide which reference files to read for each request.

## Non-Goals

- Do not change the MCP runtime behavior.
- Do not rename plugin identifiers, tool names, or the skill name.
- Do not add hidden recurrence, background automation, or hook-dependent behavior.
- Do not move development-only repository guidance from `AGENTS.md` into the installed skill.
- Do not create deep documentation chains where references point to further required references.

## Proposed Skill Structure

```text
plugins/dittosloop-for-codex/skills/loop/
├── SKILL.md
└── references/
    ├── choose-workflow.md
    ├── create-loop.md
    ├── execute-loop.md
    ├── iterate-loop.md
    ├── inspect-loop.md
    ├── memory-and-artifacts.md
    ├── human-requests.md
    └── tool-reference.md
```

## `SKILL.md` Responsibilities

`SKILL.md` should become a compact router and invariant guide. It should include:

- The current front matter name and description.
- A short overview: runtime state is source of truth, preview is read-only display, visible loop work is explicit.
- When to use and when not to use the skill.
- Stable invariants:
  - New user-visible formal runs start with `start_codex_session`.
  - Formal workflow execution uses `execute_workflow_attempt` with the returned `runId` and `attemptId`.
  - New loops use `create_loop_contract`.
  - Verification is recorded before completion unless the blocker is explicit.
  - User decisions are represented with `record_human_request` and `resolve_human_request`.
  - The preview is not editable state.
  - Task session result writeback should use precise locators and `idempotencyKey` when available.
  - Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
- A routing table that tells the agent which reference file to read for each task.
- A short warning to consult `tool-reference.md` when exact tool shape, parameters, or edge-case call rules are needed.

`SKILL.md` should not keep the full 24-step workflow, tool map, contract shape, workflow style details, or full mistake list inline.

## Routing Table

| User intent or agent need | Required reference files |
| --- | --- |
| User wants a new loop or contract | `references/choose-workflow.md`, `references/create-loop.md` |
| User wants to run an existing loop | `references/execute-loop.md` |
| A Codex task result must be written back, resumed, or suspended for human input | `references/execute-loop.md`, and `references/tool-reference.md` for exact locators |
| Verification failed, repair is needed, or workflow behavior should change | `references/iterate-loop.md` |
| User wants to inspect loop state, run detail, snapshot, or preview | `references/inspect-loop.md` |
| Agent needs durable memory or artifact rules | `references/memory-and-artifacts.md` |
| Agent needs to ask or resolve a user decision inside a run | `references/human-requests.md` |
| Agent needs exact MCP tool purpose, required fields, or parameter caveats | `references/tool-reference.md` |

## Reference File Responsibilities

### `choose-workflow.md`

Contains workflow style selection only. It should preserve the existing styles:

- `Pipeline`
- `Fan-out/Fan-in`
- `Multi-perspective Vote`
- `Single Expert`

It should explain that verification is an outer layer, not a workflow style. It should keep the current guidance that monitoring, reports, research, audits, multiple sources, multiple files, and competing judgments should not collapse into `Single Expert` without a clear reason.

### `create-loop.md`

Contains new loop creation flow:

- Shape title, goal, manual trigger, verification expectations, and whether a structured body is needed.
- Choose workflow style before writing `body.steps`.
- Use `create_loop_contract` for every new loop.
- Prefer formal runtime contracts and `task` steps with `runtime: "codex"`.
- Treat old `agent` steps as compatibility aliases only.
- Keep `sessionPolicy` omitted or `"new"`.
- Include optional subagent hints while stating DittosLoop records and passes hints through but does not enforce tool allowlists itself.
- Final response after loop creation should summarize selected style, task responsibilities, verifier rubrics, repair policy, and stop policy.

### `execute-loop.md`

Contains visible run execution:

- Use `list_loops` before reusing an existing loop.
- Use `start_codex_session` to create visible run, attempt, session request, workflow context, and memory excerpt.
- Use injected memory excerpt first; call `read_loop_memory` only when more durable context is needed.
- From that visible session, call `execute_workflow_attempt` with returned `runId` and `attemptId`.
- Use `record_session_result` for Codex task sessions that finish outside the immediate engine call.
- Preserve the rule that multiple locators must identify the same task run.
- Explain `needs_human` suspension at the workflow task level and when it opens a linked human request.
- Use `append_event`, `record_verification`, `complete_attempt`, and `complete_run` in the same behavioral order as the current skill.
- For manual follow-up outside normal workflow attempts, use `start_attempt`.

### `iterate-loop.md`

Contains repair and workflow evolution:

- If verification fails and repair work is needed, use `record_verification` with `repair: true` or call `mark_run_repairing`.
- Use workflow revision tools from the same visible session when active work discovers the workflow should change.
- Preserve the lifecycle: propose revision, list drafts when needed, promote or reject explicitly.
- Keep repair, revision, and verification tied to the current `runId` and `attemptId` when available.

### `inspect-loop.md`

Contains inspection and preview:

- Use `get_run_detail` for one run.
- Use `get_snapshot` for full state.
- Use `get_preview_url` and Codex's in-app browser for visual preview.
- State that preview displays runtime state and is not source of truth.
- Mention old compatibility runs may appear in preview state, but new user-visible runs should not be started through compatibility paths.

### `memory-and-artifacts.md`

Contains durable context and output references:

- Use injected bounded memory excerpt first.
- Use `read_loop_memory` with `loopId`, `limit`, and `offset` when more durable context is useful.
- Workflow tasks may read loop memory while working.
- Tasks should return durable observations in results instead of deciding long-term memory writes themselves.
- After verifier results are visible, the top-level visible Codex session decides whether to call `commit_memory`.
- Use `add_artifact` for useful local files, preview URLs, reports, or outputs.

### `human-requests.md`

Contains user decision flow:

- Use `record_human_request` when a decision is needed before continuing.
- Use `resolve_human_request` once the user answers.
- If the request is linked to a workflow task, resolution should write the answer back and resume the workflow.
- Do not ask for user input inside an active loop without recording the open request.

### `tool-reference.md`

Contains the full tool map and exact-use caveats now spread through `SKILL.md`:

- Contract and loop discovery: `create_loop_contract`, `list_loops`.
- Visible session and workflow execution: `start_codex_session`, `execute_workflow_attempt`.
- Task/session integration: `record_codex_thread`, `record_session_result`.
- Workflow revisions: `propose_workflow_revision`, `list_workflow_revisions`, `promote_workflow_revision`, `reject_workflow_revision`.
- Manual attempts and events: `start_attempt`, `complete_attempt`, `append_event`.
- Verification and repair: `record_verification`, `mark_run_repairing`.
- Human decisions: `record_human_request`, `resolve_human_request`.
- Memory and artifacts: `read_loop_memory`, `commit_memory`, `add_artifact`.
- Completion and inspection: `complete_run`, `get_run_detail`, `get_snapshot`, `get_preview_url`.

The reference should include exact caveats for `record_session_result`: provide `workflowContextId`, `attemptId`, an available task locator such as `taskRunId`, `sessionId`, or `stepId`, and an `idempotencyKey`; multiple locators must identify the same task run.

## Migration Rules

- Each existing instruction should move to exactly one main home.
- Small invariant reminders may appear in `SKILL.md`, but detailed procedure should live in one reference file.
- References should use direct relative links from `SKILL.md`.
- Reference files should not require reading other reference files except when `SKILL.md` routes the agent to both.
- Keep prose imperative and operational for agents.
- Do not add README, changelog, or nested reference folders under the skill directory.
- Avoid `@file` shorthand in skill instructions; use normal relative paths.

## Validation Strategy

After implementation, run:

- Repository checks: `npm run check`.
- Skill structure check:
  - `SKILL.md` front matter still has `name: loop`.
  - Every reference linked from `SKILL.md` exists.
  - No required reference path points outside `plugins/dittosloop-for-codex/skills/loop/references/`.
  - `SKILL.md` remains materially smaller than the current flat version.
- Behavioral pressure review:
  - Creating a new formal loop routes to `choose-workflow.md` and `create-loop.md`.
  - Running an existing loop routes to `execute-loop.md`.
  - Writing back an async task result routes to `execute-loop.md` and `tool-reference.md`.
  - Handling failed verification routes to `iterate-loop.md`.
  - Opening preview routes to `inspect-loop.md`.
  - Asking the user for a workflow decision routes to `human-requests.md`.

## Acceptance Criteria

- The installed loop skill still presents one skill named `loop`.
- The new `SKILL.md` is a compact entry point with lifecycle routing.
- The lifecycle references cover all current behavior from the old `SKILL.md`.
- `tool-reference.md` contains the detailed MCP tool map and exact call caveats.
- No runtime code behavior changes.
- Repository validation passes, or any failure is documented with a concrete blocker.
