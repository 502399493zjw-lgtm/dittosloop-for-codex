const formatDate = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const UNASSIGNED_PROJECT_LABEL = "无项目";

const elements = {
  shell: document.querySelector(".loop-shell"),
  loopShell: document.querySelector(".loop-shell"),
  newLoop: document.querySelector("#new-loop"),
  showProjects: document.querySelector("#show-projects"),
  showTemplates: document.querySelector("#show-templates"),
  projectView: document.querySelector("#project-view"),
  templateView: document.querySelector("#template-view"),
  loopWorkspace: document.querySelector(".loop-workspace"),
  templates: document.querySelector("#templates"),
  loops: document.querySelector("#loops"),
  loopStage: document.querySelector("#loop-stage")
};

let selectedLoopId = null;
let selectedRunId = null;
let currentSnapshot = null;
let activeLoopTab = "history";
let selectedDirectoryPath = "memory.md";
const loopFilesById = new Map();
const loopFilesLoading = new Set();
const loopFilesErrors = new Map();
let selectedRunPhaseId = "attempts";
let loopSelectionClosed = false;
let observedHash = window.location.hash;
let currentTemplates = [];
let activeListView = "projects";
let activeTemplateCategory = "all";
let activeTemplateCadence = "all";
let templateToast = null;
let templateToastTimer = null;

const templateFilters = {
  categories: [
    { id: "all", label: "全部类型" },
    { id: "engineering", label: "工程" },
    { id: "product", label: "产品" },
    { id: "documentation", label: "文档" },
    { id: "operations", label: "运营" },
    { id: "research", label: "研究" },
    { id: "content", label: "内容" },
    { id: "evaluation", label: "评估" },
    { id: "design", label: "设计" }
  ],
  cadences: [
    { id: "all", label: "全部循环" },
    { id: "manual", label: "手动触发" },
    { id: "recurring", label: "周期循环" }
  ]
};

elements.newLoop.addEventListener("click", () => {
  void copyNewLoopPrompt();
});

elements.showProjects.addEventListener("click", () => {
  setListView("projects");
});

elements.showTemplates.addEventListener("click", () => {
  setListView("templates");
});

window.addEventListener("hashchange", syncRouteFromLocation);
window.addEventListener("popstate", syncRouteFromLocation);
window.setInterval(() => {
  if (window.location.hash !== observedHash) {
    syncRouteFromLocation();
  }
}, 200);

setListView(activeListView);

function setListView(view) {
  activeListView = view === "templates" ? "templates" : "projects";
  const templatesActive = activeListView === "templates";

  elements.loopShell.classList.toggle("template-mode", templatesActive);
  elements.loopWorkspace.hidden = templatesActive;
  elements.loopWorkspace.setAttribute("aria-hidden", String(templatesActive));
  elements.projectView.hidden = templatesActive;
  elements.templateView.hidden = !templatesActive;
  elements.projectView.classList.toggle("active", !templatesActive);
  elements.templateView.classList.toggle("active", templatesActive);
  elements.showProjects.classList.toggle("active", !templatesActive);
  elements.showTemplates.classList.toggle("active", templatesActive);
  elements.showProjects.setAttribute("aria-pressed", String(!templatesActive));
  elements.showTemplates.setAttribute("aria-pressed", String(templatesActive));
}

function syncRouteFromLocation() {
  observedHash = window.location.hash;
  if (!currentSnapshot) return;
  applyRouteState(currentSnapshot);
  render(currentSnapshot);
  if (selectedRunId) {
    void loadRunDetail(selectedRunId);
  } else {
    renderLoopStage({ snapshot: currentSnapshot });
  }
}

async function loadSnapshot() {
  renderLoading();

  try {
    const response = await fetch("/api/snapshot", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Snapshot request failed: ${response.status}`);
    }

    const snapshot = await response.json();
    currentSnapshot = snapshot;
    loopFilesById.clear();
    loopFilesErrors.clear();

    const loops = snapshot.loops ?? [];
    const runs = snapshot.runs ?? [];
    if (selectedLoopId && !loops.some((loop) => loop.id === selectedLoopId)) {
      selectedLoopId = null;
      selectedRunId = null;
    }

    const selectedRuns = runsForLoop(selectedLoopId, runs);
    if (selectedRunId && !selectedRuns.some((run) => run.id === selectedRunId)) {
      selectedRunId = null;
    }
    applyRouteState(snapshot);

    render(snapshot);
    await loadTemplates();

    if (selectedRunId) {
      await loadRunDetail(selectedRunId);
    } else {
      renderLoopStage({ snapshot });
    }
  } catch (error) {
    if (window.location.protocol === "file:") {
      const emptySnapshot = {
        loops: [],
        runs: [],
        attempts: [],
        events: [],
        verificationResults: [],
        humanRequests: [],
        memoryCommits: [],
        artifacts: []
      };
      currentSnapshot = emptySnapshot;
      selectedLoopId = null;
      selectedRunId = null;
      render(emptySnapshot);
      renderTemplates([], "当前是离线文件预览，请从 DittosLoop 预览链接打开后读取Loop示例库。");
      renderLoopStage({ snapshot: emptySnapshot });
      return;
    }
    renderError(error instanceof Error ? error.message : "Preview failed to load.");
  }
}

function render(snapshot) {
  const loops = snapshot.loops ?? [];
  const runs = snapshot.runs ?? [];
  const verificationResults = snapshot.verificationResults ?? [];
  const loopGroups = groupedLoopsByProject(snapshot, loops);

  updateWorkspaceState();
  elements.loops.replaceChildren(...renderLoopGroups(loopGroups, runs, verificationResults));
}

async function loadTemplates() {
  if (!elements.templates) return;

  try {
    const response = await fetch("/api/templates", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Templates request failed: ${response.status}`);
    }

    currentTemplates = await response.json();
    renderTemplates(currentTemplates);
  } catch (error) {
    currentTemplates = [];
    renderTemplates([], error instanceof Error ? error.message : "Loop示例库暂不可用。");
  }
}

function renderTemplates(templates = currentTemplates, errorMessage = "") {
  if (!elements.templates) return;

  if (!templates.some((template) => template.category === activeTemplateCategory)) {
    activeTemplateCategory = "all";
  }
  if (!templates.some((template) => template.cadence === activeTemplateCadence)) {
    activeTemplateCadence = "all";
  }

  const visibleTemplates = filteredTemplates(templates);
  const header = el("header", "templates-header", [
    el("div", "templates-title-block", [
      el("span", "templates-kicker", "Loop示例库"),
      el("strong", "", "各类Loop示例")
    ]),
    el("span", "templates-count", `${visibleTemplates.length}/${templates.length}`)
  ]);
  const filters = renderTemplateFilters(templates);

  if (errorMessage) {
    elements.templates.replaceChildren(
      header,
      el("div", "template-empty", errorMessage)
    );
    return;
  }

  if (!templates.length) {
    elements.templates.replaceChildren(
      header,
      el("div", "template-empty", "正在读取Loop示例库...")
    );
    return;
  }

  elements.templates.replaceChildren(
    ...[
      header,
      filters,
      visibleTemplates.length
        ? el("div", "template-grid", visibleTemplates.map((template) => renderTemplateCard(template)))
        : el("div", "template-empty", "没有符合当前筛选的Loop示例。")
    ].filter(Boolean)
  );
}

function renderTemplateNotice(message, options = {}) {
  renderTemplateToast(message, options);
}

function renderTemplateToast(message, options = {}) {
  const kind = options.kind ?? "info";
  const duration = options.duration ?? (kind === "info" ? 1800 : 2800);
  const toast = ensureTemplateToast();

  window.clearTimeout(templateToastTimer);
  toast.hidden = false;
  toast.className = `template-toast ${kind}`;
  toast.setAttribute("role", kind === "error" || kind === "warning" ? "alert" : "status");
  toast.textContent = message;
  toast.getBoundingClientRect();
  toast.classList.add("visible");

  if (duration > 0) {
    templateToastTimer = window.setTimeout(() => {
      toast.classList.remove("visible");
      templateToastTimer = window.setTimeout(() => {
        toast.hidden = true;
      }, 180);
    }, duration);
  }
}

