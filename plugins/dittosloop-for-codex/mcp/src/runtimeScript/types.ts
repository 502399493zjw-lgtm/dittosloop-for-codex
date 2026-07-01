import type { CodexSessionRef } from "../codex/sessionBridge.js";
import type {
  CodexSubagentSpec,
  EffectiveAgentProfile,
  RuntimeScriptLimits
} from "../contract/types.js";
import type { RuntimeScriptJournal } from "./journal.js";

export interface RuntimeScriptEventInput {
  type: string;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  contractId: string;
  timestamp: string;
  data?: Record<string, unknown>;
}

export interface RuntimeScriptRunInput {
  loopId?: string;
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
  runtimeContextTimeIso?: string;
  now: () => string;
}

export interface RuntimeScriptAgentOptions {
  key?: string;
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
