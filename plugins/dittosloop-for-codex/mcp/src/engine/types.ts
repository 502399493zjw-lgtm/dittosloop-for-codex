export interface AgentRequest {
  prompt: string;
  label?: string;
  stepId?: string;
}

export interface AgentResult {
  text: string;
  data?: Record<string, unknown>;
}

export interface Executor {
  run(request: AgentRequest): Promise<AgentResult>;
}

export type EngineEvent =
  | EngineEventBase<"run_started">
  | EngineEventBase<"run_completed", { status: "completed"; result?: unknown }>
  | EngineEventBase<"run_failed", { status: "failed"; error: string }>
  | EngineEventBase<"phase_started", { label: string }>
  | EngineEventBase<"agent_started", { label?: string; prompt: string; stepId?: string }>
  | EngineEventBase<"agent_done", { label?: string; result: string; stepId?: string }>
  | EngineEventBase<"agent_failed", { label?: string; error: string; stepId?: string }>
  | EngineEventBase<"parallel_started", { label?: string; count: number }>
  | EngineEventBase<"parallel_completed", { label?: string; count: number }>
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

export interface FlowApi {
  phase(title: string): void;
  agent(prompt: string, opts?: AgentOptions): Promise<string>;
  parallel<T>(tasks: Array<() => Promise<T>>, opts?: ParallelOptions): Promise<T[]>;
  log(message: string): void;
  commit(data: unknown): void;
}

export interface AgentOptions {
  label?: string;
  stepId?: string;
}

export interface ParallelOptions {
  label?: string;
  stepId?: string;
}

export interface RunFlowDeps {
  runId: string;
  executor: Executor;
  emit?: (event: EngineEvent) => void;
  now?: () => string;
}

export interface RunFlowResult {
  status: "completed";
  result: unknown;
}
