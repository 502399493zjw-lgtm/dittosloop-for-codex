import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, expect, test } from "vitest";

import {
  asAppleScriptString,
  buildTemplateLaunchShellCommand,
  shellQuote,
  startPreviewServer,
  type PreviewServer
} from "../src/previewServer.js";
import { LoopService, type LoopServiceOptions } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type { CodexSessionBridge, CodexSessionRef, CodexSessionRequest } from "../src/codex/sessionBridge.js";

const tempDirs: string[] = [];
const servers: PreviewServer[] = [];
const previewDir = join(dirname(fileURLToPath(import.meta.url)), "../../preview");

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(
  options: Partial<Pick<LoopServiceOptions, "codexProjects" | "createId" | "sessionBridge">> = {}
) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-preview-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-23T00:00:00.000Z",
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:0",
    ...options
  });
}

function createPendingSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
        createdAt: "2026-06-23T00:00:00.000Z",
        prompt: request.prompt,
        subagent: request.subagent,
        workflowRuntime: request.workflowRuntime,
        workflowContractId: request.workflowContractId,
        workflowPlan: request.workflowPlan
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult() {
      return undefined;
    }
  };

  return { bridge, requests };
}

async function createFormalLoop(
  service: LoopService,
  input: {
    title?: string;
    goal?: string;
  } = {}
) {
  const contract = await service.createLoopContract({
    title: input.title ?? "Code health",
    goal: input.goal ?? "Keep checks visible",
    body: {
      steps: [
        {
          id: "run-worker",
          kind: "agent",
          label: "Run worker",
          prompt: "Run the loop workflow."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "done",
          label: "Done",
          requirement: "The workflow result satisfies the loop goal.",
          severity: "must"
        }
      ]
    }
  });

  expect(contract.verification).toMatchObject({
    version: 2,
    validators: [expect.objectContaining({ type: "rubric_agent" })]
  });
  return contract;
}

test("serves the preview shell", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(server.url);
  const html = await response.text();

  expect(response.status).toBe(200);
  expect(html).toContain("DittosLoop For Codex");
  expect(html).toContain("Dittos.Loop");
  expect(html).toContain("Caveat:wght@600;700");
  expect(html).not.toContain("跟你一起");
  expect(html).toContain("id=\"loop-stage\"");
});

test("preview brand matches the Dittos.Loop wordmark treatment", async () => {
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(styles).toContain("--brand-pink: #e85a9e");
  expect(styles).toContain("color: var(--brand-pink)");
  expect(styles).toContain("font-family: Caveat");
});

test("preview script includes a real Live Loop directory view", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("renderLoopDirectory");
  expect(app).toContain("loadLoopFiles");
  expect(app).toContain("activeLoopTab = \"directory\"");
  expect(app).toContain("readRouteState");
  expect(app).toContain("directory-file-list");
  expect(app).toContain("/api/loops/");
  expect(app).toContain("/files");
  expect(app).not.toContain("function buildLoopDirectoryFiles");
  expect(app).not.toContain("function formalLoopDirectoryFiles");
  expect(app).not.toContain("formalWorkflowFlowFile");
  expect(app).not.toContain("compatibilityFlowFile");
  expect(app).not.toContain("context.codexApp.createThread(launch.launchRequest)");
});

test("preview script renders run detail as phase rail and agent cards", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("buildRunPhases");
  expect(app).toContain("selectedRunPhaseId");
  expect(app).toContain("renderAgentCard");
  expect(app).toContain("agent-card");
  expect(app).toContain("agent-avatar");
  expect(app).toContain("待手动启动");
  expect(app).toContain("threadId");
  expect(app).toContain("Codex worker 会话");
  expect(app).toContain("codexSessionRequestAgents");
  expect(app).toContain("codexWorkflowPlanAgents");
  expect(app).toContain("hasCodexThreadLink");
  expect(app).toContain("等待 Codex 宿主创建并回填真实新会话。");
  expect(app).toContain("status: hasThread ? run.codexSession.status : \"requested\"");
  expect(app).toContain("工作流计划");
  expect(app).toContain("hasWorkflowTimeline");
  expect(app).toContain("phaseDone");
  expect(app).toContain("timelineSectionAgents");
  expect(app).toContain("workflowTimelinePhases");
  expect(app).toContain("mergePhaseTimelineStatus");
  expect(app).toContain("workflowGroupId");
  expect(app).toContain("item.phaseId");
  expect(app).toContain("sessionFromTimelineItem");
  expect(app).toContain("session?.threadUrl");
  expect(app).toContain("timelineSectionStatus");
  expect(app).toContain("工作流阶段");
  expect(app).toContain("workflowOnlyMode");
  expect(app).toContain("workflowDisplayPhases");
  expect(app).toContain("shouldShowTimelineSectionAsPhase");
  expect(app).toContain("isWorkflowRuntimeSection");
  expect(app).toContain("phaseStatusDot");
  expect(app).not.toContain("name: section.title");
  expect(app).toContain("renderWorkflowRuntimePanel");
  expect(app).toContain("renderWorkflowRuntimePanel(detail, isDebugMode())");
  expect(app).toContain("function isDebugMode()");
  expect(app).toContain("detail.workflowContexts ?? []");
  expect(app).toContain("detail.workflowRevisions ?? []");
  expect(app).toContain("workflow-revisions");
  expect(app).toContain("Workflow attempt");
  expect(app).toContain("工作流草稿");
  expect(app).toContain("renderWorkflowTaskRun");
  expect(app).toContain("context.pendingSessionIds ?? []");
  expect(app).toContain("workflow-task-row");
  expect(app).toContain("workflow-pending-sessions");
  expect(app).toContain("subagent.tools?.length");
  expect(app).toContain("subagent.permissions?.filesystem");
  expect(app).toContain("subagent.workdir");
  expect(app).toContain("subagent.env");
  expect(app).toContain("subagent.timeoutMs");
  expect(app).toContain("subagent.context");
  expect(app).toContain("superseded: \"已替代\"");
  expect(app).not.toContain("阶段暂无 agent 明细");
});

test("preview script prefers canonical verification results and direct workflow output", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("canonicalVerificationAgents(detail.verificationResults)");
  expect(app).toContain("canonicalVerificationPhase(verificationAgents)");
  expect(app).toContain('section.id === "verification" && verificationAgents.length');
  expect(app).toContain("if (run.result) return run.result;");
  expect(app).toContain("return taskRuns.at(-1)?.result ?? run.summary ?? \"\";");
  expect(app).not.toContain("const explicit = run.result || run.summary;");
});

test("preview prefers workflowView for workflow phase display", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("workflowViewPhases(detail.workflowView");
  expect(app).toContain("workflowViewNodeAgent");
  expect(app).toContain("detail.workflowView?.nodes");
  expect(app).toContain("workflowViewStatus");
});

