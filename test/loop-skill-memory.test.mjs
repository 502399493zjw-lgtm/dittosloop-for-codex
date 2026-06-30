import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillRoot = path.join(repoRoot, "plugins/dittosloop-for-codex/skills/loop");
const skillPath = path.join(skillRoot, "SKILL.md");

const requiredReferences = [
  "references/create-loop.md",
  "references/define-rubric.md",
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

test("loop skill docs describe runtime script workflows and the generated local skill guide", async () => {
  const skill = await readFile(skillPath, "utf8");
  const createLoop = await readSkillFile("references/create-loop.md");
  const executeLoop = await readSkillFile("references/execute-loop.md");
  const toolReference = await readSkillFile("references/tool-reference.md");

  assert.match(createLoop, /workflowKind/);
  assert.match(createLoop, /runtime_script/);
  assert.match(createLoop, /字符串 `script`/);
  assert.match(createLoop, /agent\(\)/);
  assert.match(createLoop, /parallel\(\)/);
  assert.match(createLoop, /skill\/dittosloop-for-codex-loop\.md/);
  assert.doesNotMatch(createLoop, /runtime\/dittosloop-for-codex-loop\.md/);
  assert.match(executeLoop, /approve_runtime_script/);
  assert.match(executeLoop, /allowDegradedProfiles/);
  assert.match(toolReference, /workflowKind/);
  assert.match(toolReference, /approve_runtime_script/);
  assert.match(skill, /create_loop_contract/);
});

test("loop skill runtime script guidance is written in Chinese", async () => {
  const skill = await readFile(skillPath, "utf8");
  const createLoop = await readSkillFile("references/create-loop.md");
  const defineRubric = await readSkillFile("references/define-rubric.md");
  const executeLoop = await readSkillFile("references/execute-loop.md");
  const toolReference = await readSkillFile("references/tool-reference.md");

  assert.match(skill, /当用户说.*dynamic workflow.*script/);
  assert.match(createLoop, /动态 workflow script/);
  assert.match(createLoop, /脚本编排提示/);
  assert.match(defineRubric, /独立.*子 agent/);
  assert.match(executeLoop, /runtime script.*JavaScript 源码/);
  assert.match(toolReference, /字符串 `script`/);
});

test("loop skill does not route through a separate workflow chooser", async () => {
  const skill = await readFile(skillPath, "utf8");
  const createLoop = await readSkillFile("references/create-loop.md");

  assert.doesNotMatch(skill, /references\/choose-workflow\.md/);
  assert.doesNotMatch(skill, /选择 Workflow|workflow style|工作流风格/i);
  assert.doesNotMatch(createLoop, /workflow style|选择的 workflow style|工作流风格/i);
});

test("loop skill docs only describe the current runtime script workflow", async () => {
  const userFacingDocs = { "SKILL.md": await readFile(skillPath, "utf8") };
  for (const referencePath of requiredReferences) {
    userFacingDocs[referencePath] = await readSkillFile(referencePath);
  }

  for (const [docPath, content] of Object.entries(userFacingDocs)) {
    assert.doesNotMatch(content, /body\.steps/, `${docPath} must not mention body.steps`);
    assert.doesNotMatch(content, /script\.build/, `${docPath} must not mention script.build`);
    assert.doesNotMatch(content, /\blegacy\b/i, `${docPath} must not mention legacy workflow concepts`);
    assert.doesNotMatch(content, /\bcompatibility\b/i, `${docPath} must not mention compatibility workflow concepts`);
    assert.doesNotMatch(content, /兼容/, `${docPath} must not mention compatibility workflow concepts`);
    assert.doesNotMatch(content, /旧/, `${docPath} must not mention old workflow concepts`);
    assert.doesNotMatch(content, /静态/, `${docPath} must not mention static workflow concepts`);
  }
});

test("rubric guidance covers construction modes and evaluator fit", async () => {
  const defineRubric = await readSkillFile("references/define-rubric.md");

  for (const mode of ["strict-audit", "discovery-radar", "action-runner", "creative-output", "code-change"]) {
    assert.match(defineRubric, new RegExp(`\\b${mode}\\b`));
  }

  assert.match(defineRubric, /Rubric strategy|judgment mode/);
  assert.match(defineRubric, /not.*JSON `verification\.mode`|不是.*JSON.*`verification\.mode`/);
  assert.match(defineRubric, /workflow requirement/);
  assert.match(defineRubric, /rubric criterion/);
  assert.match(defineRubric, /validator evidence contract/);
  assert.match(defineRubric, /failure risks|失败风险/);

  assert.match(defineRubric, /Weak leads are allowed\. Miscalibrated certainty is not\./);
  assert.match(defineRubric, /no-confidence-inflation/);
  assert.match(defineRubric, /source-or-limitation-recorded/);
  assert.match(defineRubric, /fact-judgment-separated/);
  assert.match(defineRubric, /noise-not-promoted/);
  assert.match(defineRubric, /confirmed|已确认/);
  assert.match(defineRubric, /pending verification|待核验/);
  assert.match(defineRubric, /low confidence|低置信/);

  assert.match(defineRubric, /required fields|必填字段/);
  assert.match(defineRubric, /counts|数量/);
  assert.match(defineRubric, /cross-reference|交叉引用/);
  assert.match(defineRubric, /unsupported claims|无证据主张/);
  assert.match(defineRubric, /Do not use scripts[\s\S]*domain judgment|不要.*脚本.*领域判断/);
  assert.match(defineRubric, /scripts as the only validator|脚本.*唯一 validator/);
  assert.match(defineRubric, /hybrid verification|混合验证/);
});

test("create loop guidance describes clarification, creation, and preview handoff", async () => {
  const createLoop = await readSkillFile("references/create-loop.md");
  const defineRubric = await readSkillFile("references/define-rubric.md");

  assert.match(createLoop, /## (Creation Method|创建前方法)/);
  assert.match(createLoop, /Restate the inferred loop goal, boundary, trigger, and expected outputs|loop 目标、边界、触发方式和预期输出/);
  assert.match(createLoop, /Make reasonable defaults for low-risk details|低风险细节使用合理默认值/);
  assert.match(
    createLoop,
    /safety, permissions, cost, destructive actions, external side effects, project binding, or verification|安全、权限、成本、破坏性操作、外部副作用、项目绑定或验证/
  );
  assert.match(createLoop, /compact contract draft|紧凑合同草稿/);
  assert.doesNotMatch(createLoop, /```text\nRubric Draft\n/);
  assert.doesNotMatch(createLoop, /evaluator-builder subagent/);
  const rubricDraftMatch = defineRubric.match(/```text\nRubric Draft\n([\s\S]*?)\n```/);
  assert.ok(rubricDraftMatch, "expected rubric guidance to include a Rubric Draft text block");
  const rubricDraft = rubricDraftMatch[1];

  assert.match(rubricDraft, /- Must[:：]/);
  assert.match(rubricDraft, /- Should[:：]/);
  assert.match(rubricDraft, /- Validators[:：]/);
  assert.match(rubricDraft, /- Evidence[:：]/);
  assert.match(rubricDraft, /- Failure handling[:：].*(repair|修复).*(ask the user|询问用户).*(fail|失败)/);
  assert.match(defineRubric, /evaluator-builder subagent/);
  assert.match(defineRubric, /script evaluator/);
  assert.match(defineRubric, /self-check/);
  assert.match(defineRubric, /checksum/);
  assert.match(defineRubric, /verification_result_v1/);
  assert.match(createLoop, /get_preview_url/);
  assert.match(createLoop, /loopId/);
  assert.match(createLoop, /local DittosLoop board URL|本地 DittosLoop 看板 URL/);
  assert.match(createLoop, /local board URL could not be retrieved|无法取得本地看板 URL/);
});
