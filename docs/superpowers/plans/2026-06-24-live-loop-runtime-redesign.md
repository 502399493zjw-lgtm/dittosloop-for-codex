# Live Loop Runtime Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an independent, formal Live Loop runtime inside `DittosLoop For Codex` by copying the main Dittos Loop engine shape into this plugin project.

**Architecture:** The plugin owns formal contract types, contract validation/migration, a small deterministic engine (`runFlow`, `runBody`, `parallel`, `EngineEvent`), runner/verifier/repair orchestration, and a Codex session bridge seam. Existing MCP tools remain compatible wrappers while new engine-backed tools are introduced.

**Tech Stack:** TypeScript ES2022, NodeNext modules, Vitest, JSON-backed local state, MCP SDK, vanilla preview UI.

## Global Constraints

- `dittosloop-for-codex` remains a standalone project with its own runtime, state, tests, preview, and release path.
- No runtime import points at `/Users/edisonzhong/projects/dittos-loop`.
- Copy the Live Loop execution model from the main Dittos Loop project into this plugin repo instead of importing the main repo as a package.
- A loop run executes a structured workflow; prompt text is not the primary workflow engine.
- Verifier and repair are runtime steps, not only manual records.
- Codex session creation goes through a replaceable bridge interface.
- The first bridge is host-mediated because plugin-side Codex App session APIs are not proven available.
- Preview run detail is driven by engine events.
- Legacy loops still load and migrate.
- `npm run check` remains the repo-level validation command.

---

## File Structure

- Create `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`: formal loop contract, workflow, verification, repair, stop, project binding types.
- Create `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`: default filling for formal contracts.
- Create `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`: contract validation and body validation.
- Create `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`: convert current thin `LoopContract` records into formal contracts.
- Create `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`: engine API, executor, outputs, event types.
- Create `plugins/dittosloop-for-codex/mcp/src/engine/runBody.ts`: deterministic `ExecutionBody` walker.
- Create `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`: engine event wrapper around agent/phase/parallel execution.
- Create `plugins/dittosloop-for-codex/mcp/src/engine/parallel.ts`: safe parallel helper.
- Create `plugins/dittosloop-for-codex/mcp/src/codex/sessionBridge.ts`: bridge interfaces and host-mediated request/result types.
- Create `plugins/dittosloop-for-codex/mcp/src/runner/verifier.ts`: rubric verifier decision helpers.
- Create `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`: engine-backed run orchestration.
- Modify `plugins/dittosloop-for-codex/mcp/src/types.ts`: add formal state fields without breaking current fields.
- Modify `plugins/dittosloop-for-codex/mcp/src/store.ts`: normalize/migrate state to include engine events and formal contracts.
- Modify `plugins/dittosloop-for-codex/mcp/src/service.ts`: add formal contract creation and engine-backed run methods.
- Modify `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`: expose formal MCP tools.
- Modify `plugins/dittosloop-for-codex/mcp/src/previewServer.ts`: expose engine-event run detail data.
- Create tests under `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`, `engine.test.ts`, `loopRunner.test.ts`, and update existing service/MCP/preview tests.

## Task 1: Formal Contract Types, Defaults, Validation, And Migration

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

**Interfaces:**
- Produces: `FormalLoopContract`, `ExecutionBody`, `Step`, `VerificationPolicy`, `RepairPolicy`, `StopPolicy`, `compileContract(input, now)`, `validateContract(contract)`, `migrateLegacyContract(loop)`.
- Consumes: current thin loop shape from `src/types.ts`.

- [x] **Step 1: Write the failing contract tests**

```ts
import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { migrateLegacyContract } from "../src/contract/migrateLegacyContract.js";
import { validateContract } from "../src/contract/validateContract.js";

const fixedTime = "2026-06-24T00:00:00.000Z";

describe("formal loop contracts", () => {
  test("compiles defaults for a one-step manual contract", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "AI monitor",
        goal: "Track AI tool updates",
        body: {
          steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan official updates" }]
        },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "source", label: "Source", requirement: "Uses official sources", severity: "must" }]
        }
      },
      fixedTime
    );

    expect(contract).toMatchObject({
      id: "loop_1",
      title: "AI monitor",
      goal: "Track AI tool updates",
      trigger: { mode: "manual" },
      repairPolicy: { maxAttempts: 1, strategy: "repair_then_retry" },
      stopPolicy: { rule: "user cancels" },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });
  });

  test("rejects duplicate step ids", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad loop",
        goal: "Run duplicated steps",
        body: {
          steps: [
            { id: "scan", kind: "agent", label: "Scan 1", prompt: "one" },
            { id: "scan", kind: "agent", label: "Scan 2", prompt: "two" }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/unique/i);
  });

  test("migrates a legacy loop into a formal one-step body", () => {
    const migrated = migrateLegacyContract({
      id: "loop_1",
      title: "Legacy",
      intent: "Keep project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });

    expect(migrated.goal).toBe("Keep project healthy");
    expect(migrated.body.steps).toEqual([
      { id: "legacy-agent", kind: "agent", label: "Run loop", prompt: "Keep project healthy" }
    ]);
    expect(migrated.verification.rubrics).toEqual([
      { id: "check-1", label: "npm test", requirement: "npm test", severity: "must" }
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts`

