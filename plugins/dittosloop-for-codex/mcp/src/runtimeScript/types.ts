import type { CodexSessionRef } from "../codex/sessionBridge.js";
import type {
  CodexSubagentSpec,
  EffectiveAgentProfile,
  RuntimeScriptLimits
} from "../contract/types.js";

export interface RuntimeScriptEventInput {
  type: string;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  contractId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface RuntimeScriptJournal {
  readAgentResult(idempotencyKey: string): Promise<WorkflowSubagentResult | undefined>;
  writeAgentResult(idempotencyKey: string, result: WorkflowSubagentResult): Promise<void>;
}

export interface RuntimeScriptRunInput {
  runId: string;
  attemptId: string;
  workflowContextId: string;
  contractId: string;
  source: string;
  args: Record<string, unknown>;
  limits: Required<RuntimeScriptLimits>;
  journal: RuntimeScriptJournal;
  subagentBridge: WorkflowSubagentBridge;
  emit?: (event: RuntimeScriptEventInput) => void;
  now: () => string;
}

export interface RuntimeScriptAgentOptions {
  label?: string;
  phaseId?: string;
  subagent?: CodexSubagentSpec;
  agentProfile?: EffectiveAgentProfile;
  timeoutMs?: number;
}

export interface WorkflowSubagentInput {
  prompt: string;
  label?: string;
  callSite: string;
  idempotencyKey: string;
  options?: RuntimeScriptAgentOptions;
}

export interface WorkflowSubagentResult {
  status: "completed" | "failed" | "needs_human";
  output?: string;
  error?: string;
  session?: CodexSessionRef;
  data?: Record<string, unknown>;
}

export interface WorkflowSubagentBridge {
  runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult>;
}
