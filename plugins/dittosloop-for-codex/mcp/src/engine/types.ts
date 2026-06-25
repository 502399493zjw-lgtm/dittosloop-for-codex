import type { CodexSubagentSpec } from "../contract/types.js";

export interface AgentRequest {
  prompt: string;
  label?: string;
  stepId?: string;
  phaseId?: string;
  subagent?: CodexSubagentSpec;
  attemptId?: string;
  workflowContextId?: string;
  workflowRuntime?: "dittosloop-local-workflow";
  workflowContractId?: string;
  workflowPlan?: WorkflowExecutionPlan;
}

export interface WorkflowExecutionPlanStep {
  id: string;
  kind: "agent" | "task" | "parallel" | "phase";
  runtime?: "codex";
  label: string;
  depth: number;
  phaseId?: string;
  prompt?: string;
  sessionPolicy?: "new";
  subagent?: CodexSubagentSpec;
}

export interface WorkflowExecutionPlan {
  runtime: "dittosloop-local-workflow";
  contractId: string;
  goal: string;
  steps: WorkflowExecutionPlanStep[];
  verification: unknown;
  repairPolicy: unknown;
  stopPolicy: unknown;
}

export interface AgentResult {
  text: string;
  data?: Record<string, unknown>;
}

export interface VerificationDecisionSnapshot {
  status: "passed" | "failed" | "needs_human";
  summary: string;
  checks: Array<{
    rubricId: string;
    status: "passed" | "failed" | "skipped" | "needs_human";
    evidence?: string;
  }>;
  repairInstructions?: string;
  humanQuestion?: string;
}

export interface Executor {
  run(request: AgentRequest): Promise<AgentResult>;
}

export type EngineEvent =
  | EngineEventBase<"run_started">
  | EngineEventBase<"run_completed", { status: "completed"; result?: unknown }>
  | EngineEventBase<"run_failed", { status: "failed"; error: string }>
  | EngineEventBase<"run_done", { status: "completed" | "failed" | "waiting_for_human"; summary?: string }>
  | EngineEventBase<"phase_started", { label?: string; title?: string; phaseId?: string }>
  | EngineEventBase<"phase_done", { phaseId: string; title?: string; status: "ok" | "failed" }>
  | EngineEventBase<"agent_started", { label?: string; prompt: string; stepId?: string; nodeId?: string; phaseId?: string; session?: unknown }>
  | EngineEventBase<"agent_done", { label?: string; result?: string; stepId?: string; nodeId?: string; phaseId?: string; status?: "ok" | "failed"; error?: string; session?: unknown }>
  | EngineEventBase<"agent_failed", { label?: string; error: string; stepId?: string; phaseId?: string }>
  | EngineEventBase<"parallel_started", { label?: string; count: number }>
  | EngineEventBase<"parallel_completed", { label?: string; count: number }>
  | EngineEventBase<"verification_started", { attemptId: string }>
  | EngineEventBase<"verification_done", { attemptId: string; decision: VerificationDecisionSnapshot }>
  | EngineEventBase<"repair_started", { attemptId: string; reason: string }>
  | EngineEventBase<"human_request", { question: string }>
  | EngineEventBase<"log", { message: string }>
  | EngineEventBase<"commit", { data: unknown }>;

export type EngineEventType = EngineEvent["type"];
export type EngineEventInput = EngineEvent extends infer TEvent
  ? TEvent extends EngineEvent
    ? Omit<TEvent, "runId" | "createdAt" | "sequence">
    : never
  : never;

export type EngineEventBase<TType extends string, TExtra extends object = object> = {
  type: TType;
  runId: string;
  createdAt: string;
  sequence: number;
} & TExtra;

export interface PhaseHandle {
  done(status?: "ok" | "failed"): void;
}

export interface PhaseOptions {
  phaseId?: string;
}

export interface FlowApi {
  phase(title: string, opts?: PhaseOptions): PhaseHandle;
  agent(prompt: string, opts?: AgentOptions): Promise<string>;
  parallel<T>(tasks: Array<() => Promise<T>>, opts?: ParallelOptions): Promise<T[]>;
  log(message: string): void;
  commit(data: unknown): void;
}

export interface AgentOptions {
  label?: string;
  stepId?: string;
  phaseId?: string;
  subagent?: CodexSubagentSpec;
}

export interface ParallelOptions {
  label?: string;
  stepId?: string;
}

export interface RunFlowDeps {
  runId: string;
  executor: Executor;
  workflow?: WorkflowExecutionPlan;
  completedStepOutputs?: Record<string, string>;
  emit?: (event: EngineEvent) => void;
  now?: () => string;
}

export interface RunFlowResult {
  status: "completed";
  result: unknown;
}
