# Live Loop Runtime Redesign

## Status

Approved direction: rebuild the DittosLoop For Codex runtime as an independent, formal Live Loop runtime. Keep this repository as the product boundary. Do not depend on the existing Dittos Loop product repository at runtime. Copy the engine ideas and small source patterns that are needed, then own them inside this plugin project.

## Context

The current `DittosLoop For Codex` plugin is a local-first Codex plugin with a bundled skill, MCP runtime, JSON state, and preview UI. It can create loop records, start runs, attach Codex thread metadata, record attempts, record verification, and show a preview. This proved the plugin surface works, but the runtime is still prompt-led: `start_codex_session` builds a large prompt and expects Codex to perform the loop discipline manually.

The main Dittos Loop project already has the right execution shape: `ExecutionBody`, `runBody`, `runFlow`, `EngineEvent`, `LoopRunner`, and a `SessionBus` seam. Those concepts model a loop as an executable contract with phases, agent steps, parallel work, event emission, session attachment, escalation, failure handling, and per-run history.

The plugin should now move from a record board to an executable loop runtime. It should stay independent from the main product repo, but copy the useful engine shape into this repo so the plugin can be installed, tested, and evolved on its own.

## Goals

- Treat `dittosloop-for-codex` as a standalone project with its own runtime, state, tests, preview, and release path.
- Copy the Live Loop execution model from the main Dittos Loop project into this plugin repo instead of importing the main repo as a package.
- Make loop contracts executable: a run should execute a structured workflow, not merely launch a broad reminder prompt.
- Add first-class workflow, verifier, repair, and Codex session bridge concepts.
- Keep the Codex session visible and native: when a user clicks a session, open the real Codex session instead of rendering a fake copy of the session result in the preview.
- Preserve current MCP tools where possible as compatibility wrappers while adding formal runtime tools.
- Keep runtime state local and outside committed files.

## Non-Goals

- Do not embed this plugin inside `/Users/edisonzhong/projects/dittos-loop`.
- Do not import the main Dittos Loop repo as a runtime dependency.
- Do not require the hosted Dittos Loop service.
- Do not pretend the plugin process can directly call Codex App session APIs until Codex exposes such an API to plugin runtimes.
- Do not make the preview UI the source of truth.
- Do not make prompt text the primary workflow engine.
- Do not implement cron, webhook, GitHub, Lark, or remote hosted triggers as part of this redesign.

## Approaches Considered

### Approach A: Keep The Current Prompt-Led Runtime

This would refine the generated session prompt and ask the Codex session to follow workflow, verification, and repair instructions. It is the smallest change, but it leaves loop behavior implicit, difficult to test, and dependent on one large prompt. It also keeps the UI and state model out of sync with the real Live Loop model.

Rejected because the plugin would still not be a formal loop runtime.

### Approach B: Import The Existing Dittos Loop Engine

This would reuse the existing engine directly from the main project. It is attractive for short-term parity, but it couples plugin installation and release to another repo with its own app, backend, daemon, and deployment concerns.

Rejected because `DittosLoop For Codex` must remain a separate project.

### Approach C: Independent Runtime With Copied Engine Core

This creates a plugin-owned runtime that copies the main project's proven concepts and small implementation patterns: `ExecutionBody`, deterministic `runBody`, `runFlow`, event emission, loop runner state transitions, and session bus seams. The plugin gets the same logic shape while remaining independently testable and distributable.

Chosen because it is formal from the start and keeps project boundaries clean.

## Chosen Architecture

```txt
plugins/dittosloop-for-codex/mcp/src/
  contract/
    types.ts
    validateContract.ts
    compileContract.ts
    migrateLegacyContract.ts
  engine/
    types.ts
    runFlow.ts
    runBody.ts
    parallel.ts
    events.ts
  runner/
    loopRunner.ts
    verifier.ts
    repair.ts
  codex/
    sessionBridge.ts
    hostMediatedBridge.ts
    promptCompiler.ts
  state/
    migrations.ts
  preview/
    eventAdapter.ts
```

Existing files may remain during migration, but new runtime logic should be organized around these boundaries.

## Contract Model

The current `LoopContract` is too thin for executable loops. The redesign introduces a formal contract while preserving legacy read compatibility.

