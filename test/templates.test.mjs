import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const templatesPath = path.join(repoRoot, "plugins/dittosloop-for-codex/templates/templates.json");
const previewAppPath = path.join(repoRoot, "plugins/dittosloop-for-codex/preview/app.js");

async function readTemplates() {
  return JSON.parse(await readFile(templatesPath, "utf8"));
}

async function readPreviewApp() {
  return readFile(previewAppPath, "utf8");
}

function byId(templates, id) {
  return templates.find((template) => template.id === id);
}

const expectedHookTemplates = [
  {
    id: "hook-session-brief",
    title: "会话启动简报",
    category: "operations",
    cadence: "event",
    trigger: "打开或恢复 AI 工作台时",
    desc: "每次打开或恢复 AI 工作台时输出日期、天气、日程和提醒",
    checks: [
      "无法读取日程时降级为时间、天气和提醒",
      "启动简报不阻塞会话",
      "外部日历连接失败时有明确说明"
    ],
    promptIncludes: ["日期", "天气", "日程", "提醒", "无法读取日程"]
  },
  {
    id: "hook-inbox-file-triage",
    title: "文件收件箱分诊",
    category: "operations",
    cadence: "event",
    trigger: "Inbox/Downloads 有新文件进入时",
    desc: "监听 Inbox/Downloads 新文件，识别类型并给出命名与归档建议，默认 dry-run",
    checks: [
      "等待文件写入完成后再分析",
      "默认只输出整理计划，不移动或删除文件",
      "移动、删除、重命名前必须先确认",
      "归档建议可追溯到文件类型或内容依据"
    ],
    promptIncludes: ["dry-run", "移动", "删除", "重命名", "确认"]
  },
  {
    id: "hook-long-session-break",
    title: "久坐提醒",
    category: "personal",
    cadence: "recurring",
    trigger: "AI 编程会话持续运行超过 60 分钟后每 60 分钟",
    desc: "AI 编程会话持续运行超过固定时长时提醒休息，不打断当前任务",
    checks: [
      "按固定间隔提醒",
      "不打断当前任务执行",
      "会话结束后停止提醒",
      "通知文案简短"
    ],
    promptIncludes: ["60 分钟", "不打断", "会话结束", "停止提醒"]
  },
  {
    id: "hook-task-completion-push",
    title: "长任务完成推送",
    category: "operations",
    cadence: "event",
    trigger: "长任务完成、失败或等待输入时",
    desc: "长任务完成、失败或等待输入时发送系统或手机通知，减少盯终端等待",
    checks: [
      "通知区分成功完成、执行失败和等待输入",
      "推送通道已用测试任务验证",
      "外部 webhook 或 Bark URL 不写入仓库",
      "失败原因可读"
    ],
    promptIncludes: ["成功完成", "执行失败", "等待输入", "Bark", "不写入仓库"]
  }
];

test("includes the selected Hook Engineering template cards", async () => {
  const templates = await readTemplates();

  for (const template of templates) {
    assert.match(template.buildPrompt, /\bcreate_loop_contract\b/, `${template.id} should use create_loop_contract`);
    assert.doesNotMatch(template.buildPrompt, /\bcreate_loop\b/, `${template.id} should use create_loop_contract`);
  }

  for (const expected of expectedHookTemplates) {
    const actual = byId(templates, expected.id);
    assert.ok(actual, `missing template ${expected.id}`);
    assert.equal(actual.title, expected.title);
    assert.equal(actual.category, expected.category);
    assert.equal(actual.cadence, expected.cadence);
    assert.equal(actual.trigger, expected.trigger);
    assert.equal(actual.desc, expected.desc);
    assert.deepEqual(actual.checks, expected.checks);
    assert.equal(actual.source?.label, "数字生命卡兹克");
    assert.equal(actual.source?.url, "https://x.com/khazix0918/status/2070403772703285575?s=46");
    assert.match(actual.buildPrompt, /请用 DittosLoop For Codex 创建一个循环/);
    assert.match(actual.buildPrompt, /请调用 create_loop_contract 创建该循环/);
    assert.match(actual.buildPrompt, /get_preview_url/);
    for (const phrase of expected.promptIncludes) {
      assert.match(actual.buildPrompt, new RegExp(phrase), `${expected.id} prompt should include ${phrase}`);
    }
  }
});

test("preview filters label the Hook template categories and cadences", async () => {
  const previewApp = await readPreviewApp();

  assert.match(previewApp, /\{\s*id:\s*"personal",\s*label:\s*"个人"\s*\}/);
  assert.match(previewApp, /\{\s*id:\s*"event",\s*label:\s*"事件触发"\s*\}/);
  assert.match(previewApp, /personal:\s*"个人"/);
});
