# Runtime Script Dynamic Workflow Design

Review status: draft for user review.

## Status

This design introduces OpenClaw-style runtime script workflows for DittosLoop For
Codex. It intentionally supersedes the dynamic-workflow position in
`2026-06-25-script-flow-alignment.md` and the non-goal in
`2026-06-27-durable-workflow-graph-design.md` that ruled out JavaScript workflow
runtime execution.

The existing `body.steps` and `script.build` builder-AST paths remain supported as
static workflow authoring and compatibility surfaces. They are no longer the target
semantics for dynamic workflows.

## Reference Model

The reference behavior is the OpenClaw dynamic workflow plugin model:

- A tool receives a JavaScript orchestration script body plus `args`.
- The script runs in a constrained `node:vm` context.
- The runtime injects `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and
  `budget`.
- `agent()` spawns an isolated sub-agent session and awaits its result.
- `parallel()` and `pipeline()` are real JavaScript helpers, so normal JavaScript
  control flow can decide how many sub-agents run and what comes next.
- Resume is journal-based: a rerun re-executes the script, but completed `agent()`
  calls return cached results keyed by script, args, call site, and prompt.

This design adapts that model to DittosLoop For Codex while preserving visible
execution, local-first state, and compatibility with existing loops.

## Problem

The current DittosLoop For Codex `script` support is not runtime dynamic workflow.
It is a serializable builder AST:

```json
{ "build": [{ "fn": "task", "args": [{ "id": "scan", "prompt": "Scan" }] }] }
```

That AST compiles to `body.steps`. After creation, the runtime executes a static
graph derived from `body.steps`. This is useful for inspectable workflows, but it
does not support runtime JavaScript decisions such as:

```js
const files = await agent("Find risky files");
return await parallel(files.map((file) => () => agent(`Review ${file}`)));
```

The desired dynamic workflow form treats the script itself as the orchestration
program. The runtime must be able to run the script, fan out real sub-agents,
collect results into script variables, and resume safely by replaying the script
with journaled `agent()` outputs.

## Goals

- Add a first-class runtime script workflow definition.
- Support JavaScript workflow scripts with top-level `await` and `return`.
- Inject `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and `budget`.
- Make `agent()` spawn a visible, isolated Codex sub-agent through a narrow bridge.
- Support dynamic fan-out driven by script logic, including `if`, `for`, `map`,
  `filter`, and prior agent output.
- Add a durable replay journal so reruns reuse completed sub-agent outputs.
- Require human approval before running a runtime script by default.
- Preserve existing `body.steps` loops and old `script.build` AST compatibility.
- Make runtime script activity visible in run history and preview surfaces.
- Store journal and saved-script state outside committed repository files.

## Non-Goals

- Do not treat `node:vm` as a security boundary.
- Do not support arbitrary host I/O from workflow scripts.
- Do not persist or restore a live JavaScript continuation.
- Do not remove existing static `body.steps` workflows.
- Do not make the preview editable or authoritative.
- Do not add hidden always-on background execution in the first milestone.
- Do not support nested dynamic workflows from inside sub-agents.
- Do not require hosted services for the local MVP.

## Terminology

- **Static workflow:** A workflow defined by `body.steps`, including old
  `script.build` inputs that compile to `body.steps`.
- **Runtime script workflow:** A workflow whose orchestration source is a
  JavaScript script string executed by the workflow runtime.
- **Builder AST:** The existing JSON builder-call format under `script.build`.
- **Sub-agent:** An isolated Codex child session or equivalent local runner used
  by `agent()`.
- **Replay journal:** Durable cache of completed `agent()` calls for a specific
  script, args, call site, and prompt.

## Target Model

```text
Runtime script contract
  -> approval gate
  -> validate script
  -> run script in constrained VM
  -> injected agent()/parallel()/pipeline()
  -> sub-agent bridge
  -> replay journal
  -> final script return value
  -> run history + preview
```

Static workflows continue to use:

```text
body.steps or script.build
  -> compile/validate contract
  -> durable execution graph
  -> node runs
  -> preview
```

These are two workflow kinds with a shared loop/run envelope, verification policy,
memory/artifact storage, and preview entry point.

## Contract Shape

Introduce an explicit workflow definition union. Existing persisted contracts can
be upgraded in memory without rewriting old state.

```ts
export type WorkflowDefinition =
  | StaticStepsWorkflowDefinition
  | RuntimeScriptWorkflowDefinition;

export interface StaticStepsWorkflowDefinition {
  kind: "static_steps";
  body: ExecutionBody;
  source?: {
    kind: "body_steps" | "builder_ast";
    scriptBuildHash?: string;
  };
}

export interface RuntimeScriptWorkflowDefinition {
  kind: "runtime_script";
  script: RuntimeWorkflowScript;
}

export interface RuntimeWorkflowScript {
  language: "javascript";
  source: string;
  argsSchema?: Record<string, unknown>;
  limits?: RuntimeScriptLimits;
  journal?: RuntimeScriptJournalPolicy;
  approval?: RuntimeScriptApprovalPolicy;
}

export interface RuntimeScriptLimits {
  concurrency: number;
  totalAgentCalls: number;
  scriptTimeoutMs: number;
  agentTimeoutMs: number;
}

export interface RuntimeScriptJournalPolicy {
  enabled: boolean;
  cacheFailures: false;
}

export interface RuntimeScriptApprovalPolicy {
  required: boolean;
  previewChars: number;
}
```