```ts
export interface LoopContract {
  id: string;
  title: string;
  goal: string;
  intent?: string;
  scope?: string;
  trigger: TriggerSpec;
  projectBinding?: CodexProjectBinding;
  body: ExecutionBody;
  verification: VerificationPolicy;
  repairPolicy: RepairPolicy;
  stopPolicy: StopPolicy;
  memoryPolicy?: MemoryPolicy;
  status: "active" | "paused" | "archived";
  createdAt: string;
  updatedAt: string;
}
```

The legacy `intent` field can remain as a compatibility alias for older loops, but new writes should use `goal` and `body`.

### Execution Body

The execution body should copy the main Dittos Loop structure because it maps cleanly to engine primitives and is easy to validate.

```ts
export interface ExecutionBody {
  steps: Step[];
}

export type Step =
  | {
      id: string;
      kind: "phase";
      label: string;
      children: Step[];
    }
  | {
      id: string;
      kind: "parallel";
      label: string;
      children: Step[];
    }
  | {
      id: string;
      kind: "agent";
      label: string;
      prompt: string;
      verifierRef?: string;
      sessionPolicy?: "new" | "reuse-run" | "reuse-step";
    };
```

Rules:

- `phase` runs children sequentially and emits a visible phase boundary.
- `parallel` runs children concurrently through the engine's parallel primitive.
- `agent` invokes the Codex executor/session bridge.
- Scheduling steps are not allowed inside `body`; scheduling belongs to `trigger`.
- Each step id must be unique inside a contract.
- Old loops without `body` migrate to one agent step whose prompt is the old `intent` or run goal.

### Verification Policy

Verification is a runtime concern, not only a record type.

```ts
export interface VerificationPolicy {
  mode: "after_workflow" | "after_each_agent";
  rubrics: VerificationRubric[];
}

export interface VerificationRubric {
  id: string;
  label: string;
  requirement: string;
  severity: "must" | "should";
}
```

The verifier receives:

- loop goal
- current run goal
- workflow result
- relevant agent outputs
- rubrics
- prior failed checks, when repairing

It returns a structured verification result:

```ts
export interface VerificationDecision {
  status: "passed" | "failed" | "needs_human";
  summary: string;
  checks: Array<{
    rubricId: string;
    status: "passed" | "failed" | "skipped";
    evidence?: string;
  }>;
  repairInstructions?: string;
  humanQuestion?: string;
}
```

### Repair Policy

```ts
export interface RepairPolicy {
  maxAttempts: number;
  strategy: "repair_then_retry" | "ask_human" | "fail_run";
}
```

When verification fails:

1. If `strategy` is `repair_then_retry` and attempts remain, the runner creates a repair attempt.
2. The repair attempt receives the failed checks and repair instructions.
3. Verification runs again.
4. When attempts are exhausted, the runner either creates a human request or fails the run according to policy.

### Stop Policy

```ts
export interface StopPolicy {
  rule: string;
  maxConsecutiveFailures?: number;
}
```

Every loop must be cancellable and must have a stop rule. Missing stop rules should compile to `user cancels`.

## Engine Model

The plugin runtime should own a small engine copied from the main project shape.

### Flow API

```ts
export interface FlowApi {
  phase(title: string): void;
  agent(prompt: string, opts?: AgentOptions): Promise<AgentOutput>;
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<Array<T | null>>;
  log(message: string): void;
  commit(patch: { cursor?: unknown }): void;
  args?: Record<string, unknown>;
}
```

In production, `agent(...)` is not a fake local worker and should not be treated as a plain prompt-only shortcut. Its default executor is the configured `CodexSessionBridge`: the runner reaches an agent step, asks the bridge to create or reuse the appropriate Codex session, records the session reference, waits for or receives the step result, and then continues verifier, repair, and downstream workflow steps.

Tests and local previews may use fake executors, but product behavior should treat session-backed execution as the primary adapter for agent steps.

### Engine Events

Events are the canonical UI feed. Attempts and verification records should be derived from or linked to these events, not manually invented by the preview.