function ensureTemplateToast() {
  if (templateToast) return templateToast;

  templateToast = el("div", "template-toast");
  templateToast.hidden = true;
  document.body.appendChild(templateToast);
  return templateToast;
}

function filteredTemplates(templates = currentTemplates) {
  return templates.filter((template) => {
    const categoryMatched = activeTemplateCategory === "all" || template.category === activeTemplateCategory;
    const cadenceMatched = activeTemplateCadence === "all" || template.cadence === activeTemplateCadence;
    return categoryMatched && cadenceMatched;
  });
}

function renderTemplateFilters(templates = currentTemplates) {
  const categoryCounts = templateCategoryCounts(templates);
  const categoryFilters = templateFilters.categories.filter((filter) => {
    return filter.id === "all" || categoryCounts.has(filter.id);
  });

  return el("div", "template-filters", [
    el("div", "template-filter-row", [
      el("span", "template-filter-label", "类型"),
      ...categoryFilters.map((filter) => renderTemplateFilterButton("category", filter, categoryCounts))
    ]),
    el("div", "template-filter-row", [
      el("span", "template-filter-label", "循环"),
      ...templateFilters.cadences.map((filter) => renderTemplateFilterButton("cadence", filter))
    ])
  ]);
}

function templateCategoryCounts(templates = currentTemplates) {
  const counts = new Map([["all", templates.length]]);
  for (const template of templates) {
    counts.set(template.category, (counts.get(template.category) ?? 0) + 1);
  }
  return counts;
}

function renderTemplateFilterButton(kind, filter, counts = null) {
  const active = kind === "category"
    ? activeTemplateCategory === filter.id
    : activeTemplateCadence === filter.id;
  const count = counts?.get(filter.id);
  const content = count === undefined
    ? filter.label
    : [
      el("span", "template-filter-text", filter.label),
      el("span", "template-filter-count", String(count))
    ];
  const filterButton = button(`template-filter-button ${active ? "active" : ""}`, () => {
    if (kind === "category") {
      activeTemplateCategory = filter.id;
    } else {
      activeTemplateCadence = filter.id;
    }
    renderTemplates();
  }, content);

  filterButton.setAttribute("aria-pressed", String(active));
  if (kind === "category") {
    filterButton.setAttribute("data-template-category", filter.id);
    filterButton.setAttribute("aria-label", `${filter.label}，${count ?? 0} 个Loop示例`);
  } else {
    filterButton.setAttribute("data-template-cadence", filter.id);
  }

  return filterButton;
}

function renderTemplateCard(template) {
  const card = el("article", "template-card", [
    el("div", "template-card-head", [
      el("span", "template-category", templateCategoryLabel(template.category)),
      el("span", "template-trigger", template.trigger)
    ]),
    el("div", "template-card-body", [
      el("h3", "", template.title),
      el("p", "template-card-desc", template.desc)
    ]),
    el("div", "template-card-foot", [
      renderTemplateSource(template),
      button("template-use-button", () => {
        void useTemplate(template);
      }, "用Loop示例")
    ])
  ]);
  card.setAttribute("data-template-category", template.category);
  card.setAttribute("data-template-cadence", template.cadence);
  return card;
}

function renderTemplateSource(template) {
  const label = template.source?.label;
  if (!label) return null;

  const sourceLabel = `来源 ${label}`;
  if (!template.source?.url) {
    return el("span", "template-source-text", sourceLabel);
  }

  const source = el("a", "template-source-link", sourceLabel);
  source.href = template.source.url;
  source.target = "_blank";
  source.rel = "noreferrer";
  source.setAttribute("aria-label", `打开来源 ${label}`);
  return source;
}

function templateCategoryLabel(category) {
  const labels = {
    engineering: "工程",
    operations: "运营",
    documentation: "文档",
    product: "产品",
    research: "研究",
    content: "内容",
    evaluation: "评估",
    design: "设计"
  };
  return labels[category] ?? category;
}

async function useTemplate(template) {
  renderTemplateNotice("正在生成Loop示例 prompt...", { kind: "info" });

  try {
    const response = await fetch(`/api/templates/${encodeURIComponent(template.id)}/prompt`, { cache: "no-store" });
    if (!response.ok) {
      console.error(`Template prompt request failed: ${response.status}`);
      renderTemplateNotice("Loop示例 prompt 生成失败，请刷新后再试。", { kind: "error" });
      return;
    }

    const { prompt } = await response.json();
    if (typeof prompt !== "string" || !prompt.trim()) {
      renderTemplateNotice("Loop示例 prompt 生成失败，请刷新后再试。", { kind: "error" });
      return;
    }

    if (await copyTemplatePrompt(prompt)) {
      renderTemplateNotice("已复制 prompt，可新开 Codex 会话粘贴。", { kind: "success" });
      return;
    }

    renderTemplateNotice("复制失败，请允许浏览器剪贴板权限后再试。", { kind: "warning" });
  } catch (error) {
    console.error(error);
    renderTemplateNotice("Loop示例 prompt 生成失败，请确认预览服务仍在运行。", { kind: "error" });
  }
}

async function copyTemplatePrompt(prompt) {
  if (!prompt) {
    return false;
  }

  if (copyTemplatePromptWithSelection(prompt)) {
    return true;
  }

  if (!navigator.clipboard?.writeText) {
    return false;
  }

  try {
    await navigator.clipboard.writeText(prompt);
    return true;
  } catch (error) {
    console.warn("Template prompt copy failed", error);
    return false;
  }
}

function copyTemplatePromptWithSelection(prompt) {
  if (!document.execCommand) {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = prompt;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, prompt.length);

  try {
    return document.execCommand("copy");
  } catch (error) {
    console.warn("Template prompt selection copy failed", error);
    return false;
  } finally {
    textarea.remove();
  }
}

async function loadRunDetail(runId) {
  const response = await fetch(`/api/runs/${encodeURIComponent(runId)}`, { cache: "no-store" });
  if (!response.ok) {
    renderError(`Run detail request failed: ${response.status}`);
    return;
  }

  const detail = await response.json();
  selectedRunId = detail.run.id;
  selectedLoopId = detail.loop.id;
  loopSelectionClosed = false;
  render(currentSnapshot);
  renderLoopStage({ snapshot: currentSnapshot, detail });
}

