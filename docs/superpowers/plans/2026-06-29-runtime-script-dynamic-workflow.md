# Runtime Script Dynamic Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Review status: draft for user review.

**Goal:** Build OpenClaw-style runtime script dynamic workflows in DittosLoop For Codex, where JavaScript workflow source runs as the orchestration program, calls visible Codex sub-agents through `agent()`, supports `parallel()` and `pipeline()`, resumes through a replay journal, and remains compatible with existing `body.steps` and `script.build` static workflows.

**Architecture:** Keep static workflows on the existing `body.steps` and graph scheduler path. Add a separate `runtime_script` workflow kind that stores JavaScript source, validates it, executes it in a constrained `node:vm` context with injected primitives, and persists completed `agent()` results into a replay journal. The service branches at execution time: static workflows continue through `LoopRunner` or the graph scheduler; runtime scripts go through a new runtime executor that uses the existing Codex session bridge and workflow context state so every sub-agent is visible, resumable, and recordable.

**Tech Stack:** TypeScript, Node.js 20 `node:vm`, Zod, Vitest, existing `LoopService`, `LoopStore`, `CodexSessionBridge`, workflow context state, preview timeline adapter, and MCP server schemas.

## Source Documents

- `docs/superpowers/specs/2026-06-29-runtime-script-dynamic-workflow-design.md`
- `docs/superpowers/specs/2026-06-29-runtime-script-dynamic-workflow-validation.md`

## Global Constraints

- Do not remove or weaken existing `body.steps` behavior.
- Do not reinterpret old `script.build` as runtime script.
- Runtime script input must be explicit: `workflowKind: "runtime_script"` plus a string `script`.
- Runtime script contracts must not be compiled into `body.steps`.
- `node:vm` is only a containment mechanism, not a security boundary; approval remains required by default.
- Runtime script `agent()` must create visible Codex sub-agent sessions through the existing bridge.
- A waiting sub-agent must suspend the run without creating duplicate sessions on resume.
- Completed `agent()` calls must be journaled and reused by script hash, args hash, call site, prompt hash, and options hash.
- Runtime script validation must include at least one real verifier sub-agent path, not only mocks.
- Keep local state outside committed files, under the existing store data directory.
- Run verification after each task before marking that task complete.

## Desired Public Contract

### Static Steps

Existing loops stay valid:

```json
{
  "title": "Static review",
  "goal": "Review known files",
  "body": {
    "steps": [
      { "kind": "agent", "id": "review", "label": "Review", "prompt": "Review src/index.ts" }
    ]
  },
  "verification": { "checks": [] }
}
```

### Builder AST Compatibility

Existing builder AST stays valid and still compiles to `body.steps`:

```json
{
  "title": "Builder review",
  "goal": "Review known files",
  "script": {
    "build": [
      { "fn": "agent", "args": [{ "id": "review", "label": "Review", "prompt": "Review src/index.ts" }] }
    ]
  },
  "verification": { "checks": [] }
}
```

### Runtime Script

New runtime script workflows use explicit kind plus source string:

```json
{
  "workflowKind": "runtime_script",
  "title": "Dynamic review",
  "goal": "Review only risky files",
  "script": "const files = JSON.parse(await agent('List risky files as JSON array')); return await parallel(files.map((file) => () => agent(`Review ${file}`)));",
  "args": { "maxFiles": 3 },
  "limits": { "maxAgentCalls": 8, "timeoutMs": 120000 },
  "verification": {
    "version": 2,
    "criteria": [
      { "id": "verified-by-agent", "label": "Verifier checked output", "severity": "must" }
    ],
    "validators": [
      {
        "id": "verifier-subagent",
        "type": "rubric_agent",
        "label": "Verifier sub-agent",
        "severity": "must",
        "criteriaIds": ["verified-by-agent"],
        "prompt": "Verify the workflow result and cite evidence.",
        "evidenceRequired": true,
        "allowSelfReview": false,
        "subagent": { "profile": "reviewer" }
      }
    ],
    "decision": {
      "failOnMustValidatorFailure": true,
      "failOnShouldValidatorFailure": false,
      "requireAllMustCriteriaCovered": true
    }
  }
}
```

## Implementation Tasks