```ts
export type EngineEvent =
  | { type: "run_started"; runId: string; ts: string; args?: unknown }
  | { type: "phase_started"; runId: string; phaseId: string; title: string; ts: string }
  | { type: "phase_done"; runId: string; phaseId: string; status: "ok" | "failed"; ts: string }
  | { type: "agent_started"; runId: string; nodeId: string; phaseId?: string; label: string; prompt: string; session?: CodexSessionRef; ts: string }
  | { type: "agent_done"; runId: string; nodeId: string; status: "ok" | "failed"; result?: string; error?: string; session?: CodexSessionRef; ts: string }
  | { type: "verification_started"; runId: string; attemptId: string; ts: string }
  | { type: "verification_done"; runId: string; attemptId: string; decision: VerificationDecision; ts: string }
  | { type: "repair_started"; runId: string; attemptId: string; reason: string; ts: string }
  | { type: "human_request"; runId: string; question: string; ts: string }
  | { type: "run_done"; runId: string; status: "completed" | "failed" | "waiting_for_human"; summary?: string; ts: string };
```

The preview should render these events as the Live Loop timeline: phases in order, agent cards under phases, verification cards, repair loops, human requests, and final status.

## Loop Runner

The loop runner is the stateful orchestration layer.

Responsibilities:

- claim a loop run so overlapping runs do not execute for the same loop
- create a run record and initial attempt
- execute the contract body through `runFlow` and `runBody`
- call verifier according to `VerificationPolicy`
- apply `RepairPolicy`
- record human requests
- complete or fail runs
- update loop cursor, memory, and consecutive failure counters
- emit `EngineEvent` entries for preview and debugging

The runner must not be a prompt string. It is a deterministic TypeScript orchestrator.

## Codex Session Bridge

The engine should not know how Codex sessions are created. It calls a bridge.

```ts
export interface CodexSessionBridge {
  createSession(input: CreateCodexSessionInput): Promise<CodexSessionRef>;
  sendMessage(sessionId: string, input: CodexMessageInput): Promise<void>;
  readResult(sessionId: string): Promise<CodexSessionResult>;
  openSession(sessionId: string): Promise<void>;
}
```

The bridge is the execution adapter for workflow agent steps, not an alternative workflow path. A run still belongs to the loop runner: the runner owns phases, retries, verifier calls, repair policy, stop policy, cursor updates, and final status. The Codex session owns the actual step work and returns a result that the runner records back into the run.

### Host-Mediated Bridge

The first implementation should use a host-mediated bridge because the plugin MCP process currently does not have a proven direct Codex App session API.

Flow:

1. The runner emits `session_requested`.
2. The current Codex host thread creates the real Codex session using available Codex App thread tools.
3. The host thread calls `record_codex_thread` or the newer session bridge callback.
4. The runner records the `threadId`, `threadTitle`, `threadUrl`, and status.
5. The preview's "open session" action opens the recorded Codex session URL or requests the host to open it.

This bridge is a formal adapter, not a throwaway workaround. When Codex exposes a direct plugin-side session API, only this adapter should change.

### Prompt Compiler

The session prompt remains necessary, but it is no longer the workflow engine. It should compile only the current step's execution context:

- loop title and goal
- current run goal
- selected project binding
- current phase and agent step
- required input from previous steps
- relevant rubrics
- expected result shape for the step

It should not include hidden scheduling logic, global system-prompt style rules, or the entire loop runtime contract unless needed.

## MCP Tool Surface

Keep existing tools for compatibility. Add formal runtime tools.

Existing compatibility tools:

- `create_loop`
- `list_loops`
- `trigger_run`
- `start_codex_session`
- `record_codex_thread`
- `start_attempt`
- `complete_attempt`
- `record_verification`
- `record_human_request`
- `complete_run`
- `get_run_detail`
- `get_snapshot`
- `get_preview_url`

New or upgraded tools:

- `create_loop_contract`: create a formal contract with `body`, `verification`, and policies.
- `update_loop_contract`: edit contract fields and migrate old loops.
- `start_loop_run`: start a formal engine-backed run.
- `record_session_result`: write a Codex session result back to the runner.
- `resume_loop_run`: continue a run waiting on a session result or human answer.
- `open_codex_session`: ask the host to open a recorded session.

Compatibility behavior:

