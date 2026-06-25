const formatDate = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const UNASSIGNED_PROJECT_LABEL = "无项目";

const elements = {
  shell: document.querySelector(".loop-shell"),
  newLoop: document.querySelector("#new-loop"),
  loops: document.querySelector("#loops"),
  loopStage: document.querySelector("#loop-stage")
};

let selectedLoopId = null;
let selectedRunId = null;
let currentSnapshot = null;
let activeLoopTab = "history";
let selectedDirectoryPath = "flow.js";
let selectedRunPhaseId = "attempts";
let loopSelectionClosed = false;
let observedHash = window.location.hash;

elements.newLoop.addEventListener("click", () => {
  void copyNewLoopPrompt();
});

window.addEventListener("hashchange", syncRouteFromLocation);
window.addEventListener("popstate", syncRouteFromLocation);
window.setInterval(() => {
  if (window.location.hash !== observedHash) {
    syncRouteFromLocation();
  }
}, 200);

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
          void startCodexSession(loop);
        }, "生成启动请求"),
        button("danger-button", () => {
          void deleteLoop(loop);
        }, "删除")
      ].filter(Boolean))
    ]),
    renderLoopTabs(),
    activeLoopTab === "directory"
      ? renderLoopDirectory({ snapshot, loop, loopRuns, checks })
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
  if (!loop) return projects[0] ?? null;

  return projects.find((project) => {
    return project.id === loop.codexProjectId || project.path === loop.projectPath || project.name === loop.projectLabel;
  }) ?? null;
}

async function copyNewLoopPrompt() {
  const project = projectChoices(currentSnapshot)[0];
  const body = project
    ? {
        codexProjectId: project.id,
        projectLabel: project.name,
        projectPath: project.path
      }
    : {};

  const response = await fetch("/api/new-loop-session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    renderError(`New loop prompt request failed: ${response.status}`);
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

async function startCodexSession(loop) {
  const project = projectForLoop(currentSnapshot, loop) ?? projectChoices(currentSnapshot)[0];
  if (!project) {
    renderError("没有可用的 Codex App 项目，无法创建 Codex 会话请求。");
    return;
  }

  const response = await fetch(`/api/loops/${encodeURIComponent(loop.id)}/codex-session`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      goal: loop.intent,
      codexProjectId: project.id,
      projectLabel: project.name,
      projectPath: project.path
    })
  });
  if (!response.ok) {
    renderError(`Codex session request failed: ${response.status}`);
    return;
  }

  const launch = await response.json();
  window.__dittosloopLastLaunchRequest = launch.launchRequest;
  window.dispatchEvent(new CustomEvent("dittosloop:create-codex-thread", { detail: launch.launchRequest }));
  window.parent?.postMessage({ type: "dittosloop:create-codex-thread", launchRequest: launch.launchRequest }, "*");
  selectedRunId = launch.run.id;
  selectedLoopId = launch.run.loopId;
  activeLoopTab = "history";
  writeRouteState("run", selectedRunId);
  renderNotice("已生成 Codex 会话请求，等待 Codex App 打开新会话。");
  await loadSnapshot();
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

