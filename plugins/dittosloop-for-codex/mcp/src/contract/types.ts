import type { LoopStatus, LoopTrigger } from "../types.js";

export interface CodexSubagentSpec {
  ref?: string;
  role?: string;
  model?: string;
  tools?: string[];
  workdir?: string;
  env?: Record<string, string>;
  permissions?: {
    filesystem?: "read-only" | "workspace-write" | "danger-full-access";
    network?: "enabled" | "disabled";
  };
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

export type Step =
  | AgentStep
  | TaskStep
  | ParallelStep
  | PhaseStep;

export interface AgentStep {
  id: string;
  kind: "agent";
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  subagent?: CodexSubagentSpec;
}

export interface TaskStep {
  id: string;
  kind: "task";
  runtime: "codex";
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  outputSchema?: Record<string, unknown>;
  subagent?: CodexSubagentSpec;
}

export interface ParallelStep {
  id: string;
  kind: "parallel";
  label: string;
  children: Step[];
}

export interface PhaseStep {
  id: string;
  kind: "phase";
  label: string;
  children: Step[];
}

export interface ExecutionBody {
  steps: Step[];
}

export interface VerificationRubric {
  id: string;
  label: string;
  requirement: string;
  severity: "must" | "should";
}

export interface VerificationPolicy {
  mode: "after_workflow" | "after_each_agent";
  rubrics: VerificationRubric[];
}

export interface RepairPolicy {
  maxAttempts: number;
  strategy: "repair_then_retry" | "ask_human" | "fail_run";
}

export interface StopPolicy {
  rule: string;
  maxConsecutiveFailures?: number;
}

export interface CodexProjectBinding {
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface MemoryPolicy {
  summary?: string;
}

export interface FormalLoopContract {
  id: string;
  title: string;
  goal: string;
  intent?: string;
  body: ExecutionBody;
  trigger: LoopTrigger;
  verification: VerificationPolicy;
  repairPolicy: RepairPolicy;
  stopPolicy: StopPolicy;
  budgetUsd?: number;
  escalation?: string[];
  projectBinding?: CodexProjectBinding;
  memoryPolicy?: MemoryPolicy;
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
}

export type FormalLoopContractInput =
  & Pick<FormalLoopContract, "id" | "title" | "goal" | "body" | "verification">
  & Partial<Omit<FormalLoopContract, "id" | "title" | "goal" | "body" | "verification">>;