### 1. Contract Types and Compatibility Guardrails

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/contract/types.ts` with a workflow union that can represent static steps and runtime scripts.

  Add these shapes without deleting existing step types:

  ```ts
  export interface StaticStepsWorkflowDefinition {
    kind: "static_steps";
    body: ExecutionBody;
  }

  export interface RuntimeScriptWorkflowDefinition {
    kind: "runtime_script";
    language: "javascript";
    source: string;
    args?: Record<string, unknown>;
    limits?: RuntimeScriptLimits;
    approval?: RuntimeScriptApprovalPolicy;
    journal?: RuntimeScriptJournalPolicy;
  }

  export interface RuntimeScriptLimits {
    timeoutMs?: number;
    maxAgentCalls?: number;
    maxParallelBranches?: number;
    maxPipelineItems?: number;
    maxLogChars?: number;
  }

  export interface RuntimeScriptApprovalPolicy {
    required: boolean;
    approvedAt?: string;
    approvedBy?: string;
  }

  export interface RuntimeScriptJournalPolicy {
    enabled: boolean;
  }

  export type WorkflowDefinition = StaticStepsWorkflowDefinition | RuntimeScriptWorkflowDefinition;
  ```

- [ ] Preserve `FormalLoopContract.body` for static compatibility, but allow it to be absent only when `workflow.kind === "runtime_script"`.

  Target shape:

  ```ts
  export interface FormalLoopContract {
    id: string;
    title: string;
    goal: string;
    workflow: WorkflowDefinition;
    body?: ExecutionBody;
    verification: VerificationPolicy;
    // keep existing optional fields unchanged
  }
  ```

- [ ] Update `FormalLoopContractInput` so `body` and runtime `script` can be accepted before normalization.

  Requirements:

  - `body` means static workflow.
  - object `script.build` means legacy builder AST and must compile to static workflow.
  - string `script` is accepted only with `workflowKind: "runtime_script"`.
  - reject `body` plus any `script`.
  - reject string `script` without `workflowKind: "runtime_script"`.
  - reject object `script.build` with `workflowKind: "runtime_script"`.

- [ ] Extend `VerificationRubricAgentValidator` with verifier sub-agent controls.

  ```ts
  export interface VerificationRubricAgentValidator extends VerificationValidatorBase {
    type: "rubric_agent";
    prompt: string;
    scoreScale?: { min: number; max: number };
    passScore?: number;
    evidenceRequired?: boolean;
    subagent?: CodexSubagentSpec;
    allowSelfReview?: boolean;
  }
  ```

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`.

  Expected behavior:

  ```ts
  export function compileContract(input: FormalLoopContract): FormalLoopContract {
    if (input.workflow.kind === "runtime_script") {
      return {
        ...input,
        body: undefined,
        verification: migrateVerificationToV2(input.verification)
      };
    }

    const body = input.body ?? input.workflow.body;
    return {
      ...input,
      workflow: { kind: "static_steps", body },
      body,
      verification: migrateVerificationToV2(input.verification)
    };
  }
  ```

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`.

  Static validation:

  - `workflow.kind === "static_steps"` requires non-empty `body.steps`.
  - existing step validation stays unchanged.

  Runtime script validation:

  - `workflow.kind === "runtime_script"` requires `language === "javascript"`.
  - `source` must be non-empty and below a documented max length.
  - no `body.steps` requirement.
  - validate limits are positive integers when present.
  - validate approval policy is present and defaults to `required: true` during normalization.

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts` schemas.

  Add a runtime script schema separate from the builder AST:

  ```ts
  const runtimeScriptLimitsSchema = z.object({
    timeoutMs: z.number().int().positive().optional(),
    maxAgentCalls: z.number().int().positive().optional(),
    maxParallelBranches: z.number().int().positive().optional(),
    maxPipelineItems: z.number().int().positive().optional(),
    maxLogChars: z.number().int().positive().optional()
  }).strict();

  const createLoopContractObjectSchema = z.object({
    workflowKind: z.enum(["static_steps", "runtime_script"]).optional(),
    body: executionBodySchema.optional(),
    script: z.union([scriptSchema, z.string()]).optional(),
    args: z.record(z.unknown()).optional(),
    limits: runtimeScriptLimitsSchema.optional()
    // keep existing fields
  }).superRefine((input, ctx) => {
    // enforce the compatibility rules from this task
  });
  ```

- [ ] Add contract tests in `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`.

  Required cases:

  - accepts static `body.steps`.
  - accepts legacy `script.build`.
  - accepts runtime string script only with `workflowKind: "runtime_script"`.
  - rejects string script without explicit runtime kind.
  - rejects `body` plus `script`.
  - runtime script contract has `workflow.kind === "runtime_script"` and no synthesized `body.steps`.
  - rubric agent validator accepts `subagent` and `allowSelfReview`.