Expected: FAIL because `src/contract/*` modules do not exist.

- [x] **Step 3: Implement minimal contract modules**

Create the four contract files with the exact exported names from the test. Keep validation small: required id/title/goal/body, non-empty body, unique step ids, agent prompts required, phase/parallel children required, stop rule required after compile.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts`

Expected: PASS.

## Task 2: Engine Core With Evented Flow And Deterministic Body Walker

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/engine/parallel.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/engine/runBody.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/engine.test.ts`

**Interfaces:**
- Consumes: `ExecutionBody` from Task 1.
- Produces: `runBody(body, api)`, `runFlow(flow, deps)`, `EngineEvent`, `Executor`.

- [x] **Step 1: Write failing engine tests**

```ts
import { describe, expect, test } from "vitest";

import { runBody } from "../src/engine/runBody.js";
import { runFlow } from "../src/engine/runFlow.js";
import type { EngineEvent, Executor } from "../src/engine/types.js";

describe("engine runtime", () => {
  test("runBody maps phase, agent, and parallel steps onto FlowApi", async () => {
    const calls: string[] = [];
    const result = await runBody(
      {
        steps: [
          {
            id: "phase-1",
            kind: "phase",
            label: "Collect",
            children: [
              { id: "scan", kind: "agent", label: "Scan", prompt: "scan prompt" },
              {
                id: "parallel-1",
                kind: "parallel",
                label: "Parallel",
                children: [
                  { id: "a", kind: "agent", label: "A", prompt: "a prompt" },
                  { id: "b", kind: "agent", label: "B", prompt: "b prompt" }
                ]
              }
            ]
          }
        ]
      },
      {
        phase(title) {
          calls.push(`phase:${title}`);
        },
        async agent(prompt, opts) {
          calls.push(`agent:${opts?.label}:${prompt}`);
          return `${opts?.label}:result`;
        },
        async parallel(tasks) {
          calls.push("parallel");
          return Promise.all(tasks.map((task) => task()));
        },
        log() {},
        commit() {}
      }
    );

    expect(calls).toEqual([
      "phase:Collect",
      "agent:Scan:scan prompt",
      "parallel",
      "agent:A:a prompt",
      "agent:B:b prompt"
    ]);
    expect(result).toEqual([["Scan:result", ["A:result", "B:result"]]]);
  });

  test("runFlow emits run and agent events", async () => {
    const events: EngineEvent[] = [];
    const executor: Executor = {
      async run(req) {
        return { text: `result:${req.prompt}` };
      }
    };

    const out = await runFlow(
      async (api) => {
        api.phase("Work");
        return api.agent("do work", { label: "Worker" });
      },
      {
        runId: "run_1",
        executor,
        emit: (event) => events.push(event),
        now: () => "2026-06-24T00:00:00.000Z"
      }
    );

    expect(out).toEqual({ status: "completed", result: "result:do work" });
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "phase_started",
      "agent_started",
      "agent_done",
      "phase_done",
      "run_done"
    ]);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- engine.test.ts`

Expected: FAIL because `src/engine/*` modules do not exist.

- [x] **Step 3: Implement minimal engine core**

Implement the interfaces from the tests. Use deterministic ids derived from a counter (`agent_1`, `phase_1`) unless callers inject ids later.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- engine.test.ts`

Expected: PASS.

## Task 3: Host-Mediated Codex Session Bridge Types

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/codex/sessionBridge.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/codex/hostMediatedBridge.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/sessionBridge.test.ts`

**Interfaces:**
- Produces: `CodexSessionBridge`, `CodexSessionRef`, `HostMediatedSessionBridge`.
- Consumes: engine agent requests from Task 2.

- [x] **Step 1: Write failing bridge test**

```ts
import { expect, test } from "vitest";

import { HostMediatedSessionBridge } from "../src/codex/hostMediatedBridge.js";

test("host-mediated bridge records session requests and accepts results", async () => {
  const bridge = new HostMediatedSessionBridge({ now: () => "2026-06-24T00:00:00.000Z" });

  const ref = await bridge.createSession({
    runId: "run_1",
    stepId: "scan",
    title: "Scan updates",
    projectPath: "/tmp/project"
  });

  await bridge.sendMessage(ref.sessionId, { text: "Run scan" });
  await bridge.recordResult(ref.sessionId, {
    status: "completed",
    text: "Scan complete",
    threadId: "thread_1",
    threadUrl: "codex://thread/thread_1"
  });

  await expect(bridge.readResult(ref.sessionId)).resolves.toMatchObject({
    status: "completed",
    text: "Scan complete",
    threadId: "thread_1"
  });
  expect(bridge.getRequests()).toHaveLength(1);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts`

Expected: FAIL because bridge modules do not exist.

- [x] **Step 3: Implement bridge**

Use in-memory request/result storage first. Persisted integration belongs to Task 5.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts`

Expected: PASS.

## Task 4: Verifier And Repair Decisions

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/runner/verifier.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/runner/repair.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`