test("preview script references agent profile and preflight workflow metadata", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("formatAgentProfileMeta");
  expect(app).toContain("formatProfileSkills");
  expect(app).toContain("profileStatusMeta");
  expect(app).toContain("taskRun.agentProfile");
  expect(app).toContain("taskRun.profilePreflight");
  expect(app).toContain("subagent.agentProfile");
  expect(app).toContain("subagent.profilePreflight");
  expect(app).toContain("requiredSkills");
  expect(app).toContain("advisorySkills");
  expect(app).toContain("allowDegradedProfiles");
});

test("preview renders pipeline and human badges on workflow nodes", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).toContain("renderAgentBadges");
  expect(app).toContain("agent-badge pipeline");
  expect(app).toContain("agent-badge human");
  expect(app).toContain("管道");
  expect(app).toContain("人工");
  expect(app).toContain("item.pipeline === true");
  expect(app).toContain("item.human === true");
  expect(styles).toContain(".agent-badge");
  expect(styles).toContain(".agent-badge.pipeline");
  expect(styles).toContain(".agent-badge.human");
});

test("preview renders agent cards with minimal avatars and no diamond marker", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");
  const agentCardRule = styles.match(/\.agent-card \{[\s\S]*?\n\}/)?.[0] ?? "";

  expect(app).toContain("agent-avatar");
  expect(app).toContain("agent-main");
  expect(app).toContain("agentInitial(agent)");
  expect(app).not.toContain("agent-diamond");
  expect(styles).toContain(".agent-avatar");
  expect(styles).toContain(".agent-main");
  expect(styles).toContain("border: 1.5px solid var(--dittos-700)");
  expect(styles).toContain("background: transparent");
  expect(styles).toContain(".agent-card:not(:last-child)");
  expect(styles).toContain("border-bottom: 1px solid var(--hair)");
  expect(styles).not.toContain("margin: 7px 0 0 41px");
  expect(agentCardRule).toContain("border: 0");
  expect(agentCardRule).not.toContain("border-radius");
  expect(styles).not.toContain(".agent-diamond");
  expect(styles).not.toContain("box-shadow: 0 5px 18px rgba(107, 91, 208, 0.08)");
});

test("preview keeps run output out of the run detail board", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).not.toContain("renderSummaryOutput");
  expect(app).not.toContain("summary-output");
  expect(app).not.toContain("汇总输出");
  expect(styles).not.toContain("summary-output");
  expect(styles).not.toContain("summary-copy");
  expect(app).not.toContain("run.codexSession.subagents ?? []).map");
  expect(app).not.toContain("Codex subagent attempt");
  expect(app).not.toContain("timelineAgents = detail.events.map");
});

test("preview script includes codex session launch controls", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("copyLoopLaunchPrompt");
  expect(app).toContain("copyNewLoopPrompt");
  expect(app).toContain("copyText");
  expect(app).toContain("projectForLoop");
  expect(app).toContain("project?.name || project?.label");
  expect(app).toContain("project.name ?? project.label");
  expect(app).toContain("loop-project-group-title");
  expect(app).toContain("UNASSIGNED_PROJECT_LABEL = \"无项目\"");
  expect(app).toContain("closeCurrentLoopTab");
  expect(app).toContain("inactive-tab-title");
  expect(app).toContain("loopSelectionClosed = true");
  expect(app).toContain("updateWorkspaceState");
  expect(app).toContain("workspace-closed");
  expect(app).toContain("/codex-session");
  expect(app).toContain("/api/new-loop-session");
  expect(app).toContain("已复制成功，请打开 Codex 新会话粘贴构建。");
  expect(app).toContain("}, \"创建并复制启动请求\"),");
  expect(app).not.toContain("}, \"复制启动请求\"),");
  expect(app).toContain("已复制启动提示，请打开 Codex 新会话粘贴运行。");
  expect(app).toContain("sessionActionForRun");
  expect(app).toContain("window.__dittosloopLastLaunchPrompt");
  expect(app).toContain("launchRequest");
  expect(app).toContain("codexProjectId");
  expect(app).toContain("deleteLoop");
  expect(app).toContain("danger-button");
  expect(app).toContain("window.confirm");
  expect(app).not.toContain("创建 Codex 会话请求");
  expect(app).not.toContain("Codex App 创建");
  expect(app).not.toContain("dittosloop:create-codex-thread");
  expect(app).not.toContain("没有可用的 Codex App 项目");
  expect(app).not.toContain("projectChoices(currentSnapshot)[0]");
  expect(app).not.toContain("再次点击删除");
  expect(app).not.toContain("未连接 Codex 项目");
  expect(app).not.toContain("未关联会话");
  expect(app).not.toContain("待创建会话");
  expect(app).not.toContain("本轮剧本");
  expect(app).not.toContain("script-steps");
});

test("loop launch copy reuses an existing run prompt and reports failures with toast", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("copyLoopLaunchPrompt(loop)");
  expect(app).toContain("function existingLoopLaunch(loop)");
  expect(app).toContain("if (existingLaunch?.prompt)");
  expect(app).toContain("window.__dittosloopLastLaunchPrompt = existingLaunch.prompt");
  expect(app).toContain("showToast(\"已复制启动提示，请打开 Codex 新会话粘贴运行。\")");
  expect(app).toContain("showToast(`复制启动提示失败：${errorMessage(response,");
  expect(app).toContain("showToast(\"创建启动请求失败：预览服务已断开，请重新打开 DittosLoop 预览后再试。\", \"error\")");
  expect(app).toContain("showToast(\"读取运行详情失败：预览服务已断开，请重新打开 DittosLoop 预览后再试。\", \"error\")");
  expect(app).toContain("const copied = await copyText(launch.prompt)");
  expect(app).toContain("renderPromptNotice(\"已创建启动请求，但浏览器没有开放剪贴板。请手动复制下面的 prompt。\", launch.prompt)");
  const copyLaunchBody = app.slice(
    app.indexOf("async function copyLoopLaunchPrompt(loop)"),
    app.indexOf("function existingLoopLaunch(loop)")
  );
  expect(copyLaunchBody).not.toContain("writeRouteState(\"run\"");
  expect(copyLaunchBody).not.toContain("selectedRunId =");
  expect(copyLaunchBody).not.toContain("loadRunDetail(");
  expect(app).not.toContain("renderError(`Codex session request failed: ${response.status}`)");
  expect(app).not.toContain("renderNotice(\"已复制启动提示");
});

test("preview closes the workspace when all loop tabs are closed", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).toContain("const workspaceClosed = !selectedLoopId && !selectedRunId");
  expect(app).toContain("elements.shell?.classList.toggle(\"workspace-closed\", workspaceClosed)");
  expect(styles).toContain(".loop-shell.workspace-closed");
  expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(styles).toContain(".loop-shell.workspace-closed .loop-workspace");
  expect(styles).toContain("display: none");
});

test("preview keeps the workspace closed on initial history load", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("const route = readRouteState()");
  expect(app).toContain("route.runId");
  expect(app).not.toContain("selectedLoopId = newestLoopId(loops, runs)");
});

