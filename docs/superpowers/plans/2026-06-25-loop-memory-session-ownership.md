# Loop Memory Session Ownership Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement bounded newest-first loop memory reads and make the top-level visible Codex session own the post-verifier memory write decision.

**Architecture:** The runtime keeps memory writes explicit through `commit_memory`, but exposes a new read-only `read_loop_memory` path and injects a bounded memory excerpt into `start_codex_session`. The workflow engine and verifier remain memory-policy free; task agents can read memory through the MCP tool and return durable observations through task results, while the visible session decides whether to commit memory after verifier results.

**Tech Stack:** TypeScript, Vitest, MCP SDK tool registration, Zod schemas, Node test runner for root plugin checks, local JSON `LoopStore`.

## Global Constraints

- Work only in `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/.worktrees/loop-memory-session-ownership` on branch `codex/loop-memory-session-ownership`.
- Default startup memory read limit is exactly 80 memory lines.
- `read_loop_memory.limit` must be an integer between 1 and 200.
- `read_loop_memory.offset` must be an integer greater than or equal to 0.
- Memory windows are newest-first.
- New memory entries appear at the top of the readable memory surface.
- `commit_memory` remains explicit; do not add hidden automatic memory writes.
- Workflow task agents and verifier logic do not decide long-term memory writes.
- The top-level visible Codex session decides whether to call `commit_memory` after verifier results are visible.
- Preserve existing run, attempt, workflow, verification, pause, resume, and stop-policy behavior.
- Use TDD for implementation tasks: write a failing test, run it red, implement the smallest passing change, rerun tests green, then commit.
- Do not merge this branch without review and explicit user approval.

---

## File Structure

- `plugins/dittosloop-for-codex/mcp/src/types.ts`: add the exported `LoopMemoryWindow` data shape returned by the service and MCP tool.
- `plugins/dittosloop-for-codex/mcp/src/service.ts`: add memory read constants, `ReadLoopMemoryInput`, `readLoopMemory`, pure memory-window helpers, newest-first memory prepending, and session prompt memory injection.
- `plugins/dittosloop-for-codex/mcp/src/store.ts`: adjust memory reconstruction from `memoryCommits` so newly reconstructed memory is newest-first when no explicit `loopMemories.content` exists.
- `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`: add `read_loop_memory` schema, handler, and tool metadata.
- `plugins/dittosloop-for-codex/skills/loop/SKILL.md`: update installed skill instructions so `read_loop_memory` is discoverable and `commit_memory` is owned by the top-level session after verifier results.
- `plugins/dittosloop-for-codex/mcp/test/service.test.ts`: cover newest-first storage, bounded read windows, empty memory responses, unknown loop errors, and prompt injection.
- `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`: cover tool registration, MCP read behavior, and schema rejection.
- `test/loop-skill-memory.test.mjs`: add a root Node test that checks the installed loop skill documents `read_loop_memory` and the post-verifier memory ownership rule.

---

### Task 1: Service Memory Window And Newest-First Storage

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/store.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

**Interfaces:**
- Consumes: existing `LoopService`, `LoopStore.readState()`, `commitMemory(loopId, input)`, `listLoopFiles(loopId)`.
- Produces: `LoopMemoryWindow`, `ReadLoopMemoryInput`, `DEFAULT_LOOP_MEMORY_READ_LIMIT`, `MAX_LOOP_MEMORY_READ_LIMIT`, `readLoopMemory(loopId, input?)`.

- [ ] **Step 1: Write the failing service tests**

In `plugins/dittosloop-for-codex/mcp/test/service.test.ts`, replace the existing test named `persists append-only loop memory across commits` with this test:

```ts
test("persists newest-first loop memory across commits", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run memory updater" });

  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Prefer official sources." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Ignore duplicate syndicated posts." });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopMemories: [
      {
        loopId: formal.id,
        content: "Ignore duplicate syndicated posts.\nPrefer official sources.\n",
        updatedAt: fixedTime
      }
    ],
    memoryCommits: [
      { loopId: formal.id, runId: launch.run.id, summary: "Prefer official sources." },
      { loopId: formal.id, runId: launch.run.id, summary: "Ignore duplicate syndicated posts." }
    ]
  });

  const files = await service.listLoopFiles(formal.id);
  expect(files.find((file) => file.path === "memory.md")?.content).toBe(
    "Ignore duplicate syndicated posts.\nPrefer official sources.\n"
  );
  const memoryCommits = JSON.parse(files.find((file) => file.path === "evolution/memory-commits.json")!.content);
  expect(memoryCommits).toMatchObject({
    loopId: formal.id,
    latestCommitId: "memory_2",
    commits: [
      { id: "memory_1", summary: "Prefer official sources." },
      { id: "memory_2", summary: "Ignore duplicate syndicated posts." }
    ]
  });
});
```

Add these tests immediately after that replaced test:

```ts
test("reads loop memory in bounded newest-first windows", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run memory updater" });

  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "First durable lesson." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Second durable lesson." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Third durable lesson." });

  await expect(service.readLoopMemory(formal.id, { limit: 2 })).resolves.toEqual({
    loopId: formal.id,
    limit: 2,
    offset: 0,
    returnedLines: 2,
    totalLines: 3,
    remainingLines: 1,
    content:
      "Third durable lesson.\nSecond durable lesson.\n还有 1 条记忆未读取。可调用 read_loop_memory({ loopId: \"loop_1\", offset: 2, limit: 2 }) 继续读取。"
  });

  await expect(service.readLoopMemory(formal.id, { limit: 2, offset: 2 })).resolves.toEqual({
    loopId: formal.id,
    limit: 2,
    offset: 2,
    returnedLines: 1,
    totalLines: 3,
    remainingLines: 0,
    content: "First durable lesson."
  });

  await expect(service.readLoopMemory(formal.id)).resolves.toMatchObject({
    loopId: formal.id,
    limit: 80,
    offset: 0,
    returnedLines: 3,
    totalLines: 3,
    remainingLines: 0
  });
});
```

Add this empty-memory test after the bounded-window test:

```ts
test("returns structured empty loop memory windows", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  await expect(service.readLoopMemory(formal.id)).resolves.toEqual({
    loopId: formal.id,
    limit: 80,
    offset: 0,
    returnedLines: 0,
    totalLines: 0,
    remainingLines: 0,
    content: "暂无长期记忆。"
  });
});
```

Add this validation test after the empty-memory test:

```ts
test("rejects invalid loop memory window requests", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  await expect(service.readLoopMemory("missing_loop")).rejects.toThrow(/Loop not found/);
  await expect(service.readLoopMemory(formal.id, { limit: 0 })).rejects.toThrow(/limit must be between 1 and 200/);
  await expect(service.readLoopMemory(formal.id, { limit: 201 })).rejects.toThrow(/limit must be between 1 and 200/);
  await expect(service.readLoopMemory(formal.id, { offset: -1 })).rejects.toThrow(/offset must be greater than or equal to 0/);
});
```

- [ ] **Step 2: Run the service tests red**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "loop memory"
```

Expected result: FAIL because `service.readLoopMemory` does not exist and existing memory order is old-first.

- [ ] **Step 3: Add the public memory window type**

In `plugins/dittosloop-for-codex/mcp/src/types.ts`, add this interface immediately after `LoopMemory`:

```ts
export interface LoopMemoryWindow {
  loopId: string;
  limit: number;
  offset: number;
  returnedLines: number;
  totalLines: number;
  remainingLines: number;
  content: string;
}
```

- [ ] **Step 4: Add service constants, input type, and import**

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, add `LoopMemoryWindow` to the existing `./types.js` type import:

```ts
  LoopMemory,
  LoopMemoryWindow,
  LoopOperationalState,
```

Add these exports after `LoopServiceOptions`:

```ts
export const DEFAULT_LOOP_MEMORY_READ_LIMIT = 80;
export const MAX_LOOP_MEMORY_READ_LIMIT = 200;

