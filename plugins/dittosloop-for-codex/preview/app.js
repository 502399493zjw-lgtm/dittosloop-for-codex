const formatDate = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit"
});

const elements = {
  refresh: document.querySelector("#refresh"),
  loops: document.querySelector("#loops"),
  loopGroupCount: document.querySelector("#loop-group-count"),
  loopStage: document.querySelector("#loop-stage")
};

let selectedLoopId = null;
let selectedRunId = null;
let currentSnapshot = null;
let activeLoopTab = "history";
let selectedDirectoryPath = "flow.js";
let selectedCodexProjectId = "";
let selectedRunPhaseId = "attempts";
let observedHash = window.location.hash;

elements.refresh.addEventListener("click", () => {
  void loadSnapshot();
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
    if (!selectedLoopId || !loops.some((loop) => loop.id === selectedLoopId)) {
      selectedLoopId = newestLoopId(loops, runs);
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

  elements.loopGroupCount.textContent = String(loops.length);
  elements.loops.replaceChildren(...renderLoopRows(loops, runs, verificationResults));
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
  render(currentSnapshot);
  renderLoopStage({ snapshot: currentSnapshot, detail });
}

function renderLoopRows(loops, runs, verificationResults) {
  if (loops.length === 0) {
    return [empty("还没有 Live Loop")];
  }

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
      activeLoopTab = "history";
      render(currentSnapshot);
      renderLoopStage({ snapshot: currentSnapshot });
    });
    if (selected) row.classList.add("selected");

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
      el("span", `row-toggle ${latestRun?.status === "running" ? "disabled" : "on"}`, ""),
      el("span", "chevron", "›")
    );
    return row;
  });
}

function renderLoopStage({ snapshot, detail }) {
  if (!snapshot) return;

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
        el("span", "tab-close", "×")
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
        renderProjectPicker(snapshot, loop),
        button("ghost-button launch-button", () => {
          void startCodexSession(loop);
        }, "生成启动请求"),
        button("danger-button", () => {
          void deleteLoop(loop);
        }, "删除")
      ])
    ]),
    renderLoopTabs(),
    activeLoopTab === "directory"
      ? renderLoopDirectory({ snapshot, loop, loopRuns, checks })
      : [
          el("section", "execution-card", [
            el("div", "execution-heading", [
              inlineIcon("flow"),
              el("span", "", "本轮剧本")
            ]),
            el("ol", "script-steps", [
              el("li", "", "启动一次可见 run，并在 run 下创建 attempt"),
              el("li", "", "记录进展、验证结果和需要人工处理的事项"),
              el("li", "", "在预览中读取 run detail，确认历史可追溯")
            ])
          ]),
          el("section", "history-panel", [
            ...renderHistoryRows(loopRuns, verificationResults, humanRequests)
          ])
        ]
  ].flat().filter(Boolean));
}

function renderProjectPicker(snapshot, loop) {
  const projects = projectChoices(snapshot);
  if (!projects.length) {
    const select = el("select", "project-picker", [
      el("option", "", "未连接 Codex 项目")
    ]);
    select.disabled = true;
    return select;
  }

  const loopProjectId = projects.some((project) => project.id === loop?.codexProjectId)
    ? loop.codexProjectId
    : null;
  if (!selectedCodexProjectId || !projects.some((project) => project.id === selectedCodexProjectId)) {
    selectedCodexProjectId = loopProjectId ?? projects[0].id;
  }

  const select = el("select", "project-picker", projects.map((project) => {
    const option = el("option", "", project.name);
    option.value = project.id;
    return option;
  }));
  select.value = selectedCodexProjectId;
  select.addEventListener("change", () => {
    selectedCodexProjectId = select.value;
  });
  return select;
}

function projectChoices(snapshot) {
  const projects = snapshot?.codexProjects ?? [];
  return projects
    .filter((project) => project?.id && project?.name && project?.path)
    .map((project) => ({
      id: project.id,
      name: project.name,
      path: project.path
    }));
}