test("new loop prompt copy uses a centered toast without changing the workspace", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(app).toContain("showToast(\"已复制成功，请打开 Codex 新会话粘贴构建。\")");
  expect(app).toContain("function showToast(message, kind = \"success\")");
  expect(app).toContain("dittos-toast");
  expect(app).not.toContain("renderNotice(\"已复制新建循环提示词");
  expect(styles).toContain(".dittos-toast");
  expect(styles).toContain("position: fixed");
  expect(styles).toContain("top: 50%");
  expect(styles).toContain("left: 50%");
  expect(styles).toContain(".dittos-toast.error");
});

test("preview script includes templates gallery launch controls", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");
  const html = await readFile(join(previewDir, "index.html"), "utf8");
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(html).toContain("id=\"templates\"");
  expect(html).toContain("id=\"show-projects\"");
  expect(html).toContain("id=\"show-templates\"");
  expect(html).toContain("id=\"project-view\"");
  expect(html).toContain("id=\"template-view\"");
  expect(html).toContain("项目");
  expect(html).toContain("Loop示例");
  expect(html).not.toContain("模版");
  expect(app).toContain("renderTemplates");
  expect(app).toContain("setListView");
  expect(app).toContain("activeListView");
  expect(app).toContain("loopShell");
  expect(app).toContain("loopWorkspace");
  expect(app).toContain("classList.toggle(\"template-mode\", templatesActive)");
  expect(app).toContain("elements.loopWorkspace.hidden = templatesActive");
  expect(app).toContain("aria-hidden");
  expect(app).toContain("templateFilters");
  expect(app).toContain("activeTemplateCategory");
  expect(app).toContain("activeTemplateCadence");
  expect(app).toContain("filteredTemplates");
  expect(app).toContain("templateCategoryCounts");
  expect(app).toContain("template-filter-count");
  expect(app).toContain("data-template-category");
  expect(app).toContain("data-template-cadence");
  expect(app).toContain("/api/templates");
  expect(app).toContain("useTemplate");
  expect(app).toContain("用Loop示例");
  expect(app).toContain("templateToast");
  expect(app).toContain("renderTemplateNotice");
  expect(app).toContain("renderTemplateToast");
  expect(app).toContain("renderTemplateSource");
  expect(app).toContain("template-source-link");
  expect(app).toContain("window.setTimeout");
  expect(app).not.toContain("renderTemplateFeedback");
  expect(app).not.toContain("template-feedback");
  expect(styles).toContain(".template-toast");
  expect(styles).toContain(".template-source-link");
  expect(styles).toContain("top: 50%");
  expect(styles).toContain("left: 50%");
  expect(styles).toContain("translate(-50%, -50%)");
  expect(styles).toContain(".template-filter-count");
  expect(styles).not.toContain(".template-feedback");
  expect(app).toContain("正在生成Loop示例 prompt...");
  expect(app).toContain("/api/templates/${encodeURIComponent(template.id)}/prompt");
  expect(app).toContain("copyTemplatePrompt");
  expect(app).toContain("copyTemplatePromptWithSelection");
  expect(app).toContain("document.execCommand(\"copy\")");
  expect(app).toContain("navigator.clipboard.writeText");
  expect(app).not.toContain("template-prompt-copy");
  expect(app).not.toContain("templateToast.prompt");
  expect(app).not.toContain("launchMode: \"host\"");
  expect(app).not.toContain("__dittosloopTemplateLaunchRequest");
  expect(app).toContain("各类Loop示例");
  expect(app).toContain("Loop示例库");
  expect(app).toContain("正在读取Loop示例库...");
  expect(app).toContain("没有符合当前筛选的Loop示例。");
  expect(app).not.toContain("模版");
  expect(app).toContain("全部类型");
  expect(app).toContain("内容");
  expect(app).toContain("评估");
  expect(app).toContain("设计");
  expect(app).toContain("手动触发");
  expect(app).toContain("周期循环");
  expect(app).not.toContain("templateCadenceLabel");
  expect(app).not.toContain("el(\"span\", \"template-cadence\"");
  expect(app).toContain("已复制 prompt，可新开 Codex 会话粘贴。");
  expect(app).toContain("复制失败，请允许浏览器剪贴板权限后再试。");
  expect(app).not.toContain("请手动复制下面内容");
  expect(app).not.toContain("已在 Terminal 打开 Codex CLI 会话，建好后点刷新");
  expect(app).toContain("Template prompt request failed");
  expect(app).not.toContain("templates-header .project-picker");
});

test("preview templates view hides the right workspace panel", async () => {
  const styles = await readFile(join(previewDir, "styles.css"), "utf8");

  expect(styles).toContain(".loop-shell.template-mode");
  expect(styles).toContain("grid-template-columns: minmax(0, 1fr)");
  expect(styles).toContain(".loop-shell.template-mode .loop-workspace");
  expect(styles).toContain("display: none");
  expect(styles).toContain(".loop-shell.template-mode .template-grid");
});

test("preview file fallback explains templates need the local preview server", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("window.location.protocol === \"file:\"");
  expect(app).toContain("renderTemplates([], \"当前是离线文件预览，请从 DittosLoop 预览链接打开后读取Loop示例库。\")");
  expect(app).not.toContain("renderTemplates([]);");
});

test("preview shell uses the new loop button as a session launch action", async () => {
  const html = await readFile(join(previewDir, "index.html"), "utf8");

  expect(html).toContain("id=\"new-loop\"");
  expect(html).toContain("+ 新建循环");
  expect(html).not.toContain("id=\"refresh\"");
  expect(html).not.toContain("id=\"loop-group-label\"");
});

test("preview script keeps deep-linked run routes even before snapshot catches up", async () => {
  const app = await readFile(join(previewDir, "app.js"), "utf8");

  expect(app).toContain("selectedRunId = route.runId");
  expect(app).toContain("selectedLoopId = detail.loop.id");
  expect(app).toContain("const loop = loops.find((item) => item.id === selectedLoopId) ?? detail?.loop");
  expect(app).toContain("detail?.run?.loopId === loop.id");
});