export interface ReadLoopMemoryInput {
  limit?: number;
  offset?: number;
}
```

- [ ] **Step 5: Implement `readLoopMemory` on `LoopService`**

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, add this method immediately before `async commitMemory`:

```ts
  async readLoopMemory(loopId: string, input: ReadLoopMemoryInput = {}): Promise<LoopMemoryWindow> {
    const state = await this.options.store.readState();
    return loopMemoryWindow(state, loopId, input);
  }
```

Add these helpers near `appendLoopMemory`:

```ts
function loopMemoryWindow(state: LoopState, loopId: string, input: ReadLoopMemoryInput = {}): LoopMemoryWindow {
  requireLoop(state, loopId);
  const limit = input.limit ?? DEFAULT_LOOP_MEMORY_READ_LIMIT;
  const offset = input.offset ?? 0;

  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LOOP_MEMORY_READ_LIMIT) {
    throw new Error(`Memory read limit must be between 1 and ${MAX_LOOP_MEMORY_READ_LIMIT}.`);
  }

  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error("Memory read offset must be greater than or equal to 0.");
  }

  const memory = state.loopMemories.find((candidate) => candidate.loopId === loopId);
  const lines = memoryLines(memory?.content);
  const selectedLines = lines.slice(offset, offset + limit);
  const remainingLines = Math.max(lines.length - offset - selectedLines.length, 0);

  return {
    loopId,
    limit,
    offset,
    returnedLines: selectedLines.length,
    totalLines: lines.length,
    remainingLines,
    content: memoryWindowContent(loopId, selectedLines, remainingLines, offset + selectedLines.length, limit)
  };
}