**Interfaces:**
- Produces: `createPassedDecision`, `createFailedDecision`, `shouldRepair(decision, policy, attemptNumber)`.
- Consumes: `VerificationPolicy`, `RepairPolicy`.

- [x] **Step 1: Write failing verifier tests**

```ts
import { expect, test } from "vitest";

import { shouldRepair } from "../src/runner/repair.js";
import { createFailedDecision, createPassedDecision } from "../src/runner/verifier.js";

test("creates structured verifier decisions from rubric checks", () => {
  expect(createPassedDecision("Looks good", [{ rubricId: "source", evidence: "official changelog" }])).toMatchObject({
    status: "passed",
    summary: "Looks good",
    checks: [{ rubricId: "source", status: "passed", evidence: "official changelog" }]
  });

  expect(createFailedDecision("Missing source", [{ rubricId: "source", evidence: "no source" }], "Add official source")).toMatchObject({
    status: "failed",
    repairInstructions: "Add official source",
    checks: [{ rubricId: "source", status: "failed" }]
  });
});

test("repair policy retries only while attempts remain", () => {
  const decision = createFailedDecision("Missing source", [{ rubricId: "source" }], "Add source");
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "repair_then_retry" }, 1)).toBe(true);
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "repair_then_retry" }, 2)).toBe(false);
  expect(shouldRepair(decision, { maxAttempts: 2, strategy: "ask_human" }, 1)).toBe(false);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts`

Expected: FAIL because runner verifier modules do not exist.

- [x] **Step 3: Implement verifier helpers**

Keep this deterministic. Model-based verification can be added through the session bridge later.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts`

Expected: PASS.

## Task 5: Service Integration For Formal Contracts And Engine-Backed Runs

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/store.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

**Interfaces:**
- Consumes: contract and engine modules from Tasks 1-4.
- Produces: `createLoopContract(input)`, `startLoopRun(loopId, input)`, `recordSessionResult(runId, input)`.

- [x] **Step 1: Write failing service tests**

Add tests proving:

```ts
const formal = await service.createLoopContract({
  title: "AI monitor",
  goal: "Track AI tool updates",
  body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
  verification: {
    mode: "after_workflow",
    rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
  }
});
expect(formal.body.steps[0]).toMatchObject({ id: "scan", kind: "agent" });

const run = await service.startLoopRun(formal.id, { goal: "Manual check" });
expect(run.status).toBe("running");
await expect(service.getRunDetail(run.id)).resolves.toMatchObject({
  events: [{ data: { engineEvent: { type: "run_started" } } }]
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts mcpServer.test.ts`

Expected: FAIL because service methods and MCP tools do not exist.

- [x] **Step 3: Implement minimal service integration**

Add formal contracts alongside legacy fields, add `engineEvents` to state, and route `create_loop` legacy calls through formal compile/migration where possible without breaking existing tests.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts mcpServer.test.ts`

Expected: PASS.

## Task 6: Preview Event Adapter And API Data

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/previewServer.ts`
- Create: `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `EngineEvent[]`.
- Produces: grouped run timeline sections for preview.

- [x] **Step 1: Write failing preview tests**

Add a test asserting `/api/runs/:id` returns engine event data and a grouped timeline containing phase, agent, verification, repair, and run status entries when those events exist.

- [x] **Step 2: Run test to verify it fails**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- previewServer.test.ts`

Expected: FAIL because event adapter data is absent.

- [x] **Step 3: Implement event adapter and endpoint shape**

Keep the existing response fields and add `engineEvents` plus `timeline`. Do not remove old attempts/events fields yet.

- [x] **Step 4: Run test to verify it passes**

Run: `npm --prefix plugins/dittosloop-for-codex/mcp test -- previewServer.test.ts`

Expected: PASS.

## Task 7: Repo-Level Verification And Documentation Update

**Files:**
- Modify: `README.md`
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Test: repository checks

**Interfaces:**
- Consumes: all implementation tasks.
- Produces: updated user/developer docs describing formal runtime and compatibility wrappers.

- [x] **Step 1: Update docs**

Document that:

- `DittosLoop For Codex` owns an independent formal runtime.
- The runtime copies engine concepts instead of importing the main Dittos Loop project.
- Engine-backed runs use formal contract body, verifier, repair, and Codex session bridge.
- Existing tools remain compatibility tools.

- [x] **Step 2: Run full verification**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
npm --prefix plugins/dittosloop-for-codex/mcp run build
npm run check
```

Expected: all commands exit 0.

## Self-Review

- Spec coverage: Tasks 1-7 cover formal contract, engine core, bridge, verifier/repair, service/MCP integration, preview event data, migration, and documentation.
- Project independence: Global constraints and Task 1/2/5 prohibit importing the main Dittos Loop project.
- Type consistency: `ExecutionBody`, `Step`, `VerificationPolicy`, `RepairPolicy`, `EngineEvent`, `CodexSessionBridge`, and service methods are named consistently across tasks.
- Placeholder scan: No task uses unresolved placeholder language. Task 6 leaves UI visual polish outside this first implementation pass but still requires API/event adapter behavior.