async function loadLoopFiles(loopId) {
  if (loopFilesLoading.has(loopId)) return;
  loopFilesLoading.add(loopId);
  loopFilesErrors.delete(loopId);

  try {
    const response = await fetch(`/api/loops/${encodeURIComponent(loopId)}/files`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Loop files request failed: ${response.status}`);
    }

    const files = await response.json();
    if (!Array.isArray(files)) {
      throw new Error("Loop files response was not a file list.");
    }

    loopFilesById.set(loopId, files.map(normalizeLoopFile).filter(Boolean));
  } catch (error) {
    loopFilesErrors.set(loopId, error instanceof Error ? error.message : "Loop files failed to load.");
  } finally {
    loopFilesLoading.delete(loopId);
    if (selectedLoopId === loopId && activeLoopTab === "directory") {
      renderLoopStage({ snapshot: currentSnapshot });
    }
  }
}

function normalizeLoopFile(file) {
  if (!file || typeof file.path !== "string") return null;
  return {
    path: file.path,
    kind: typeof file.kind === "string" ? file.kind : "contract",
    language: typeof file.language === "string" ? file.language : "json",
    content: typeof file.content === "string" ? file.content : JSON.stringify(file.content ?? null, null, 2),
    size: typeof file.size === "number" ? file.size : 0
  };
}

function renderLoopGroups(groups, runs, verificationResults) {
  if (groups.length === 0) {
    return [empty("还没有 Live Loop")];
  }

  return groups.flatMap((group) => [
    el("div", "loop-project-group-title", [
      el("span", "loop-project-group-dot", ""),
      el("span", "loop-project-group-name", group.label),
      el("span", "group-count", String(group.loops.length))
    ]),
    ...renderLoopRows(group.loops, runs, verificationResults)
  ]);
}

function renderLoopRows(loops, runs, verificationResults) {
  return loops.map((loop) => {
    const loopRuns = runsForLoop(loop.id, runs);
    const latestRun = loopRuns.at(-1);
    const latestVerification = latestRun
      ? [...verificationResults].reverse().find((result) => result.runId === latestRun.id)
      : null;
    const selected = loop.id === selectedLoopId;
    const row = button("loop-row", () => {
      selectedLoopId = loop.id;
      selectedRunId = null;
      loopSelectionClosed = false;
      activeLoopTab = "history";
      render(currentSnapshot);
      renderLoopStage({ snapshot: currentSnapshot });
    });
    if (selected) row.classList.add("selected");
    if (latestRun?.status === "running") row.classList.add("running");

    row.replaceChildren(
      el("span", "state-dot", ""),
      el("div", "loop-row-copy", [
        el("span", "loop-name", loop.title),
        el("p", "loop-description", loop.intent),
        el("div", "loop-row-meta", [
          el("span", "mono", `${loopRuns.length} runs`),
          el("span", "divider", "·"),
          statusChip(latestRun?.status ?? loop.status),
          latestVerification ? statusChip(latestVerification.status) : null
        ])
      ]),
      el("span", `row-toggle ${latestRun?.status === "running" ? "on running" : "on"}`, ""),
      el("span", "chevron", "›")
    );
    return row;
  });
}

function groupedLoopsByProject(snapshot, loops) {
  const groups = new Map();
  for (const loop of loops) {
    const label = loopProjectLabel(loop, snapshot) ?? UNASSIGNED_PROJECT_LABEL;
    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(loop);
  }

  const projectOrder = projectChoices(snapshot).map((project) => project.name);
  return [...groups.entries()]
    .sort(([left], [right]) => {
      const leftIndex = projectOrder.indexOf(left);
      const rightIndex = projectOrder.indexOf(right);
      if (leftIndex !== -1 || rightIndex !== -1) {
        if (leftIndex === -1) return 1;
        if (rightIndex === -1) return -1;
        return leftIndex - rightIndex;
      }
      if (left === UNASSIGNED_PROJECT_LABEL) return 1;
      if (right === UNASSIGNED_PROJECT_LABEL) return -1;
      return left.localeCompare(right);
    })
    .map(([label, groupLoops]) => ({ label, loops: groupLoops }));
}

function renderLoopStage({ snapshot, detail }) {
  if (!snapshot) return;
  updateWorkspaceState();

  const loops = snapshot.loops ?? [];
  const runs = snapshot.runs ?? [];
  const verificationResults = snapshot.verificationResults ?? [];
  const humanRequests = snapshot.humanRequests ?? [];
  const loop = loops.find((item) => item.id === selectedLoopId);

  if (!loop) {
    elements.loopStage.replaceChildren(empty("选择一个 Live Loop 查看运行记录。"));
    return;
  }

  const loopRuns = [...runsForLoop(loop.id, runs)].reverse();
  const checks = loop.verification?.checks ?? [];

  if (detail && selectedRunId) {
    renderRunBoard({ detail, loop, loopRuns });
    return;
  }

  elements.loopStage.replaceChildren(...[
    el("div", "tab-strip", [
      el("div", "active-tab", [
        inlineIcon("gear"),
        el("span", "tab-title", loop.title),
        button("tab-close-button", closeCurrentLoopTab, "×")
      ])
    ]),
    el("header", "stage-header", [
      el("div", "stage-title-block", [
        el("h2", "", loop.title),
        el("p", "", loop.intent)
      ]),
      el("div", "stage-actions", [
        statusChip(loop.status),
        el("span", "run-count-label", `已执行 ${loopRuns.length} 次`),
        el("span", "toggle on", "")
      ])
    ]),
    el("section", "trigger-line", [
      el("span", "trigger-copy", [
        el("span", "", "触发："),
        el("strong", "", "手动"),
        checks.length ? el("span", "trigger-note", ` · ${checks.length} 个验证点`) : null
      ]),
      el("span", "trigger-actions", [
        button("ghost-button launch-button", () => {
          void copyLoopLaunchPrompt(loop);
        }, "复制启动请求"),
        button("danger-button", () => {
          void deleteLoop(loop);
        }, "删除")
      ].filter(Boolean))
    ]),
    renderLoopTabs(),
    activeLoopTab === "directory"
      ? renderLoopDirectory({ loop, loopRuns })
      : el("section", "history-panel", [
          ...renderHistoryRows(loopRuns, verificationResults, humanRequests)
        ])
  ].flat().filter(Boolean));
}

function closeCurrentLoopTab() {
  selectedLoopId = null;
  selectedRunId = null;
  loopSelectionClosed = true;
  activeLoopTab = "history";
  if (window.location.hash) {
    window.history.replaceState(null, "", window.location.pathname);
    observedHash = window.location.hash;
  }
  render(currentSnapshot);
  renderLoopStage({ snapshot: currentSnapshot });
}

function updateWorkspaceState() {
  const workspaceClosed = !selectedLoopId && !selectedRunId;
  elements.shell?.classList.toggle("workspace-closed", workspaceClosed);
}

function projectChoices(snapshot) {
  const projects = snapshot?.codexProjects ?? [];
  return projects
    .filter((project) => project?.id && (project?.name || project?.label) && project?.path)
    .map((project) => ({
      id: project.id,
      name: project.name ?? project.label,
      path: project.path
    }));
}

function loopProjectLabel(loop, snapshot) {
  if (!loop) return null;
  const projects = projectChoices(snapshot);
  const project = projects.find((candidate) => {
    return candidate.id === loop.codexProjectId || candidate.path === loop.projectPath;
  });
  if (project) return project.name;

  const labelOnlyProject = projects.find((candidate) => candidate.name === loop.projectLabel);
  return labelOnlyProject?.name ?? null;
}

function projectForLoop(snapshot, loop) {
  const projects = projectChoices(snapshot);
  if (!loop) return null;

  return projects.find((project) => {
    return project.id === loop.codexProjectId || project.path === loop.projectPath || project.name === loop.projectLabel;
  }) ?? null;
}

async function copyNewLoopPrompt() {
  const response = await fetch("/api/new-loop-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({})
  });
  if (!response.ok) {
    showToast(`复制构建提示失败：${errorMessage(response, "请稍后重试。")}`, "error");
    return;
  }

  const launch = await response.json();
  window.__dittosloopNewLoopPrompt = launch.prompt;
  await copyText(launch.prompt);
  showToast("已复制成功，请打开 Codex 新会话粘贴构建。");
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the legacy textarea path when the embedded browser denies clipboard access.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function copyLoopLaunchPrompt(loop) {
  const existingLaunch = existingLoopLaunch(loop);
  if (existingLaunch?.prompt) {
    window.__dittosloopLastLaunchRequest = existingLaunch.launchRequest;
    window.__dittosloopLastLaunchPrompt = existingLaunch.prompt;
    await copyText(existingLaunch.prompt);
    selectedRunId = existingLaunch.run.id;
    selectedLoopId = existingLaunch.run.loopId;
    activeLoopTab = "history";
    writeRouteState("run", selectedRunId);
    await loadRunDetail(existingLaunch.run.id);
    showToast("已复制启动提示，请打开 Codex 新会话粘贴运行。");
    return;
  }

  const response = await fetch(`/api/loops/${encodeURIComponent(loop.id)}/codex-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: loop.intent
    })
  });
  if (!response.ok) {
    showToast(`复制启动提示失败：${errorMessage(response, "请稍后重试。")}`, "error");
    return;
  }

  const launch = await response.json();
  window.__dittosloopLastLaunchRequest = launch.launchRequest;
  window.__dittosloopLastLaunchPrompt = launch.prompt;
  await copyText(launch.prompt);
  selectedRunId = launch.run.id;
  selectedLoopId = launch.run.loopId;
  activeLoopTab = "history";
  writeRouteState("run", selectedRunId);
  await loadSnapshot();
  showToast("已复制启动提示，请打开 Codex 新会话粘贴运行。");
}

