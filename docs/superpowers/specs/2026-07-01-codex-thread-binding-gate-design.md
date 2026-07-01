# Codex Thread Binding Gate Design

## Goal

Formal DittosLoop executions must not run inside the caller's current Codex session after `start_codex_session` only records a launch request. The host-created Codex thread has to be attached with `record_codex_thread` before the workflow advances.

## Background

The MCP runtime cannot directly call private Codex App thread creation APIs. Its responsibility is to record a launch request, expose the prompt to the host, and store the real thread metadata after the host creates the visible thread.

The previous FDE loop failure happened because `execute_workflow_attempt` could still be called from the original session while the top-level `codexSession` only had `status: "requested"` and no host thread binding.

## Design

- Keep business verification focused on workflow output quality. Do not encode Codex thread creation as a loop-specific verification criterion.
- Enforce the session invariant at the MCP execution boundary. `execute_workflow_attempt` must reject a run whose top-level `codexSession.mode` is `new_session` when neither `threadId` nor `threadUrl` is present.
- Keep service-level workflow tests able to exercise the engine without simulating the Codex App host. The public MCP tool path is the user-visible product boundary.
- Update the loop skill execution guide so agents create or bind the real Codex thread immediately after `start_codex_session`, before calling `execute_workflow_attempt`.

## Error Handling

The rejection message must explain the required recovery path: create a new Codex thread from `launchRequest.prompt`, then call `record_codex_thread`, then retry `execute_workflow_attempt`.

## Testing

- Add a failing MCP test proving `execute_workflow_attempt` rejects an unbound requested Codex session.
- Update MCP/E2E tests that intentionally execute workflows to attach a real host thread first.
- Run targeted MCP/E2E tests, then build and run the MCP test suite.