test("serves the loop snapshot api", async () => {
  const service = await createService({
    codexProjects: [
      {
        id: "/Users/edisonzhong/Documents/dittos loop",
        name: "dittos loop",
        path: "/Users/edisonzhong/Documents/dittos loop"
      }
    ]
  });
  await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: { steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run npm test" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "tests", label: "Tests", requirement: "npm test passes", severity: "must" }]
    }
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/snapshot`);
  const snapshot = await response.json();

  expect(response.status).toBe(200);
  expect(snapshot).toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    codexProjects: [{ name: "dittos loop" }]
  });
});

test("falls back to an available preview port when the preferred port is busy", async () => {
  const busyServer = await reserveTcpPort();
  const busyAddress = busyServer.address();
  if (!busyAddress || typeof busyAddress !== "object") {
    throw new Error("Expected reserved test port");
  }

  try {
    const service = await createService();
    const server = await startPreviewServer({ service, staticDir: previewDir, port: busyAddress.port });
    servers.push(server);

    expect(server.port).not.toBe(busyAddress.port);

    const response = await fetch(`${server.url}/api/snapshot`);
    expect(response.status).toBe(200);
  } finally {
    await closeServer(busyServer);
  }
});

test("serves backend-rendered loop directory files api", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成 AI 开发工具中文日报",
    agentProfiles: {
      reporter: {
        id: "reporter",
        label: "Reporter",
        role: "report-writer",
        requiredSkills: [
          { id: "web.run" }
        ],
        advisorySkills: [
          { id: "rg" }
        ]
      }
    },
    body: {
      steps: [{ id: "write-report", kind: "task", runtime: "codex", label: "日报 worker", prompt: "生成中文日报。", agentProfileRef: "reporter" }]
    },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        {
          id: "daily-report",
          label: "中文日报",
          description: "输出中文日报。",
          severity: "must"
        }
      ],
      validators: [
        {
          id: "daily-report-review",
          type: "rubric_agent",
          label: "中文日报 review",
          criteriaIds: ["daily-report"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must"
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, {
    goal: "生成今天的中文日报",
    allowDegradedProfiles: true
  });
  await service.commitMemory(contract.id, { runId: run.id, summary: "保留昨天的来源筛选规则。" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${contract.id}/files`);
  const files = await response.json();

  expect(response.status).toBe(200);
  expect(files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "memory.md", kind: "memory", language: "markdown" }),
      expect.objectContaining({ path: "workflow.json", kind: "workflow", language: "json" }),
      expect.objectContaining({ path: "verification.md", kind: "verification", language: "markdown" }),
      expect.objectContaining({ path: "contract.json", kind: "contract", language: "json" })
    ])
  );
  const workflowFile = files.find((file: { path: string }) => file.path === "workflow.json");
  expect(workflowFile).toBeDefined();
  expect(JSON.parse(workflowFile.content)).toMatchObject({
    id: contract.id,
    agentProfiles: {
      reporter: {
        id: "reporter",
        label: "Reporter",
        role: "report-writer"
      }
    }
  });
  expect(files.find((file: { path: string }) => file.path === "memory.md").content).toContain("保留昨天的来源筛选规则。");
  expect(files.find((file: { path: string }) => file.path === "skill/dittosloop-for-codex-loop.md")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "runtime/dittosloop-for-codex-loop.md")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "flow.js")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "rubrics.md")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "agents.md")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "tool-list.md")).toBeUndefined();
  expect(files.find((file: { path: string }) => file.path === "session.json")).toBeUndefined();
});