function existingLoopLaunch(loop) {
  if (!currentSnapshot || !loop?.id) return null;

  const runs = runsForLoop(loop.id, currentSnapshot.runs ?? []);
  const loopState = (currentSnapshot.loopStates ?? []).find((state) => state.loopId === loop.id);
  const activeRun = runs.find((run) => run.id === loopState?.activeRunId && run.codexSession?.prompt);
  const reusableRun = activeRun ?? [...runs].reverse().find((run) => (
    run.codexSession?.prompt && !isTerminalRunStatus(run.status)
  ));
  if (!reusableRun?.codexSession?.prompt) return null;

  const attempts = (currentSnapshot.attempts ?? []).filter((attempt) => attempt.runId === reusableRun.id);
  const attempt = [...attempts].reverse().find((candidate) => candidate.status === "running") ?? attempts.at(-1);
  const contexts = (currentSnapshot.workflowContexts ?? []).filter((context) => context.runId === reusableRun.id);
  const context = attempt
    ? [...contexts].reverse().find((candidate) => candidate.attemptId === attempt.id) ?? contexts.at(-1)
    : contexts.at(-1);
  const project = {
    codexProjectId: reusableRun.codexProjectId ?? reusableRun.codexSession.codexProjectId,
    projectLabel: reusableRun.projectLabel ?? reusableRun.codexSession.projectLabel,
    projectPath: reusableRun.projectPath ?? reusableRun.codexSession.projectPath
  };
  const launchRequest = {
    runId: reusableRun.id,
    attemptId: attempt?.id,
    workflowContextId: context?.id,
    loopId: reusableRun.loopId,
    title: `DittosLoop: ${loop.title}`,
    prompt: reusableRun.codexSession.prompt,
    workflowRuntime: context ? "dittosloop-local-workflow" : undefined,
    workflowContractId: context?.contractId,
    ...project
  };

  return {
    run: reusableRun,
    prompt: reusableRun.codexSession.prompt,
    launchRequest
  };
}

function isTerminalRunStatus(status) {
  return ["completed", "failed", "cancelled", "canceled"].includes(timelineStatus(status));
}

function errorMessage(response, fallback = "请稍后重试。") {
  if (!response) return fallback;
  const status = response.status ? `${response.status}` : "";
  const statusText = response.statusText ? ` ${response.statusText}` : "";
  return `${status}${statusText}`.trim() || fallback;
}

async function deleteLoop(loop) {
  const confirmed = typeof window.confirm === "function"
    ? window.confirm(`删除「${loop.title}」及其所有运行记录？`)
    : true;
  if (!confirmed) {
    return;
  }

  const response = await fetch(`/api/loops/${encodeURIComponent(loop.id)}`, { method: "DELETE" });
  if (!response.ok) {
    renderError(`Delete loop request failed: ${response.status}`);
    return;
  }

  if (selectedLoopId === loop.id) {
    selectedLoopId = null;
    selectedRunId = null;
    activeLoopTab = "history";
    writeRouteState("history");
  }
  await loadSnapshot();
}

function renderLoopTabs() {
  return el("nav", "stage-tabs", [
    button(`stage-tab ${activeLoopTab === "history" ? "active" : ""}`, () => {
      activeLoopTab = "history";
      selectedRunId = null;
      writeRouteState("history");
      renderLoopStage({ snapshot: currentSnapshot });
    }, "历史活动"),
    button(`stage-tab ${activeLoopTab === "directory" ? "active" : ""}`, () => {
      activeLoopTab = "directory";
      selectedRunId = null;
      writeRouteState("directory");
      renderLoopStage({ snapshot: currentSnapshot });
    }, "Live Loop 目录")
  ]);
}

function renderLoopDirectory({ loop, loopRuns }) {
  const latestRun = loopRuns.at(0);
  const files = loopFilesById.get(loop.id);
  const error = loopFilesErrors.get(loop.id);

  if (!files && !error) {
    void loadLoopFiles(loop.id);
    return el("section", "directory-browser", [
      renderDirectoryFileList({ files: [], selectedPath: null }),
      el("div", "directory-file-view", [
        el("header", "directory-file-head", [
          el("span", "directory-path", "Live Loop 目录"),
          el("span", "directory-spacer", ""),
          el("span", "directory-sync-note", "正在读取目录")
        ]),
        el("div", "directory-empty", "正在读取 Live Loop 目录。")
      ])
    ]);
  }

  if (error) {
    return el("section", "directory-browser", [
      renderDirectoryFileList({ files: [], selectedPath: null }),
      el("div", "directory-file-view", [
        el("header", "directory-file-head", [
          el("span", "directory-path", "Live Loop 目录"),
          el("span", "directory-spacer", ""),
          button("ghost-button", () => {
            void loadLoopFiles(loop.id);
          }, "重试")
        ]),
        el("div", "directory-empty", error)
      ])
    ]);
  }

  const selected = files.find((file) => file.path === selectedDirectoryPath) ?? files[0];
  selectedDirectoryPath = selected?.path ?? "memory.md";

  return el("section", "directory-browser", [
    renderDirectoryFileList({ files, selectedPath: selected?.path }),
    el("div", "directory-file-view", [
      el("header", "directory-file-head", [
        el("span", "directory-path", selected?.path ?? "Live Loop 目录"),
        selected ? el("span", "directory-file-type", fileMeta(selected)) : null,
        el("span", "directory-spacer", ""),
        latestRun ? el("span", "directory-sync-note", `最近 run ${formatDate.format(new Date(latestRun.createdAt))}`) : null
      ]),
      selected
        ? el("pre", "directory-code", [el("code", "", selected.content)])
        : el("div", "directory-empty", "选择一个文件查看内容。")
    ])
  ]);
}

function renderDirectoryFileList({ files, selectedPath }) {
  const folders = new Map();
  const renderedFolders = new Set();
  for (const file of files) {
    const [folder, name] = file.path.split("/");
    if (!name) continue;
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push({ ...file, displayName: name });
  }

  const renderFileButton = (file, extraClass = "", displayName = file.path) =>
    button(`directory-file ${extraClass} ${file.path === selectedPath ? "active" : ""}`, () => {
      selectedDirectoryPath = file.path;
      renderLoopStage({ snapshot: currentSnapshot });
    }, [
      inlineIcon(file.language === "markdown" ? "fileText" : "fileCode"),
      el("span", "directory-file-name", displayName),
      el("span", "directory-file-meta", fileMeta(file))
    ]);

  return el("aside", "directory-file-list", [
    el("div", "directory-file-root", [
      inlineIcon("folder"),
      el("span", "", "Live Loop")
    ]),
    el("div", "directory-files", files.flatMap((file) => {
      const [folder, name] = file.path.split("/");
      if (!name) return [renderFileButton(file)];
      if (renderedFolders.has(folder)) return [];
      renderedFolders.add(folder);
      const children = folders.get(folder) ?? [];
      return [
        el("div", "directory-folder-group", [
          el("div", "directory-folder-row", [
            inlineIcon("folder"),
            el("span", "directory-file-name", folder)
          ]),
          el("div", "directory-folder-files", children.map((child) =>
            renderFileButton(child, "nested", child.displayName)
          ))
        ])
      ];
    }))
  ]);
}

function fileMeta(file) {
  if (file.language === "javascript") return "JS";
  if (file.language === "markdown") return "MD";
  if (file.language === "json") return "JSON";
  return (file.kind ?? "FILE").toUpperCase();
}

function renderHistoryRows(runs, verificationResults, humanRequests) {
  if (runs.length === 0) {
    return [empty("还没有运行记录。")];
  }

  return runs.map((run) => {
    const verification = [...verificationResults].reverse().find((result) => result.runId === run.id);
    const humanRequest = humanRequests.find((request) => request.runId === run.id && request.status !== "resolved");
    const openRun = () => {
      selectedRunId = run.id;
      writeRouteState("run", run.id);
      void loadRunDetail(run.id);
    };
    const row = el("div", "history-row");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.addEventListener("click", openRun);
    row.addEventListener("keydown", (event) => {
      if (event.target !== row) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openRun();
    });

    row.replaceChildren(
      el("span", "history-time", formatDate.format(new Date(run.createdAt))),
      el("span", "history-trigger", [inlineIcon("bolt"), el("span", "", run.trigger)]),
      el("span", "history-status", [
        el("span", `tiny-dot ${run.status}`, ""),
        el("span", "", statusText(run.status)),
        verification ? el("b", "", `· ${statusText(verification.status)}`) : null,
        humanRequest ? el("b", "", "· 等待你") : null
      ]),
      el("span", "history-actions", [
        sessionActionForRun(run, "history-session-button", "history-session-state"),
        el("span", "open-run", "看 run ›")
      ])
    );
    return row;
  });
}

