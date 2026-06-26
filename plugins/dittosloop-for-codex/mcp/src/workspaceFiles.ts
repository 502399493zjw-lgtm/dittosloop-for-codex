import type { FormalLoopContract } from "./contract/types.js";
import type { LoopContract, LoopRun, LoopState, LoopWorkspaceFile, VerificationResultRecord } from "./types.js";
import type { ValidatorResult, VerificationResultV2 } from "./runner/verificationV2.js";

export function loopWorkspaceFiles(state: LoopState, loopId: string): LoopWorkspaceFile[] {
  const loop = state.loops.find((candidate) => candidate.id === loopId);
  if (!loop) {
    throw new Error(`Loop not found: ${loopId}`);
  }

  const loopRuns = runsForLoop(state, loopId);
  const loopState = state.loopStates.find((candidate) => candidate.loopId === loopId);
  const formalContract = state.formalContracts.find((contract) => contract.id === loopId);
  const workflowFiles = formalContract
    ? formalLoopDirectoryFiles({ contract: formalContract, state, loopRuns, loopState })
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
    ["verification.md", 2],
    ["rubrics.md", 2],
    ["status.json", 3],
    ["runs.json", 4],
    ["contract.json", 5]
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
  const memory = input.state.loopMemories.find((candidate) => candidate.loopId === input.loop.id);
  if (memory?.content) {
    return memory.content;
  }

  return "# memory\n\n暂无记忆。\n";
}