test("serves the templates gallery api", async () => {
  const service = await createService();
  const templatesFile = await writeTemplatesFile([
    {
      id: "tests-green",
      title: "测试修绿",
      category: "engineering",
      cadence: "manual",
      desc: "把测试一路修到全过、lint 干净",
      trigger: "手动",
      checks: ["全部测试通过"],
      buildPrompt: "请用 DittosLoop For Codex 创建一个 loop。Title: 测试修绿。Trigger: manual。Verification checks: (1) 全部测试通过。请调用 create_loop。",
      source: {
        label: "awesome-agent-loops",
        url: "https://github.com/serenakeyitan/awesome-agent-loops"
      }
    }
  ]);
  const server = await startPreviewServer({ service, staticDir: previewDir, templatesFile, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/templates`);
  const templates = await response.json();

  expect(response.status).toBe(200);
  expect(templates).toEqual([
    expect.objectContaining({
      id: "tests-green",
      title: "测试修绿",
      category: "engineering",
      cadence: "manual",
      checks: ["全部测试通过"],
      buildPrompt: expect.stringContaining("create_loop"),
      source: {
        label: "awesome-agent-loops",
        url: "https://github.com/serenakeyitan/awesome-agent-loops"
      }
    })
  ]);
});

test("serves a template prompt api without launching a session", async () => {
  const service = await createService();
  const templatesFile = await writeTemplatesFile([
    {
      id: "tests-green",
      title: "测试修绿",
      category: "engineering",
      cadence: "manual",
      desc: "把测试一路修到全过、lint 干净",
      trigger: "手动",
      checks: ["全部测试通过"],
      buildPrompt: "请用 DittosLoop For Codex 创建一个 loop。Title: 测试修绿。Trigger: manual。Verification checks: (1) 全部测试通过。请调用 create_loop。"
    }
  ]);
  const server = await startPreviewServer({
    service,
    staticDir: previewDir,
    templatesFile,
    spawnProcess: () => {
      throw new Error("spawn should not be called for prompt generation");
    },
    port: 0
  });
  servers.push(server);

  const response = await fetch(`${server.url}/api/templates/tests-green/prompt`);
  const prompt = await response.json();

  expect(response.status).toBe(200);
  expect(prompt).toEqual({
    prompt: expect.stringContaining("Title: 测试修绿")
  });
});

test("bundled templates cover common categories and cadence modes", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    category?: string;
    cadence?: string;
  }>;

  expect(templates.length).toBeGreaterThanOrEqual(107);
  expect(new Set(templates.map((template) => template.category))).toEqual(
    new Set(["engineering", "product", "documentation", "operations", "personal", "research", "content", "evaluation", "design"])
  );
  expect(new Set(templates.map((template) => template.cadence))).toEqual(new Set(["manual", "event", "recurring"]));
  expect(templates.filter((template) => template.id?.startsWith("awesome-"))).toHaveLength(18);
  expect(templates.filter((template) => template.id?.startsWith("ff-"))).toHaveLength(64);
  expect(templates.map((template) => template.id)).toEqual(
    expect.arrayContaining([
      "awesome-kill-flaky-tests",
      "awesome-keep-docs-in-sync",
      "ff-overnight-docs-sweep",
      "ff-full-product-evaluation-loop"
    ])
  );
});

test("bundled templates include lightweight source metadata", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    source?: {
      label?: string;
      url?: string;
    };
  }>;

  const sourceById = new Map(templates.map((template) => [template.id, template.source]));

  expect(templates.every((template) => template.source?.label)).toBe(true);
  expect(sourceById.get("awesome-kill-flaky-tests")).toEqual({
    label: "awesome-agent-loops",
    url: "https://github.com/serenakeyitan/awesome-agent-loops"
  });
  expect(sourceById.get("ff-overnight-docs-sweep")).toEqual({
    label: "Forward-Future/loop-library",
    url: "https://github.com/Forward-Future/loop-library"
  });
  expect(sourceById.get("tests-green")).toEqual({
    label: "DittosLoop 内置"
  });
});

test("bundled template categories keep engineering workflows in engineering", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    category?: string;
  }>;
  const categoryById = new Map(templates.map((template) => [template.id, template.category]));
  const expectedCategories = new Map([
    ["pr-babysitter", "engineering"],
    ["release-readiness", "engineering"],
    ["awesome-babysit-a-pr", "engineering"],
    ["awesome-babysit-many-prs", "engineering"],
    ["awesome-wait-for-ci", "engineering"],
    ["awesome-ship-a-pr-until-green", "engineering"],
    ["awesome-keep-docs-in-sync", "engineering"],
    ["awesome-morning-issue-triage", "product"],
    ["ff-stale-safe-batch-release-loop", "engineering"],
    ["ff-production-data-cleanup-loop", "engineering"],
    ["ff-post-release-baseline-loop", "engineering"],
    ["ff-customer-ai-deployment-loop", "engineering"],
    ["ff-seo-geo-visibility-loop", "engineering"],
    ["ff-quality-streak-loop", "engineering"],
    ["ff-full-product-evaluation-loop", "engineering"],
    ["ff-boeing-747-benchmark", "engineering"],
    ["ff-war-loops-frontend-designer", "engineering"],
    ["ff-revolve-self-improvement-loop", "engineering"],
    ["ff-pixel-safe-css-trim-loop", "engineering"],
    ["ff-accessibility-repair-loop", "engineering"],
    ["ff-living-story-loop", "documentation"],
    ["ff-recovery-proof-loop", "engineering"]
  ]);

  const offenders = [...expectedCategories].flatMap(([id, expected]) => {
    const actual = categoryById.get(id);
    return actual === expected ? [] : [{ id, expected, actual }];
  });

  expect(offenders).toEqual([]);
});

test("bundled template cadence matches visible trigger copy", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    cadence?: string;
    trigger?: string;
  }>;

  const offenders = templates.filter(
    (template) =>
      (template.cadence === "manual" && template.trigger !== "手动") ||
      (template.cadence === "recurring" && template.trigger === "手动")
  );

  expect(offenders).toEqual([]);
});

test("bundled templates keep user-facing copy localized in Chinese", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    title?: string;
    desc?: string;
    trigger?: string;
    checks?: string[];
    buildPrompt?: string;
  }>;
  const englishStructurePattern =
    /\b(?:Title|Intent|Trigger|Verification checks|Original prompt|Use when):|^The .+ loop$|\b(?:A reusable|A bounded|A scheduled|A performance|A goal-based|A repeatable|A repository|A release|A production|A triggered|A supervised|A Claude|A vision|A prompt|A critic|A disposable|A thumbnail|A planning workflow|A browser-based|A web performance|A stylesheet|A first-time-user|An accessibility|A conservative|A controlled|A flaky-test|An evidence-driven|A recurring|A read-only|A disaster|A persistent|A safe Dependabot)\b|\b(?:Use this when|Use this for|Every |No |The final |Finish with |Return |Stop when|Never |Ask before|If |Do not )\b/;

  const offenders = templates
    .flatMap((template) => [
      ["title", template.title ?? ""],
      ["desc", template.desc ?? ""],
      ["trigger", template.trigger ?? ""],
      ...((template.checks ?? []).map((check, index) => [`checks[${index}]`, check] as const)),
      ["buildPrompt", template.buildPrompt ?? ""]
    ].map(([field, value]) => ({ id: template.id, field, value })))
    .filter(({ value }) => englishStructurePattern.test(value));

  expect(offenders).toEqual([]);
});

test("bundled templates do not expose generic fallback evidence checks", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    checks?: string[];
    buildPrompt?: string;
  }>;
  const fallbackChecks = [
    "按原始步骤记录证据；需要越权或高风险操作时暂停确认。",
    "高风险、生产、付费或权限动作前暂停确认",
    "按原始节奏完成一次检查或行动",
    "输出包含可复查的结果和下一步",
    "原始目标条件已经满足",
    "相关测试或检查已通过",
    "达到停止条件前不提前结束",
    "若信息不全，只追问安全关键缺项。"
  ];

  const offenders = templates
    .flatMap((template) => [
      ...((template.checks ?? []).map((check, index) => [`checks[${index}]`, check] as const)),
      ["buildPrompt", template.buildPrompt ?? ""]
    ].map(([field, value]) => ({ id: template.id, field, value })))
    .filter(({ value }) => fallbackChecks.some((fallbackCheck) => value.includes(fallbackCheck)));

  expect(offenders).toEqual([]);
});

test("bundled template prompts do not expose joined sentence punctuation", async () => {
  const templates = JSON.parse(await readFile(join(previewDir, "../templates/templates.json"), "utf8")) as Array<{
    id?: string;
    buildPrompt?: string;
  }>;

  const offenders = templates
    .map((template) => ({ id: template.id, value: template.buildPrompt ?? "" }))
    .filter(({ value }) => /。{2,}/.test(value));

  expect(offenders).toEqual([]);
});

test("launches a template as a visible codex terminal session on macOS", async () => {
  const service = await createService();
  const templatesFile = await writeTemplatesFile([
    {
      id: "quote-heavy",
      title: "带引号任务",
      category: "engineering",
      cadence: "manual",
      desc: "测试命令转义",
      trigger: "手动",
      checks: ["prompt 保持完整"],
      buildPrompt: "Title: 带引号任务。Intent: 处理 \"quote\" 和 \\ slash。Trigger: manual。Verification checks: (1) prompt 保持完整。请调用 create_loop。"
    }
  ]);
  const spawns: Array<{ command: string; args: string[]; options: unknown }> = [];
  const server = await startPreviewServer({
    service,
    staticDir: previewDir,
    templatesFile,
    platform: "darwin",
    spawnProcess: (command, args, options) => {
      spawns.push({ command, args, options });
      return { unref: () => undefined };
    },
    port: 0
  });
  servers.push(server);

  const response = await fetch(`${server.url}/api/templates/quote-heavy/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: "/tmp/it works" })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch).toEqual({ launched: true });
  expect(spawns).toHaveLength(1);
  expect(spawns[0]).toMatchObject({
    command: "osascript",
    args: [
      "-e",
      expect.stringContaining("tell application \"Terminal\" to do script")
    ]
  });
  expect(spawns[0].args[1]).toContain("cd '/tmp/it works' && codex");
  expect(spawns[0].args[1]).toContain("Title: 带引号任务");
  expect(spawns[0].args[1]).toContain("quote");
  expect(spawns[0].args[1]).toContain("slash");
});

