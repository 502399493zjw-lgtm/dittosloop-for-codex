import type {
  CodexSessionBridge,
  CodexSessionMessage,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult,
  RecordedCodexSessionRequest
} from "./sessionBridge.js";

export interface HostMediatedSessionBridgeOptions {
  now?: () => string;
  makeId?: () => string;
}

export class HostMediatedSessionBridge implements CodexSessionBridge {
  private readonly requests = new Map<string, RecordedCodexSessionRequest>();
  private readonly now: () => string;
  private readonly makeId: () => string;

  constructor(options: HostMediatedSessionBridgeOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.makeId = options.makeId ?? (() => `session_${Math.random().toString(36).slice(2, 10)}`);
  }

  async createSession(request: CodexSessionRequest): Promise<CodexSessionRef> {
    const ref: CodexSessionRef = {
      sessionId: this.makeId(),
      runId: request.runId,
      stepId: request.stepId,
      phaseId: request.phaseId,
      title: request.title,
      status: "requested",
      createdAt: this.now(),
      prompt: request.prompt,
      workflowRuntime: request.workflowRuntime,
      workflowContractId: request.workflowContractId,
      workflowPlan: request.workflowPlan,
      projectId: request.projectId,
      projectLabel: request.projectLabel,
      projectPath: request.projectPath
    };

    this.requests.set(ref.sessionId, { ...ref, messages: [] });
    return ref;
  }

  async sendMessage(sessionId: string, message: CodexSessionMessage): Promise<void> {
    const request = this.requireRequest(sessionId);
    request.messages.push({ ...message, createdAt: message.createdAt ?? this.now() });
  }

  async recordResult(sessionId: string, result: CodexSessionResult): Promise<void> {
    const request = this.requireRequest(sessionId);
    request.status = result.status;
    request.result = { ...result, createdAt: result.createdAt ?? this.now() };
  }

  async readResult(sessionId: string): Promise<CodexSessionResult | undefined> {
    return this.requests.get(sessionId)?.result;
  }

  getRequests(): RecordedCodexSessionRequest[] {
    return Array.from(this.requests.values());
  }

  private requireRequest(sessionId: string): RecordedCodexSessionRequest {
    const request = this.requests.get(sessionId);
    if (!request) {
      throw new Error(`Unknown Codex session: ${sessionId}`);
    }
    return request;
  }
}
