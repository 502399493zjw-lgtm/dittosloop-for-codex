import type { FormalLoopContract, Step } from "./contract/types.js";
import type { LoopContract, LoopRun, LoopState, LoopWorkspaceFile, VerificationResult } from "./types.js";

type DirectoryEngineEvent = Record<string, unknown> & {
  type?: string;
  sequence?: number;
  stepId?: string;
  nodeId?: string;
};

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

  return [
    withSize({
      path: "flow.js",
      kind: "flow",
      language: "javascript",
      content: formalContract ? formalWorkflowFlowFile(formalContract) : compatibilityFlowFile(loop)
    }),
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
    }),
    withSize({
      path: "session.json",
      kind: "session",
      language: "json",
      content: sessionFile({ loop, latestRun: loopRuns.at(0) })
    })
  ];
}

function withSize(file: Omit<LoopWorkspaceFile, "size">): LoopWorkspaceFile {
  return { ...file, size: Buffer.byteLength(file.content, "utf8") };
}

function runsForLoop(state: LoopState, loopId: string): LoopRun[] {
  return state.runs
    .filter((run) => run.loopId === loopId)
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
}

function compatibilityFlowFile(loop: LoopContract): string {
  return [
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
    "}",
    ""
  ].join("\n");
}

function formalWorkflowFlowFile(contract: FormalLoopContract): string {
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
    "}",
    ""
  ];
  return lines.join("\n");
}

function workflowStepLines(steps: Step[], indent: string): string[] {
  return steps.flatMap((step) => workflowStepLine(step, indent));
}

function workflowStepLine(step: Step, indent: string): string[] {
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
    `${indent}await runAgent(context, results, ${JSON.stringify(
      {
        id: step.id,
        label: step.label,
        prompt: step.prompt ?? "",
        verifierRef: step.verifierRef,
        sessionPolicy: step.sessionPolicy
      },
      null,
      2
    ).replaceAll("\n", `\n${indent}`)});`
  ];
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
  const agentSteps = flattenContractSteps(input.contract.body?.steps ?? []).filter((step) => step.kind === "agent");
  const latestRun = input.loopRuns.at(0);
  const latestAttempt = latestRun
    ? [...input.state.attempts].reverse().find((attempt) => attempt.runId === latestRun.id)
    : null;
  const latestVerification = latestRun ? latestVerificationForRun(input.state, latestRun.id) : undefined;
  const engineEvents = latestRun ? engineEventsForRun(input.state, latestRun.id) : [];
  const agentStatuses = agentStatusByStepId(engineEvents);
  const rubricStatuses = rubricStatusByLabel(latestVerification);

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
      path: "agents.md",
      kind: "agents",
      language: "markdown",
      content: [
        `# ${input.contract.title} agents`,
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
      path: "runs.json",
      kind: "runs",
      language: "json",
      content: `${JSON.stringify(
        {
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

function sessionFile(input: { loop: LoopContract; latestRun?: LoopRun }): string {
  return `${JSON.stringify(
    {
      launch: "host-mediated-new-codex-session",
      projectBinding: {
        mode: "select-codex-project",
        codexProjectId: input.latestRun?.codexProjectId ?? input.loop.codexProjectId ?? null,
        projectLabel: input.latestRun?.projectLabel ?? input.loop.projectLabel ?? null,
        projectPath: input.latestRun?.projectPath ?? input.loop.projectPath ?? null
      },
      execution: {
        host: "codex-app",
        worker: "new-codex-session"
      },
      launchRequest: input.latestRun?.codexSession
        ? {
            runId: input.latestRun.id,
            loopId: input.latestRun.loopId,
            title: `DittosLoop: ${input.loop.title}`,
            prompt: input.latestRun.codexSession.prompt,
            status: input.latestRun.codexSession.status,
            threadId: input.latestRun.codexSession.threadId,
            threadTitle: input.latestRun.codexSession.threadTitle,
            threadUrl: input.latestRun.codexSession.threadUrl
          }
        : null,
      hostWriteback: {
        required: true,
        api: input.latestRun ? `/api/runs/${input.latestRun.id}/codex-thread` : "/api/runs/{runId}/codex-thread",
        mcpTool: "record_codex_thread",
        fields: ["threadId", "threadTitle", "threadUrl"]
      },
      userPromptInjection: {
        timing: ["session-start", "context-compaction"],
        source: ["loopable.md", "loop memory", "latest user confirmation"]
      }
    },
    null,
    2
  )}\n`;
}

function latestVerificationForRun(state: LoopState, runId: string): VerificationResult | undefined {
  return [...state.verificationResults].reverse().find((result) => result.runId === runId);
}

function engineEventsForRun(state: LoopState, runId: string): DirectoryEngineEvent[] {
  return state.events
    .filter((event) => event.runId === runId)
    .map((event) => event.data?.engineEvent)
    .filter(isRecord)
    .sort((left, right) => (numberValue(left.sequence) ?? 0) - (numberValue(right.sequence) ?? 0));
}

function agentStatusByStepId(engineEvents: DirectoryEngineEvent[]): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const event of engineEvents) {
    const stepId = stringValue(event.stepId) ?? stringValue(event.nodeId);
    if (!stepId) continue;
    if (event.type === "agent_started") {
      statuses.set(stepId, "running");
    }
    if (event.type === "agent_done") {
      statuses.set(stepId, "completed");
    }
    if (event.type === "agent_failed") {
      statuses.set(stepId, "failed");
    }
  }
  return statuses;
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

function isRecord(value: unknown): value is DirectoryEngineEvent {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
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