function renderRunBoard({ detail, loop, loopRuns }) {
  const run = detail.run;
  const runIndex = Math.max(1, [...loopRuns].reverse().findIndex((item) => item.id === run.id) + 1);
  const activeHumanRequest = detail.humanRequests.find((request) => request.status !== "resolved");
  const phases = buildRunPhases(detail);
  if (!phases.some((phase) => phase.id === selectedRunPhaseId)) {
    selectedRunPhaseId = phases[0]?.id ?? "attempts";
  }
  const activePhase = phases.find((phase) => phase.id === selectedRunPhaseId) ?? phases[0];
  const total = phases.length;
  const done = phases.filter((phase) => phaseDone(phase.status)).length;

  elements.loopStage.replaceChildren(...[
    el("div", "tab-strip run-tabs", [
      el("div", "inactive-tab", [
        button("inactive-tab-title", () => {
          selectedRunId = null;
          writeRouteState("history");
          renderLoopStage({ snapshot: currentSnapshot });
        }, [el("span", "tab-title", loop.title)]),
        button("tab-close-button", closeCurrentLoopTab, "×")
      ]),
      el("div", "active-tab run-tab", [
        el("span", "", `第 ${runIndex} 轮`),
        el("span", "tab-time", formatClock(new Date(run.createdAt))),
        button("tab-close-button", () => {
          selectedRunId = null;
          writeRouteState("history");
          renderLoopStage({ snapshot: currentSnapshot });
        }, "×")
      ])
    ]),
    el("header", "run-board-header", [
      el("div", "run-title-block", [
        el("span", "run-breadcrumb", loop.title),
        el("h2", "", `第 ${runIndex} 轮`)
      ]),
      el("span", `run-status ${run.status}`, [
        el("span", `tiny-dot ${run.status}`, ""),
        el("span", "", `${statusText(run.status)} ${done}/${total}`)
      ]),
      run.codexSession?.threadUrl
        ? openSessionButtonForRun(run.id, "打开会话")
        : sessionActionForRun(run)
    ]),
    el("div", "run-meta-line", [
      inlineIcon("bolt"),
      el("span", "", run.trigger),
      el("span", "divider", "·"),
      el("span", "", formatClock(new Date(run.createdAt))),
      run.goal ? el("span", "divider", "·") : null,
      run.goal ? el("span", "run-input-label", run.goal) : null
    ]),
    activeHumanRequest
      ? el("section", "approval-band", [
          statusChip("open"),
          el("p", "", activeHumanRequest.question)
        ])
      : null,
    renderWorkflowRuntimePanel(detail, isDebugMode()),
    el("section", "run-board-body", [
      el("aside", "phase-rail", [
        el("div", "phase-rail-title", "工作流阶段"),
        ...phases.map((phase) =>
          button(`phase-step ${phase.status} ${phase.id === selectedRunPhaseId ? "focused" : ""}`, () => {
            selectedRunPhaseId = phase.id;
            renderRunBoard({ detail, loop, loopRuns });
          }, [
            phaseStatusDot(phase.status),
            el("span", "phase-copy", phase.name)
          ])
        )
      ]),
      el("div", "phase-detail", activePhase && activePhase.agents.length ? [
        el("section", "phase-agent-group", [
          el("div", "phase-group-label", activePhase.name),
          ...activePhase.agents.map((agent) => renderAgentCard(agent))
        ])
      ] : [el("p", "detail-empty", "当前运行没有可展示的 agent 明细。")])
    ])
  ].filter(Boolean));
}

function renderWorkflowRuntimePanel(detail, showDebug) {
  if (!showDebug) return null;

  const workflowContexts = detail.workflowContexts ?? [];
  const workflowRevisions = detail.workflowRevisions ?? [];
  if (!workflowContexts.length && !workflowRevisions.length) return null;

  return el("section", "workflow-runtime-panel", [
    el("div", "workflow-runtime-heading", [
      el("span", "detail-kicker", "Local workflow"),
      el("strong", "", "动态工作流状态")
    ]),
    el("div", "workflow-runtime-grid", [
      workflowContexts.length
        ? el("div", "workflow-runtime-card workflow-contexts", [
            el("h3", "", "Workflow attempt"),
            ...workflowContexts.map(renderWorkflowContextRow)
          ])
        : null,
      workflowRevisions.length
        ? el("div", "workflow-runtime-card workflow-revisions", [
            el("h3", "", "工作流草稿"),
            ...workflowRevisions.map(renderWorkflowRevisionRow)
          ])
        : null
    ])
  ]);
}

function isDebugMode() {
  return new URLSearchParams(window.location.search).get("debug") === "1";
}

function renderWorkflowContextRow(context) {
  const taskRuns = context.taskRuns ?? [];
  const completedTasks = taskRuns.filter((task) => task.status === "completed").length;
  const pendingSessions = context.pendingSessionIds ?? [];
  const cursor = context.cursor ?? {};
  const cursorLabel = [cursor.state, cursor.stepId, cursor.sessionId].filter(Boolean).join(" · ");

  return el("div", "workflow-context-block", [
    el("div", "workflow-runtime-row", [
      statusChip(context.status),
      el("div", "workflow-runtime-copy", [
        el("p", "", cursorLabel || context.id),
        el(
          "span",
          "detail-meta",
          `${completedTasks}/${taskRuns.length} tasks · ${context.attemptId}` +
            (pendingSessions.length ? ` · pending ${pendingSessions.join(", ")}` : "")
        )
      ])
    ]),
    taskRuns.length
      ? el("div", "workflow-task-list", taskRuns.map(renderWorkflowTaskRun))
      : el("div", "workflow-task-empty detail-meta", "暂无 task run"),
    pendingSessions.length
      ? el("div", "workflow-pending-sessions detail-meta", `Pending sessions: ${pendingSessions.join(", ")}`)
      : null
  ]);
}

function renderWorkflowTaskRun(taskRun) {
  const title = taskRun.label || taskRun.stepId || taskRun.id;
  const sessionLabel = taskRun.sessionId ? `session ${taskRun.sessionId}` : "session pending";
  const meta = [taskRun.id, taskRun.stepId, taskRun.phaseId, sessionLabel].filter(Boolean).join(" · ");
  const result = taskRun.result || taskRun.error;
  const subagent = taskRun.subagent;
  const subagentMeta = formatSubagentMeta(subagent);

  return el("div", "workflow-task-row", [
    statusChip(taskRun.status),
    el("div", "workflow-runtime-copy", [
      el("p", "", title),
      el("span", "detail-meta", meta),
      subagentMeta ? el("span", "detail-meta", subagentMeta) : null,
      result ? el("span", "workflow-task-result", result) : null
    ])
  ]);
}

function renderWorkflowRevisionRow(revision) {
  return el("div", "workflow-runtime-row", [
    statusChip(revision.status),
    el("div", "workflow-runtime-copy", [
      el("p", "", revision.reason || revision.contract?.title || revision.id),
      el("span", "detail-meta", revision.rejectionReason
        ? `${revision.id} · ${revision.rejectionReason}`
        : revision.id)
    ])
  ]);
}