`FormalLoopContract` should expose `workflow: WorkflowDefinition`. During the
transition it may also keep `body` for old code paths, but for runtime script
contracts `body` is absent and must not be synthesized as if the workflow were
static.

### MCP Input Compatibility

`create_loop_contract` accepts three authoring forms:

1. Existing static body:

```json
{ "body": { "steps": [] } }
```

2. Existing builder AST:

```json
{ "script": { "build": [] } }
```

3. New runtime script:

```json
{
  "workflowKind": "runtime_script",
  "script": "phase('scan'); return await agent('Find risks');",
  "args": { "scope": "repo" }
}
```

Rules:

- `body` and runtime script are mutually exclusive.
- `script` object with `build` means builder AST compatibility.
- `script` string requires `workflowKind: "runtime_script"`.
- A runtime script contract stores the script source as script source, not as
  compiled `body.steps`.
- Old contracts without `workflow` are interpreted as `static_steps`.

## Runtime API

The script body is wrapped as an async function so top-level `await` and `return`
work:

```js
phase("scan");
const files = await agent("Find files that need review", { key: "find-files" });

phase("review");
const findings = await parallel(
  files.map((file) => () =>
    agent(`Review ${file}`, { key: `review:${file}`, label: file })
  )
);

return findings.filter(Boolean);
```

### `agent(prompt, opts?)`

```ts
type RuntimeAgent = (
  prompt: string,
  opts?: {
    key?: string;
    label?: string;
    schema?: Record<string, unknown>;
    agentProfileRef?: string;
    timeoutMs?: number;
    cache?: boolean;
  }
) => Promise<unknown>;
```

Behavior:

- Starts one isolated sub-agent through `WorkflowSubagentBridge`.
- Returns text by default, or a validated object when `schema` is provided.
- Emits `agent:start`, `agent:done`, `agent:error`, and `agent:cached` events.
- Uses the replay journal before spawning when cache is enabled.
- Returns `null` for a handled sub-agent failure, while preserving the failure
  reason in run history.
- Enforces total agent call and per-agent timeout limits.

`opts.key` is strongly recommended for calls generated from dynamic arrays. If no
key is supplied, the runtime uses the current phase and sequence number. That
fallback is convenient, but adding or reordering prior `agent()` calls changes the
cache key for later calls.

### `parallel(...thunks)` and `parallel([thunks])`

```ts
type RuntimeParallel = (
  ...thunksOrArray: Array<(() => Promise<unknown>) | Array<() => Promise<unknown>>>
) => Promise<unknown[]>;
```

Behavior:

- Accepts either varargs or one array.
- Runs thunks through the concurrency scheduler.
- Preserves input order in the returned array.
- Converts failed thunks to `null` and records the failure.
- Does not cancel successful siblings when one child fails.

### `pipeline(items, ...stages)`

```ts
type RuntimePipeline = (
  items: unknown[],
  ...stages: Array<(prev: unknown, item: unknown, index: number) => Promise<unknown>>
) => Promise<unknown[]>;
```

Behavior:

- Each item flows through every stage in order.
- Different items may run concurrently subject to the same scheduler.
- A failed item chain returns `null` for that item.

### `phase(name)` and `log(message)`

`phase(name)` changes the current visible phase. `log(message)` records a progress
line under the current phase. Both are reflected in run history and preview state.

### `args` and `budget`

`args` is caller-supplied structured input. `budget` exposes a small read-only
object:

```ts
{
  total: number | null;
  spent(): number;
  remaining(): number | null;
}
```

The initial implementation may track agent-call budget rather than exact token
spend if Codex token accounting is not available through the bridge.

## Sub-Agent Bridge

Runtime scripts must not know how Codex sessions are spawned. They call
`agent()`, and `agent()` delegates to a narrow bridge.

```ts
export interface WorkflowSubagentBridge {
  runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult>;
}

export interface WorkflowSubagentInput {
  runId: string;
  attemptId: string;
  sessionKey: string;
  prompt: string;
  label: string;
  agentProfileRef?: string;
  timeoutMs: number;
  idempotencyKey: string;
}

export interface WorkflowSubagentResult {
  status: "ok" | "error" | "timeout" | "canceled";
  output?: unknown;
  error?: string;
  sessionId?: string;
}
```

The first implementation should include:

- `FakeSubagentBridge` for deterministic runtime and journal tests.
- A real Codex bridge that starts a visible child session or uses the existing
  local session bridge seam.
- A bridge-level idempotency key derived from the journal key, so retrying a
  dispatch cannot create duplicate child sessions for the same `agent()` call.

## Replay Journal