- [ ] Add MCP schema tests in `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`.

  Required cases:

  - `create_loop_contract` accepts runtime script input.
  - legacy `script.build` still works.
  - invalid mixed static/runtime inputs return validation errors with useful messages.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/contract.test.ts test/mcpServer.test.ts
  npm run typecheck
  ```

### 2. Runtime Script Module Skeleton

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/types.ts`.

  Required interfaces:

  ```ts
  import type { CodexSessionRef } from "../codex/sessionBridge.js";
  import type { CodexSubagentSpec, EffectiveAgentProfile, RuntimeScriptLimits } from "../contract/types.js";

  export interface RuntimeScriptRunInput {
    runId: string;
    attemptId: string;
    workflowContextId: string;
    contractId: string;
    source: string;
    args: Record<string, unknown>;
    limits: Required<RuntimeScriptLimits>;
    journal: RuntimeScriptJournal;
    subagentBridge: WorkflowSubagentBridge;
    emit?: (event: RuntimeScriptEventInput) => void;
    now: () => string;
  }

  export interface RuntimeScriptAgentOptions {
    label?: string;
    phaseId?: string;
    subagent?: CodexSubagentSpec;
    agentProfile?: EffectiveAgentProfile;
    timeoutMs?: number;
  }

  export interface WorkflowSubagentInput {
    prompt: string;
    label?: string;
    callSite: string;
    idempotencyKey: string;
    options?: RuntimeScriptAgentOptions;
  }

  export interface WorkflowSubagentResult {
    status: "completed" | "failed" | "needs_human";
    output?: string;
    error?: string;
    session?: CodexSessionRef;
    data?: Record<string, unknown>;
  }

  export interface WorkflowSubagentBridge {
    runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult>;
  }
  ```

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/defaults.ts`.

  Required default limits:

  ```ts
  export const DEFAULT_RUNTIME_SCRIPT_LIMITS = {
    timeoutMs: 120_000,
    maxAgentCalls: 20,
    maxParallelBranches: 8,
    maxPipelineItems: 50,
    maxLogChars: 20_000
  } as const;
  ```

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/validateScript.ts`.

  Deny at least these patterns:

  ```ts
  const deniedPatterns = [
    /\brequire\s*\(/,
    /\bimport\s*(?:\(|{|[A-Za-z_*])/,
    /\bprocess\b/,
    /\bglobalThis\b/,
    /\bfetch\s*\(/,
    /\bfs\b/,
    /\bchild_process\b/,
    /\bnet\b/,
    /\bhttp\b/,
    /\bhttps\b/,
    /\bos\b/,
    /\bvm\b/,
    /\beval\s*\(/,
    /\bFunction\s*\(/,
    /\bconstructor\b/,
    /__proto__/
  ];
  ```

  Return structured results:

  ```ts
  export interface RuntimeScriptValidationResult {
    ok: boolean;
    errors: string[];
  }
  ```

- [ ] Add `plugins/dittosloop-for-codex/mcp/test/runtimeScript/validateScript.test.ts`.

  Required cases:

  - accepts `const x = await agent("x"); return x;`.
  - rejects `require("fs")`.
  - rejects static and dynamic `import`.
  - rejects `process.env`.
  - rejects `globalThis`.
  - rejects `Function("return process")`.
  - reports all denied matches found in a script.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/validateScript.test.ts
  npm run typecheck
  ```

### 3. Replay Journal

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/hash.ts`.

  Required behavior:

  - stable stringify object keys.
  - hash script source.
  - hash args.
  - hash prompt.
  - hash options.
  - produce journal keys.

  Target helper:

  ```ts
  export function runtimeAgentJournalKey(input: {
    contractId: string;
    scriptHash: string;
    argsHash: string;
    callSite: string;
    prompt: string;
    options: unknown;
  }): string {
    return sha256(stableStringify({
      contractId: input.contractId,
      scriptHash: input.scriptHash,
      argsHash: input.argsHash,
      callSite: input.callSite,
      promptHash: sha256(input.prompt),
      optionsHash: sha256(stableStringify(input.options ?? {}))
    }));
  }
  ```

- [ ] Extend `plugins/dittosloop-for-codex/mcp/src/types.ts` with persisted journal records.

  ```ts
  export interface RuntimeScriptJournalRecord {
    id: string;
    loopId: string;
    runId: string;
    attemptId: string;
    workflowContextId: string;
    contractId: string;
    scriptHash: string;
    argsHash: string;
    key: string;
    callSite: string;
    promptHash: string;
    optionsHash: string;
    status: "completed" | "failed";
    output?: string;
    error?: string;
    sessionId?: string;
    createdAt: string;
    updatedAt: string;
  }
  ```

  Add `runtimeScriptJournals: RuntimeScriptJournalRecord[]` to `LoopState`.

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/store.ts`.

  Requirements:

  - default missing `runtimeScriptJournals` to `[]`.
  - preserve old state files.
  - do not change the state version unless migration code requires it.

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/journal.ts`.

  Required class:

  ```ts
  export interface RuntimeScriptJournal {
    get(key: string): Promise<RuntimeScriptJournalRecord | undefined>;
    recordCompleted(input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">): Promise<RuntimeScriptJournalRecord>;
    recordFailed(input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">): Promise<RuntimeScriptJournalRecord>;
  }
  ```

  Service-backed implementation must use `LoopStore.updateState()` and upsert by `key`.