function memoryLines(content: string | undefined): string[] {
  return (content ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function memoryWindowContent(
  loopId: string,
  lines: string[],
  remainingLines: number,
  nextOffset: number,
  limit: number
): string {
  if (!lines.length) {
    return "暂无长期记忆。";
  }

  const content = lines.join("\n");
  if (!remainingLines) {
    return content;
  }

  return [
    content,
    `还有 ${remainingLines} 条记忆未读取。可调用 read_loop_memory({ loopId: "${loopId}", offset: ${nextOffset}, limit: ${limit} }) 继续读取。`
  ].join("\n");
}
```

- [ ] **Step 6: Make new memory entries prepend**

Replace `appendLoopMemory` in `plugins/dittosloop-for-codex/mcp/src/service.ts` with:

```ts
function appendLoopMemory(memories: LoopMemory[], loopId: string, line: string, updatedAt: string): LoopMemory[] {
  const existing = memories.find((memory) => memory.loopId === loopId);
  const updated = {
    loopId,
    content: `${line}\n${existing?.content ?? ""}`,
    updatedAt
  };

  if (!existing) {
    return [...memories, updated];
  }

  return memories.map((memory) => (memory.loopId === loopId ? updated : memory));
}
```

- [ ] **Step 7: Reconstruct missing memory content newest-first**

In `plugins/dittosloop-for-codex/mcp/src/store.ts`, change the `loopCommits` sort inside `deriveLoopMemories` to descending:

```ts
    const loopCommits = commits
      .filter((commit) => commit.loopId === loopId)
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
```

Change the reconstructed `updatedAt` line in the same object to:

```ts
      updatedAt: loopCommits.at(0)?.createdAt
```

- [ ] **Step 8: Run the service tests green**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "loop memory"
```

Expected result: PASS for the memory-related service tests.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/src/store.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts
git commit -m "feat: add bounded loop memory reads"
```

---

### Task 2: MCP `read_loop_memory` Tool

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

**Interfaces:**
- Consumes: `LoopService.readLoopMemory(loopId, input?)`.
- Produces: MCP tool `read_loop_memory({ loopId, limit?, offset? })`.

- [ ] **Step 1: Write failing MCP registration and behavior tests**

In `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`, update the `registeredTools` expectation by inserting `"read_loop_memory"` immediately before `"commit_memory"`:

```ts
    "resolve_human_request",
    "read_loop_memory",
    "commit_memory",
```

Add this test before `function readResult`:

```ts
test("reads loop memory through MCP with bounded newest-first windows", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Memory loop",
    goal: "Remember durable lessons",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Check", prompt: "Check memory" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Memory can be read", severity: "must" }]
    }
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: loop.id, goal: "Run memory update" }));

  await handlers.commit_memory({ loopId: loop.id, runId: launch.run.id, summary: "First lesson." });
  await handlers.commit_memory({ loopId: loop.id, runId: launch.run.id, summary: "Second lesson." });

  const memory = readResult(await handlers.read_loop_memory({ loopId: loop.id, limit: 1 }));

  expect(memory).toEqual({
    loopId: loop.id,
    limit: 1,
    offset: 0,
    returnedLines: 1,
    totalLines: 2,
    remainingLines: 1,
    content:
      "Second lesson.\n还有 1 条记忆未读取。可调用 read_loop_memory({ loopId: \"loop_1\", offset: 1, limit: 1 }) 继续读取。"
  });
});
```

Add this schema test after the behavior test:

```ts
test("rejects invalid MCP memory read windows", async () => {
  const handlers = await createHandlers();
  const loop = readResult(await handlers.create_loop_contract({
    title: "Memory loop",
    goal: "Remember durable lessons",
    body: {
      steps: [{ id: "check", kind: "agent", label: "Check", prompt: "Check memory" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Memory can be read", severity: "must" }]
    }
  }));

  await expect(handlers.read_loop_memory({ loopId: loop.id, limit: 0 })).rejects.toThrow();
  await expect(handlers.read_loop_memory({ loopId: loop.id, limit: 201 })).rejects.toThrow();
  await expect(handlers.read_loop_memory({ loopId: loop.id, offset: -1 })).rejects.toThrow();
});
```

- [ ] **Step 2: Run the MCP tests red**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts
```

Expected result: FAIL because `read_loop_memory` is not registered.

- [ ] **Step 3: Add schema and handler**

In `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`, change the service import to:

```ts
import { MAX_LOOP_MEMORY_READ_LIMIT, type LoopService } from "./service.js";
```

Add this schema immediately after `commitMemorySchema`:

```ts
const readLoopMemorySchema = z.object({
  loopId: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_LOOP_MEMORY_READ_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional()
});
```

Add this handler immediately before `commit_memory`:

```ts
    read_loop_memory: async (input) => {
      const args = readLoopMemorySchema.parse(input);
      return toToolResult(await service.readLoopMemory(args.loopId, {
        limit: args.limit,
        offset: args.offset
      }));
    },
```

- [ ] **Step 4: Add tool metadata**

In `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`, add this metadata block immediately before the `commit_memory` block:

```ts
  {
    name: "read_loop_memory",
    title: "Read loop memory",
    description: "Read a bounded newest-first window of durable loop memory.",
    schema: readLoopMemorySchema
  },
```

- [ ] **Step 5: Run the MCP tests green**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts
```

Expected result: PASS for the MCP memory tests.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/mcpServer.ts plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts
git commit -m "feat: expose loop memory reader tool"
```

---

### Task 3: Session Prompt And Installed Skill Discipline

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
- Create: `test/loop-skill-memory.test.mjs`

**Interfaces:**
- Consumes: `loopMemoryWindow(state, loopId, input?)`, `LoopMemoryWindow`.
- Produces: visible session prompt section `Loop memory / 长期记忆` and installed skill guidance for `read_loop_memory` plus post-verifier `commit_memory`.

- [ ] **Step 1: Write the failing prompt test**

In `plugins/dittosloop-for-codex/mcp/test/service.test.ts`, add this test near the existing `startCodexSessionRun` prompt tests:

```ts
test("injects a bounded loop memory excerpt into Codex session prompts", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const first = await service.startCodexSessionRun(formal.id, { goal: "Seed memory" });

  for (let index = 1; index <= 82; index += 1) {
    await service.commitMemory(formal.id, { runId: first.run.id, summary: `Memory ${index}` });
  }

  await service.completeRun(first.run.id, { status: "completed" });

  const second = await service.startCodexSessionRun(formal.id, { goal: "Use memory" });

  expect(second.prompt).toContain("Loop memory / 长期记忆");
  expect(second.prompt).toContain("Memory 82");
  expect(second.prompt).toContain("Memory 3");
  expect(second.prompt).not.toContain("Memory 2");
  expect(second.prompt).not.toContain("Memory 1");
  expect(second.prompt).toContain("还有 2 条记忆未读取。可调用 read_loop_memory({ loopId: \"loop_1\", offset: 80, limit: 80 }) 继续读取。");
  expect(second.prompt).toContain("顶层 Codex session 在 verifier 结果可见后决定是否调用 commit_memory");
  expect(second.prompt).toContain("workflow task 如发现可复用观察，应通过 task result 回传");
});
```

- [ ] **Step 2: Write the failing installed skill test**

Create `test/loop-skill-memory.test.mjs` with this content:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(repoRoot, "plugins/dittosloop-for-codex/skills/loop/SKILL.md");

test("loop skill documents memory reads and post-verifier memory ownership", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /read_loop_memory/);
  assert.match(skill, /verifier/);
  assert.match(skill, /commit_memory/);
  assert.match(skill, /top-level visible Codex session|顶层 Codex session/);
});
```

- [ ] **Step 3: Run the prompt and skill tests red**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "bounded loop memory excerpt"
node --test test/loop-skill-memory.test.mjs
```

