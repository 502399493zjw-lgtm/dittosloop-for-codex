import type { CodexSubagentSpec, EffectiveAgentProfile, FormalLoopContract, SkillRequirement } from "./contract/types.js";
import type {
  AggregatedVerificationDecision,
  ValidatorResult,
  VerificationResultV2
} from "./runner/verificationV2.js";
import type { ExecutionGraphSnapshot, WorkflowNodeRun, WorkflowView } from "./workflowGraph/types.js";

export type LoopStatus = "active" | "paused" | "archived";
export type TriggerMode = "manual";
export type RunStatus = "running" | "waiting_for_human" | "repairing" | "completed" | "failed";
export type LoopPausedReason = "failures" | "budget" | "escalation";
export type LoopRunRecordStatus = "queued" | "running" | "waiting_for_human" | "repairing" | "completed" | "failed" | "canceled";
export type AttemptStatus = "running" | "completed" | "failed";
export type VerificationStatus = "passed" | "failed" | "needs_human" | "skipped";
export type HumanRequestStatus = "open" | "resolved";
export type SkillPreflightStatus = "passed" | "missing" | "unknown";
export type EventKind =
  | "note"
  | "run_created"
  | "attempt_started"
  | "attempt_completed"
  | "verification_recorded"
  | "human_request"
  | "memory_committed"
  | "artifact_added"
  | "run_completed";

export interface LoopTrigger {
  mode: TriggerMode;
  schedule?: string;
}

export interface VerificationPlan {
  checks: string[];
  notes?: string;
}

export interface LoopContract {
  id: string;
  title: string;
  intent: string;
  trigger: LoopTrigger;
  verification: VerificationPlan;
  status: LoopStatus;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
  createdAt: string;
  updatedAt: string;
}