- [ ] Add `plugins/dittosloop-for-codex/mcp/test/runtimeScript/journal.test.ts`.

  Required cases:

  - same script, args, call site, prompt, and options hits cache.
  - changed args misses cache.
  - changed prompt misses cache.
  - changed options misses cache.
  - failed records are not reused as successful outputs.
  - journal entries survive creating a new `LoopStore` pointing at the same temp data dir.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/journal.test.ts
  npm run typecheck
  ```

### 4. Runtime Scheduler and Sandbox

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/scheduler.ts`.

  Required runtime API:

  ```ts
  export interface RuntimeScriptApi {
    agent(prompt: string, options?: RuntimeScriptAgentOptions): Promise<string>;
    parallel<T>(tasks: Array<() => Promise<T>>, options?: { label?: string }): Promise<T[]>;
    pipeline<TInput, TOutput>(
      items: TInput[],
      stages: Array<(item: TInput | TOutput, index: number) => Promise<TOutput>>,
      options?: { label?: string }
    ): Promise<TOutput[]>;
    phase(label: string): { done(status?: "ok" | "failed"): void };
    log(message: string): void;
  }
  ```

- [ ] `agent()` behavior:

  - validate prompt is non-empty.
  - increment call counter.
  - enforce `maxAgentCalls`.
  - derive a deterministic call site from call sequence and optional label: `agent:${sequence}:${labelOrPromptHash}`.
  - calculate journal key.
  - if a completed journal record exists, emit `agent:cached` and return output.
  - otherwise call `WorkflowSubagentBridge.runAgent`.
  - on `completed`, journal output and return it.
  - on `needs_human`, throw an error that carries the session ref and status.
  - on `failed`, journal failure and throw.

- [ ] `parallel()` behavior:

  - enforce `maxParallelBranches`.
  - emit `runtime_parallel_started` and `runtime_parallel_completed`.
  - run branch functions concurrently with `Promise.all`.
  - preserve result order.

- [ ] `pipeline()` behavior:

  - enforce `maxPipelineItems`.
  - emit `runtime_pipeline_started` and `runtime_pipeline_completed`.
  - process each item through all stages.
  - return one final result per input item.

- [ ] `phase()` behavior:

  - emit `runtime_phase_started`.
  - returned handle emits `runtime_phase_done`.

- [ ] `log()` behavior:

  - emit `runtime_log`.
  - enforce cumulative `maxLogChars`.

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/sandbox.ts`.

  Target wrapper:

  ```ts
  import vm from "node:vm";

  export async function runRuntimeScriptInVm(input: RuntimeScriptRunInput): Promise<unknown> {
    const validation = validateRuntimeScript(input.source);
    if (!validation.ok) {
      throw new Error(`Runtime script failed validation: ${validation.errors.join("; ")}`);
    }

    const api = createRuntimeScriptScheduler(input);
    const context = vm.createContext(Object.freeze({
      agent: api.agent,
      parallel: api.parallel,
      pipeline: api.pipeline,
      phase: api.phase,
      log: api.log,
      args: deepFreeze(input.args),
      budget: Object.freeze({ limits: input.limits })
    }));

    const script = new vm.Script(`"use strict"; (async () => {\n${input.source}\n})()`, {
      filename: `dittosloop-runtime-script:${input.contractId}`
    });
    return await script.runInContext(context, { timeout: input.limits.timeoutMs });
  }
  ```

- [ ] Add `plugins/dittosloop-for-codex/mcp/test/runtimeScript/sandbox.test.ts`.

  Required cases:

  - `return await agent("hello")` returns fake bridge output.
  - `parallel()` starts all branches before awaiting results.
  - `parallel()` preserves result order.
  - `pipeline()` returns one result per input item.
  - `if` and `for` JavaScript control flow can decide later agent calls.
  - cache hit avoids a second bridge call.
  - max agent calls is enforced.
  - max parallel branches is enforced.
  - validation failure prevents execution.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/sandbox.test.ts
  npm run typecheck
  ```

### 5. Engine Events and Preview Visibility