Expected result: the Vitest prompt test fails because prompt injection is missing; the Node skill test fails because the skill does not mention `read_loop_memory`.

- [ ] **Step 4: Inject the memory window into `startCodexSessionRun`**

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, change the prompt creation inside `startCodexSessionRun` from:

```ts
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract, {
        runId,
        attemptId,
        workflowContextId
      });
```

to:

```ts
      const memoryWindow = loopMemoryWindow(state, loopId);
      const prompt = buildCodexSessionPrompt(loop, goal, formalContract, {
        runId,
        attemptId,
        workflowContextId
      }, memoryWindow);
```

- [ ] **Step 5: Update `buildCodexSessionPrompt` signature**

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, change the function signature to:

```ts
function buildCodexSessionPrompt(
  loop: LoopContract,
  goal: string,
  contract?: FormalLoopContract,
  callbacks?: { runId: string; attemptId: string; workflowContextId: string },
  memoryWindow?: LoopMemoryWindow
): string {
```

Add this block before `const workflowCallbacks`:

```ts
  const loopMemory = memoryWindow
    ? [
        "",
        "Loop memory / 长期记忆：",
        memoryWindow.content,
        "",
        "Memory discipline / 记忆写入纪律：",
        "- 可在需要更多长期上下文时调用 read_loop_memory({ loopId, limit, offset })。",
        "- workflow task 如发现可复用观察，应通过 task result 回传，不直接负责长期记忆取舍。",
        "- verifier 只判断结果是否过关，不负责写入长期记忆。",
        "- 顶层 Codex session 在 verifier 结果可见后决定是否调用 commit_memory。",
        "- 只记录稳定偏好、长期规则、可复用修复经验、边界条件或 workflow 改进；不要记录一次性进度、临时失败、run id、attempt id 或调试残留。"
      ].join("\n")
    : "";
```

Add `loopMemory,` into the final returned array immediately before `workflowContract`:

```ts
    loopMemory,
    workflowContract,
```

- [ ] **Step 6: Update installed skill workflow order**

In `plugins/dittosloop-for-codex/skills/loop/SKILL.md`, change the numbered steps around memory to include this exact run order:

