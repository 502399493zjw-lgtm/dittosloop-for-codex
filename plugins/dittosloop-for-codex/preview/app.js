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

  renderLoopStage({ snapshot: currentSnapshot, detail: await response.json() });
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
        el("button", "danger-button", "删除")
      ])
    ]),
    renderLoopTabs(),
    activeLoopTab === "directory"
      ? renderLoopDirectory({ loop, loopRuns, checks })
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
    renderError("没有可用的 Codex App 项目，无法生成启动请求。");
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
  selectedRunId = launch.run.id;
  selectedLoopId = launch.run.loopId;
  activeLoopTab = "history";
  writeRouteState("run", selectedRunId);
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

function renderLoopDirectory({ loop, loopRuns, checks }) {
  const latestRun = loopRuns.at(0);
  const files = buildLoopDirectoryFiles({ loop, loopRuns, checks });
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
    const row = button("history-row", () => {
      selectedRunId = run.id;
      writeRouteState("run", run.id);
      void loadRunDetail(run.id);
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
      el("span", "open-run", "点开看 ›")
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
      ])
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
          name: "当前 Codex session",
          status: run.codexSession.status === "requested" ? run.status : run.codexSession.status,
          description: "Loop 在当前 Codex 对话里继续推进，并把执行工作交给子 agent。",
          meta: runProjectLabel(run) || "当前项目",
          threadId: run.codexSession.threadId,
          threadTitle: run.codexSession.threadTitle,
          threadUrl: run.codexSession.threadUrl
        },
        ...(run.codexSession.subagents ?? []).map((subagent, index) => ({
          id: `${run.id}-subagent-${index}`,
          avatar: "子",
          name: "Codex subagent",
          status: subagent.status,
          description: subagent.prompt ?? "读取 loop 目标、历史和验证点并执行本轮任务。",
          meta: subagent.role,
          threadId: subagent.threadId ?? run.codexSession.threadId,
          threadTitle: subagent.threadTitle ?? run.codexSession.threadTitle,
          threadUrl: subagent.threadUrl ?? run.codexSession.threadUrl
        }))
      ]
    : [];
  const attemptAgents = detail.attempts.map((attempt) => ({
    id: attempt.id,
    avatar: "启",
    name: "Codex subagent attempt",
    status: attempt.status,
    description: attempt.summary ?? attempt.id,
    meta: attempt.completedAt ? formatDate.format(new Date(attempt.completedAt)) : "运行中",
    threadId: run.codexSession?.threadId,
    threadTitle: run.codexSession?.threadTitle,
    threadUrl: run.codexSession?.threadUrl
  }));
  const verificationAgents = detail.verificationResults.map((result) => ({
    id: result.id,
    avatar: result.status === "failed" ? "!" : "验",
    name: "Verification",
    status: result.status,
    description: result.summary,
    meta: result.attemptId ? `Attempt ${result.attemptId}` : "Run level"
  }));
  const timelineAgents = detail.events.map((event) => ({
    id: event.id,
    avatar: event.kind === "run_created" ? "启" : event.kind === "human_request" ? "问" : "记",
    name: event.kind === "run_created" ? "当前 session 绑定" : statusText(event.kind),
    status: event.kind === "attempt_started" ? "running" : event.kind === "verification_recorded" ? "passed" : run.status,
    description: event.message,
    meta: event.data?.projectPath ? `${event.data.projectPath}` : formatDate.format(new Date(event.createdAt))
  }));

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
      id: "timeline",
      name: "时间线",
      status: run.status,
      agents: timelineAgents
    }
  ];
}

function renderAgentCard(agent) {
  const sessionLabel = agent.threadTitle ?? (agent.threadId ? shortThreadId(agent.threadId) : "待 Codex App 创建");
  const card = button("agent-card", () => {
    if (agent.threadUrl) {
      window.location.href = agent.threadUrl;
    }
  }, [
    el("div", "agent-card-row", [
      el("span", "agent-avatar", agent.avatar),
      el("span", "agent-name", [
        agent.name,
        el("span", "agent-diamond", "")
      ]),
      el("span", "agent-spacer", ""),
      statusChip(agent.status),
      el("span", `agent-session-link ${agent.threadId ? "linked" : "pending"}`, sessionLabel)
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

function shortThreadId(threadId) {
  return threadId.length > 12 ? `${threadId.slice(0, 8)}...${threadId.slice(-4)}` : threadId;
}

function renderSummaryOutput(detail) {
  const latestVerification = detail.verificationResults.at(-1);
  const memories = detail.memoryCommits ?? [];
  const artifacts = detail.artifacts ?? [];
  if (!latestVerification && memories.length === 0 && artifacts.length === 0) {
    return null;
  }

  return el("section", "summary-output", [
    el("div", "summary-kicker", "汇总输出"),
    latestVerification ? el("p", "summary-copy", latestVerification.summary) : null,
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

function buildLoopDirectoryFiles({ loop, loopRuns, checks }) {
  const latestRun = loopRuns.at(0);
  return [
    {
      path: "flow.js",
      language: "javascript",
      meta: "JS",
      content: [
        `export const loop = ${JSON.stringify(loop.title)};`,
        "",
        "export async function run(context) {",
        "  const session = context.codex.currentSession;",
        "  const subagent = await session.spawnSubagent({",
        "    project: context.project ?? '当前 Codex 工作区',",
        "    input: context.userPrompt",
        "  });",
        "",
        "  await context.dittosloop.startAttempt({ sessionId: session.id, subagentId: subagent.id });",
        "  await context.dittosloop.recordProgress('在当前 session 中派发子 agent 并回写 run 状态');",
        "  return subagent;",
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
        "- Loop 触发时复用当前 Codex session。",
        "- 当前 session 负责接收提醒、展示状态和协调回写。",
        "- 实际执行交给当前 session 下的子 agent。",
        "- session 输入作为 user prompt 注入，提醒 agent 读取 loop 目标、历史和验证点。",
        "- session 结束后把 attempt、event、verification 回写到本地状态。",
        latestRun ? `- 最近关联项目：${runProjectLabel(latestRun) ?? "未关联 Codex 项目"}` : ""
      ].join("\n")
    },
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
        launch: "current-session-with-subagent",
        projectBinding: {
          mode: "select-codex-project",
          default: "current-workspace"
        },
        execution: {
          mainAgent: "current-codex-session",
          worker: "subagent"
        },
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
    const run = (snapshot.runs ?? []).find((item) => item.id === route.runId);
    if (run) {
      selectedRunId = run.id;
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
