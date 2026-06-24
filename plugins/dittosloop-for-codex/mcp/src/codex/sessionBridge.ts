export interface CodexWorkflowLaunchPlanStep {
  id: string;
  kind: "agent" | "parallel" | "phase";
  label: string;
  depth: number;
  phaseId?: string;
  prompt?: string;
  sessionPolicy?: "new" | "reuse-run" | "reuse-step";
}

export interface CodexWorkflowLaunchPlan {
  runtime: "dittosloop-local-workflow";
  contractId: string;
  goal: string;
  steps: CodexWorkflowLaunchPlanStep[];
  verification: unknown;
  repairPolicy: unknown;
  stopPolicy: unknown;
}

export interface CodexSessionRequest {
  runId: string;
  stepId?: string;
  phaseId?: string;
  title: string;
  prompt?: string;
  workflowRuntime?: "dittosloop-local-workflow";
  workflowContractId?: string;
  workflowPlan?: CodexWorkflowLaunchPlan;
  projectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface CodexSessionRef {
  sessionId: string;
  runId: string;
  stepId?: string;
  phaseId?: string;
  title: string;
  status: "requested" | "started" | "completed" | "failed";
  createdAt: string;
  prompt?: string;
  workflowRuntime?: "dittosloop-local-workflow";
  workflowContractId?: string;
  workflowPlan?: CodexWorkflowLaunchPlan;
  projectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface CodexSessionMessage {
  text: string;
  createdAt?: string;
}

export interface CodexSessionResult {
  status: "completed" | "failed";
  text: string;
  threadId?: string;
  threadTitle?: string;
  threadUrl?: string;
  createdAt?: string;
}

export interface RecordedCodexSessionRequest extends CodexSessionRef {
  messages: Array<CodexSessionMessage & { createdAt: string }>;
  result?: CodexSessionResult & { createdAt: string };
}

export interface CodexSessionBridge {
  createSession(request: CodexSessionRequest): Promise<CodexSessionRef>;
  sendMessage(sessionId: string, message: CodexSessionMessage): Promise<void>;
  recordResult(sessionId: string, result: CodexSessionResult): Promise<void>;
  readResult(sessionId: string): Promise<CodexSessionResult | undefined>;
}