function renderLoopDirectory({ snapshot, loop, loopRuns, checks }) {
  const latestRun = loopRuns.at(0);
  const files = buildLoopDirectoryFiles({ snapshot, loop, loopRuns, checks });
  const selected = files.find((file) => file.path === selectedDirectoryPath) ?? files[0];
  selectedDirectoryPath = selected?.path ?? "flow.js";

  return el("section", "directory-browser", [
    el("aside", "directory-file-list", [
      el("div", "directory-file-root", [
        inlineIcon("folder"),
        el("span", "", "Live Loop")
      ]),
      el("div", "directory-files", files.map((file) =>
        button(`directory-file ${file.path === selected.path ? "active" : ""}`, () => {
          selectedDirectoryPath = file.path;
          renderLoopStage({ snapshot: currentSnapshot });
        }, [
          inlineIcon(file.language === "markdown" ? "fileText" : "fileCode"),
          el("span", "directory-file-name", file.path),
          el("span", "directory-file-meta", file.meta)
        ])
      ))
    ]),
    el("div", "directory-file-view", [
      el("header", "directory-file-head", [
        el("span", "directory-path", selected?.path ?? "Live Loop 目录"),
        selected ? el("span", "directory-file-type", selected.meta) : null,
        el("span", "directory-spacer", ""),
        latestRun ? el("span", "directory-sync-note", `最近 run ${formatDate.format(new Date(latestRun.createdAt))}`) : null
      ]),
      selected
        ? el("pre", "directory-code", [el("code", "", selected.content)])
        : el("div", "directory-empty", "选择一个文件查看内容。")
    ])
  ]);
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
  const done = phases.filter((phase) => phase.status !== "running" && phase.status !== "open").length;

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
    el("section", "run-board-body", [
      el("aside", "phase-rail", [
        el("div", "phase-rail-title", "工作流阶段"),
        ...phases.map((phase) =>
          button(`phase-step ${phase.status} ${phase.id === selectedRunPhaseId ? "focused" : ""}`, () => {
            selectedRunPhaseId = phase.id;
            renderRunBoard({ detail, loop, loopRuns });
          }, [
            statusChip(phase.status),
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

function buildRunPhases(detail) {
  const run = detail.run;
  const sessionAgents = run.codexSession ? codexSessionPhaseAgents(run) : [];
  const attemptAgents = detail.attempts
    .filter(() => !run.codexSession)
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
      status: startAgents.some((agent) => agent.status === "running" || agent.status === "requested") ? "running" : "completed",
      agents: startAgents
    });
  }

  for (const section of detail.timeline ?? []) {
    const sectionPhases = section.id === "workflow"
      ? workflowTimelinePhases(section, run.status)
      : [timelineSectionPhase(section, run.status)].filter(Boolean);
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

function codexSessionPhaseAgents(run) {
  const subagents = Array.isArray(run.codexSession?.subagents) ? run.codexSession.subagents : [];
  if (subagents.length) {
    return subagents.map((subagent, index) => ({
      id: `${run.id}-session-subagent-${index}`,
      avatar: subagent.role === "loop-runner" ? "主" : "代",
      name: subagent.role,
      status: subagent.status === "requested" && run.codexSession.status !== "requested"
        ? run.codexSession.status
        : subagent.status,
      description: subagent.threadId
        ? "点击查看这一步的实际运行结果。"
        : "已纳入本次 Codex worker 的 workflow 计划。",
      meta: subagent.threadTitle ?? "workflow agent",
      threadId: subagent.threadId ?? run.codexSession.threadId,
      threadTitle: subagent.threadTitle ?? run.codexSession.threadTitle,
      threadUrl: subagent.threadUrl ?? run.codexSession.threadUrl,
      showSessionLink: subagent.threadUrl || run.codexSession.threadUrl ? undefined : false
    }));
  }

  return [
    {
      id: `${run.id}-current-session`,
      avatar: "主",
      name: "Codex 会话",
      status: run.codexSession.status === "requested" ? run.status : run.codexSession.status,
      description: run.codexSession.threadId
        ? "点击查看这次任务的实际运行结果。"
        : "等待 Codex App 创建任务会话。",
      meta: "Codex session",
      threadId: run.codexSession.threadId,
      threadTitle: run.codexSession.threadTitle,
      threadUrl: run.codexSession.threadUrl
    }
  ];
}

function timelineSectionPhase(section, fallbackStatus) {
  const agents = timelineSectionAgents(section);
  if (!agents.length) return null;
  return {
    id: section.id,
    name: section.title,
    status: timelineSectionStatus(section, fallbackStatus),
    agents
  };
}

function workflowTimelinePhases(section, fallbackStatus) {
  const items = compactTimelineItems(section.items ?? []);
  const phaseOrder = [];
  const phaseMap = new Map();
  const looseAgents = [];
  let currentPhaseId = null;

  for (const item of items) {
    if (item.kind === "phase" || item.kind === "parallel") {
      const phaseId = workflowGroupId(item, phaseOrder.length);
      const nextStatus = timelineStatus(item.status);
      currentPhaseId = nextStatus === "completed" || nextStatus === "passed" || nextStatus === "failed" ? null : phaseId;
      let phase = phaseMap.get(phaseId);
      if (!phase) {
        phase = {
          id: `workflow-${phaseId}`,
          name: item.label,
          status: timelineStatus(item.status),
          agents: []
        };
        phaseMap.set(phaseId, phase);
        phaseOrder.push(phaseId);
      } else {
        phase.name = item.label || phase.name;
        phase.status = mergePhaseTimelineStatus(phase.status, item.status);
      }
      continue;
    }

    if (item.kind !== "agent") continue;
    const agent = timelineItemAgent(section, item, phaseMap.size + looseAgents.length);
    const phaseId = item.phaseId ?? currentPhaseId;
    if (!phaseId || !phaseMap.has(phaseId)) {
      looseAgents.push(agent);
      continue;
    }
    phaseMap.get(phaseId).agents.push(agent);
  }

  const phases = phaseOrder
    .map((phaseId) => phaseMap.get(phaseId))
    .filter((phase) => phase.agents.length);

  if (looseAgents.length) {
    phases.push({
      id: "workflow-agents",
      name: section.title,
      status: agentsStatus(looseAgents, fallbackStatus),
      agents: looseAgents
    });
  }

  return phases;
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
      name: "创建 Codex 会话",
      status: run.codexSession.threadId ? "completed" : run.codexSession.status,
      description: run.codexSession.threadId ? "真实 Codex worker session 已创建并关联。" : "等待 Codex App 创建真实会话。",
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
    agents.push(...codexSessionPhaseAgents(run));
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

function renderAgentCard(agent) {
  const sessionLabel = agent.threadTitle ?? (agent.threadId ? shortThreadId(agent.threadId) : "待 Codex App 创建");
  const card = el("div", `agent-card ${agent.threadUrl ? "has-session" : ""}`, [
    el("div", "agent-card-row", [
      el("span", "agent-avatar", agent.avatar),
      el("span", "agent-name", agent.name),
      el("span", "agent-spacer", ""),
      statusChip(agent.status),
      agent.showSessionLink === false
        ? null
        : agent.threadUrl
          ? openSessionButton(agent.threadUrl, sessionLabel, "agent-open-session")
          : el("span", "agent-session-link pending", sessionLabel)
    ]),
    agent.description ? el("p", "agent-description", agent.description) : null,
    agent.meta ? el("span", "agent-meta", agent.meta) : null
  ]);
  if (agent.threadId) {
    card.title = `Codex thread: ${agent.threadId}`;
    card.dataset.threadId = agent.threadId;
  }
  return card;
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
    return el("span", pendingClassName, "等待 Codex App 创建");
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

function buildLoopDirectoryFiles({ snapshot, loop, loopRuns, checks }) {
  const latestRun = loopRuns.at(0);
  const formalContract = (snapshot?.formalContracts ?? []).find((contract) => contract.id === loop.id);
  const workflowFiles = formalContract ? formalLoopDirectoryFiles({ contract: formalContract, snapshot, loopRuns }) : [];
  return [
    {
      path: "flow.js",
      language: "javascript",
      meta: "JS",
      content: formalContract ? formalWorkflowFlowFile(formalContract) : legacyLoopFlowNoticeFile(loop)
    },
    {
      path: "memory.md",
      language: "markdown",
      meta: "MD",
      content: [
        `# ${loop.title}`,
        "",
        loop.intent,
        "",
        "## Runtime",
        `- 状态：${statusText(loop.status)}`,
        `- 运行次数：${loopRuns.length}`,
        `- 最近 run：${latestRun ? formatDate.format(new Date(latestRun.createdAt)) : "暂无"}`,
        "",
        "## Codex session policy",
        "- Loop 触发时创建新的真实 Codex worker session。",
        "- DittosLoop 只生成 launchRequest，不在预览页里伪造 session。",
        "- Codex App 宿主负责 create_thread，并把 threadId/threadUrl 写回 run。",
        "- 新 session 的输入作为 user prompt 注入，提醒 agent 读取 loop 目标、历史和验证点。",
        "- session 执行结果在 Codex 原生会话里查看；DittosLoop 记录 run、attempt、verification 和链接。"
      ].join("\n")
    },
    ...workflowFiles,
    {
      path: "contract.json",
      language: "json",
      meta: "JSON",
      content: JSON.stringify({
        id: loop.id,
        title: loop.title,
        intent: loop.intent,
        status: loop.status,
        trigger: "manual",
        verificationChecks: checks
      }, null, 2)
    },
    {
      path: "session.json",
      language: "json",
      meta: "JSON",
      content: JSON.stringify({
        launch: "host-mediated-new-codex-session",
        projectBinding: {
          mode: "select-codex-project",
          default: "current-workspace"
        },
        execution: {
          host: "codex-app",
          worker: "new-codex-session"
        },
        launchRequest: latestRun?.codexSession
          ? {
              runId: latestRun.id,
              loopId: latestRun.loopId,
              title: `DittosLoop: ${loop.title}`,
              prompt: latestRun.codexSession.prompt
            }
          : null,
        hostWriteback: {
          required: true,
          api: latestRun ? `/api/runs/${latestRun.id}/codex-thread` : "/api/runs/{runId}/codex-thread",
          mcpTool: "record_codex_thread",
          fields: ["threadId", "threadTitle", "threadUrl"]
        },
        userPromptInjection: {
          timing: ["session-start", "context-compaction"],
          source: ["loopable.md", "loop memory", "latest user confirmation"]
        }
      }, null, 2)
    }
  ];
}

function legacyLoopFlowNoticeFile(loop) {
  return [
    `export const loop = ${JSON.stringify(loop.title)};`,
    "",
    "// 这个旧版 loop 没有正式 workflow contract。",
    "// 它只保留历史记录，不伪装成可执行 workflow。",
    "export const workflow = null;"
  ].join("\n");
}

function formalWorkflowFlowFile(contract) {
  const lines = [
    `export const loop = ${JSON.stringify(contract.title)};`,
    `export const workflowContractId = ${JSON.stringify(contract.id)};`,
    `export const goal = ${JSON.stringify(contract.goal)};`,
    `export const rubrics = ${JSON.stringify(contract.verification?.rubrics ?? [], null, 2)};`,
    "",
    "export async function run(context) {",
    "  const results = [];",
    ...workflowStepLines(contract.body?.steps ?? [], "  "),
    "  const verification = await verifyRubrics(context, results);",
    "  return { results, verification };",
    "}",
    "",
    "async function runPhase(context, label, body) {",
    "  await context.dittosloop.phaseStarted(label);",
    "  const result = await body();",
    "  await context.dittosloop.phaseCompleted(label);",
    "  return result;",
    "}",
    "",
    "async function runParallel(context, label, tasks) {",
    "  await context.dittosloop.parallelStarted(label);",
    "  return Promise.all(tasks.map((task) => task()));",
    "}",
    "",
    "async function runAgent(context, results, step) {",
    "  const result = await context.codexSession.runAgent(step);",
    "  results.push({ stepId: step.id, label: step.label, result });",
    "  await context.dittosloop.agentCompleted(step.id, result);",
    "  return result;",
    "}",
    "",
    "async function verifyRubrics(context, results) {",
    "  return context.verifier.check({ results, rubrics });",
    "}"
  ];
  return lines.join("\n");
}

function workflowStepLines(steps, indent) {
  return steps.flatMap((step) => workflowStepLine(step, indent));
}

function workflowStepLine(step, indent) {
  if (step.kind === "phase") {
    return [
      `${indent}await runPhase(context, ${JSON.stringify(step.label)}, async () => {`,
      ...workflowStepLines(step.children ?? [], `${indent}  `),
      `${indent}});`
    ];
  }

  if (step.kind === "parallel") {
    return [
      `${indent}await runParallel(context, ${JSON.stringify(step.label)}, [`,
      ...(step.children ?? []).flatMap((child) => [
        `${indent}  async () => {`,
        ...workflowStepLine(child, `${indent}    `),
        `${indent}  },`
      ]),
      `${indent}]);`
    ];
  }

  return [
    `${indent}await runAgent(context, results, ${JSON.stringify({
      id: step.id,
      label: step.label,
      prompt: step.prompt ?? "",
      inputs: step.inputs ?? []
    }, null, 2).replaceAll("\n", `\n${indent}`)});`
  ];
}

function formalLoopDirectoryFiles({ contract, snapshot, loopRuns }) {
  const agentSteps = flattenContractSteps(contract.body?.steps ?? []).filter((step) => step.kind === "agent");
  const latestRun = loopRuns.at(0);
  const latestAttempt = latestRun
    ? [...(snapshot?.attempts ?? [])].reverse().find((attempt) => attempt.runId === latestRun.id)
    : null;
  const latestVerification = latestRun
    ? [...(snapshot?.verificationResults ?? [])].reverse().find((result) => result.runId === latestRun.id)
    : null;
  const engineEvents = latestRun ? engineEventsForRun(snapshot, latestRun.id) : [];
  const agentStatuses = agentStatusByStepId(engineEvents);
  const rubricStatuses = rubricStatusByLabel(latestVerification);
  return [
    {
      path: "workflow.json",
      language: "json",
      meta: "JSON",
      content: JSON.stringify({
        id: contract.id,
        title: contract.title,
        goal: contract.goal,
        status: contract.status,
        latestRunStatus: latestRun?.status ?? null,
        latestAttemptStatus: latestAttempt?.status ?? null,
        latestVerificationStatus: latestVerification?.status ?? null,
        body: contract.body,
        repairPolicy: contract.repairPolicy,
        stopPolicy: contract.stopPolicy,
        projectBinding: contract.projectBinding
      }, null, 2)
    },
    {
      path: "agents.md",
      language: "markdown",
      meta: "MD",
      content: [
        `# ${contract.title} agents`,
        "",
        ...agentSteps.flatMap((step, index) => [
          `## ${index + 1}. ${step.label}`,
          "",
          `- id: \`${step.id}\``,
          `- kind: \`${step.kind}\``,
          `- status: ${statusText(agentStatuses.get(step.id) ?? "not-run")}`,
          "",
          step.prompt,
          ""
        ])
      ].join("\n")
    },
    {
      path: "rubrics.md",
      language: "markdown",
      meta: "MD",
      content: [
        `# ${contract.title} verifier`,
        "",
        `Mode: \`${contract.verification?.mode ?? "after_workflow"}\``,
        "",
        ...(contract.verification?.rubrics ?? []).flatMap((rubric) => [
          `## ${rubric.label}`,
          "",
          `- id: \`${rubric.id}\``,
          `- severity: \`${rubric.severity}\``,
          `- status: ${statusText(rubricStatuses.get(rubric.label) ?? "not-run")}`,
          `- requirement: ${rubric.requirement}`,
          rubricStatuses.get(`${rubric.label}:output`) ? `- evidence: ${rubricStatuses.get(`${rubric.label}:output`)}` : "",
          ""
        ].filter(Boolean))
      ].join("\n")
    },
    {
      path: "runs.json",
      language: "json",
      meta: "JSON",
      content: JSON.stringify({
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              goal: latestRun.goal,
              createdAt: latestRun.createdAt,
              completedAt: latestRun.completedAt
            }
          : null,
        latestAttempt: latestAttempt
          ? {
              id: latestAttempt.id,
              status: latestAttempt.status,
              summary: latestAttempt.summary,
              startedAt: latestAttempt.startedAt,
              completedAt: latestAttempt.completedAt
            }
          : null,
        latestVerification: latestVerification
          ? {
              id: latestVerification.id,
              status: latestVerification.status,
              summary: latestVerification.summary,
              checks: latestVerification.checks ?? [],
              createdAt: latestVerification.createdAt
            }
          : null,
        runs: loopRuns.map((run) => ({
          id: run.id,
          status: run.status,
          goal: run.goal,
          createdAt: run.createdAt,
          completedAt: run.completedAt
        }))
      }, null, 2)
    }
  ];
}

function engineEventsForRun(snapshot, runId) {
  return (snapshot?.events ?? [])
    .filter((event) => event.runId === runId)
    .map((event) => event.data?.engineEvent)
    .filter(Boolean)
    .sort((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0));
}

function agentStatusByStepId(engineEvents) {
  const statuses = new Map();
  for (const event of engineEvents) {
    if (!event.stepId) continue;
    if (event.type === "agent_started") {
      statuses.set(event.stepId, "running");
    }
    if (event.type === "agent_done") {
      statuses.set(event.stepId, "completed");
    }
    if (event.type === "agent_failed") {
      statuses.set(event.stepId, "failed");
    }
  }
  return statuses;
}

function rubricStatusByLabel(verification) {
  const statuses = new Map();
  for (const check of verification?.checks ?? []) {
    statuses.set(check.name, check.status);
    if (check.output) {
      statuses.set(`${check.name}:output`, check.output);
    }
  }
  return statuses;
}

function flattenContractSteps(steps) {
  const result = [];
  for (const step of steps) {
    result.push(step);
    if (Array.isArray(step.children)) {
      result.push(...flattenContractSteps(step.children));
    }
  }
  return result;
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
    requested: "待创建",
    started: "已创建",
    unavailable: "不可用",
    draft: "候选",
    promoted: "已采用",
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

function showToast(message) {
  document.querySelector(".dittos-toast")?.remove();
  const toast = el("div", "dittos-toast", message);
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  document.body.append(toast);
  window.setTimeout(() => {
    toast.classList.add("leaving");
    window.setTimeout(() => toast.remove(), 180);
  }, 2400);
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
