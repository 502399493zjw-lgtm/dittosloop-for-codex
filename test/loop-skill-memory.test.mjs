import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(repoRoot, "plugins/dittosloop-for-codex/skills/loop");
const skillPath = path.join(skillRoot, "SKILL.md");

const requiredReferences = [
  "references/choose-workflow.md",
  "references/create-loop.md",
  "references/execute-loop.md",
  "references/iterate-loop.md",
  "references/inspect-loop.md",
  "references/memory-and-artifacts.md",
  "references/human-requests.md",
  "references/tool-reference.md"
];

async function readSkillFile(relativePath) {
  return readFile(path.join(skillRoot, relativePath), "utf8");
}

test("loop skill uses progressive disclosure references for lifecycle guidance", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /^name: loop$/m);

  const skillLineCount = skill.trimEnd().split(/\r?\n/).length;
  assert.ok(skillLineCount < 132, `expected SKILL.md to shrink below 132 lines, got ${skillLineCount}`);

  for (const referencePath of requiredReferences) {
    assert.match(skill, new RegExp(referencePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await readSkillFile(referencePath);
  }
});

test("loop skill references preserve memory, execution, and writeback rules", async () => {
  const memory = await readSkillFile("references/memory-and-artifacts.md");
  assert.match(memory, /read_loop_memory/);
  assert.match(memory, /commit_memory/);
  assert.match(memory, /top-level visible Codex session|顶层 Codex session/);

  const execution = await readSkillFile("references/execute-loop.md");
  assert.match(execution, /start_codex_session/);
  assert.match(execution, /execute_workflow_attempt/);
  assert.match(execution, /needs_human/);

  const toolReference = await readSkillFile("references/tool-reference.md");
  assert.match(toolReference, /record_session_result/);
  assert.match(toolReference, /workflowContextId/);
  assert.match(toolReference, /attemptId/);
  assert.match(toolReference, /idempotencyKey/);
  assert.match(toolReference, /multiple locators.*same task run|多个定位.*同一个 task run/i);
});

test("loop skill docs describe profile-based codex workflows and the generated runtime guide", async () => {
  const skill = await readFile(skillPath, "utf8");
  const chooseWorkflow = await readSkillFile("references/choose-workflow.md");
  const createLoop = await readSkillFile("references/create-loop.md");
  const executeLoop = await readSkillFile("references/execute-loop.md");
  const toolReference = await readSkillFile("references/tool-reference.md");

  assert.match(chooseWorkflow, /task\(runtime: codex\)/);
  assert.match(createLoop, /agentProfiles/);
  assert.match(createLoop, /agentProfileRef/);
  assert.match(createLoop, /requiredSkills/);
  assert.match(createLoop, /allowDegradedProfiles/);
  assert.match(createLoop, /runtime\/dittosloop-for-codex-loop\.md/);
  assert.match(createLoop, /compatibility/);
  assert.doesNotMatch(createLoop, /skill\/dittosloop-for-codex-loop\.md/);
  assert.match(executeLoop, /requiredSkills/);
  assert.match(executeLoop, /allowDegradedProfiles/);
  assert.match(toolReference, /requiredSkills/);
  assert.match(skill, /create_loop_contract/);
});
