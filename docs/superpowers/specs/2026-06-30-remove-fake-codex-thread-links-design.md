# Remove Fake Codex Thread Links Design

## Goal

Stop deriving openable Codex thread links from `threadId`. A run may carry a DittosLoop-owned `sessionId` and may optionally remember a host-provided `threadId`, but `threadUrl` must exist only when the Codex host explicitly provides a real openable URL.

## Motivation

The workflow and verification preview must not depend on synthetic `codex://thread/{threadId}` links. Durable workflow state should still be inspectable when no visible Codex thread has been created or attached.

## In Scope

- `record_codex_thread` records exactly the thread metadata provided by the host.
- `open_codex_session` reports `ready` only when a real `threadUrl` is present.
- `open_codex_session` returns the launch request and writeback instruction when a session exists but no openable URL is known.
- Workflow completion, task runs, verification results, and preview detail continue to work when no real thread URL exists.
- Tests cover the no-real-thread path and the real-thread-url path.

## Out of Scope

- Removing DittosLoop `sessionId`.
- Adding new MCP tools.
- Changing Verification v2 schemas or evaluator contracts.
- Changing Codex host thread creation behavior.

## Expected Behavior

- Host records `{ threadId }`: the run stores `threadId`, leaves `threadUrl` empty, and `open_codex_session` remains `unavailable`.
- Host records `{ threadId, threadUrl }`: the run stores both fields, and `open_codex_session` returns `ready`.
- No host thread is recorded: workflow execution and verification state remain visible in snapshot and run detail.

