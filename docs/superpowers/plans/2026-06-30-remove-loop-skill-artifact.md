# Remove Loop Skill Artifact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop generating the misleading per-loop `skill/dittosloop-for-codex-loop.md` artifact while preserving useful Live Loop directory files.

**Architecture:** `loopWorkspaceFiles` remains the source of truth for generated Live Loop files. The service and preview API continue to expose the generated file list, and stale on-disk files are still removed by the existing directory sync path. Documentation no longer tells users that each loop has a generated local skill guide.

**Tech Stack:** TypeScript, Vitest, Node test runner, markdown plugin skill docs.

## Global Constraints

- Do not remove the installed plugin skill under `plugins/dittosloop-for-codex/skills/loop`.
- Preserve useful generated Live Loop files: `memory.md`, `workflow.json`, `runtime.js`, `verification.md`, `status.json`, and `contract.json`.
- Do not change loop execution, runtime script behavior, verification, memory, or preview file rendering.
- Do not introduce a replacement `runtime/` guide file.
- Follow TDD: update tests first, verify they fail, then implement.

---

### Task 1: Remove the Generated Skill Artifact

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/workspaceFiles.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Modify: `test/loop-skill-memory.test.mjs`
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`

**Interfaces:**
- Consumes: `loopWorkspaceFiles(state: LoopState, loopId: string): LoopWorkspaceFile[]`.
- Produces: A Live Loop file list with no `skill/dittosloop-for-codex-loop.md` entry and no replacement `runtime/dittosloop-for-codex-loop.md` entry.

- [ ] **Step 1: Write failing workspace file tests**

Update `plugins/dittosloop-for-codex/mcp/test/workspaceFiles.test.ts` so runtime script workflows assert the complete useful file set and assert no generated skill guide exists:

```ts
const paths = files.map((file) => file.path);
expect(paths).toEqual([
  "memory.md",
  "workflow.json",
  "runtime.js",
  "verification.md",
  "status.json",
  "contract.json"
]);
expect(paths).not.toContain("skill/dittosloop-for-codex-loop.md");
expect(paths).not.toContain("runtime/dittosloop-for-codex-loop.md");
```

- [ ] **Step 2: Update service and preview tests to describe desired behavior**

In `plugins/dittosloop-for-codex/mcp/test/service.test.ts`, change the generated file order assertion to:

```ts
expect(files.map((file) => file.path)).toEqual([
  "memory.md",
  "workflow.json",
  "verification.md",
  "status.json",
  "contract.json"
]);
```

Delete the assertion that reads `skill/dittosloop-for-codex-loop.md`, and add:

```ts
expect(files.find((file) => file.path === "skill/dittosloop-for-codex-loop.md")).toBeUndefined();
await expect(readFile(join(loopDir, "skill", "dittosloop-for-codex-loop.md"), "utf8")).rejects.toMatchObject({
  code: "ENOENT"
});
```

In `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`, remove the expected `skill/dittosloop-for-codex-loop.md` object, keep the useful file assertions, and add:

```ts
expect(files.find((file: { path: string }) => file.path === "skill/dittosloop-for-codex-loop.md")).toBeUndefined();
expect(files.find((file: { path: string }) => file.path === "runtime/dittosloop-for-codex-loop.md")).toBeUndefined();
```

- [ ] **Step 3: Update skill documentation tests**

In `test/loop-skill-memory.test.mjs`, rename the runtime-script documentation test to stop mentioning the generated local skill guide. Replace the `skill/` path assertion with:

```js
assert.doesNotMatch(createLoop, /skill\/dittosloop-for-codex-loop\.md/);
assert.doesNotMatch(createLoop, /runtime\/dittosloop-for-codex-loop\.md/);
assert.doesNotMatch(createLoop, /每个 loop 生成的本地指导/);
```

- [ ] **Step 4: Run focused tests and confirm they fail for the expected reason**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workspaceFiles.test.ts service.test.ts previewServer.test.ts
node --test test/loop-skill-memory.test.mjs
```

Expected: the workspace, service, preview, and documentation tests fail because production code and docs still generate or mention `skill/dittosloop-for-codex-loop.md`.

- [ ] **Step 5: Remove the generated skill file from production code**

In `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`, remove this object from `formalLoopDirectoryFiles`:

```ts
withSize({
  path: "skill/dittosloop-for-codex-loop.md",
  kind: "skill",
  language: "markdown",
  content: loopSkillFile(input.contract)
}),
```

Delete the `loopSkillFile(contract: FormalLoopContract): string` helper. Remove the `skill/` sorting special case because new generated output no longer produces skill files:

```ts
const leftIsSkill = left.path.startsWith("skill/");
const rightIsSkill = right.path.startsWith("skill/");
if (leftIsSkill !== rightIsSkill) return leftIsSkill ? 1 : -1;
```

In `plugins/dittosloop-for-codex/mcp/src/types.ts`, remove `"skill"` from `LoopWorkspaceFile["kind"]`.

- [ ] **Step 6: Remove the outdated guide text**

In `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`, delete this paragraph:

```md
每个 loop 生成的本地指导位于 `skill/dittosloop-for-codex-loop.md`。它是某次 loop session 的 runtime output，不是已安装 marketplace skill。
```

- [ ] **Step 7: Run focused tests and confirm they pass**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- workspaceFiles.test.ts service.test.ts previewServer.test.ts
node --test test/loop-skill-memory.test.mjs
```

Expected: all focused tests pass.

- [ ] **Step 8: Run full verification**

Run:

```bash
npm run check
```

Expected: build, generated-file verification, root tests, plugin validation, and MCP tests pass.

- [ ] **Step 9: Commit implementation**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/test/workspaceFiles.test.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts test/loop-skill-memory.test.mjs plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/skills/loop/references/create-loop.md docs/superpowers/specs/2026-06-30-remove-loop-skill-artifact-design.md docs/superpowers/plans/2026-06-30-remove-loop-skill-artifact.md
git commit -m "fix: remove generated loop skill artifact"
```

Expected: implementation commit created after tests pass.
