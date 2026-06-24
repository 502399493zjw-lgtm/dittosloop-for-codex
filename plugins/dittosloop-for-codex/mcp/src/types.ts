import type { FormalLoopContract } from "./contract/types.js";

export type LoopStatus = "active" | "paused" | "archived";
export type TriggerMode = "manual";
export type RunStatus = "running" | "waiting_for_human" | "repairing" | "completed" | "failed";
export type AttemptStatus = "running" | "completed" | "failed";
export type VerificationStatus = "passed" | "failed" | "skipped";
export type HumanRequestStatus = "open" | "resolved";
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
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
  codexSession?: {
    mode: "current_session" | "new_session";
    status: "requested" | "started" | "unavailable";
    threadId?: string;
    threadTitle?: string;
    threadUrl?: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
    subagents?: Array<{
      role: string;
      status: "requested" | "running" | "completed" | "failed";
      threadId?: string;
      threadTitle?: string;
      threadUrl?: string;
      prompt?: string;
    }>;
    prompt: string;
  };
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
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
    name: string;
    status: VerificationStatus;
    output?: string;
  }>;
  createdAt: string;
}

export interface HumanRequest {
  id: string;
  runId: string;
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

export interface ArtifactRef {
  id: string;
  runId: string;
  title: string;
  path?: string;
  url?: string;
  kind?: string;
  createdAt: string;
}

export interface LoopState {
  version: 1;
  loops: LoopContract[];
  formalContracts?: FormalLoopContract[];
  runs: LoopRun[];
  attempts: RunAttempt[];
  events: RunEvent[];
  verificationResults: VerificationResult[];
  humanRequests: HumanRequest[];
  memoryCommits: MemoryCommit[];
  artifacts: ArtifactRef[];
}

export interface RunDetail {
  run: LoopRun;
  loop: LoopContract;
  attempts: RunAttempt[];
  events: RunEvent[];
  verificationResults: VerificationResult[];
  humanRequests: HumanRequest[];
  memoryCommits: MemoryCommit[];
  artifacts: ArtifactRef[];
}

export interface CodexProjectRef {
  id: string;
  name: string;
  path: string;
}