The journal is the resume mechanism for runtime scripts. It does not persist a
JavaScript stack. Instead, the runtime reruns the script and short-circuits
completed `agent()` calls.

### Key

```ts
export interface RuntimeJournalKeyParts {
  contractId: string;
  scriptHash: string;
  argsHash: string;
  callSite: string;
  promptHash: string;
  optsHash: string;
}
```

`callSite` is `opts.key` when present. Otherwise it is derived from phase and
agent sequence, such as `scan#3`.

`scriptHash` is based on normalized source. `argsHash` uses stable JSON hashing.
`optsHash` includes schema and target agent profile because those can change the
meaning of an `agent()` call.

### Entry

```ts
export interface RuntimeJournalEntry {
  key: string;
  status: "completed";
  output: unknown;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}
```

Only completed, schema-valid outputs are cached in the first milestone. Failures
are recorded as run events but not reused as successful journal entries.

### Storage

Journal state lives under the documented DittosLoop For Codex user data directory,
outside the repository. It may be embedded in the existing local state store or
split into a versioned runtime-script journal file. It must not store secrets, raw
environment variables, or unbounded child-session logs.

## Script Validation And Sandbox

The VM is a speed bump, not a security boundary. The real safety controls are:

- trusted local authoring,
- explicit approval before execution,
- no injected host I/O primitives,
- obvious-danger token validation,
- tight runtime limits,
- local-only state.

Reject scripts containing obvious host access and nondeterminism:

- `require`
- `import(`
- `process`
- `globalThis`
- `fetch`
- `fs`, `child_process`, `net`, `http`, `https`, `os`, `vm`
- `eval`
- `Function`
- `constructor`
- `__proto__`
- `Date`
- `Math.random`
- `crypto`
- `performance`

This list is not a sandbox guarantee. It prevents accidental misuse and common
prompt-injection mistakes. The approval UI and local trust model remain mandatory.

## Approval

Runtime script execution requires approval by default. The approval prompt must
show:

- loop title,
- workflow kind,
- script preview,
- args preview,
- limits,
- warning that the VM is not a security boundary.

Headless test mode may skip approval only through an explicit environment or test
configuration flag. Production/default local use keeps approval enabled.

## Execution Semantics

1. Load loop contract and confirm `workflow.kind === "runtime_script"`.
2. Require approval unless explicitly disabled for tests.
3. Validate script source and args.
4. Create runtime context: scheduler, budget, event sink, sub-agent bridge,
   replay journal.
5. Run the script in the constrained VM.
6. For each `agent()` call:
   - compute journal key,
   - emit cached event and return output on hit,
   - otherwise dispatch through sub-agent bridge,
   - persist completed output to journal,
   - emit result event.
7. Return the script's final value as the workflow attempt result.
8. Run normal loop verification after the workflow result, when configured.

Runtime script workflows should be safe to rerun. Repeated runs with the same
script and args should not re-spawn completed `agent()` calls.

## Run History And Preview

Runtime script workflows emit explicit events:

```ts
type RuntimeScriptEvent =
  | { type: "runtime_script_started"; scriptHash: string }
  | { type: "phase"; name: string }
  | { type: "log"; phase: string; message: string }
  | { type: "agent:start"; phase: string; label: string; key: string; promptPreview: string }
  | { type: "agent:cached"; phase: string; label: string; key: string }
  | { type: "agent:done"; phase: string; label: string; key: string; status: string; sessionId?: string }
  | { type: "agent:error"; phase: string; label: string; key: string; error: string }
  | { type: "runtime_script_done"; status: "completed" | "failed" };
```

The preview should show runtime script workflows differently from static
`body.steps` workflows:

- script hash and source summary,
- current and completed phases,
- sub-agent rows with status, label, and session id when available,
- cache-hit markers,
- final returned result,
- failure reasons.

The preview remains read-only. Runtime state remains owned by the local MCP
runtime and persisted store.

## Compatibility And Migration

- Existing `body.steps` contracts load as `workflow.kind = "static_steps"`.
- Existing `script.build` inputs continue to compile to static `body.steps`.
- Existing run history and preview behavior for static workflows is unchanged.
- The loop skill documentation must stop describing builder AST as "dynamic
  workflow script".
- New runtime script loops must be visibly labeled as runtime script workflows.
- Existing loops do not need migration before this feature can ship.

## Validation

The companion validation plan is
`docs/superpowers/specs/2026-06-29-runtime-script-dynamic-workflow-validation.md`.

The feature is not complete unless the validation plan passes, including both
mock sub-agent tests and at least one real Codex sub-agent smoke test.

## Open Questions

- Which Codex session bridge should be the first real `WorkflowSubagentBridge`
  implementation: the existing session-first loop runner, a new dedicated child
  session API, or a narrow wrapper around current MCP session tools?
- Should saved runtime scripts be a first milestone, or should `save/list/run-saved`
  wait until the basic runtime, journal, and preview are proven?
- Should journal entries be scoped by contract revision as well as contract id and
  script hash?
- Should schema validation retry failed sub-agent outputs in the first milestone,
  or should schema support be accepted but initially single-pass?
