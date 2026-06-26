import { spawn } from "node:child_process";
import path from "node:path";

import type {
  ScoreValidator,
  VerificationCommandValidator,
  VerificationPolicyV2,
  VerificationRubricAgentValidator,
  VerificationValidator
} from "../contract/types.js";
import type { VerificationDecisionCheck, VerificationDecisionStatus } from "./verifier.js";

export const MAX_EVIDENCE_CHARS = 8000;

export interface CommandExecutionRequest {
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface CommandExecutionResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
  error?: string;
}

export type CommandExecutor = (request: CommandExecutionRequest) => Promise<CommandExecutionResult>;

interface ValidatorResultBase {
  validatorId: string;
  type: VerificationValidator["type"];
  label: string;
  severity: "must" | "should";
  criteriaIds: string[];
  status: VerificationDecisionStatus;
  summary: string;
  evidence?: string;
}

export interface CommandValidatorResult extends ValidatorResultBase {
  type: "command";
  command: string;
  args: string[];
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface ScoreValidatorResult extends ValidatorResultBase {
  type: "score";
  metric: string;
  source: ScoreValidator["source"];
  operator: ScoreValidator["operator"];
  threshold: number;
  score?: number;
}

export interface RubricAgentValidatorResult extends ValidatorResultBase {
  type: "rubric_agent";
  score?: number;
  output?: unknown;
}

export type ValidatorResult =
  | CommandValidatorResult
  | ScoreValidatorResult
  | RubricAgentValidatorResult;

export interface AggregatedVerificationDecision {
  status: VerificationDecisionStatus;
  summary: string;
  failedValidatorIds: string[];
  needsHumanValidatorIds: string[];
  failedCriterionIds: string[];
  uncoveredMustCriterionIds: string[];
  warnings: string[];
  repairInstructions?: string;
  humanQuestion?: string;
}

export interface VerificationResultV2 {
  id: string;
  version: 2;
  runId: string;
  attemptId?: string;
  status: VerificationDecisionStatus;
  summary: string;
  checks: VerificationDecisionCheck[];
  validatorResults: ValidatorResult[];
  decision: AggregatedVerificationDecision;
  repairInstructions?: string;
  humanQuestion?: string;
  createdAt: string;
}

export type RunVerificationV2Event =
  | {
      type: "validator_started";
      attemptId?: string;
      validatorId: string;
      validatorType: VerificationValidator["type"];
      label?: string;
    }
  | {
      type: "validator_done";
      attemptId?: string;
      result: ValidatorResult;
    }
  | {
      type: "verification_decided";
      attemptId?: string;
      decision: AggregatedVerificationDecision;
    };

export interface RunVerificationV2Input {
  id: string;
  runId: string;
  attemptId?: string;
  createdAt: string;
  policy: VerificationPolicyV2;
  workflowResult: unknown;
  projectPath?: string;
  contractWorkspacePath?: string;
  priorValidatorResults?: ValidatorResult[];
  commandExecutor?: CommandExecutor;
  emit?: (event: RunVerificationV2Event) => void;
}

export interface RecordedRubricAgentResultInput {
  status?: VerificationDecisionStatus;
  score?: number;
  evidence?: string;
  summary?: string;
  output?: unknown;
}

export async function runVerificationV2(input: RunVerificationV2Input): Promise<VerificationResultV2> {
  const validatorResults: ValidatorResult[] = [...(input.priorValidatorResults ?? [])];

  for (const validator of input.policy.validators) {
    if (validatorResults.some((result) => result.validatorId === validator.id)) {
      continue;
    }

    input.emit?.({
      type: "validator_started",
      attemptId: input.attemptId,
      validatorId: validator.id,
      validatorType: validator.type,
      label: validator.label
    });
    const result = await runDeterministicValidator(validator, input, validatorResults);
    input.emit?.({ type: "validator_done", attemptId: input.attemptId, result });
    validatorResults.push(result);
  }

  const decision = aggregateVerificationDecision(input.policy, validatorResults);
  input.emit?.({ type: "verification_decided", attemptId: input.attemptId, decision });
  return {
    id: input.id,
    version: 2,
    runId: input.runId,
    attemptId: input.attemptId,
    status: decision.status,
    summary: decisionSummary(decision),
    checks: validatorResultsToDecisionChecks(validatorResults),
    validatorResults,
    decision,
    repairInstructions: decision.repairInstructions,
    humanQuestion: decision.humanQuestion,
    createdAt: input.createdAt
  };
}

export function aggregateVerificationDecision(
  policy: VerificationPolicyV2,
  validatorResults: ValidatorResult[]
): AggregatedVerificationDecision {
  const effectiveResults = validatorResults.map((result) => enforceRubricAgentPolicy(policy, result));
  const failures = effectiveResults.filter((result) => result.status === "failed");
  const mustFailures = failures.filter((result) => result.severity === "must");
  const shouldFailures = failures.filter((result) => result.severity === "should");
  const needsHuman = effectiveResults.filter((result) => result.status === "needs_human");
  const uncoveredMustCriterionIds = findUncoveredMustCriterionIds(policy, effectiveResults);
  const warnings = shouldFailures.map((result) => `${result.label} failed: ${result.summary}`);

  if (needsHuman.length > 0) {
    return {
      status: "needs_human",
      summary: "Verification needs human review.",
      failedValidatorIds: failures.map((result) => result.validatorId),
      needsHumanValidatorIds: needsHuman.map((result) => result.validatorId),
      failedCriterionIds: unique(failures.flatMap((result) => result.criteriaIds)),
      uncoveredMustCriterionIds,
      warnings,
      humanQuestion: `Review required for validators: ${needsHuman.map((result) => result.validatorId).join(", ")}`
    };
  }

  if (policy.decision.failOnMustValidatorFailure && mustFailures.length > 0) {
    return failedDecision("Must validator failed.", mustFailures, uncoveredMustCriterionIds, warnings);
  }

  if (policy.decision.failOnShouldValidatorFailure && shouldFailures.length > 0) {
    return failedDecision("Should validator failed.", shouldFailures, uncoveredMustCriterionIds, warnings);
  }

  if (policy.decision.requireAllMustCriteriaCovered && uncoveredMustCriterionIds.length > 0) {
    return {
      status: "failed",
      summary: "Must criteria were not covered by verification results.",
      failedValidatorIds: [],
      needsHumanValidatorIds: [],
      failedCriterionIds: uncoveredMustCriterionIds,
      uncoveredMustCriterionIds,
      warnings,
      repairInstructions: `Add verification coverage for must criteria: ${uncoveredMustCriterionIds.join(", ")}`
    };
  }

  return {
    status: "passed",
    summary: warnings.length > 0 ? "Verification passed with warnings." : "Verification passed.",
    failedValidatorIds: [],
    needsHumanValidatorIds: [],
    failedCriterionIds: [],
    uncoveredMustCriterionIds,
    warnings
  };
}

export function recordedRubricAgentResultToValidatorResult(
  validator: VerificationRubricAgentValidator,
  input: RecordedRubricAgentResultInput
): RubricAgentValidatorResult {
  const hasRequiredEvidence = !validator.evidenceRequired || Boolean(input.evidence?.trim());
  const hasScore = typeof input.score === "number" && Number.isFinite(input.score);
  const status = rubricAgentStatusFromInput(validator, input.status, input.score, hasScore, hasRequiredEvidence);

  return {
    validatorId: validator.id,
    type: "rubric_agent",
    label: validator.label,
    severity: validator.severity,
    criteriaIds: validator.criteriaIds,
    status,
    summary: input.summary ?? rubricAgentSummary(validator, input.score, hasRequiredEvidence),
    evidence: input.evidence,
    score: input.score,
    output: input.output
  };
}

async function runDeterministicValidator(
  validator: VerificationValidator,
  input: RunVerificationV2Input,
  validatorResults: ValidatorResult[]
): Promise<ValidatorResult> {
  switch (validator.type) {
    case "command":
      return runCommandValidator(validator, input);
    case "score":
      return runScoreValidator(validator, input, validatorResults);
    case "rubric_agent":
      return rubricAgentNeedsHumanResult(validator);
  }
}

async function runCommandValidator(
  validator: VerificationCommandValidator,
  input: RunVerificationV2Input
): Promise<CommandValidatorResult> {
  const executor = input.commandExecutor ?? defaultCommandExecutor;
  const args = validator.args ?? [];
  const cwd = resolveCommandCwd(validator, input);
  const execution = await executor({
    command: validator.command,
    args,
    cwd,
    timeoutMs: validator.timeoutMs
  });
  const stdout = truncateEvidence(execution.stdout);
  const stderr = truncateEvidence(execution.stderr);
  const error = execution.error ? truncateEvidence(execution.error) : undefined;
  const passed = execution.exitCode === 0 && !execution.timedOut && !error;

  return {
    validatorId: validator.id,
    type: "command",
    label: validator.label,
    severity: validator.severity,
    criteriaIds: validator.criteriaIds ?? [],
    status: passed ? "passed" : "failed",
    summary: passed
      ? `Command validator ${validator.id} passed.`
      : `Command validator ${validator.id} failed.`,
    evidence: commandEvidence(stdout, stderr, error),
    command: validator.command,
    args,
    cwd,
    exitCode: execution.exitCode,
    stdout,
    stderr,
    timedOut: execution.timedOut
  };
}

function runScoreValidator(
  validator: ScoreValidator,
  input: RunVerificationV2Input,
  validatorResults: ValidatorResult[]
): ScoreValidatorResult {
  const sourceValue = readScoreSource(validator, input, validatorResults);
  const base = {
    validatorId: validator.id,
    type: "score" as const,
    label: validator.label,
    severity: validator.severity,
    criteriaIds: validator.criteriaIds ?? [],
    metric: validator.metric,
    source: validator.source,
    operator: validator.operator,
    threshold: validator.threshold
  };

  if (sourceValue.status === "needs_human") {
    return {
      ...base,
      status: "needs_human",
      summary: sourceValue.summary,
      evidence: sourceValue.summary
    };
  }

  if (typeof sourceValue.value !== "number" || !Number.isFinite(sourceValue.value)) {
    return {
      ...base,
      status: "failed",
      summary: `Score source for ${validator.metric} did not resolve to a finite number.`,
      evidence: `Resolved value: ${JSON.stringify(sourceValue.value)}`
    };
  }

  const passed = compareScore(sourceValue.value, validator.operator, validator.threshold);
  return {
    ...base,
    status: passed ? "passed" : "failed",
    summary: passed
      ? `${validator.metric} satisfied ${validator.operator} ${validator.threshold}.`
      : `${validator.metric} did not satisfy ${validator.operator} ${validator.threshold}.`,
    evidence: `${validator.metric}=${sourceValue.value}`,
    score: sourceValue.value
  };
}

function rubricAgentNeedsHumanResult(validator: VerificationRubricAgentValidator): RubricAgentValidatorResult {
  return {
    validatorId: validator.id,
    type: "rubric_agent",
    label: validator.label,
    severity: validator.severity,
    criteriaIds: validator.criteriaIds,
    status: "needs_human",
    summary: "Rubric agent validator requires an explicit recorded result."
  };
}

function readScoreSource(
  validator: ScoreValidator,
  input: RunVerificationV2Input,
  validatorResults: ValidatorResult[]
): { status: "resolved"; value: unknown } | { status: "needs_human"; summary: string } {
  const source = validator.source;
  switch (source.type) {
    case "workflow_result":
      return { status: "resolved", value: readPath(input.workflowResult, source.path) };
    case "validator_output": {
      const priorResult = validatorResults.find((result) => result.validatorId === source.validatorId);
      return { status: "resolved", value: readPath(priorResult, source.path) };
    }
    case "artifact":
      return {
        status: "needs_human",
        summary: `Artifact score source ${source.artifactId}:${source.path} requires an artifact loader.`
      };
  }
}

function compareScore(score: number, operator: ScoreValidator["operator"], threshold: number): boolean {
  switch (operator) {
    case ">=":
      return score >= threshold;
    case ">":
      return score > threshold;
    case "<=":
      return score <= threshold;
    case "<":
      return score < threshold;
    case "==":
      return score === threshold;
    case "!=":
      return score !== threshold;
  }
}

function findUncoveredMustCriterionIds(policy: VerificationPolicyV2, validatorResults: ValidatorResult[]): string[] {
  const coveredCriterionIds = new Set<string>();
  for (const result of validatorResults) {
    for (const criterionId of result.criteriaIds) {
      coveredCriterionIds.add(criterionId);
    }
  }

  return policy.criteria
    .filter((criterion) => criterion.severity === "must" && !coveredCriterionIds.has(criterion.id))
    .map((criterion) => criterion.id);
}

function failedDecision(
  summary: string,
  failures: ValidatorResult[],
  uncoveredMustCriterionIds: string[],
  warnings: string[]
): AggregatedVerificationDecision {
  return {
    status: "failed",
    summary,
    failedValidatorIds: failures.map((result) => result.validatorId),
    needsHumanValidatorIds: [],
    failedCriterionIds: unique(failures.flatMap((result) => result.criteriaIds)),
    uncoveredMustCriterionIds,
    warnings,
    repairInstructions: failures.map((result) => result.summary).join("\n")
  };
}

function enforceRubricAgentPolicy(policy: VerificationPolicyV2, result: ValidatorResult): ValidatorResult {
  if (result.type !== "rubric_agent" || result.status !== "passed") {
    return result;
  }

  const validator = policy.validators.find((candidate) =>
    candidate.id === result.validatorId && candidate.type === "rubric_agent"
  );
  const requiresEvidence = policy.decision.requireEvidenceForAgentScores
    || (validator?.type === "rubric_agent" && validator.evidenceRequired);
  const hasRequiredEvidence = !requiresEvidence || Boolean(result.evidence?.trim());
  const hasScore = typeof result.score === "number" && Number.isFinite(result.score);

  if (!hasScore || !hasRequiredEvidence) {
    return {
      ...result,
      status: "needs_human",
      summary: !hasScore
        ? "Rubric agent result requires a finite score."
        : "Rubric agent result requires evidence."
    };
  }

  if (validator?.type === "rubric_agent" && result.score !== undefined && result.score < validator.passScore) {
    return {
      ...result,
      status: "failed",
      summary: `${validator.label} failed with score ${result.score}.`
    };
  }

  return result;
}

function validatorResultsToDecisionChecks(validatorResults: ValidatorResult[]): VerificationDecisionCheck[] {
  return validatorResults.flatMap((result) => {
    const rubricIds = result.criteriaIds.length > 0 ? result.criteriaIds : [result.validatorId];
    return rubricIds.map((rubricId) => ({
      rubricId,
      status: result.status,
      evidence: result.evidence
    }));
  });
}

function rubricAgentStatusFromInput(
  validator: VerificationRubricAgentValidator,
  requestedStatus: VerificationDecisionStatus | undefined,
  score: number | undefined,
  hasScore: boolean,
  hasRequiredEvidence: boolean
): VerificationDecisionStatus {
  if (requestedStatus === "failed" || requestedStatus === "needs_human") {
    return requestedStatus;
  }
  if (!hasScore || !hasRequiredEvidence) {
    return "needs_human";
  }
  return score! >= validator.passScore ? "passed" : "failed";
}

function decisionSummary(decision: AggregatedVerificationDecision): string {
  if (decision.status === "passed" && decision.warnings.length > 0) {
    return `${decision.summary} ${decision.warnings.join(" ")}`;
  }
  return decision.summary;
}

function rubricAgentSummary(
  validator: VerificationRubricAgentValidator,
  score: number | undefined,
  hasRequiredEvidence: boolean
): string {
  if (typeof score !== "number" || !Number.isFinite(score)) {
    return "Rubric agent result requires a finite score.";
  }
  if (!hasRequiredEvidence) {
    return "Rubric agent result requires evidence.";
  }
  return score >= validator.passScore
    ? `${validator.label} passed with score ${score}.`
    : `${validator.label} failed with score ${score}.`;
}

function resolveCommandCwd(validator: VerificationCommandValidator, input: RunVerificationV2Input): string | undefined {
  const cwd = validator.cwd;
  if (!cwd) {
    return input.projectPath;
  }
  if (cwd === "project") {
    return input.projectPath;
  }
  if (cwd === "contract") {
    return input.contractWorkspacePath;
  }
  return input.projectPath ? path.resolve(input.projectPath, cwd.relativeToProject) : cwd.relativeToProject;
}

async function defaultCommandExecutor(request: CommandExecutionRequest): Promise<CommandExecutionResult> {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args, {
      cwd: request.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let timedOut = false;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    if (request.timeoutMs && request.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, request.timeoutMs);
    }

    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        exitCode: null,
        stdout: truncateEvidence(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: truncateEvidence(Buffer.concat(stderrChunks).toString("utf8")),
        timedOut,
        error: error.message
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      resolve({
        exitCode,
        stdout: truncateEvidence(Buffer.concat(stdoutChunks).toString("utf8")),
        stderr: truncateEvidence(Buffer.concat(stderrChunks).toString("utf8")),
        timedOut
      });
    });
  });
}

function commandEvidence(stdout: string, stderr: string, error?: string): string {
  return [
    stdout ? `stdout:\n${stdout}` : undefined,
    stderr ? `stderr:\n${stderr}` : undefined,
    error ? `error:\n${error}` : undefined
  ].filter((section): section is string => Boolean(section)).join("\n\n");
}

function truncateEvidence(value: string): string {
  if (value.length <= MAX_EVIDENCE_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_EVIDENCE_CHARS)}\n[truncated]`;
}

function readPath(source: unknown, dottedPath: string): unknown {
  if (!dottedPath) {
    return source;
  }

  return dottedPath.split(".").reduce<unknown>((current, segment) => {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      return current[Number(segment)];
    }
    if (typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