- [ ] Extend `plugins/dittosloop-for-codex/mcp/src/engine/types.ts` with runtime script events.

  Add to `EngineEvent`:

  ```ts
  | EngineEventBase<"runtime_script_started", { contractId: string }>
  | EngineEventBase<"runtime_script_done", { contractId: string; status: "completed" | "failed"; result?: unknown; error?: string }>
  | EngineEventBase<"agent:start", { label?: string; prompt: string; callSite: string; session?: unknown }>
  | EngineEventBase<"agent:done", { label?: string; callSite: string; result?: string; session?: unknown }>
  | EngineEventBase<"agent:error", { label?: string; callSite: string; error: string; session?: unknown }>
  | EngineEventBase<"agent:cached", { label?: string; callSite: string }>
  | EngineEventBase<"runtime_parallel_started", { label?: string; count: number }>
  | EngineEventBase<"runtime_parallel_completed", { label?: string; count: number }>
  | EngineEventBase<"runtime_pipeline_started", { label?: string; count: number }>
  | EngineEventBase<"runtime_pipeline_completed", { label?: string; count: number }>
  | EngineEventBase<"runtime_phase_started", { label: string }>
  | EngineEventBase<"runtime_phase_done", { label: string; status: "ok" | "failed" }>
  | EngineEventBase<"runtime_log", { message: string }>
  ```

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`.

  Requirements:

  - runtime script start/completion appear in the workflow section.
  - runtime agent start/done/error/cache-hit appear as agent timeline items.
  - runtime parallel/pipeline events appear as workflow items.
  - cache hits are visible as `completed` with message `agent:cached`.

- [ ] Add preview tests in `plugins/dittosloop-for-codex/mcp/test/preview.test.ts` or existing preview test file.

  Required cases:

  - runtime script events are extracted from run events.
  - runtime agent cache hit appears in timeline.
  - static workflow timeline output remains unchanged.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/preview*.test.ts
  npm run typecheck
  ```

### 6. Service Execution Branch

- [ ] Update `plugins/dittosloop-for-codex/mcp/src/service.ts` normalization.

  Replace the current `resolveScriptContractInput()` behavior with:

  ```ts
  function resolveWorkflowContractInput(input: CreateLoopContractInput): FormalLoopContractInput {
    if (input.body && input.script) {
      throw new Error("Loop contract cannot define both body.steps and script");
    }

    if (typeof input.script === "string") {
      if (input.workflowKind !== "runtime_script") {
        throw new Error("Runtime script workflows require workflowKind: runtime_script");
      }
      return {
        ...input,
        workflow: {
          kind: "runtime_script",
          language: "javascript",
          source: input.script,
          args: input.args ?? {},
          limits: input.limits,
          approval: { required: true, ...input.approval },
          journal: { enabled: true, ...input.journal }
        },
        body: undefined
      };
    }

    if (input.script) {
      const compiled = compileScriptContract({
        id: input.id ?? loopIdFromTitle(input.title),
        title: input.title,
        goal: input.goal,
        script: input.script,
        verification: input.verification,
        budgetUsd: input.budgetUsd,
        escalation: input.escalation
      });
      return {
        ...input,
        workflow: { kind: "static_steps", body: compiled.body },
        body: compiled.body
      };
    }

    if (!input.body) {
      throw new Error("Loop contract requires body.steps or a runtime script");
    }

    return {
      ...input,
      workflow: { kind: "static_steps", body: input.body },
      body: input.body
    };
  }
  ```

  Adapt names to the actual helper signatures rather than copying this verbatim if surrounding types differ.

- [ ] Update `prepareWorkflowContext()` and `createWorkflowContext()`.

  Requirements:

  - static workflows still create graph snapshots.
  - runtime script workflows do not call `compileExecutionGraph()`.
  - runtime script contexts initialize a `vars.runtimeScript` object that can store result metadata.

  Suggested state shape:

  ```ts
  export interface RuntimeScriptContextState {
    scriptHash: string;
    argsHash: string;
    status: "not_started" | "running" | "waiting_for_session" | "completed" | "failed";
    result?: unknown;
    error?: string;
    updatedAt: string;
  }
  ```

- [ ] Add `executeRuntimeScriptWorkflowAttempt()` in `LoopService`.

  Required flow:

  1. emit `runtime_script_started`.
  2. validate approval policy.
  3. construct service-backed replay journal.
  4. construct service-backed sub-agent bridge.
  5. run VM script.
  6. emit `runtime_script_done` with `status: "completed"` or `status: "failed"`.
  7. run `runContractVerification()` against the script result.
  8. persist verification and final run status the same way static execution does.

- [ ] Branch inside `executeWorkflowAttempt()`.

  Required ordering:

  ```ts
  if (contract.workflow.kind === "runtime_script") {
    return this.executeRuntimeScriptWorkflowAttempt(run, attempt, workflowContext, contract, input);
  }
  ```

  This branch must run before graph scheduler checks because runtime scripts do not have graph snapshots.