function buildRunPhases(detail) {
  const run = detail.run;
  const hasWorkflowTimeline = (detail.timeline ?? []).some((section) => section.id === "workflow");
  const workflowOnlyMode = hasWorkflowTimeline;
  const sessionAgents = !workflowOnlyMode && run.codexSession ? codexSessionRequestAgents(run) : [];
  const workflowPlanAgents = run.codexSession && !hasWorkflowTimeline ? codexWorkflowPlanAgents(run) : [];
  const attemptAgents = detail.attempts
    .filter(() => !workflowOnlyMode && !run.codexSession)
    .map((attempt) => ({
    id: attempt.id,
    avatar: "流",
    name: "工作流执行",
    status: attempt.status,
    description: attempt.summary ?? attempt.id,
    meta: attempt.completedAt ? formatDate.format(new Date(attempt.completedAt)) : "运行中",
    showSessionLink: false
  }));
  const verificationAgents = detail.verificationResults.map((result) => ({
    id: result.id,
    avatar: result.status === "failed" ? "!" : "验",
    name: "验证结果",
    status: result.status,
    description: result.summary,
    meta: result.attemptId ? `Attempt ${result.attemptId}` : "Run level"
  }));
  const phases = [];
  const startAgents = [...sessionAgents, ...attemptAgents];

  if (startAgents.length) {
    phases.push({
      id: "attempts",
      name: "启动执行",
      status: agentsStatus(startAgents, run.status),
      agents: startAgents
    });
  }

  if (workflowPlanAgents.length) {
    phases.push({
      id: "workflow-plan",
      name: "工作流计划",
      status: agentsStatus(workflowPlanAgents, run.status),
      agents: workflowPlanAgents
    });
  }

  for (const section of detail.timeline ?? []) {
    const sectionPhases = isWorkflowRuntimeSection(section)
      ? workflowDisplayPhases(section, run.status)
      : shouldShowTimelineSectionAsPhase(section, workflowOnlyMode)
        ? [timelineSectionPhase(section, run.status)].filter(Boolean)
        : [];
    phases.push(...sectionPhases);
  }

  if (!phases.some((phase) => phase.id === "verification") && verificationAgents.length) {
    phases.push({
      id: "verification",
      name: "验证",
      status: verificationAgents.some((agent) => agent.status === "failed") ? "failed" : "passed",
      agents: verificationAgents
    });
  }

  if (!phases.length) {
    phases.push({
      id: "timeline",
      name: "时间线",
      status: run.status,
      agents: buildPreviewTimelineAgents(detail)
    });
  }

  return phases;
}

function codexSessionRequestAgents(run) {
  return [
    {
      id: `${run.id}-current-session`,
      avatar: "会",
      name: "Codex worker 会话",
      status: run.codexSession.threadId ? "completed" : run.codexSession.status,
      description: run.codexSession.threadId
        ? "已关联真实 Codex worker 会话，可打开查看运行结果。"
        : "启动提示已复制，等待在 Codex 新会话中粘贴运行。",
      meta: "host-mediated session",
      threadId: run.codexSession.threadId,
      threadTitle: run.codexSession.threadTitle,
      threadUrl: run.codexSession.threadUrl
    }
  ];
}

function codexWorkflowPlanAgents(run) {
  const subagents = Array.isArray(run.codexSession?.subagents) ? run.codexSession.subagents : [];
  return subagents.map((subagent, index) => ({
    id: `${run.id}-session-subagent-${index}`,
    name: subagent.role,
    status: subagent.status === "requested" && run.codexSession.status !== "requested"
      ? run.codexSession.status
      : subagent.status,
    description: subagent.threadId
      ? "点击查看这一步的实际运行结果。"
      : "已纳入本次 Codex worker 的 workflow 计划，等待会话接管执行。",
    meta: subagent.phaseId
      ? `phase ${subagent.phaseId}`
      : (subagent.threadTitle || formatSubagentMeta(subagent.subagent) || "workflow agent"),
    threadId: subagent.threadId ?? run.codexSession.threadId,
    threadTitle: subagent.threadTitle ?? run.codexSession.threadTitle,
    threadUrl: subagent.threadUrl ?? run.codexSession.threadUrl,
    showSessionLink: subagent.threadUrl || run.codexSession.threadUrl ? undefined : false
  }));
}

function formatSubagentMeta(subagent) {
  const envMeta = subagent?.env ? formatKeyValueMeta(subagent.env) : "";
  const contextMeta = subagent?.context ? formatKeyValueMeta(subagent.context) : "";
  return subagent
    ? [
        subagent.ref,
        subagent.role,
        subagent.model,
        subagent.tools?.length ? `tools ${subagent.tools.join(", ")}` : null,
        subagent.workdir ? `cwd ${subagent.workdir}` : null,
        envMeta ? `env ${envMeta}` : null,
        subagent.permissions?.filesystem ? `fs ${subagent.permissions.filesystem}` : null,
        subagent.permissions?.network ? `net ${subagent.permissions.network}` : null,
        subagent.timeoutMs ? `timeout ${subagent.timeoutMs}ms` : null,
        contextMeta ? `ctx ${contextMeta}` : null
      ].filter(Boolean).join(" · ")
    : "";
}

function formatKeyValueMeta(value) {
  return Object.entries(value)
    .map(([key, entry]) => `${key}=${formatMetaValue(entry)}`)
    .join(", ");
}

function formatMetaValue(value) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null) return "null";
  return JSON.stringify(value);
}

function timelineSectionPhase(section, fallbackStatus) {
  const agents = timelineSectionAgents(section);
  if (!agents.length) return null;
  return {
    id: section.id,
    name: timelineSectionLabel(section),
    status: timelineSectionStatus(section, fallbackStatus),
    agents
  };
}

function workflowDisplayPhases(section, fallbackStatus) {
  return workflowTimelinePhases(section, fallbackStatus);
}

function shouldShowTimelineSectionAsPhase(section, workflowOnlyMode) {
  if (isWorkflowRuntimeSection(section)) return false;
  if (workflowOnlyMode) return section.id === "verification";
  return true;
}

function isWorkflowRuntimeSection(section) {
  return section.id === "workflow";
}

function timelineSectionLabel(section) {
  if (section.id === "verification") return "验证";
  if (section.id === "repair") return "修复";
  if (section.id === "human") return "人工确认";
  return section.title || section.id;
}

function workflowTimelinePhases(section, fallbackStatus) {
  const items = compactTimelineItems(section.items ?? []);
  const phaseOrder = [];
  const phaseMap = new Map();

  for (const item of items) {
    if (item.kind !== "agent") continue;
    const stage = workflowAgentStage(item, phaseMap.size);
    let phase = phaseMap.get(stage.id);
    if (!phase) {
      phase = {
        id: stage.id,
        name: stage.name,
        status: timelineStatus(item.status),
        agents: []
      };
      phaseMap.set(stage.id, phase);
      phaseOrder.push(stage.id);
    } else {
      phase.status = mergePhaseTimelineStatus(phase.status, item.status);
    }
    phase.agents.push(timelineItemAgent(section, item, phase.agents.length));
  }

  const phases = phaseOrder
    .map((phaseId) => phaseMap.get(phaseId))
    .filter((phase) => phase.agents.length);

  if (phases.length) {
    return phases.map((phase) => ({
      ...phase,
      status: agentsStatus(phase.agents, phase.status)
    }));
  }

  return workflowMarkerPhases(section, fallbackStatus);
}

function workflowAgentStage(item, fallbackIndex) {
  const label = item.label ?? "";
  const stepId = item.stepId ?? "";
  const phaseId = item.phaseId ?? "";
  const haystack = `${stepId} ${phaseId} ${label}`.toLowerCase();
  if (haystack.includes("orchestr") || label.includes("编排") || label.includes("计划")) {
    return { id: "workflow-orchestrate", name: "编排计划" };
  }
  if (haystack.includes("observer") || label.includes("观察")) {
    return { id: "workflow-observe", name: "并行观察" };
  }
  if (haystack.includes("editor") || haystack.includes("writer") || label.includes("编辑") || label.includes("撰写") || label.includes("日报")) {
    return { id: "workflow-edit", name: "产出编辑" };
  }
  if (haystack.includes("review") || haystack.includes("verify") || label.includes("核对") || label.includes("复核") || label.includes("验证")) {
    return { id: "workflow-review", name: "核对验证" };
  }
  const idSeed = item.phaseId ?? item.stepId ?? label ?? `agent-${fallbackIndex}`;
  return { id: `workflow-${slugifyId(idSeed)}`, name: label || "工作流执行" };
}

