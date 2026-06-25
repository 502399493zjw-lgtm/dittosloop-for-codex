import type { FormalLoopContract, Step } from "./contract/types.js";
import type { LoopContract, LoopRun, LoopState, LoopWorkspaceFile, VerificationResult } from "./types.js";

export function loopWorkspaceFiles(state: LoopState, loopId: string): LoopWorkspaceFile[] {
  const loop = state.loops.find((candidate) => candidate.id === loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  const loopRuns = runsForLoop(state, loopId);
  const formalContract = state.formalContracts.find((contract) => contract.id === loopId);
  const workflowFiles = formalContract
    ? formalLoopDirectoryFiles({ contract: formalContract, state, loopRuns })
    : [];

  return sortLoopWorkspaceFiles([
    withSize({
      path: "memory.md",
      kind: "memory",
      language: "markdown",
      content: memoryFile({ state, loop })
    }),
    ...workflowFiles,
    withSize({
      path: "contract.json",
      kind: "contract",
      language: "json",
      content: contractFile({ state, loop, formalContract, loopRuns })
    })
  ]);
}

function withSize(file: Omit<LoopWorkspaceFile, "size">): LoopWorkspaceFile {
  return { ...file, size: Buffer.byteLength(file.content, "utf8") };
}

function sortLoopWorkspaceFiles(files: LoopWorkspaceFile[]): LoopWorkspaceFile[] {
  const rootOrder = new Map([
    ["memory.md", 0],
    ["workflow.json", 1],
    ["tool-list.md", 2],
    ["rubrics.md", 3],
    ["status.json", 4],
    ["runs.json", 5],
    ["contract.json", 6]
  ]);

  return [...files].sort((left, right) => {
    const leftIsSkill = left.path.startsWith("skill/");
    const rightIsSkill = right.path.startsWith("skill/");
    if (leftIsSkill !== rightIsSkill) return leftIsSkill ? 1 : -1;

    const leftRank = rootOrder.get(left.path) ?? 100;
    const rightRank = rootOrder.get(right.path) ?? 100;
    if (leftRank !== rightRank) return leftRank - rightRank;

    return left.path.localeCompare(right.path);
  });
}

function runsForLoop(state: LoopState, loopId: string): LoopRun[] {
  return state.runs
    .filter((run) => run.loopId === loopId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function memoryFile(input: { state: LoopState; loop: LoopContract }): string {
  const commits = input.state.memoryCommits
    .filter((commit) => commit.loopId === input.loop.id)
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  if (commits.length === 0) {
    return [`# ${input.loop.title}`, "", input.loop.intent, "", "## Memory commits", "暂无记忆。", ""].join("\n");
  }

  return [
    `# ${input.loop.title}`,
    "",
    input.loop.intent,
    "",
    "## Memory commits",
    ...commits.map((commit) =>
      [
        `- ${commit.createdAt}: ${commit.summary}`,
        commit.runId ? `  - run: ${commit.runId}` : null
      ].filter(Boolean).join("\n")
    ),
    ""
  ].join("\n");
}

function formalLoopDirectoryFiles(input: {
  contract: FormalLoopContract;
  state: LoopState;
  loopRuns: LoopRun[];
}): LoopWorkspaceFile[] {
  const agentSteps = flattenContractSteps(input.contract.body?.steps ?? []).filter(isAgentLikeStep);
  const latestRun = input.loopRuns.at(0);
  const latestAttempt = latestRun
    ? [...input.state.attempts].reverse().find((attempt) => attempt.runId === latestRun.id)
    : null;
  const latestVerification = latestRun ? latestVerificationForRun(input.state, latestRun.id) : undefined;
  const rubricStatuses = rubricStatusByLabel(latestVerification);
  const taskRuns = latestRun?.codexSession?.subagents ?? [];

  return [
    withSize({
      path: "workflow.json",
      kind: "workflow",
      language: "json",
      content: `${JSON.stringify(
        {
          id: input.contract.id,
          title: input.contract.title,
          goal: input.contract.goal,
          status: input.contract.status,
          latestRunStatus: latestRun?.status ?? null,
          latestAttemptStatus: latestAttempt?.status ?? null,
          latestVerificationStatus: latestVerification?.status ?? null,
          body: input.contract.body,
          repairPolicy: input.contract.repairPolicy,
          stopPolicy: input.contract.stopPolicy,
          projectBinding: input.contract.projectBinding
        },
        null,
        2
      )}\n`
    }),
    withSize({
      path: "skill/dittosloop-for-codex-loop.md",
      kind: "skill",
      language: "markdown",
      content: loopSkillFile(input.contract)
    }),
    withSize({
      path: "tool-list.md",
      kind: "tools",
      language: "markdown",
      content: toolListFile({ contract: input.contract, agentSteps })
    }),
    withSize({
      path: "rubrics.md",
      kind: "rubrics",
      language: "markdown",
      content: [
        `# ${input.contract.title} verifier`,
        "",
        `Mode: \`${input.contract.verification?.mode ?? "after_workflow"}\``,
        "",
        ...(input.contract.verification?.rubrics ?? []).flatMap((rubric) =>
          [
            `## ${rubric.label}`,
            "",
            `- id: \`${rubric.id}\``,
            `- severity: \`${rubric.severity}\``,
            `- status: ${statusText(rubricStatuses.get(rubric.label) ?? "not-run")}`,
            `- requirement: ${rubric.requirement}`,
            rubricStatuses.get(`${rubric.label}:output`) ? `- evidence: ${rubricStatuses.get(`${rubric.label}:output`)}` : "",
            ""
          ].filter(Boolean)
        )
      ].join("\n")
    }),
    withSize({
      path: "status.json",
      kind: "status",
      language: "json",
      content: `${JSON.stringify(
        {
          workflow: {
            totalTasks: taskRuns.length,
            completedTasks: taskRuns.filter((task) => task.status === "completed").length,
            runningTasks: taskRuns.filter((task) => task.status === "running" || task.status === "requested").length,
            failedTasks: taskRuns.filter((task) => task.status === "failed").length,
            tasks: taskRuns
          },
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
                createdAt: latestAttempt.createdAt,
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
          runs: input.loopRuns.map((run) => ({
            id: run.id,
            status: run.status,
            goal: run.goal,
            createdAt: run.createdAt,
            completedAt: run.completedAt
          }))
        },
        null,
        2
      )}\n`
    })
  ];
}

function loopSkillFile(contract: FormalLoopContract): string {
  return [
    "# dittosloop-for-codex:loop",
    "",
    `Loop: ${contract.title}`,
    "",
    "这个 loop 使用 DittosLoop For Codex 的 loop skill 来创建正式 contract、启动可见 Codex worker session、执行 workflow、写回结果，并按 rubrics 做最终验证。",
    "",
    "## Runtime role",
    "",
    "- Codex worker session 本身承担 orchestrator。",
    "- workflow body 只描述真正被调度的 specialist/editor/checker agents。",
    "- verifier/rubrics 属于外部最终验证，不作为普通 agent 文件夹层级展示。",
    ""
  ].join("\n");
}

function toolListFile(input: { contract: FormalLoopContract; agentSteps: Array<Extract<Step, { kind: "agent" | "task" }>> }): string {
  const declaredTools = new Set<string>();
  for (const step of input.agentSteps) {
    for (const tool of step.subagent?.tools ?? []) {
      declaredTools.add(tool);
    }
  }

  const runtimeTools = [
    "start_codex_session",
    "execute_workflow_attempt",
    "record_session_result",
    "record_verification",
    "get_run_detail"
  ];

  return [
    `# ${input.contract.title} tool list`,
    "",
    "## DittosLoop runtime",
    "",
    ...runtimeTools.map((tool) => `- ${tool}`),
    "",
    "## Workflow agents",
    "",
    ...input.agentSteps.flatMap((step) => {
      const subagent = step.subagent;
      return [
        `### ${step.label}`,
        "",
        `- id: \`${step.id}\``,
        `- role: \`${subagent?.role ?? step.id}\``,
        `- tools: ${(subagent?.tools ?? []).length > 0 ? subagent?.tools?.map((tool) => `\`${tool}\``).join(", ") : "未声明"}`,
        `- filesystem: \`${subagent?.permissions?.filesystem ?? "workspace-write"}\``,
        `- network: \`${subagent?.permissions?.network ?? "enabled"}\``,
        ""
      ];
    }),
    "## Declared tool names",
    "",
    declaredTools.size > 0 ? [...declaredTools].sort().map((tool) => `- ${tool}`).join("\n") : "- 未声明",
    ""
  ].join("\n");
}

function contractFile(input: {
  state: LoopState;
  loop: LoopContract;
  formalContract?: FormalLoopContract;
  loopRuns: LoopRun[];
}): string {
  const runIds = new Set(input.loopRuns.map((run) => run.id));
  return `${JSON.stringify(
    {
      loop: input.loop,
      formalContract: input.formalContract ?? null,
      workflowRevisions: input.state.workflowRevisions.filter((revision) => revision.loopId === input.loop.id),
      runs: input.loopRuns,
      attempts: input.state.attempts.filter((attempt) => runIds.has(attempt.runId)),
      events: input.state.events.filter((event) => runIds.has(event.runId)),
      verificationResults: input.state.verificationResults.filter((result) => runIds.has(result.runId)),
      humanRequests: input.state.humanRequests.filter((request) => runIds.has(request.runId)),
      memoryCommits: input.state.memoryCommits.filter((commit) => commit.loopId === input.loop.id),
      artifacts: input.state.artifacts.filter((artifact) => runIds.has(artifact.runId))
    },
    null,
    2
  )}\n`;
}

function latestVerificationForRun(state: LoopState, runId: string): VerificationResult | undefined {
  return [...state.verificationResults].reverse().find((result) => result.runId === runId);
}

function rubricStatusByLabel(verification: VerificationResult | undefined): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const check of verification?.checks ?? []) {
    statuses.set(check.name, check.status);
    if (check.output) {
      statuses.set(`${check.name}:output`, check.output);
    }
  }
  return statuses;
}

function flattenContractSteps(steps: Step[]): Step[] {
  const result: Step[] = [];
  for (const step of steps) {
    result.push(step);
    if (step.kind === "phase" || step.kind === "parallel") {
      result.push(...flattenContractSteps(step.children));
    }
  }
  return result;
}

function isAgentLikeStep(step: Step): step is Extract<Step, { kind: "agent" | "task" }> {
  return step.kind === "agent" || step.kind === "task";
}

function statusText(status: string): string {
  const labels: Record<string, string> = {
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
    resolved: "已解决"
  };
  return labels[status] ?? status;
}