test("returns a host-mediated template codex session request without opening Terminal", async () => {
  const service = await createService();
  const templatesFile = await writeTemplatesFile([
    {
      id: "host-open",
      title: "宿主打开",
      category: "engineering",
      cadence: "manual",
      desc: "交给 Codex App 打开",
      trigger: "手动",
      checks: ["返回 launchRequest"],
      buildPrompt: "Title: 宿主打开。Trigger: manual。Verification checks: (1) 返回 launchRequest。请调用 create_loop。"
    }
  ]);
  const server = await startPreviewServer({
    service,
    staticDir: previewDir,
    templatesFile,
    platform: "darwin",
    spawnProcess: () => {
      throw new Error("spawn should not be called for host launches");
    },
    port: 0
  });
  servers.push(server);

  const response = await fetch(`${server.url}/api/templates/host-open/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      launchMode: "host",
      codexProjectId: "/tmp/project",
      projectLabel: "project",
      projectPath: "/tmp/project"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch).toMatchObject({
    launched: false,
    prompt: expect.stringContaining("Title: 宿主打开"),
    launchRequest: {
      title: "DittosLoop: 宿主打开",
      prompt: expect.stringContaining("Title: 宿主打开"),
      workflowRuntime: "dittosloop-loop-creator",
      codexProjectId: "/tmp/project",
      projectLabel: "project",
      projectPath: "/tmp/project"
    }
  });
});

test("returns a copyable template prompt outside macOS", async () => {
  const service = await createService();
  const templatesFile = await writeTemplatesFile([
    {
      id: "manual-copy",
      title: "手动复制",
      category: "operations",
      cadence: "manual",
      desc: "非 macOS 降级",
      trigger: "手动",
      checks: ["返回 prompt"],
      buildPrompt: "Title: 手动复制。Trigger: manual。Verification checks: (1) 返回 prompt。请调用 create_loop。"
    }
  ]);
  const server = await startPreviewServer({
    service,
    staticDir: previewDir,
    templatesFile,
    platform: "linux",
    spawnProcess: () => {
      throw new Error("spawn should not be called");
    },
    port: 0
  });
  servers.push(server);

  const response = await fetch(`${server.url}/api/templates/manual-copy/launch`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projectPath: "/tmp/project" })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch).toEqual({
    launched: false,
    prompt: expect.stringContaining("Title: 手动复制")
  });
});

test("escapes template launch commands for Terminal", () => {
  const shellCommand = buildTemplateLaunchShellCommand(
    "/tmp/it's here",
    'Title: "quoted" \\ path $HOME `whoami`'
  );

  expect(shellCommand).toContain("cd '/tmp/it'\"'\"'s here' && codex");
  expect(shellCommand).toContain('Title: \\"quoted\\"');
  expect(shellCommand).toContain("\\\\ path");
  expect(shellCommand).toContain("\\$HOME");
  expect(shellCommand).toContain("\\`whoami\\`");
  expect(shellQuote("a'b")).toBe("'a'\"'\"'b'");
  expect(asAppleScriptString('say "hi" \\ ok')).toBe('"say \\"hi\\" \\\\ ok"');
});

test("creates a host-mediated new loop codex session request", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/new-loop-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch.launchRequest).toMatchObject({
    title: "DittosLoop: 新建 Live Loop",
    workflowRuntime: "dittosloop-loop-creator",
    projectLabel: "dittos loop"
  });
  expect(launch.prompt).toContain("create_loop_contract");
  expect(launch.prompt).toContain("workflow steps");
  expect(launch.prompt).toContain("criteria、validators、decision");
  expect(launch.prompt).toContain("task(runtime: \"codex\") / phase / parallel");
  expect(launch.prompt).not.toContain("agent / sequence / parallel");
});

test("deletes a loop from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "Daily code health check",
    goal: "Keep the project healthy"
  });
  const { run } = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${loop.id}`, { method: "DELETE" });
  const deleted = await response.json();

  expect(response.status).toBe(200);
  expect(deleted).toMatchObject({ id: loop.id, title: "Daily code health check" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [],
    runs: [],
    attempts: [],
    verificationResults: []
  });
});

test("serves composed run detail api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  const { run, attempt } = launch;
  await service.proposeWorkflowRevision(loop.id, {
    runId: run.id,
    attemptId: attempt.id,
    reason: "Add source scan",
    contract: {
      title: "Code health",
      goal: "Keep checks visible",
      body: {
        steps: [
          { id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." },
          { id: "scan-source", kind: "agent", label: "Scan source", prompt: "Check source links." }
        ]
      },
      verification: {
        mode: "after_workflow",
        rubrics: [
          {
            id: "done",
            label: "Done",
            requirement: "The workflow result satisfies the loop goal.",
            severity: "must"
          }
        ]
      }
    }
  });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail).toMatchObject({
    run: { id: run.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }],
    workflowContexts: [{ runId: run.id, status: "ready" }],
    workflowRevisions: [{ runId: run.id, status: "draft", reason: "Add source scan" }]
  });
});

test("serves workflow view from durable graph state in run detail api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail.workflowView).toMatchObject({
    version: 1,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    scheduler: { mode: "dual_write", runnableNodeIds: [] },
    progress: { total: 3, completed: 0, running: 0, waiting: 0, failed: 0 },
    nodes: [
      expect.objectContaining({ nodeId: "root", kind: "root", status: "pending" }),
      expect.objectContaining({ sourceStepId: "run-worker", kind: "task", status: "pending" }),
      expect.objectContaining({ nodeId: "root/verification", kind: "verification", status: "pending" })
    ]
  });
});