- [ ] Update static helper functions that assume `contract.body.steps`.

  Required changes:

  - `hasRemainingExecutableSteps()` returns `false` for runtime script contracts.
  - `buildWorkflowExecutionPlan()` is called only for static contracts or returns an empty runtime-script plan with `steps: []`.
  - `compileExecutionGraph()` is not called for runtime scripts.
  - `validateContract()` remains the source of truth for body requirements.

- [ ] Add service tests in `plugins/dittosloop-for-codex/mcp/test/service.runtimeScript.test.ts`.

  Required cases:

  - runtime script loop creates without `body.steps`.
  - executing a runtime script with a fake completed bridge completes the run.
  - runtime script result is used as verification input.
  - static workflow execution still passes existing service tests.
  - runtime script does not create an execution graph snapshot.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/service.runtimeScript.test.ts test/service.test.ts
  npm run typecheck
  ```

### 7. Service-Backed Sub-Agent Bridge and Resume Semantics

- [ ] Add `plugins/dittosloop-for-codex/mcp/src/runtimeScript/serviceSubagentBridge.ts`.

  Required constructor input:

  ```ts
  export interface ServiceSubagentBridgeInput {
    service: LoopService;
    bridge: CodexSessionBridge;
    run: LoopRun;
    attempt: RunAttempt;
    workflowContext: WorkflowContext;
    contract: FormalLoopContract;
    nextId: (prefix: string) => string;
    now: () => string;
  }
  ```

  If direct `LoopService` import causes a circular dependency, put the implementation as a private method in `service.ts` and keep only the interface in `runtimeScript/types.ts`.

- [ ] Implement idempotent `runAgent()`.

  Required behavior:

  - derive `stepId` as `runtime:${callSite}`.
  - derive `idempotencyKey` from the runtime journal key.
  - before creating a new session, find an existing `WorkflowTaskRun` with the same `idempotencyKey`.
  - if existing task is completed, return its result.
  - if existing task is running or suspended, read its bridge result by `sessionId`.
  - if bridge result is still missing, throw `CodexSessionPendingError` with the existing session ref.
  - if no existing task exists, create one with `markWorkflowTaskRunning()`, call `CodexSessionBridge.createSession()`, attach the session, and read the result.
  - if read result is missing, suspend and throw `CodexSessionPendingError`.
  - if completed, call `completeWorkflowTask()` and return output.
  - if failed, call `failWorkflowTask()` and throw.

- [ ] Update `markWorkflowTaskRunning()` to accept an optional `idempotencyKey`.

  Current `WorkflowTaskRun` supports `idempotencyKey`; the runtime bridge must populate it.

- [ ] Add tests in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/serviceSubagentBridge.test.ts`.

  Required cases:

  - first call creates one Codex session.
  - pending bridge result suspends run and records pending session id.
  - rerun with same call site reuses existing pending session instead of creating a duplicate.
  - after `record_session_result`, rerun returns completed output.
  - completed journal hit does not call `CodexSessionBridge.createSession()`.
  - failed bridge result marks task failed and surfaces the error.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/serviceSubagentBridge.test.ts
  npm run typecheck
  ```

### 8. Approval Gate

- [ ] Add approval checks before VM execution.

  Required behavior:

  - runtime scripts default to `approval.required === true`.
  - an unapproved runtime script run does not execute and returns a clear waiting or failed state.
  - static workflows are unaffected.
  - approved runtime scripts can run.

- [ ] Add an MCP-visible approval path if no existing workflow approval command can represent this.

  Preferred tool input:

  ```json
  {
    "loopId": "loop_dynamic_review",
    "approvedBy": "user"
  }
  ```

  The tool should set `contract.workflow.approval.approvedAt` and `approvedBy` on the active contract or create a promoted workflow revision if that is the existing repository pattern for contract updates.

- [ ] Add tests in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/approval.test.ts`.

  Required cases:

  - unapproved runtime script is blocked before validation and execution.
  - approval allows execution.
  - approval state is persisted.
  - static workflows do not require runtime script approval.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/approval.test.ts
  npm run typecheck
  ```

### 9. Verification Sub-Agent Support

- [ ] Update verification v2 types and schemas.

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
  - `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`

  Requirements:

  - `rubric_agent` validators accept `subagent`.
  - `rubric_agent` validators accept `allowSelfReview`.
  - `allowSelfReview` defaults to `false` for runtime script verifier validators.

- [ ] Implement verifier sub-agent launch.

  Current behavior marks `rubric_agent` as needing external writeback. Keep that path, but add an optional automated launch path when validator has `subagent`.

  Required behavior:

  - `startPendingRubricAgentValidators()` creates visible verifier sessions for validators with `subagent`.
  - verifier session prompt includes workflow result, criteria, and validator prompt.
  - verifier task uses `stepId: verification:${validatorId}`.
  - verifier task uses `idempotencyKey: verification:${runId}:${attemptId}:${validatorId}`.
  - `allowSelfReview: false` rejects using the same session id as any runtime worker session.
  - verifier result is converted through `recordedRubricAgentResultToValidatorResult()`.
  - run cannot be marked verified until the verifier result is recorded.

- [ ] Add tests in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/verificationSubagent.test.ts`.

  Required cases:

  - covers validation case `DW-SUBAGENT-003`.
  - runtime script with verifier sub-agent starts worker session and verifier session.
  - worker and verifier have different session ids.
  - run waits for verifier result before completion.
  - recording verifier result completes verification.
  - `allowSelfReview: false` rejects a validator result tied to a worker session.
  - static workflows can also use verifier sub-agent if configured.