- `create_loop` creates a formal contract with a one-step `ExecutionBody`.
- `trigger_run` remains a record-only helper until replaced by `start_loop_run`.
- `start_codex_session` becomes a wrapper around `start_loop_run` with a single agent body.

## Preview Redesign

The preview should follow the Live Loop look and behavior, but its data model should come from engine events.

Views:

- loop list with project binding, run count, verification state, and active toggle
- selected loop header with title, goal, trigger, project, run count, and action buttons
- tabs for history and directory
- run detail page with phase rail and agent cards
- verification and repair cards embedded in the run timeline
- session links that open real Codex sessions

The preview should not render a fake transcript. It should show run structure and link to native Codex sessions for full detail.

## State And Migration

State stays JSON-backed and local.

Add a state version migration path:

- version 1: current thin loop/run/attempt state
- version 2: formal contract, engine events, session requests, verifier decisions

Migration rules:

- `LoopContract.intent` becomes `goal` when `goal` is absent.
- `verification.checks` becomes `verification.rubrics` with generated ids.
- loops without `body` become one agent step.
- existing attempts and events are preserved.
- existing `codexSession` records become session refs attached to the matching run.

## Testing Strategy

Unit tests:

- contract validation accepts formal contracts and rejects missing body, duplicate step ids, invalid policies, and scheduling steps inside body
- migration converts legacy loops without losing run detail data
- `runBody` executes phase, agent, and parallel steps in the expected order
- `runFlow` emits stable events around agent success and failure
- verifier turns rubrics and candidate output into a structured decision
- repair policy retries and then stops according to max attempts
- host-mediated bridge records session requests and session results

Service tests:

- `create_loop` produces a formal one-step contract
- `create_loop_contract` stores a formal contract
- `start_loop_run` creates a run, emits events, requests session work, records verifier results, and completes
- failed verification moves the run to repair and then either passes, waits for human, or fails

Preview tests:

- snapshot includes formal contracts and engine events
- run detail endpoint returns engine event history
- event adapter maps phases, agents, verification, repair, and human requests into renderable groups

Smoke test:

1. Create a monitoring loop contract for AI dev tool updates.
2. Start a formal run.
3. Request a Codex session for the worker step.
4. Record a fake session result.
5. Run verifier.
6. Complete the run.
7. Load preview and confirm the run timeline has workflow, session ref, verifier, and completion.

## Implementation Phases

### Phase 1: Contract And Migration

Add formal contract types, validation, compile defaults, and migration from legacy state. Existing MCP tools continue to work.

### Phase 2: Engine Core

Copy and adapt the small engine core into this repo: `runFlow`, `runBody`, parallel binding, and engine events. Tests use fake executors.

### Phase 3: Runner, Verifier, And Repair

Build `LoopRunner`, verifier execution, repair attempts, human request transitions, and event persistence.

### Phase 4: Codex Bridge

Add `CodexSessionBridge` and host-mediated implementation. Connect `start_loop_run` to session requests and result callbacks.

### Phase 5: Preview Parity

Render engine events in a Live Loop-style timeline. "View session" opens the real recorded Codex session.

### Phase 6: Compatibility Cleanup

Turn old prompt-led tools into wrappers or mark them as compatibility-only. Update README and skill instructions to describe the formal runtime.

## Acceptance Criteria

- The plugin repo remains independent from the main Dittos Loop repo.
- No runtime import points at `/Users/edisonzhong/projects/dittos-loop`.
- The plugin has formal `ExecutionBody` types and validation.
- A loop run can execute through the plugin-owned engine with fake executor tests.
- Verifier and repair are runtime steps, not only manual records.
- Session creation goes through a bridge interface.
- Host-mediated bridge is documented as the first adapter.
- Preview run detail is driven by engine events.
- Clicking a session opens or references the native Codex session instead of rendering a duplicate transcript.
- Legacy loops still load and migrate.
- `npm run check` remains the repo-level validation command.

## Open Questions

- Which Codex App API, if any, will be available to plugin MCP processes for direct session creation?
- Should each agent step create a new Codex session by default, or should a run reuse one session unless a step requests isolation?
- Should verifier run in the same session bridge as worker agents, or use a separate local model/executor adapter in a future phase?

The architecture should not block on these questions. The bridge and policies keep those choices replaceable.
