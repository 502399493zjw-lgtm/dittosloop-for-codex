# Final Session Result Envelope Design

Review status: approved in thread on 2026-06-25 after the comparison between Codex plugin workflow result delivery and Claude Code parent-session result delivery.

## Problem

Workflow completion currently returns the full `LoopRun` from `execute_workflow_attempt` and `record_session_result`. The runtime already records useful `sessionResult` metadata in lifecycle events, but the main Codex session still has to infer the final user-facing answer from the full run state, verification records, events, and workflow context.

The desired external behavior is closer to Claude Code parent-session result delivery: when the workflow reaches a terminal or waiting state, the calling Codex session should receive a clear result envelope that it can use directly in its reply.

## Goals

- Preserve existing run state, preview history, workflow contexts, and compatibility for callers that read the returned run directly.
- Add a top-level session-facing envelope to workflow MCP responses.
- Make the envelope appear on terminal or user-blocked workflow responses, not on ordinary in-progress responses.
- Keep the runtime state machine unchanged.

## Non-Goals

- Do not replace `record_session_result`, workflow context persistence, pending sessions, or idempotency.
- Do not create a private Codex session injection mechanism.
- Do not change preview rendering.
- Do not alter Claude Code source context.

## Design

Add a small response wrapper for workflow-facing MCP tools:

```ts
interface WorkflowToolResponse extends LoopRun {
  run: LoopRun;
  sessionResult?: WorkflowSessionResultEnvelope;
}

interface WorkflowSessionResultEnvelope {
  status: "completed" | "failed" | "waiting_for_human";
  finalAnswer: string;
  summary: string;
  result?: unknown;
  verification?: {
    status: VerificationStatus;
    summary: string;
    checks: VerificationResult["checks"];
  };
  artifacts: ArtifactRef[];
  humanRequest?: {
    id: string;
    question: string;
  };
}
```

`execute_workflow_attempt` and `record_session_result` should return this compatibility wrapper. The response keeps the original `LoopRun` fields at the top level, adds `run` as an explicit mirror of the same run, and exposes `sessionResult` only when the run is `completed`, `failed`, or `waiting_for_human`.

`sessionResult.finalAnswer` should prefer the last targeted workflow task result text when available, then the latest verification summary, then the latest attempt summary, then the run goal. This gives the main Codex session a direct answer while still retaining verification details.

## Data Flow

1. A visible Codex session calls `execute_workflow_attempt` or `record_session_result`.
2. The service still performs the existing workflow state transition and returns the updated run.
3. The MCP handler asks the service for the current run detail and builds `sessionResult` from the latest workflow task result, verification, artifacts, and human request.
4. In-progress responses return the existing top-level run fields plus `{ run }`.
5. Terminal or waiting responses return the existing top-level run fields plus `{ run, sessionResult }`.

## Error Handling

Existing service validation remains the source of truth for ambiguous task locators, failed task results, idempotency, and human requests. If a workflow is still running or waiting for sibling task sessions, the handler does not include `sessionResult`.

## Testing

Add MCP-level tests because this is a tool response shape change:

- `record_session_result` final completion returns `{ run, sessionResult }`.
- The envelope contains `finalAnswer`, verification summary/checks, artifacts, and no human request for a completed run.
- In-progress `execute_workflow_attempt` still returns only `{ run }`.

Run the existing MCP, service, and end-to-end workflow tests after the change.