- [ ] Add one live-gated test file for real sub-agent validation.

  File: `plugins/dittosloop-for-codex/mcp/test/runtimeScript/verificationSubagent.live.test.ts`

  Behavior:

  ```ts
  const runLive = process.env.DITTOSLOOP_RUNTIME_SCRIPT_LIVE === "1";
  describe.skipIf(!runLive)("runtime script live verifier subagent", () => {
    test("worker result is checked by a separate verifier subagent", async () => {
      // create runtime script loop
      // run until worker session is requested
      // record worker result
      // run until verifier session is requested
      // record verifier result
      // assert final status completed and session ids differ
    });
  });
  ```

  This test is skipped by default but documents the real sub-agent validation path required by the validation plan.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/runtimeScript/verificationSubagent.test.ts
  DITTOSLOOP_RUNTIME_SCRIPT_LIVE=1 npm test -- --run test/runtimeScript/verificationSubagent.live.test.ts
  npm run typecheck
  ```

### 10. Workspace Files and Plugin Skill Documentation

- [ ] Update workspace rendering.

  Inspect and update the files that render loop workspace files. Search first:

  ```bash
  rg -n "LoopWorkspaceFile|body.steps|script.build|workflow" plugins/dittosloop-for-codex/mcp/src
  ```

  Requirements:

  - static loops still render `workflow` and `contract` files with `body.steps`.
  - runtime script loops render the JavaScript source as a `runtime` file.
  - runtime script contract files show `workflow.kind: runtime_script`.

- [ ] Update installed skill references under `plugins/dittosloop-for-codex/skills/loop/`.

  Required docs:

  - create-loop instructions distinguish `body.steps`, `script.build`, and runtime script.
  - choose-workflow recommends runtime script when logic needs JavaScript control flow or dynamic fan-out.
  - tool reference documents `workflowKind: "runtime_script"`, string `script`, `args`, `limits`, and approval.
  - verification docs mention verifier sub-agent requirement for runtime dynamic workflow validation.

- [ ] Add or update docs tests if the repository has snapshot tests for workspace files or skills.

- [ ] Verification command:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test -- --run test/workspace*.test.ts
  npm run typecheck
  ```

### 11. End-to-End Acceptance Scenarios

- [ ] Add an end-to-end runtime script test in `plugins/dittosloop-for-codex/mcp/test/runtimeScript/e2e.test.ts`.

  Scenario:

  1. Create runtime script loop:

     ```js
     const files = JSON.parse(await agent("Return [\"a.ts\",\"b.ts\"]"));
     const reviews = await parallel(files.map((file) => () => agent(`Review ${file}`)));
     const summary = await agent(`Summarize: ${JSON.stringify(reviews)}`);
     return { files, reviews, summary };
     ```

  2. Execute until first worker session is requested.
  3. Record first session result.
  4. Resume until parallel sessions are requested.
  5. Record parallel results.
  6. Resume until summary session is requested.
  7. Record summary result.
  8. Run verifier sub-agent.
  9. Record verifier result.
  10. Assert final run is completed.

  Required assertions:

  - contract has no `body.steps`.
  - worker sessions are visible in run detail.
  - parallel branch sessions are distinct.
  - verifier session is distinct from worker sessions.
  - replaying after completion emits cache hits and creates no new worker sessions.
  - timeline contains runtime script, runtime agents, parallel, and verification items.

- [ ] Add restart end-to-end test.

  Scenario:

  - create runtime script loop in temp data dir.
  - run and complete one agent call.
  - construct a new `LoopService` and `LoopStore` with the same data dir.
  - rerun the same attempt.
  - assert journal hit and no duplicate session.