```markdown
5. Use `start_codex_session` to create the visible run, attempt, Codex session request, workflow context, and bounded memory excerpt.
6. Use the injected memory excerpt first. When more durable context is useful, call `read_loop_memory` with `loopId`, `limit`, and `offset`.
7. From that Codex session, use `execute_workflow_attempt` with the returned `runId` and `attemptId` to run the local workflow engine in the same context.
8. When a Codex task session finishes outside the immediate engine call, use `record_session_result` with `workflowContextId`, `attemptId`, `taskRunId` or `sessionId` or `stepId`, and an `idempotencyKey` to write back the exact task result. When multiple locators are provided, they must identify the same task run. `needs_human` suspends the exact task and opens a linked human request when possible.
9. Workflow tasks may call `read_loop_memory` while working. They should return durable observations in task results rather than deciding long-term memory writes themselves.
10. When a task needs a local Codex specialist, put the desired `subagent` role/model/tools/permissions on the task. DittosLoop records and passes these hints to the Codex host bridge; it does not enforce tool allowlists itself.
11. When the active Codex session discovers that the workflow should change, use the workflow revision tools from that same visible session with the current `runId` and `attemptId`: propose a revision, list drafts, then promote or reject it explicitly.
```

Update the later memory instruction to:

```markdown
19. After verifier results are visible, the top-level visible Codex session decides whether there is a durable lesson, preference, boundary, repair rule, or workflow insight worth keeping. If yes, call `commit_memory`.
```

Add this row to the Tool Map immediately before the `commit_memory` row:

```markdown
| Read durable loop memory | `read_loop_memory` |
```

- [ ] **Step 7: Run the prompt and skill tests green**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "bounded loop memory excerpt"
node --test test/loop-skill-memory.test.mjs
```

Expected result: both commands PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/skills/loop/SKILL.md test/loop-skill-memory.test.mjs
git commit -m "docs: clarify post-verifier memory discipline"
```

---

### Task 4: Full Verification And Final Review Prep

**Files:**
- Modify only files touched by Tasks 1-3 if verification reveals defects.

**Interfaces:**
- Consumes: all code and tests from Tasks 1-3.
- Produces: a verified branch ready for code review.

- [ ] **Step 1: Run focused MCP tests**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts mcpServer.test.ts
```

Expected result: PASS.

- [ ] **Step 2: Run root plugin tests**

Run:

```bash
npm test
```

Expected result: PASS, including `loop-skill-memory.test.mjs`.

- [ ] **Step 3: Run full repository check**

Run:

```bash
npm run check
```

Expected result: PASS for TypeScript build, root Node tests, plugin validation, and MCP Vitest suite.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected result: `git status --short` is clean, `git diff --check` reports no whitespace errors, and the diff contains only memory-read, session-prompt, MCP-tool, skill, tests, spec, and plan changes.

- [ ] **Step 5: Record verification commit if Task 4 changed files**

If Task 4 required fixes, commit them:

```bash
git add plugins/dittosloop-for-codex/mcp/src plugins/dittosloop-for-codex/mcp/test plugins/dittosloop-for-codex/skills/loop test
git commit -m "fix: stabilize loop memory ownership flow"
```

If Task 4 did not require fixes, do not create an empty commit.

- [ ] **Step 6: Prepare review summary**

Report:

```text
Branch: codex/loop-memory-session-ownership
Implemented:
- bounded newest-first loop memory reads
- read_loop_memory MCP tool
- visible-session prompt memory excerpt
- post-verifier memory ownership guidance in the installed skill

Verification:
- npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts mcpServer.test.ts
- npm test
- npm run check
```

---

## Plan Self-Review

- Spec coverage: Task 1 covers newest-first memory storage, read limits, offsets, empty reads, unknown loop errors, and reconstruction. Task 2 covers MCP availability and schema validation. Task 3 covers startup prompt injection, top-level session ownership, task-agent read guidance, and installed skill documentation. Task 4 covers full verification.
- Type consistency: `LoopMemoryWindow` is defined in `types.ts`, `ReadLoopMemoryInput` is defined in `service.ts`, `readLoopMemory` returns `Promise<LoopMemoryWindow>`, and MCP returns the same JSON shape.
- Responsibility boundary: workflow tasks and verifier remain free of memory write policy; only tool metadata and prompt/skill guidance tell agents how to read memory and who owns writes.