test("serves scheduler mode after durable graph execution in run detail api", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const counters = new Map<string, number>();
  const service = await createService({
    sessionBridge: bridge,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    }
  });
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}`);
  const detail = await response.json();

  expect(requests.map((request) => request.stepId)).toEqual(["run-worker"]);
  expect(response.status).toBe(200);
  expect(detail.workflowView).toMatchObject({
    runId: launch.run.id,
    scheduler: { mode: "scheduler", runnableNodeIds: [] },
    nodes: expect.arrayContaining([
      expect.objectContaining({ sourceStepId: "run-worker", kind: "task", status: "waiting_for_session" })
    ])
  });
});

test("serves workflow runtime detail for suspended tasks and promoted revisions", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const counters = new Map<string, number>();
  const service = await createService({
    sessionBridge: bridge,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    }
  });
  const contract = await service.createLoopContract({
    title: "Preview runtime",
    goal: "Show runtime state",
    body: {
      steps: [
        {
          id: "collect",
          kind: "task",
          runtime: "codex",
          label: "Collect",
          prompt: "Collect facts.",
          subagent: {
            ref: "researcher",
            tools: ["rg"],
            permissions: { filesystem: "workspace-write", network: "enabled" }
          }
        },
        { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write summary." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime is visible", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Preview suspended runtime" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const draft = await service.proposeWorkflowRevision(contract.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Add review step.",
    patch: {
      body: {
        steps: [
          { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect facts." },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write summary." },
          { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review summary." }
        ]
      }
    }
  });
  await service.promoteWorkflowRevision(contract.id, draft.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(requests.map((request) => request.stepId)).toEqual(["collect"]);
  expect(detail).toMatchObject({
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        status: "suspended",
        cursor: { state: "waiting_for_session", stepId: "collect", sessionId: "session_1" },
        pendingSessionIds: ["session_1"],
        taskRuns: [
          {
            id: "task_1",
            stepId: "collect",
            sessionId: "session_1",
            status: "suspended",
            subagent: {
              ref: "researcher",
              tools: ["rg"],
              permissions: { filesystem: "workspace-write", network: "enabled" }
            }
          }
        ]
      }
    ],
    workflowRevisions: [
      {
        id: draft.id,
        status: "promoted",
        reason: "Add review step."
      }
    ],
    workflowView: {
      scheduler: { mode: "scheduler" },
      nodes: expect.arrayContaining([
        expect.objectContaining({ sourceStepId: "collect", status: "waiting_for_session" })
      ])
    },
    engineEvents: [
      expect.objectContaining({ type: "agent_started", stepId: "collect" })
    ],
    timeline: [
      expect.objectContaining({
        id: "workflow",
        items: expect.arrayContaining([
          expect.objectContaining({ kind: "agent", label: "Collect", status: "started", stepId: "collect" })
        ])
      })
    ]
  });
});

test("serves engine events and grouped runtime timeline in run detail api", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual check" });
  await service.appendEvent(run.id, {
    message: "run_started",
    data: {
      engineEvent: {
        type: "run_started",
        runId: run.id,
        sequence: 1,
        createdAt: "2026-06-23T00:00:00.000Z"
      }
    }
  });
  await service.appendEvent(run.id, {
    message: "Agent started",
    data: {
      engineEvent: {
        type: "agent_started",
        runId: run.id,
        sequence: 2,
        createdAt: "2026-06-23T00:00:00.000Z",
        label: "Scan",
        stepId: "scan",
        prompt: "Scan updates"
      }
    }
  });
  await service.recordVerification(run.id, {
    status: "failed",
    summary: "Missing source",
    repair: true,
    checks: [{ name: "source", status: "failed", output: "No official source" }]
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail.engineEvents).toEqual([
    expect.objectContaining({ type: "run_started", sequence: 1 }),
    expect.objectContaining({ type: "agent_started", sequence: 2, label: "Scan" })
  ]);
  expect(detail.timeline).toEqual([
    expect.objectContaining({
      id: "workflow",
      title: "工作流",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "run", label: "开始运行", status: "started" }),
        expect.objectContaining({ kind: "agent", label: "Scan", status: "started" })
      ])
    }),
    expect.objectContaining({
      id: "verification",
      title: "验证",
      items: [expect.objectContaining({ kind: "verification", status: "failed", label: "Missing source" })]
    }),
    expect.objectContaining({
      id: "repair",
      title: "修复",
      items: [expect.objectContaining({ kind: "repair", label: "Missing source", status: "repairing" })]
    })
  ]);
});

test("serves formal engine event sections without invented verification records", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "Formal runtime",
    goal: "Run a formal workflow",
    body: {
      steps: [
        {
          id: "collect",
          kind: "phase",
          label: "Collect",
          children: [{ id: "agent-collect", kind: "agent", label: "Collector", prompt: "Collect facts" }]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "complete", label: "Complete", requirement: "Produce complete output", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual formal run" });
  const events = [
    {
      type: "run_started",
      runId: run.id,
      sequence: 1,
      createdAt: "2026-06-23T00:00:00.000Z"
    },
    {
      type: "phase_started",
      runId: run.id,
      sequence: 2,
      createdAt: "2026-06-23T00:01:00.000Z",
      phaseId: "collect",
      title: "Collect"
    },
    {
      type: "agent_done",
      runId: run.id,
      sequence: 3,
      createdAt: "2026-06-23T00:02:00.000Z",
      nodeId: "agent-collect",
      phaseId: "collect",
      label: "Collector",
      status: "ok",
      result: "Collected facts",
      session: {
        sessionId: "session_1",
        threadId: "thread_1",
        threadTitle: "DittosLoop: Collector",
        threadUrl: "codex://thread/thread_1"
      }
    },
    {
      type: "verification_started",
      runId: run.id,
      sequence: 4,
      createdAt: "2026-06-23T00:03:00.000Z",
      attemptId: "attempt_1"
    },
    {
      type: "verification_done",
      runId: run.id,
      sequence: 5,
      createdAt: "2026-06-23T00:04:00.000Z",
      attemptId: "attempt_1",
      decision: {
        status: "failed",
        summary: "Need stronger sources",
        checks: [{ rubricId: "complete", status: "failed", evidence: "No source links" }],
        repairInstructions: "Add source links"
      }
    },
    {
      type: "repair_started",
      runId: run.id,
      sequence: 6,
      createdAt: "2026-06-23T00:05:00.000Z",
      attemptId: "attempt_2",
      reason: "Add source links"
    },
    {
      type: "human_request",
      runId: run.id,
      sequence: 7,
      createdAt: "2026-06-23T00:06:00.000Z",
      question: "Should the run continue?"
    },
    {
      type: "run_done",
      runId: run.id,
      sequence: 8,
      createdAt: "2026-06-23T00:07:00.000Z",
      status: "waiting_for_human",
      summary: "Waiting for user input"
    }
  ];
  for (const event of events) {
    await service.appendEvent(run.id, { message: event.type, data: { engineEvent: event } });
  }
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();

  expect(response.status).toBe(200);
  expect(detail.verificationResults).toEqual([]);
  expect(detail.timeline).toEqual([
    expect.objectContaining({
      id: "workflow",
      title: "工作流",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "phase", label: "Collect", status: "started" }),
        expect.objectContaining({
          kind: "agent",
          label: "Collector",
          status: "completed",
          phaseId: "collect",
          message: "Collected facts",
          session: expect.objectContaining({
            sessionId: "session_1",
            threadUrl: "codex://thread/thread_1"
          })
        })
      ])
    }),
    expect.objectContaining({
      id: "verification",
      title: "验证",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "verification", label: "开始验证", status: "started" }),
        expect.objectContaining({ kind: "verification", label: "Need stronger sources", status: "failed", message: "Complete: failed - No source links" })
      ])
    }),
    expect.objectContaining({
      id: "repair",
      title: "修复",
      items: [expect.objectContaining({ kind: "repair", label: "Add source links", status: "repairing" })]
    }),
    expect.objectContaining({
      id: "human",
      title: "人工处理",
      items: [expect.objectContaining({ kind: "human", label: "Should the run continue?", status: "needs_human" })]
    }),
    expect.objectContaining({
      id: "run",
      title: "运行",
      items: [expect.objectContaining({ kind: "run", label: "Waiting for user input", status: "waiting_for_human" })]
    })
  ]);
});

test("serves verification v2 validator lifecycle events in the timeline", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "V2 preview",
    goal: "Render validator events",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Result meets the quality bar.", severity: "must" }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent",
          label: "Quality review",
          criteriaIds: ["quality"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must"
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual formal run" });
  const events = [
    {
      type: "validator_started",
      runId: run.id,
      sequence: 1,
      createdAt: "2026-06-23T00:01:00.000Z",
      attemptId: "attempt_1",
      validatorId: "quality-review",
      validatorType: "rubric_agent"
    },
    {
      type: "validator_done",
      runId: run.id,
      sequence: 2,
      createdAt: "2026-06-23T00:02:00.000Z",
      attemptId: "attempt_1",
      result: {
        id: "quality-review",
        type: "rubric_agent",
        label: "Quality review",
        status: "passed",
        criteriaIds: ["quality"],
        score: 1,
        evidence: "All quality criteria passed."
      }
    },
    {
      type: "verification_decided",
      runId: run.id,
      sequence: 3,
      createdAt: "2026-06-23T00:03:00.000Z",
      attemptId: "attempt_1",
      decision: {
        status: "passed",
        summary: "Verification passed",
        failedValidatorIds: [],
        needsHumanValidatorIds: [],
        failedCriterionIds: [],
        uncoveredMustCriterionIds: [],
        warnings: []
      }
    }
  ];
  for (const event of events) {
    await service.appendEvent(run.id, { message: event.type, data: { engineEvent: event } });
  }
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();
  const section = detail.timeline.find((candidate: { id: string }) => candidate.id === "verification");

  expect(response.status).toBe(200);
  expect(section.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Validator quality-review started", status: "started" }),
    expect.objectContaining({ label: "Quality review", status: "passed", message: "All quality criteria passed." }),
    expect.objectContaining({ label: "Verification passed", status: "passed" })
  ]));
});

test("serves persisted verification v2 results as fallback timeline evidence", async () => {
  const service = await createService();
  const contract = await service.createLoopContract({
    title: "V2 persisted preview",
    goal: "Render persisted validator evidence",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Result meets the quality bar.", severity: "must" }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent",
          label: "Quality review",
          criteriaIds: ["quality"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must"
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  });
  const { run } = await service.startCodexSessionRun(contract.id, { goal: "Manual formal run" });
  await (service as any).options.store.updateState((state: any) => ({
    ...state,
    verificationResults: [
      ...state.verificationResults,
      {
        id: "verification_v2_1",
        version: 2,
        runId: run.id,
        attemptId: "attempt_1",
        status: "passed",
        summary: "Verification passed.",
        checks: [{ rubricId: "quality", status: "passed", evidence: "Quality covered." }],
        validatorResults: [
          {
            id: "quality-review",
            type: "rubric_agent",
            label: "Quality review",
            status: "passed",
            criteriaIds: ["quality"],
            score: 1,
            evidence: "All quality criteria passed."
          }
        ],
        decision: {
          status: "passed",
          summary: "Verification passed",
          failedValidatorIds: [],
          needsHumanValidatorIds: [],
          failedCriterionIds: [],
          uncoveredMustCriterionIds: [],
          warnings: []
        },
        createdAt: "2026-06-23T00:03:00.000Z"
      }
    ]
  }));
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${run.id}`);
  const detail = await response.json();
  const section = detail.timeline.find((candidate: { id: string }) => candidate.id === "verification");

  expect(response.status).toBe(200);
  expect(section.items).toEqual(expect.arrayContaining([
    expect.objectContaining({ label: "Quality review", status: "passed", message: "All quality criteria passed." }),
    expect.objectContaining({ label: "Verification passed", status: "passed" })
  ]));
});

