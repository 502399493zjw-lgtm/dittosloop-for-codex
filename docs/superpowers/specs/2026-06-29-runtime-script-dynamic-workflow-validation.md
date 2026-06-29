# Runtime Script Dynamic Workflow Validation Plan

Review status: draft for user review.

## Purpose

This document defines how to prove that runtime script dynamic workflows are
actually complete. The goal is not to prove that a field named `script` exists.
The goal is to prove that a JavaScript workflow script can orchestrate real
sub-agents, make runtime decisions, resume through a replay journal, and remain
compatible with existing static loops.

## Required Success Signal

A successful implementation must pass all of these statements:

- A runtime script is stored and executed as workflow source, not compiled into
  `body.steps`.
- The script can use JavaScript control flow to decide later sub-agent calls.
- `agent()` starts isolated sub-agents through a bridge.
- `parallel()` starts multiple sub-agents concurrently and preserves result order.
- `pipeline()` chains item stages and returns one result per input item.
- A rerun with the same script and args reuses completed sub-agent results through
  the replay journal.
- A process restart does not lose completed journal entries.
- Runtime script execution requires approval by default.
- Existing static `body.steps` loops still create, load, preview, and run.
- At least one validation path uses a real sub-agent, not only mocks.

## Validation Environments

### Unit Harness

Use a deterministic `FakeSubagentBridge`:

```ts
class FakeSubagentBridge implements WorkflowSubagentBridge {
  calls: WorkflowSubagentInput[] = [];
  responses: Array<WorkflowSubagentResult | (() => Promise<WorkflowSubagentResult>)>;

  async runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult> {
    this.calls.push(input);
    const next = this.responses.shift();
    return typeof next === "function" ? next() : next ?? { status: "ok", output: "ok" };
  }
}
```

The fake bridge must support delayed responses, forced errors, forced timeouts,
and call counting so tests can prove concurrency and journal reuse.

### Restart Harness

Use a temporary user data directory and create two separate service/runtime
instances against it:

1. Run part of a workflow and persist completed journal entries.
2. Dispose the first runtime instance.
3. Create a second runtime instance using the same data directory.
4. Rerun the same script and args.
5. Assert completed calls are loaded from the journal and not re-spawned.

### Real Sub-Agent Smoke Harness

At least one end-to-end validation must use the real Codex sub-agent bridge. The
minimum smoke script is:

```js
phase("sub-agent smoke");
const result = await agent("Reply with exactly PONG.", {
  key: "pong",
  label: "PONG child"
});
return { result };
```

Acceptance:

- The parent workflow returns a result containing `PONG`.
- Run history contains `agent:start` and `agent:done`.
- The done event includes a child session id or equivalent bridge identifier.
- The preview shows the child sub-agent row.
- Rerunning the same script and args records `agent:cached` and does not create a
  second child session.

## Test Matrix

### DW-SCRIPT-001: Top-Level Await And Return

Script:

```js
const value = await Promise.resolve(args.value);
return { value };
```

Expected:

- Result is `{ value: <args.value> }`.
- No sub-agent calls are made.
- `runtime_script_started` and `runtime_script_done` events are emitted.

### DW-SCRIPT-002: Phase And Log Events

Script:

```js
phase("collect");
log("starting collection");
return "done";
```

Expected:

- Run history contains phase `collect`.
- Run history contains the log message under phase `collect`.
- Preview groups later sub-agent rows under `collect`.

### DW-SCRIPT-003: Single Mock Sub-Agent

Script:

```js
const answer = await agent("Say alpha", { key: "alpha", label: "Alpha" });
return answer;
```

Expected:

- Fake bridge receives one call.
- Prompt is `Say alpha`.
- Label is `Alpha`.
- Result equals fake bridge output.
- Events include `agent:start` and `agent:done`.

### DW-SCRIPT-004: Dynamic Fan-Out From Args

Script:

```js
phase("review");
return await parallel(
  args.files.map((file) => () =>
    agent(`Review ${file}`, { key: `review:${file}`, label: file })
  )
);
```

Args:

```json
{ "files": ["a.ts", "b.ts", "c.ts"] }
```

Expected:

- Exactly three sub-agent calls are made.
- The prompts include `a.ts`, `b.ts`, and `c.ts`.
- Returned array order matches input file order.
- This test fails if the implementation compiles the workflow to a fixed
  predeclared `body.steps` tree before runtime.

### DW-SCRIPT-005: Runtime Branching

Script:

```js
const shouldRun = await agent("Return yes", { key: "gate" });
if (/yes/i.test(String(shouldRun))) {
  return await agent("Run branch", { key: "branch" });
}
return "skipped";
```

Expected:

- With fake response `yes`, two sub-agent calls occur.
- With fake response `no`, only one sub-agent call occurs and result is
  `skipped`.
- Branch choice is based on runtime output, not contract creation time.

### DW-SCRIPT-006: Parallel Varargs And Array Forms

Scripts:

```js
return await parallel(
  () => agent("A", { key: "a" }),
  () => agent("B", { key: "b" })
);
```

```js
return await parallel([
  () => agent("A", { key: "a" }),
  () => agent("B", { key: "b" })
]);
```

Expected:

- Both forms are accepted.
- Both return two results in input order.
- Both use the same concurrency limit.

### DW-SCRIPT-007: Pipeline Stages

Script:

```js
return await pipeline(
  args.items,
  async (item) => agent(`Extract ${item}`, { key: `extract:${item}` }),
  async (prev, item) => agent(`Verify ${item}: ${prev}`, { key: `verify:${item}` })
);
```

Expected:

- Each item runs extract before verify.
- Different items may overlap subject to concurrency.
- Returned array has one result per input item.
- Verify prompts include the extract result.

### DW-SCRIPT-008: Failure Isolation

Script:

```js
return await parallel(
  () => agent("ok", { key: "ok" }),
  () => agent("fail", { key: "fail" }),
  () => agent("ok2", { key: "ok2" })
);
```

Fake bridge:

- `ok` returns `{ status: "ok", output: "one" }`.
- `fail` returns `{ status: "error", error: "boom" }`.
- `ok2` returns `{ status: "ok", output: "two" }`.

Expected:

- Result is `["one", null, "two"]`.
- Run history records the failure reason `boom`.
- The workflow does not abort successful siblings.

### DW-SCRIPT-009: Concurrency Limit

Script:

```js
return await parallel(
  args.ids.map((id) => () => agent(`Work ${id}`, { key: `work:${id}` }))
);
```

Args: ten ids. Runtime limit: concurrency `3`.

Expected:

- Fake bridge observes at most three in-flight calls.
- All ten calls eventually complete.
- Result order matches input order.

### DW-SCRIPT-010: Total Agent Cap

Runtime limit: total agent calls `2`.

Script:

```js
await agent("one", { key: "one" });
await agent("two", { key: "two" });
return await agent("three", { key: "three" });
```

Expected:

- Third call is rejected by the runtime.
- Run history records a limit failure.
- No third sub-agent is started.

## Replay Journal Validation

### DW-JOURNAL-001: Cache Hit Avoids Sub-Agent Spawn

1. Run a script with one `agent()` call and fake output `first`.
2. Rerun the same script and args with a fake bridge configured to throw if
   called.

Expected:

- Second run returns `first`.
- Fake bridge call count remains zero on the second run.
- Run history contains `agent:cached`.

### DW-JOURNAL-002: Args Change Busts Cache

Run the same script with `args.topic = "A"`, then with `args.topic = "B"`.

Expected:

- The second run starts a new sub-agent.
- The journal does not reuse output from topic `A`.

### DW-JOURNAL-003: Script Change Busts Cache

Run script source `agent("A")`, then script source `agent("B")`.

Expected:

- The second run starts a new sub-agent.
- The journal key differs because `scriptHash` changed.

### DW-JOURNAL-004: Prompt Change Busts Cache

Run two scripts with the same source structure and args but different prompt text.

Expected:

- The second run starts a new sub-agent.
- The journal key differs because `promptHash` changed.

### DW-JOURNAL-005: Partial Failure Reuses Completed Calls

Script:

```js
const a = await agent("A", { key: "a" });
const b = await agent("B", { key: "b" });
const c = await agent("C", { key: "c" });
return { a, b, c };
```

Run 1:

- `A` succeeds.
- `B` succeeds.
- `C` fails or times out.

Run 2:

- Same script and args.

Expected:

- `A` and `B` return from journal.
- Only `C` starts a real sub-agent.
- Final result contains outputs for all three when `C` succeeds.

### DW-JOURNAL-006: Restart Resume

1. Use a temporary user data directory.
2. Run a script until the first two sub-agents complete.
3. Stop the runtime.
4. Create a fresh runtime instance against the same user data directory.
5. Rerun the same script and args.

Expected:

- The second runtime loads journal entries created by the first runtime.
- Completed calls are not respawned.
- Missing calls are executed.
- Final output equals an uninterrupted run.

## Security And Approval Validation

### DW-SEC-001: Approval Required By Default

Attempt to run a runtime script in normal mode.

Expected:

- Runtime requests approval before executing.
- Approval preview includes script, args, limits, and safety warning.
- No sub-agent call starts before approval.

### DW-SEC-002: Test-Only Approval Bypass

Enable explicit test bypass.

Expected:

- Script can run in automated tests without manual approval.
- Bypass is impossible unless the explicit test flag is set.

### DW-SEC-003: Forbidden Tokens Are Rejected

Try scripts containing:

- `require("fs")`
- `import("fs")`
- `process.env`
- `globalThis`
- `fetch("https://example.com")`
- `eval("1+1")`
- `Function("return process")`
- `agent.constructor`
- `Date.now()`
- `Math.random()`

Expected:

- Each script is rejected before execution.
- No sub-agent call starts.
- Error message names the forbidden token or category.

### DW-SEC-004: No Secrets In Persistent State

Run a script with args that contain a fake secret value.

Expected:

- Journal keys use hashes, not raw args.
- Persistent journal entries do not include environment variables.
- Script source storage follows the contract storage policy and does not write to
  committed files.

## Compatibility Validation

### DW-COMPAT-001: Existing Static Contract Loads

Load an existing `body.steps` loop.

Expected:

- Contract is interpreted as `workflow.kind = "static_steps"`.
- Existing preview and run history still render.
- No runtime script code path is invoked.

### DW-COMPAT-002: Existing Builder AST Still Compiles

Create a loop with existing `script.build` input.

Expected:

- Input compiles to static `body.steps`.
- Contract is not labeled as runtime script.
- Existing builder tests still pass.

### DW-COMPAT-003: Runtime Script Does Not Require Body Steps

Create a loop with `workflowKind: "runtime_script"` and script string.

Expected:

- Contract validates without `body.steps`.
- Contract stores `workflow.kind = "runtime_script"`.
- The script source remains available for approval and preview.

### DW-COMPAT-004: Body And Runtime Script Conflict

Create a loop with both `body.steps` and `workflowKind: "runtime_script"`.

Expected:

- Contract validation rejects the input.
- Error tells the author to choose static body or runtime script.

## Real Sub-Agent Validation

These tests are allowed to be slower and may run in a live validation suite rather
than every unit run. They are mandatory before calling the feature complete.

### DW-SUBAGENT-001: Single Real Child

Script:

```js
phase("real child");
const pong = await agent("Reply with exactly PONG.", {
  key: "real:pong",
  label: "PONG child"
});
return { pong };
```

Expected:

- A real child session is created.
- Parent result contains `PONG`.
- Run history includes child session id.
- Preview shows the sub-agent row.

