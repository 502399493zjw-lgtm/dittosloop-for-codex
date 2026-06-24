export interface CodexSessionRequest {
  runId: string;
  stepId?: string;
  title: string;
  projectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface CodexSessionRef {
  sessionId: string;
  runId: string;
  stepId?: string;
  title: string;
  status: "requested" | "started" | "completed" | "failed";
  createdAt: string;
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