async function startCodexSession(loop) {
  const project = projectChoices(currentSnapshot).find((item) => item.id === selectedCodexProjectId);
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
  selectedRunId = launch.run.id;
  selectedLoopId = launch.run.loopId;
  activeLoopTab = "history";
  writeRouteState("run", selectedRunId);
  await loadSnapshot();
}

async function deleteLoop(loop) {
  if (!window.confirm(`删除「${loop.title}」？`)) {
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
        run.codexSession?.threadUrl
          ? openSessionButton(run.codexSession.threadUrl, "打开会话", "history-session-button")
          : el("span", "history-session-state", run.codexSession ? "待创建会话" : "未关联会话"),
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
      button("inactive-tab", () => {
        selectedRunId = null;
        writeRouteState("history");
        renderLoopStage({ snapshot: currentSnapshot });
      }, [el("span", "tab-title", loop.title)]),
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
        ? openSessionButton(run.codexSession.threadUrl, "打开会话")
        : el("span", "open-session-button disabled", run.codexSession ? "待创建会话" : "未关联会话")
    ]),
    el("div", "run-meta-line", [
      inlineIcon("bolt"),
      el("span", "", run.trigger),
      el("span", "divider", "·"),
      el("span", "", formatClock(new Date(run.createdAt))),
      run.goal ? el("span", "divider", "·") : null,
      run.goal ? el("span", "run-input-label", run.goal) : null,
      runProjectLabel(run) ? el("span", "divider", "·") : null,
      runProjectLabel(run) ? el("span", "run-project-label", runProjectLabel(run)) : null
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
      el("div", "phase-detail", activePhase ? [
        el("section", "phase-agent-group", [
          el("div", "phase-group-label", activePhase.name),
          ...(activePhase.agents.length ? activePhase.agents.map((agent) => renderAgentCard(agent)) : [el("p", "detail-empty", `「${activePhase.name}」阶段暂无 agent 明细。`)])
        ])
      ] : [])
    ]),
    renderSummaryOutput(detail)
  ].filter(Boolean));
}

function buildRunPhases(detail) {
  const run = detail.run;
  const sessionAgents = run.codexSession
    ? [
        {
          id: `${run.id}-current-session`,
          avatar: "主",
          name: "Codex 会话",
          status: run.codexSession.status === "requested" ? run.status : run.codexSession.status,
          description: run.codexSession.threadId
            ? "点击查看这次任务的实际运行结果。"
            : "等待 Codex App 创建任务会话。",
          meta: runProjectLabel(run) || "当前项目",
          threadId: run.codexSession.threadId,
          threadTitle: run.codexSession.threadTitle,
          threadUrl: run.codexSession.threadUrl
        }
      ]
    : [];
  const attemptAgents = detail.attempts
    .filter(() => !run.codexSession)
    .map((attempt) => ({
    id: attempt.id,
    avatar: run.codexSession ? "启" : "流",
    name: run.codexSession ? "Codex session request" : "Workflow attempt",
    status: attempt.status,
    description: attempt.summary ?? attempt.id,
    meta: attempt.completedAt ? formatDate.format(new Date(attempt.completedAt)) : "运行中",
    threadId: run.codexSession?.threadId,
    threadTitle: run.codexSession?.threadTitle,
    threadUrl: run.codexSession?.threadUrl,
    showSessionLink: Boolean(run.codexSession)
  }));
  const workflowAgents = (detail.workflowRevisions ?? []).map((revision) => ({
    id: revision.id,
    avatar: "稿",
    name: "Workflow draft",
    status: revision.status,
    description: revision.reason,
    meta: revision.createdAt ? formatDate.format(new Date(revision.createdAt)) : "候选 workflow",
    showSessionLink: false
  }));
  const verificationAgents = detail.verificationResults.map((result) => ({
    id: result.id,
    avatar: result.status === "failed" ? "!" : "验",
    name: "Verification",
    status: result.status,
    description: result.summary,
    meta: result.attemptId ? `Attempt ${result.attemptId}` : "Run level"
  }));
  const timelineAgents = buildPreviewTimelineAgents(detail);

  return [
    {
      id: "attempts",
      name: "启动执行",
      status: [...sessionAgents, ...attemptAgents].some((agent) => agent.status === "running" || agent.status === "requested") ? "running" : "completed",
      agents: [...sessionAgents, ...attemptAgents]
    },
    {
      id: "verification",
      name: "验证",
      status: verificationAgents.some((agent) => agent.status === "failed") ? "failed" : "passed",
      agents: verificationAgents
    },
    {
      id: "workflow",
      name: "工作流草稿",
      status: workflowAgents.length ? "draft" : "completed",
      agents: workflowAgents
    },
    {
      id: "timeline",
      name: "时间线",
      status: run.status,
      agents: timelineAgents
    }
  ];
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

  return compactTimelineItems(items).map((item, index) => ({
    id: `${item.stepId ?? "agent"}-${item.sequence ?? index}`,
    avatar: "代",
    name: item.label,
    status: timelineStatus(item.status),
    description: item.message,
    meta: item.createdAt ? formatDate.format(new Date(item.createdAt)) : "workflow agent"
  }));
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
    repair: "修"
  };
  return avatars[kind] ?? "记";
}