function workflowMarkerPhases(section, fallbackStatus) {
  const phases = [];
  const items = compactTimelineItems(section.items ?? []);

  for (const item of items) {
    if (item.kind !== "phase" && item.kind !== "parallel") continue;
    const phaseId = workflowGroupId(item, phases.length);
    phases.push({
      id: `workflow-${phaseId}`,
      name: item.label || "工作流阶段",
      status: timelineStatus(item.status),
      agents: [timelineItemAgent(section, item, phases.length)]
    });
  }

  return phases.length ? phases : [{
    id: "workflow-runtime",
    name: "工作流执行",
    status: fallbackStatus,
    agents: []
  }];
}

function workflowGroupId(item, fallbackIndex) {
  if (item.stepId) return item.stepId;
  if (item.phaseId) return item.phaseId;
  if (item.kind === "parallel" && item.label) return `parallel-${slugifyId(item.label)}`;
  return `${item.kind}-${item.sequence ?? fallbackIndex}`;
}

function slugifyId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "") || "group";
}

function timelineSectionAgents(section) {
  return compactTimelineItems(section.items ?? []).map((item, index) => timelineItemAgent(section, item, index));
}

function timelineItemAgent(section, item, index) {
  const session = sessionFromTimelineItem(item);
  return {
    id: `${section.id}-${item.kind}-${item.stepId ?? item.sequence ?? index}`,
    avatar: timelineAvatar(item.kind),
    name: item.label,
    status: timelineStatus(item.status),
    description: item.message,
    meta: item.createdAt ? `${section.title} · ${formatDate.format(new Date(item.createdAt))}` : section.title,
    threadId: session?.threadId,
    threadTitle: session?.threadTitle,
    threadUrl: session?.threadUrl,
    showSessionLink: item.kind === "agent" && session?.threadUrl ? undefined : false
  };
}

function mergeTimelineStatus(current, next) {
  return agentsStatus([{ status: current }, { status: next }], next);
}

function mergePhaseTimelineStatus(current, nextRaw) {
  const next = timelineStatus(nextRaw);
  if (["completed", "passed", "failed", "skipped"].includes(next)) return next;
  return mergeTimelineStatus(current, next);
}

function agentsStatus(agents, fallbackStatus) {
  const statuses = agents.map((agent) => timelineStatus(agent.status));
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("repairing")) return "repairing";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("requested") || statuses.includes("open") || statuses.includes("suspended")) return "requested";
  if (statuses.length && statuses.every((status) => ["completed", "passed", "skipped"].includes(status))) {
    return statuses.includes("passed") ? "passed" : "completed";
  }
  if (statuses.includes("passed")) return "passed";
  if (statuses.includes("completed")) return "completed";
  return fallbackStatus;
}

function timelineSectionStatus(section, fallbackStatus) {
  const items = compactTimelineItems(section.items ?? []);
  const finalItem = [...items].reverse().find((item) => ["completed", "passed", "failed", "skipped"].includes(timelineStatus(item.status)));
  if (finalItem) return timelineStatus(finalItem.status);
  return agentsStatus(items, fallbackStatus);
}

function buildPreviewTimelineAgents(detail) {
  const run = detail.run;
  if (run.codexSession) {
    return buildCodexSessionTimelineAgents(detail);
  }

  const sections = detail.timeline ?? [];
  const items = sections.flatMap((section) => section.items.map((item) => ({ ...item, section: section.title })));
  if (!items.length) {
    return [{
      id: `${run.id}-run`,
      avatar: "流",
      name: "Run",
      status: run.status,
      description: run.goal,
      meta: formatDate.format(new Date(run.createdAt))
    }];
  }

  return compactTimelineItems(items).map((item, index) => ({
    id: `${item.section}-${item.kind}-${item.sequence ?? index}`,
    avatar: timelineAvatar(item.kind),
    name: item.label,
    status: timelineStatus(item.status),
    description: item.message,
    meta: item.createdAt ? `${item.section} · ${formatDate.format(new Date(item.createdAt))}` : item.section
  }));
}

function buildCodexSessionTimelineAgents(detail) {
  const run = detail.run;
  const agents = [
    {
      id: `${run.id}-session`,
      avatar: "启",
      name: "启动 Codex 会话",
      status: run.codexSession.threadId ? "completed" : run.codexSession.status,
      description: run.codexSession.threadId
        ? "真实 Codex worker session 已创建并关联。"
        : "启动提示已复制，等待在 Codex 新会话中粘贴运行。",
      meta: formatDate.format(new Date(run.createdAt)),
      threadId: run.codexSession.threadId,
      threadTitle: run.codexSession.threadTitle,
      threadUrl: run.codexSession.threadUrl
    }
  ];

  const engineEvents = detail.engineEvents ?? [];
  if (engineEvents.length) {
    agents.push(...workflowAgentCards(detail));
  } else if (Array.isArray(run.codexSession.subagents) && run.codexSession.subagents.length) {
    agents.push(...codexWorkflowPlanAgents(run));
  }

  const latestVerification = detail.verificationResults.at(-1);
  if (latestVerification) {
    agents.push({
      id: latestVerification.id,
      avatar: "验",
      name: "验证结果",
      status: latestVerification.status,
      description: latestVerification.summary,
      meta: latestVerification.createdAt ? formatDate.format(new Date(latestVerification.createdAt)) : "verification"
    });
  }

  const userNotes = detail.events.filter(isUserFacingTimelineNote);
  for (const note of userNotes.slice(-3)) {
    agents.push({
      id: note.id,
      avatar: "记",
      name: "记录",
      status: run.status,
      description: note.message,
      meta: formatDate.format(new Date(note.createdAt))
    });
  }

  return agents;
}

function workflowAgentCards(detail) {
  const items = (detail.timeline ?? [])
    .filter((section) => section.id === "workflow")
    .flatMap((section) => section.items)
    .filter((item) => item.kind === "agent");

  return compactTimelineItems(items).map((item, index) => {
    const session = sessionFromTimelineItem(item);
    return {
      id: `${item.stepId ?? "agent"}-${item.sequence ?? index}`,
      avatar: "代",
      name: item.label,
      status: timelineStatus(item.status),
      description: item.message,
      meta: item.createdAt ? formatDate.format(new Date(item.createdAt)) : "workflow agent",
      threadId: session?.threadId,
      threadTitle: session?.threadTitle,
      threadUrl: session?.threadUrl,
      showSessionLink: session?.threadUrl ? undefined : false
    };
  });
}

function sessionFromTimelineItem(item) {
  const session = item?.session;
  if (!session || typeof session !== "object") return null;
  return session;
}

function compactTimelineItems(items) {
  const completedAgents = new Set(
    items
      .filter((item) => item.kind === "agent" && item.status === "completed" && item.stepId)
      .map((item) => item.stepId)
  );
  return items.filter((item) => !(item.kind === "agent" && item.status === "started" && completedAgents.has(item.stepId)));
}

function isUserFacingTimelineNote(event) {
  if (event.kind !== "note") return false;
  if (event.data?.codexThread || event.data?.engineEvent || event.data?.output || event.data?.contractId) return false;
  return !/^Workflow (run_|agent )/.test(event.message);
}

function timelineAvatar(kind) {
  const avatars = {
    run: "流",
    phase: "段",
    agent: "代",
    parallel: "并",
    verification: "验",
    repair: "修",
    human: "问"
  };
  return avatars[kind] ?? "记";
}

function timelineStatus(status) {
  const aliases = {
    started: "running",
    needed: "repairing",
    needs_human: "waiting_for_human"
  };
  return aliases[status] ?? status;
}

function phaseDone(status) {
  return ["completed", "passed", "failed", "skipped"].includes(timelineStatus(status));
}