test("starts a codex session run from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${loop.id}/codex-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Check today updates",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch).toMatchObject({
    run: {
      loopId: loop.id,
      goal: "Check today updates",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop",
      codexSession: {
        mode: "new_session",
        status: "requested",
        codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
        projectLabel: "dittos loop"
      }
    },
    attempt: {
      status: "running"
    }
  });
  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    loopId: loop.id,
    title: "DittosLoop: AI Dev Tools Update Monitor",
    projectLabel: "dittos loop"
  });
  expect(launch.prompt).toContain("AI Dev Tools Update Monitor");
});

test("starts a projectless codex session run from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "Projectless update monitor",
    goal: "Watch release updates"
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/loops/${loop.id}/codex-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: "Check projectless updates"
    })
  });
  const launch = await response.json();

  expect(response.status).toBe(200);
  expect(launch.run).toMatchObject({
    loopId: loop.id,
    goal: "Check projectless updates",
    codexSession: {
      mode: "new_session",
      status: "requested"
    }
  });
  expect(launch.run).not.toHaveProperty("codexProjectId");
  expect(launch.run).not.toHaveProperty("projectLabel");
  expect(launch.run).not.toHaveProperty("projectPath");
  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    loopId: loop.id,
    title: "DittosLoop: Projectless update monitor"
  });
  expect(launch.launchRequest).not.toHaveProperty("codexProjectId");
  expect(launch.launchRequest).not.toHaveProperty("projectLabel");
  expect(launch.launchRequest).not.toHaveProperty("projectPath");
  expect(launch.prompt).toContain("Projectless update monitor");
});

test("records a codex thread from the preview api", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Check today updates" });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}/codex-thread`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
      threadTitle: "DittosLoop: AI Dev Tools Update Monitor"
    })
  });
  const run = await response.json();

  expect(response.status).toBe(200);
  expect(run).toMatchObject({
    id: launch.run.id,
    codexSession: {
      status: "started",
      threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
      threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
      subagents: [
        {
          status: "running",
          threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
        }
      ]
    }
  });
  expect(run.codexSession.threadUrl).toBeUndefined();
  expect(run.codexSession.subagents?.[0]?.threadUrl).toBeUndefined();

  const openResponse = await fetch(`${server.url}/api/runs/${launch.run.id}/open-codex-session`, {
    method: "POST"
  });
  const opened = await openResponse.json();

  expect(openResponse.status).toBe(200);
  expect(opened).toMatchObject({
    runId: launch.run.id,
    status: "unavailable",
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    launchRequest: {
      runId: launch.run.id,
      attemptId: launch.attempt.id,
      loopId: loop.id
    },
    recordThread: {
      tool: "record_codex_thread",
      runId: launch.run.id
    }
  });
  expect(opened.threadUrl).toBeUndefined();
  expect(opened.recordThread).not.toHaveProperty("threadUrlTemplate");
});

test("opens a codex session from the preview api when the host thread is attached", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates"
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Check today updates" });
  await service.recordCodexThread(launch.run.id, {
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/${launch.run.id}/open-codex-session`, {
    method: "POST"
  });
  const opened = await response.json();

  expect(response.status).toBe(200);
  expect(opened).toEqual({
    runId: launch.run.id,
    status: "ready",
    message: "Codex session is ready to open.",
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });
});

test("returns 404 for unknown run detail", async () => {
  const service = await createService();
  const server = await startPreviewServer({ service, staticDir: previewDir, port: 0 });
  servers.push(server);

  const response = await fetch(`${server.url}/api/runs/run_missing`);
  const body = await response.json();

  expect(response.status).toBe(404);
  expect(body).toEqual({ error: "Run not found: run_missing" });
});

async function writeTemplatesFile(templates: unknown[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-templates-"));
  tempDirs.push(dir);
  const file = join(dir, "templates.json");
  await writeFile(file, `${JSON.stringify(templates, null, 2)}\n`, "utf8");
  return file;
}

function reserveTcpPort(): Promise<Server> {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