function timelineStatus(status) {
  const aliases = {
    started: "running",
    needed: "repairing"
  };
  return aliases[status] ?? status;
}

function renderAgentCard(agent) {
  const sessionLabel = agent.threadTitle ?? (agent.threadId ? shortThreadId(agent.threadId) : "待 Codex App 创建");
  const card = el("div", `agent-card ${agent.threadUrl ? "has-session" : ""}`, [
    el("div", "agent-card-row", [
      el("span", "agent-avatar", agent.avatar),
      el("span", "agent-name", [
        agent.name,
        el("span", "agent-diamond", "")
      ]),
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

function shortThreadId(threadId) {
  return threadId.length > 12 ? `${threadId.slice(0, 8)}...${threadId.slice(-4)}` : threadId;
}

function renderSummaryOutput(detail) {
  const memories = detail.memoryCommits ?? [];
  const artifacts = detail.artifacts ?? [];
  const latestOutput = [...(detail.events ?? [])].reverse().find((event) => event.data?.output)?.data?.output;
  if (!latestOutput && memories.length === 0 && artifacts.length === 0) {
    return null;
  }

  return el("section", "summary-output", [
    el("div", "summary-kicker", "汇总输出"),
    latestOutput ? el("p", "summary-copy", latestOutput) : null,
    memories.length ? el("p", "summary-copy muted", memories.at(-1).summary) : null,
    artifacts.length
      ? el("div", "artifact-strip", artifacts.map((artifact) =>
          el("span", "artifact-pill", artifact.title ?? artifact.url ?? artifact.path)
        ))
      : null
  ]);
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
      content: [
        `export const loop = ${JSON.stringify(loop.title)};`,
        "",
        "export async function run(context) {",
        "  const launch = await context.dittosloop.startCodexSession({",
        "    loopId: context.loop.id,",
        "    project: context.project,",
        "    prompt: context.userPrompt",
        "  });",
        "",
        "  const thread = await context.codexApp.createThread(launch.launchRequest);",
        "  await context.dittosloop.recordCodexThread({ runId: launch.run.id, ...thread });",
        "  return thread;",
        "}"
      ].join("\n")
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
        "- session 执行结果在 Codex 原生会话里查看；DittosLoop 记录 run、attempt、verification 和链接。",
        latestRun ? `- 最近关联项目：${runProjectLabel(latestRun) ?? "未关联 Codex 项目"}` : ""
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
              projectLabel: latestRun.projectLabel,
              projectPath: latestRun.projectPath,
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
              projectLabel: latestRun.projectLabel,
              projectPath: latestRun.projectPath,
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

function runProjectLabel(run) {
  if (!run) return "";
  if (run.projectLabel && run.projectPath) return `${run.projectLabel} · ${run.projectPath}`;
  return run.projectLabel ?? run.projectPath ?? "";
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