### DW-SUBAGENT-002: Real Dynamic Fan-Out

Script:

```js
phase("fanout");
const topics = ["alpha", "beta", "gamma"];
const results = await parallel(
  topics.map((topic) => () =>
    agent(`Reply with the uppercase form of ${topic}.`, {
      key: `upper:${topic}`,
      label: topic
    })
  )
);
return results;
```

Expected:

- Three real child sessions are created.
- Returned results correspond to `ALPHA`, `BETA`, and `GAMMA`.
- Preview shows all three under the same phase.
- Rerun with same script and args emits cache hits and creates no new children.

### DW-SUBAGENT-003: Sub-Agent Validator Reviews Workflow Result

This is the mandatory sub-agent validation case. It proves that validation itself
can use a sub-agent, not only the workflow body.

Workflow script:

```js
phase("produce");
const draft = await agent("Produce a two-bullet checklist for release readiness.", {
  key: "produce:draft",
  label: "Draft"
});
return { draft };
```

Validation step:

- After the workflow returns, start a separate verifier sub-agent.
- The verifier receives the workflow result and the acceptance criteria:
  "The result must contain exactly two bullets and mention release readiness."
- The verifier must return structured status, evidence, and any correction notes.

Expected:

- Worker sub-agent and verifier sub-agent have different session ids.
- The verifier inspects the worker output, not its own output.
- The run cannot be marked verified until the verifier result is recorded.
- Failed verifier output produces visible validation failure evidence.

## Preview And Observability Validation

### DW-VIEW-001: Runtime Script View

Run a workflow with two phases and three sub-agent calls.

Expected:

- Preview labels the workflow as runtime script.
- Preview shows phase grouping.
- Preview shows each sub-agent label and status.
- Preview shows cache-hit status on rerun.
- Preview shows final return value.

### DW-VIEW-002: Failure Reason Visible

Run a workflow where one sub-agent times out.

Expected:

- User sees the timeout reason in run history and preview.
- Final result does not silently collapse to unexplained `null`.

## End-To-End Acceptance Scenarios

### Scenario A: Simple Serial Runtime Script

Script:

```js
phase("topic");
const topic = await agent("Choose one concise topic about the repository.", {
  key: "topic"
});
phase("summary");
return await agent(`Summarize why ${topic} matters.`, {
  key: "summary"
});
```

Pass condition:

- Two sub-agent calls happen in order.
- The second prompt includes the first result.
- Rerun uses two cache hits.

### Scenario B: Dynamic Parallel Runtime Script

Script:

```js
phase("discover");
const files = await agent("Return JSON array of three file names to inspect.", {
  key: "discover-files",
  schema: { type: "array", items: { type: "string" } }
});

phase("inspect");
return await parallel(
  files.map((file) => () =>
    agent(`Inspect ${file} for one risk.`, { key: `inspect:${file}`, label: file })
  )
);
```

Pass condition:

- The number of inspect sub-agents is determined by the discover output.
- Inspect calls run in parallel.
- Results preserve file order.
- Rerun reuses discover and inspect calls through the journal.

### Scenario C: Interrupted Run Recovery

Use a script with five sub-agent calls. Force the third call to fail during run 1,
then rerun with the same script and args.

Pass condition:

- Calls 1 and 2 are cache hits on run 2.
- Calls 3, 4, and 5 execute as needed.
- Final result matches the result of a clean uninterrupted run.
- Run history makes cache hits and rerun work visible.

## Definition Of Done

The feature can be called complete only when:

- Unit runtime tests pass.
- Mock sub-agent bridge tests pass.
- Replay journal restart tests pass.
- Security and approval tests pass.
- Static workflow compatibility tests pass.
- Preview observability tests pass.
- At least one real Codex sub-agent smoke test passes.
- The mandatory verifier sub-agent validation case passes.
- Documentation states that runtime script workflows are distinct from
  `body.steps` and old `script.build`.