- [ ] Run full MCP verification.

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test
  npm run typecheck
  npm run build
  ```

- [ ] Run repository-level smoke checks if present.

  ```bash
  rg -n "runtime_script|script.build|body.steps" plugins/dittosloop-for-codex/mcp/src plugins/dittosloop-for-codex/skills/loop
  git diff --check
  ```

### 12. Release-Ready Review Package

- [ ] Confirm generated bundle is updated.

  Required file if build changes it:

  - `plugins/dittosloop-for-codex/mcp/dist/index.js`

- [ ] Produce a short review summary.

  Include:

  - how runtime script differs from `body.steps`.
  - how `script.build` compatibility is preserved.
  - how replay journal keys are computed.
  - how sub-agent waiting and resume avoids duplicate sessions.
  - how verifier sub-agent validation satisfies the validation plan.
  - exact commands run and pass/fail status.

- [ ] Commit only after fresh verification.

  Required commands immediately before commit:

  ```bash
  cd "plugins/dittosloop-for-codex/mcp"
  npm test
  npm run typecheck
  npm run build
  cd ../..
  git diff --check
  git status --short
  ```

## Acceptance Checklist

- [ ] Runtime script workflows can be created through MCP.
- [ ] Runtime script workflows store source as workflow source, not `body.steps`.
- [ ] Existing `body.steps` loops still create, load, preview, and run.
- [ ] Existing `script.build` builder AST loops still create, compile, preview, and run.
- [ ] Runtime script validation blocks denied host access patterns.
- [ ] Runtime script execution injects `agent`, `parallel`, `pipeline`, `phase`, `log`, `args`, and `budget`.
- [ ] `agent()` launches visible Codex sub-agent sessions.
- [ ] Waiting sessions suspend and resume without duplicates.
- [ ] Completed `agent()` calls are reused through the replay journal.
- [ ] Journal reuse survives service restart.
- [ ] `parallel()` runs branches concurrently and preserves order.
- [ ] `pipeline()` chains stages and returns one output per item.
- [ ] Approval is required by default before runtime script execution.
- [ ] Runtime script events appear in preview timeline.
- [ ] Verifier sub-agent validation exists and uses a different session than worker agents.
- [ ] The run cannot be marked verified before verifier result is recorded.
- [ ] Full MCP tests, typecheck, and build pass.

## Risks and Mitigations

- **Risk:** Runtime scripts create duplicate sessions after a suspension.
  **Mitigation:** Use deterministic idempotency keys for each `agent()` call and check existing task runs before creating a session.

- **Risk:** The service branch accidentally routes runtime scripts through graph compilation.
  **Mitigation:** Add tests that runtime script contexts have no `executionGraphSnapshot`.

- **Risk:** Replay journal returns stale results when script or args change.
  **Mitigation:** Include `scriptHash`, `argsHash`, call site, prompt hash, and options hash in journal keys.

- **Risk:** `node:vm` is mistaken for security isolation.
  **Mitigation:** Keep approval required by default and document that validation is a guardrail, not a sandbox guarantee.

- **Risk:** Verifier sub-agent uses the same session as worker output.
  **Mitigation:** Enforce `allowSelfReview: false` by comparing verifier session ids against worker session ids.

## Reviewer Approval Checklist

The reviewer should explicitly confirm these points before implementation starts:

- [ ] The new dynamic workflow target is the runtime JavaScript model, not `body.steps` and not `script.build`.
- [ ] Runtime script creation must require `workflowKind: "runtime_script"` plus a string `script`.
- [ ] Existing static `body.steps` and legacy `script.build` loops must remain compatible.
- [ ] Approval is required by default before executing runtime script source.
- [ ] The replay journal key includes script hash, args hash, call site, prompt hash, and options hash.
- [ ] Runtime `agent()` calls create visible Codex sub-agent sessions and resume without duplicate sessions.
- [ ] Verification must include the mandatory verifier sub-agent case from `DW-SUBAGENT-003`.
- [ ] The recommended execution mode is `subagent-driven-development`.

## First Implementation Slice After Approval

Start with the smallest slice that proves the contract split before touching VM execution:

1. Task 1 from this plan: contract types, MCP schema, and compatibility tests.
2. Task 2 from this plan: runtime script module skeleton and script validation tests.
3. Stop for review after the first green `npm test -- --run test/contract.test.ts test/mcpServer.test.ts test/runtimeScript/validateScript.test.ts` and `npm run typecheck`.

This slice should not create Codex sessions yet. Its purpose is to prove that the repository can represent runtime scripts separately from static workflows while preserving the existing static surfaces.

## Review Gate

Implementation must not start until this plan is reviewed and approved. After approval, execute task-by-task with `subagent-driven-development` preferred because the validation path explicitly requires sub-agent behavior and several tasks can be reviewed independently.