export interface LoopRun {
  id: string;
  loopId: string;
  status: RunStatus;
  goal: string;
  trigger: TriggerMode;
  summary?: string;
  result?: string;
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
  codexSession?: {
    mode: "current_session" | "new_session";
    status: "requested" | "started" | "completed" | "failed" | "unavailable";
    threadId?: string;
    threadTitle?: string;
    threadUrl?: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
    subagents?: Array<{
      role: string;
      status: "requested" | "running" | "completed" | "failed";
      sessionId?: string;
      stepId?: string;
      phaseId?: string;
      threadId?: string;
      threadTitle?: string;
      threadUrl?: string;
      prompt?: string;
      subagent?: CodexSubagentSpec;
      agentProfile?: EffectiveAgentProfile;
      profilePreflight?: SkillPreflightReport;
    }>;
    profilePreflight?: SkillPreflightReport;
    prompt: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pausedReason?: LoopPausedReason;
}

export interface SkillPreflightCheck {
  profileId: string;
  profileLabel: string;
  stepId?: string;
  skill: SkillRequirement;
  required: boolean;
  status: SkillPreflightStatus;
  message: string;
  locations?: string[];
}

export interface SkillPreflightReport {
  status: "passed" | "warning" | "blocked" | "degraded";
  checks: SkillPreflightCheck[];
  warnings: string[];
  blockers: string[];
  allowDegradedProfiles?: boolean;
}

export interface LoopOperationalState {
  loopId: string;
  cursor: unknown;
  consecutiveFailures: number;
  paused: boolean;
  pausedReason?: LoopPausedReason;
  running: boolean;
  runCount: number;
  lastRunAt?: number;
  activeRunId?: string;
  activeRunStatus?: RunStatus;
}

export interface RunAttempt {
  id: string;
  runId: string;
  status: AttemptStatus;
  summary?: string;
  createdAt: string;
  completedAt?: string;
}

export interface RunEvent {
  id: string;
  runId: string;
  kind: EventKind;
  message: string;
  createdAt: string;
  data?: Record<string, unknown>;
}

export interface VerificationResult {
  id: string;
  runId: string;
  attemptId?: string;
  status: VerificationStatus;
  summary: string;
  checks: Array<{
    name?: string;
    rubricId?: string;
    status: VerificationStatus;
    output?: string;
    evidence?: string;
  }>;
  createdAt: string;
}

export type VerificationResultRecord = VerificationResult | VerificationResultV2;

export interface HumanRequest {
  id: string;
  runId: string;
  attemptId?: string;
  workflowContextId?: string;
  taskRunId?: string;
  sessionId?: string;
  stepId?: string;
  question: string;
  status: HumanRequestStatus;
  response?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface MemoryCommit {
  id: string;
  loopId: string;
  runId?: string;
  summary: string;
  createdAt: string;
}

export interface LoopMemory {
  loopId: string;
  content: string;
  updatedAt?: string;
}

export interface LoopMemoryWindow {
  loopId: string;
  limit: number;
  offset: number;
  returnedLines: number;
  totalLines: number;
  remainingLines: number;
  content: string;
}

export interface ArtifactRef {
  id: string;
  runId: string;
  title: string;
  path?: string;
  url?: string;
  kind?: string;
  createdAt: string;
}

export interface RuntimeScriptJournalRecord {
  id: string;
  loopId: string;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  contractId: string;
  scriptHash: string;
  argsHash: string;
  key: string;
  callSite: string;
  promptHash: string;
  optionsHash: string;
  status: "completed" | "failed";
  output?: string;
  error?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RuntimeScriptContextState {
  scriptHash: string;
  argsHash: string;
  status: "not_started" | "running" | "waiting_for_session" | "completed" | "failed";
  result?: unknown;
  error?: string;
  updatedAt: string;
}

export interface RuntimeScriptTaskRunState {
  key: string;
  callSite: string;
  scriptHash: string;
  argsHash: string;
  promptHash: string;
  optionsHash: string;
}

export interface LoopWorkspaceFile {
  path: string;
  kind: "memory" | "contract" | "workflow" | "runtime" | "rubrics" | "verification" | "status" | "runs";
  language: "javascript" | "markdown" | "json";
  content: string;
  size: number;
}

export interface WorkflowRevision {
  id: string;
  loopId: string;
  runId: string;
  attemptId?: string;
  authorSessionId?: string;
  authorThreadId?: string;
  baseRevisionId?: string;
  status: "draft" | "promoted" | "superseded" | "rejected";
  reason: string;
  contract: FormalLoopContract;
  createdAt: string;
  promotedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
}

export type WorkflowContextStatus = "ready" | "running" | "suspended" | "repairing" | "completed" | "failed";
export type WorkflowCursorState =
  | "created"
  | "executing"
  | "waiting_for_session"
  | "waiting_for_human"
  | "repairing"
  | "completed"
  | "failed";
export type WorkflowTaskRunStatus = "running" | "suspended" | "completed" | "failed";

export interface WorkflowCursor {
  state: WorkflowCursorState;
  stepId?: string;
  phaseId?: string;
  sessionId?: string;
}

export interface WorkflowStepState {
  status: WorkflowTaskRunStatus;
  output?: string;
  error?: string;
  sessionId?: string;
  updatedAt: string;
}

export interface WorkflowTaskRun {
  id: string;
  runId: string;
  attemptId: string;
  stepId: string;
  phaseId?: string;
  label?: string;
  prompt?: string;
  subagent?: CodexSubagentSpec;
  agentProfile?: EffectiveAgentProfile;
  profilePreflight?: SkillPreflightReport;
  sessionId?: string;
  status: WorkflowTaskRunStatus;
  result?: string;
  error?: string;
  idempotencyKey?: string;
  runtimeScript?: RuntimeScriptTaskRunState;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface WorkflowVerificationState {
  status: "not_started" | "running" | "waiting_for_validator" | "completed" | "failed";
  validatorResults: ValidatorResult[];
  pendingValidatorIds: string[];
  idempotencyKeys: string[];
  decision?: AggregatedVerificationDecision;
  resultId?: string;
  updatedAt: string;
}

export interface WorkflowContext {
  id: string;
  runId: string;
  loopId: string;
  attemptId: string;
  contractId?: string;
  contractRevisionId?: string;
  contractSnapshot?: FormalLoopContract;
  executionGraphSnapshot?: ExecutionGraphSnapshot;
  nodeRuns?: WorkflowNodeRun[];
  schedulerMode?: "dual_write" | "scheduler";
  status: WorkflowContextStatus;
  cursor: WorkflowCursor;
  vars: Record<string, unknown>;
  steps: Record<string, WorkflowStepState>;
  taskRuns: WorkflowTaskRun[];
  verification?: WorkflowVerificationState;
  pendingSessionIds: string[];
  idempotencyKeys: string[];
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface LoopState {
  version: 2;
  loops: LoopContract[];
  loopStates: LoopOperationalState[];
  formalContracts: FormalLoopContract[];
  workflowRevisions: WorkflowRevision[];
  workflowContexts: WorkflowContext[];
  runs: LoopRun[];
  attempts: RunAttempt[];
  events: RunEvent[];
  verificationResults: VerificationResultRecord[];
  humanRequests: HumanRequest[];
  memoryCommits: MemoryCommit[];
  loopMemories: LoopMemory[];
  artifacts: ArtifactRef[];
  runtimeScriptJournals: RuntimeScriptJournalRecord[];
}

export interface RunDetail {
  run: LoopRun;
  loop: LoopContract;
  attempts: RunAttempt[];
  events: RunEvent[];
  verificationResults: VerificationResultRecord[];
  humanRequests: HumanRequest[];
  memoryCommits: MemoryCommit[];
  artifacts: ArtifactRef[];
  workflowRevisions: WorkflowRevision[];
  workflowContexts: WorkflowContext[];
  workflowView?: WorkflowView;
}

export interface CodexProjectRef {
  id: string;
  name: string;
  path: string;
}