function renderAgentCard(agent) {
  const sessionLabel = agent.threadTitle ?? (agent.threadId ? shortThreadId(agent.threadId) : "待手动启动");
  const card = el("div", `agent-card ${agent.threadUrl ? "has-session" : ""}`, [
    el("div", "agent-card-row", [
      el("span", "agent-avatar", agentInitial(agent)),
      el("div", "agent-main", [
        el("span", "agent-name", agent.name),
        agent.description ? el("p", "agent-description", agent.description) : null,
        agent.meta ? el("span", "agent-meta", agent.meta) : null
      ]),
      el("div", "agent-actions", [
        statusChip(agent.status),
        agent.showSessionLink === false
          ? null
          : agent.threadUrl
            ? openSessionButton(agent.threadUrl, sessionLabel, "agent-open-session")
            : el("span", "agent-session-link pending", sessionLabel)
      ])
    ])
  ]);
  if (agent.threadId) {
    card.title = `Codex thread: ${agent.threadId}`;
    card.dataset.threadId = agent.threadId;
  }
  return card;
}

function agentInitial(agent) {
  const name = `${agent.name ?? ""}`.trim();
  return Array.from(name)[0] ?? agent.avatar ?? "代";
}

function openSessionButton(threadUrl, label = "打开会话", className = "open-session-button") {
  const action = button(className, (event) => {
    event.stopPropagation();
    window.location.href = threadUrl;
  }, [
    el("span", "", label),
    el("span", "open-session-arrow", "›")
  ]);
  action.title = "打开对应的 Codex session";
  return action;
}

function openSessionButtonForRun(runId, label = "打开会话", className = "open-session-button") {
  const action = button(className, async (event) => {
    event.stopPropagation();
    action.disabled = true;
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/open-codex-session`, {
        method: "POST"
      });
      const session = await response.json();
      if (!response.ok || session.status !== "ready" || !session.threadUrl) {
        action.textContent = session.message ?? "会话未就绪";
        action.classList.add("disabled");
        return;
      }
      window.location.href = session.threadUrl;
    } catch (error) {
      action.textContent = "会话未就绪";
      action.classList.add("disabled");
    } finally {
      action.disabled = false;
    }
  }, [
    el("span", "", label),
    el("span", "open-session-arrow", "›")
  ]);
  action.title = "打开对应的 Codex session";
  return action;
}

function sessionActionForRun(run, className = "open-session-button", pendingClassName = "open-session-button disabled") {
  if (run.codexSession?.threadUrl) {
    return openSessionButtonForRun(run.id, "打开会话", className);
  }
  if (run.codexSession) {
    return el("span", pendingClassName, "等待手动启动");
  }
  return null;
}

function shortThreadId(threadId) {
  return threadId.length > 12 ? `${threadId.slice(0, 8)}...${threadId.slice(-4)}` : threadId;
}

function newestLoopId(loops, runs) {
  const latestRun = [...runs].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).at(-1);
  return latestRun?.loopId ?? loops.at(-1)?.id ?? null;
}

function runsForLoop(loopId, runs) {
  if (!loopId) return [];
  return runs.filter((run) => run.loopId === loopId);
}

function readRouteState() {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return { tab: "history" };
  if (hash === "directory") return { tab: "directory" };
  if (hash === "history") return { tab: "history" };
  if (hash.startsWith("run=")) return { tab: "history", runId: decodeURIComponent(hash.slice(4)) };
  return { tab: "history" };
}

function writeRouteState(tab, runId) {
  const next = tab === "run" && runId ? `#run=${encodeURIComponent(runId)}` : `#${tab}`;
  if (window.location.hash !== next) {
    window.history.replaceState(null, "", next);
    observedHash = window.location.hash;
  }
}

function applyRouteState(snapshot) {
  if (!snapshot) return;
  const route = readRouteState();
  activeLoopTab = route.tab === "directory" ? "directory" : "history";
  if (route.runId) {
    selectedRunId = route.runId;
    const run = (snapshot.runs ?? []).find((item) => item.id === route.runId);
    if (run) {
      selectedLoopId = run.loopId;
      activeLoopTab = "history";
    }
  } else {
    selectedRunId = null;
  }
}

function statusText(status) {
  const labels = {
    active: "守候中",
    running: "进行中",
    completed: "完成",
    failed: "失败",
    passed: "通过",
    repairing: "修复中",
    ready: "就绪",
    suspended: "等待会话",
    executing: "执行中",
    requested: "待创建",
    started: "已创建",
    unavailable: "不可用",
    draft: "候选",
    promoted: "已采用",
    superseded: "已替代",
    rejected: "已拒绝",
    skipped: "跳过",
    "not-run": "未运行",
    waiting_for_human: "等待你",
    open: "等待你",
    resolved: "已解决",
    run_created: "已创建",
    attempt_started: "开始",
    attempt_completed: "完成",
    note: "记录",
    memory: "记忆"
  };
  return labels[status] ?? status;
}

function statusChip(status) {
  return el("span", `status ${status}`, statusText(status));
}

function phaseStatusDot(status) {
  const normalized = timelineStatus(status);
  const dot = el("span", `phase-status-dot ${normalized}`, "");
  dot.title = statusText(normalized);
  return dot;
}

function formatClock(date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderLoading() {
  if (currentSnapshot) return;
  elements.loopStage.replaceChildren(el("div", "stage-loading", "正在读取 Live Loop..."));
}

function renderError(message) {
  elements.loopStage.replaceChildren(el("div", "stage-error", message));
}

function renderNotice(message) {
  elements.loopStage.replaceChildren(el("div", "stage-notice", message));
}

function showToast(message, kind = "success") {
  document.querySelector(".dittos-toast")?.remove();
  const toast = el("div", `dittos-toast ${kind}`, message);
  const isError = kind === "error";
  toast.setAttribute("role", isError ? "alert" : "status");
  toast.setAttribute("aria-live", isError ? "assertive" : "polite");
  document.body.append(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, 2400);
}

function renderPromptNotice(message, prompt) {
  elements.loopStage.replaceChildren(el("div", "stage-notice prompt-notice", [
    el("p", "", message),
    el("pre", "prompt-copy", prompt)
  ]));
}

function button(className, onClick, content) {
  const element = document.createElement("button");
  element.type = "button";
  element.className = className;
  element.addEventListener("click", onClick);
  if (content !== undefined) {
    const children = Array.isArray(content) ? content.filter(Boolean) : [content].filter(Boolean);
    for (const child of children) {
      if (child instanceof Node) {
        element.appendChild(child);
      } else {
        element.appendChild(document.createTextNode(String(child)));
      }
    }
  }
  return element;
}

function el(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;

  const children = Array.isArray(content) ? content.filter(Boolean) : [content].filter(Boolean);
  for (const child of children) {
    if (child instanceof Node) {
      element.appendChild(child);
    } else {
      element.appendChild(document.createTextNode(String(child)));
    }
  }

  return element;
}

function inlineIcon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("inline-icon");

  const paths = {
    gear: ["M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4Z", "M19.4 15a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5 2 2 0 1 1-4 0 1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3 2 2 0 1 1-2.8-2.8 1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1 2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8 2 2 0 1 1 2.8-2.8 1.6 1.6 0 0 0 1.8.3 1.6 1.6 0 0 0 1-1.5 2 2 0 1 1 4 0 1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3 2 2 0 1 1 2.8 2.8 1.6 1.6 0 0 0-.3 1.8 1.6 1.6 0 0 0 1.5 1 2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.5 1Z"],
    bolt: ["M13 2 4 14h7l-1 8 10-13h-7l0-7Z"],
    flow: ["M6 6h.01", "M18 6h.01", "M6 18h.01", "M8 6h8", "M6 8v8", "M8 18h8"],
    folder: ["M4 7.5A2.5 2.5 0 0 1 6.5 5H10l2 2h5.5A2.5 2.5 0 0 1 20 9.5v7A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z"],
    fileText: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z", "M14 3v5h5", "M8 13h8", "M8 17h6"],
    fileCode: ["M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z", "M14 3v5h5", "M10 13l-2 2 2 2", "M14 13l2 2-2 2"]
  };

  for (const d of paths[name] ?? paths.bolt) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }

  return svg;
}

function empty(message) {
  return el("div", "empty", message);
}

void loadSnapshot();