function formalLoopDirectoryFiles(input: {
  contract: FormalLoopContract;
  state: LoopState;
  loopRuns: LoopRun[];
  loopState?: LoopState["loopStates"][number];
}): LoopWorkspaceFile[] {
  const latestRun = input.loopRuns.at(0);
  const latestAttempt = latestRun
    ? [...input.state.attempts].reverse().find((attempt) => attempt.runId === latestRun.id)
    : null;
  const latestVerification = latestRun ? latestVerificationForRun(input.state, latestRun.id) : undefined;
  const rubricStatuses = rubricStatusByLabel(latestVerification);
  const taskRuns = latestRun?.codexSession?.subagents ?? [];
  const verificationFileEntry = isVerificationPolicyV2(input.contract.verification)
    ? withSize({
        path: "verification.md",
        kind: "verification",
        language: "markdown",
        content: verificationFile({ contract: input.contract, latestVerification })
      })
    : withSize({
        path: "rubrics.md",
        kind: "rubrics",
        language: "markdown",
        content: legacyRubricsFile({ contract: input.contract, rubricStatuses })
      });

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
    verificationFileEntry,
    withSize({
      path: "status.json",
      kind: "status",
      language: "json",
      content: `${JSON.stringify(
        {
          loopId: input.contract.id,
          cursor: input.loopState?.cursor ?? null,
          consecutiveFailures: input.loopState?.consecutiveFailures ?? 0,
          paused: input.loopState?.paused ?? false,
          ...(input.loopState?.pausedReason ? { pausedReason: input.loopState.pausedReason } : {}),
          running: input.loopState?.running ?? false,
          runCount: input.loopState?.runCount ?? 0,
          ...(input.loopState?.lastRunAt ? { lastRunAt: input.loopState.lastRunAt } : {}),
          ...(input.loopState?.activeRunId ? { activeRunId: input.loopState.activeRunId } : {}),
          ...(input.loopState?.activeRunStatus ? { activeRunStatus: input.loopState.activeRunStatus } : {}),
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
                completedAt: latestRun.completedAt,
                pausedReason: latestRun.pausedReason
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
            ? verificationSummaryForStatus(latestVerification)
            : null,
          runs: input.loopRuns.map((run) => ({
            id: run.id,
            status: run.status,
            goal: run.goal,
            createdAt: run.createdAt,
            completedAt: run.completedAt,
            pausedReason: run.pausedReason
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
    "这个 loop 使用 DittosLoop For Codex 的 loop skill 来创建正式 contract、启动可见 Codex worker session、执行 workflow、写回结果，并按 criteria、validators、decision 做最终验证。",
    "",
    "## Runtime role",
    "",
    "- Codex worker session 本身承担 orchestrator。",
    "- workflow body 只描述真正被调度的 specialist/editor/checker agents。",
    "- verification criteria/validators/decision 属于外部最终验证，不作为普通 agent 文件夹层级展示。",
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

function legacyRubricsFile(input: {
  contract: FormalLoopContract;
  rubricStatuses: Map<string, string>;
}): string {
  const verification = input.contract.verification as unknown as {
    mode?: string;
    rubrics?: Array<{ id: string; label: string; requirement: string; severity: string }>;
  };

  return [
    `# ${input.contract.title} verifier`,
    "",
    `Mode: \`${verification.mode ?? "after_workflow"}\``,
    "",
    ...(verification.rubrics ?? []).flatMap((rubric) =>
      [
        `## ${rubric.label}`,
        "",
        `- id: \`${rubric.id}\``,
        `- severity: \`${rubric.severity}\``,
        `- status: ${statusText(input.rubricStatuses.get(rubric.label) ?? "not-run")}`,
        `- requirement: ${rubric.requirement}`,
        input.rubricStatuses.get(`${rubric.label}:output`) ? `- evidence: ${input.rubricStatuses.get(`${rubric.label}:output`)}` : "",
        ""
      ].filter(Boolean)
    )
  ].join("\n");
}

function verificationFile(input: {
  contract: FormalLoopContract;
  latestVerification?: VerificationResultRecord;
}): string {
  const verification = input.contract.verification;
  if (!isVerificationPolicyV2(verification)) {
    return legacyRubricsFile({ contract: input.contract, rubricStatuses: rubricStatusByLabel(input.latestVerification) });
  }

  const v2Result = isVerificationResultV2(input.latestVerification) ? input.latestVerification : undefined;
  const validatorResults = v2Result?.validatorResults ?? [];

  return [
    `# ${input.contract.title} verification`,
    "",
    `Mode: \`${verification.mode}\``,
    "",
    "## Criteria",
    "| id | severity | status | covering validators |",
    "| --- | --- | --- | --- |",
    ...verification.criteria.map((criterion) => {
      const coveringValidatorIds = verification.validators
        .filter((validator) => validator.criteriaIds?.includes(criterion.id))
        .map((validator) => validator.id);
      return [
        `| \`${criterion.id}\``,
        criterion.severity,
        statusText(criterionStatus(criterion.id, validatorResults)),
        coveringValidatorIds.map((id) => `\`${id}\``).join(", ") || "none"
      ].join(" | ") + " |";
    }),
    "",
    "## Validators",
    "| id | type | severity | status | score | evidence |",
    "| --- | --- | --- | --- | --- | --- |",
    ...verification.validators.map((validator) => {
      const result = validatorResults.find((candidate) => validatorResultId(candidate) === validator.id);
      return [
        `| \`${validator.id}\``,
        validator.type,
        validator.severity,
        statusText(result?.status ?? "not-run"),
        validatorScoreText(result),
        evidenceExcerpt(result?.evidence)
      ].join(" | ") + " |";
    }),
    "",
    "## Decision",
    `- status: ${statusText(v2Result?.decision.status ?? v2Result?.status ?? "not-run")}`,
    `- summary: ${v2Result?.decision.summary ?? v2Result?.summary ?? "No verification result yet."}`,
    `- requireAllMustCriteriaCovered: ${verification.decision.requireAllMustCriteriaCovered}`,
    `- failOnMustValidatorFailure: ${verification.decision.failOnMustValidatorFailure}`,
    `- failOnShouldValidatorFailure: ${verification.decision.failOnShouldValidatorFailure}`,
    `- requireEvidenceForAgentScores: ${verification.decision.requireEvidenceForAgentScores}`,
    v2Result?.decision.repairInstructions ? `- repairInstructions: ${v2Result.decision.repairInstructions}` : "",
    v2Result?.decision.humanQuestion ? `- humanQuestion: ${v2Result.decision.humanQuestion}` : "",
    ""
  ].filter(Boolean).join("\n");
}

function latestVerificationForRun(state: LoopState, runId: string): VerificationResultRecord | undefined {
  return [...state.verificationResults].reverse().find((result) => result.runId === runId);
}

function rubricStatusByLabel(verification: VerificationResultRecord | undefined): Map<string, string> {
  const statuses = new Map<string, string>();
  if (isVerificationResultV2(verification)) {
    for (const check of verification.checks ?? []) {
      statuses.set(check.rubricId, check.status);
      if (check.evidence) {
        statuses.set(`${check.rubricId}:output`, check.evidence);
      }
    }
    return statuses;
  }

  for (const check of verification?.checks ?? []) {
    const name = check.name ?? check.rubricId;
    if (!name) continue;
    statuses.set(name, check.status);
    const evidence = check.output ?? check.evidence;
    if (evidence) {
      statuses.set(`${name}:output`, evidence);
    }
  }
  return statuses;
}

function verificationSummaryForStatus(verification: VerificationResultRecord): Record<string, unknown> {
  if (!isVerificationResultV2(verification)) {
    return {
      id: verification.id,
      status: verification.status,
      summary: verification.summary,
      checks: verification.checks ?? [],
      createdAt: verification.createdAt
    };
  }

  return {
    id: verification.id,
    version: 2,
    status: verification.status,
    summary: verification.summary,
    decision: verification.decision,
    validators: verification.validatorResults.map((result) => ({
      id: validatorResultId(result),
      type: result.type,
      label: result.label,
      status: result.status,
      score: "score" in result ? result.score : undefined,
      maxScore: "maxScore" in result ? result.maxScore : undefined,
      threshold: "threshold" in result ? result.threshold : undefined,
      exitCode: "exitCode" in result ? result.exitCode : undefined,
      evidence: evidenceExcerpt(result.evidence),
      summary: result.summary
    })),
    checks: verification.checks ?? [],
    createdAt: verification.createdAt
  };
}

function isVerificationPolicyV2(value: unknown): value is FormalLoopContract["verification"] {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 2);
}

function isVerificationResultV2(value: VerificationResultRecord | undefined): value is VerificationResultV2 {
  return Boolean(value && typeof value === "object" && (value as { version?: unknown }).version === 2);
}

function validatorResultId(result: ValidatorResult | (ValidatorResult & { id?: string })): string {
  const resultWithId = result as ValidatorResult & { id?: string };
  return result.validatorId ?? resultWithId.id ?? result.label;
}

function criterionStatus(criterionId: string, results: ValidatorResult[]): string {
  const covering = results.filter((result) => result.criteriaIds.includes(criterionId));
  if (covering.some((result) => result.status === "failed")) return "failed";
  if (covering.some((result) => result.status === "needs_human")) return "needs_human";
  if (covering.some((result) => result.status === "passed")) return "passed";
  return "not-run";
}

function validatorScoreText(result: ValidatorResult | undefined): string {
  if (!result || !("score" in result) || typeof result.score !== "number") return "";
  const maxScore = "maxScore" in result && typeof result.maxScore === "number" ? `/${result.maxScore}` : "";
  return `${result.score}${maxScore}`;
}

function evidenceExcerpt(value: string | undefined): string {
  if (!value) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
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
