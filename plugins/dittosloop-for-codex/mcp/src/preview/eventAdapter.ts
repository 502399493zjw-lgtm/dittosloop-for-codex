import type { EngineEvent } from "../engine/types.js";
import type { RunDetail, RunStatus, VerificationResultRecord } from "../types.js";
import type { ValidatorResult, VerificationResultV2 } from "../runner/verificationV2.js";
import { buildWorkflowView } from "../workflowGraph/workflowView.js";

export interface PreviewRunDetail extends RunDetail {
  engineEvents: EngineEvent[];
  timeline: PreviewTimelineSection[];
}

export interface PreviewTimelineSection {
  id: "workflow" | "verification" | "repair" | "human" | "run";
  title: string;
  items: PreviewTimelineItem[];
}

export interface PreviewTimelineItem {
  kind: "run" | "phase" | "agent" | "parallel" | "verification" | "repair" | "human";
  label: string;
  status: string;
  createdAt?: string;
  sequence?: number;
  stepId?: string;
  phaseId?: string;
  pipeline?: boolean;
  human?: boolean;
  message?: string;
  session?: unknown;
}

export function enrichRunDetail(detail: RunDetail): PreviewRunDetail {
  const engineEvents = extractEngineEvents(detail);
  const workflowView = detail.workflowView ?? buildWorkflowView(detail);

  return {
    ...detail,
    workflowView,
    engineEvents,
    timeline: buildTimeline(detail, engineEvents)
  };
}

export function extractEngineEvents(detail: RunDetail): EngineEvent[] {
  return detail.events
    .map((event) => event.data?.engineEvent)
    .filter(isEngineEvent)
    .sort((left, right) => left.sequence - right.sequence);
}

export function buildTimeline(detail: RunDetail, engineEvents: EngineEvent[] = extractEngineEvents(detail)): PreviewTimelineSection[] {
  const sections: PreviewTimelineSection[] = [];
  const workflow = engineEvents.map(workflowEventToTimelineItem).filter((item): item is PreviewTimelineItem => Boolean(item));
  if (workflow.length > 0) {
    sections.push({ id: "workflow", title: "工作流", items: workflow });
  }

  const verificationEvents = engineEvents
    .map(verificationEventToTimelineItem)
    .filter((item): item is PreviewTimelineItem => Boolean(item));
  const verification = verificationEvents.length > 0 ? verificationEvents : detail.verificationResults.flatMap(verificationToTimelineItems);
  if (verification.length > 0) {
    sections.push({ id: "verification", title: "验证", items: verification });
  }

  const repairEvents = engineEvents
    .map(repairEventToTimelineItem)
    .filter((item): item is PreviewTimelineItem => Boolean(item));
  const repair = repairEvents.length > 0 ? repairEvents : repairItems(detail.run.status, detail.verificationResults);
  if (repair.length > 0) {
    sections.push({ id: "repair", title: "修复", items: repair });
  }

  const human = engineEvents
    .map(humanEventToTimelineItem)
    .filter((item): item is PreviewTimelineItem => Boolean(item));
  if (human.length > 0) {
    sections.push({ id: "human", title: "人工处理", items: human });
  }

  const runDone = engineEvents
    .map(runDoneEventToTimelineItem)
    .filter((item): item is PreviewTimelineItem => Boolean(item));
  if (runDone.length > 0) {
    sections.push({ id: "run", title: "运行", items: runDone });
  }

  if (sections.length === 0) {
    sections.push({
      id: "run",
      title: "运行",
      items: [{ kind: "run", label: detail.run.goal, status: detail.run.status, createdAt: detail.run.createdAt }]
    });
  }

  return sections;
}

function workflowEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type === "run_started") {
    return baseItem(event, "run", "开始运行", "started");
  }
  if (event.type === "run_failed") {
    return baseItem(event, "run", "运行失败", event.status, event.error);
  }
  if (event.type === "runtime_script_started") {
    return baseItem(event, "run", runtimeScriptLabel(event.contractId), "started");
  }
  if (event.type === "runtime_script_done") {
    return baseItem(event, "run", runtimeScriptLabel(event.contractId), event.status, event.error ?? event.result);
  }
  if (event.type === "runtime_phase_started") {
    return baseItem(event, "phase", event.label, "started");
  }
  if (event.type === "runtime_phase_done") {
    return baseItem(event, "phase", event.label, event.status === "ok" ? "completed" : "failed");
  }
  if (event.type === "agent:start") {
    return baseItem(event, "agent", runtimeAgentLabel(event), "started", event.prompt);
  }
  if (event.type === "agent:done") {
    return baseItem(event, "agent", runtimeAgentLabel(event), "completed", event.result);
  }
  if (event.type === "agent:error") {
    return baseItem(event, "agent", runtimeAgentLabel(event), "failed", event.error);
  }
  if (event.type === "agent:cached") {
    return baseItem(event, "agent", runtimeAgentLabel(event), "completed", "agent:cached");
  }
  if (event.type === "runtime_parallel_started") {
    return baseItem(event, "parallel", event.label ?? "Parallel", "started", String(event.count));
  }
  if (event.type === "runtime_parallel_completed") {
    return baseItem(event, "parallel", event.label ?? "Parallel", "completed", String(event.count));
  }
  if (event.type === "runtime_pipeline_started") {
    return { ...baseItem(event, "parallel", event.label ?? "Pipeline", "started", String(event.count)), pipeline: true };
  }
  if (event.type === "runtime_pipeline_completed") {
    return { ...baseItem(event, "parallel", event.label ?? "Pipeline", "completed", String(event.count)), pipeline: true };
  }
  if (event.type === "runtime_log") {
    return baseItem(event, "run", "Runtime log", "completed", event.message);
  }
  if (event.type === "phase_started") {
    return baseItem(event, "phase", phaseLabel(event), "started");
  }
  if (event.type === "phase_done") {
    return baseItem(event, "phase", event.title ?? event.phaseId, event.status === "ok" ? "completed" : "failed");
  }
  if (event.type === "agent_started") {
    return baseItem(event, "agent", event.label ?? event.stepId ?? event.nodeId ?? "Agent", "started");
  }
  if (event.type === "agent_done") {
    const status = event.status === "failed" ? "failed" : "completed";
    return baseItem(event, "agent", event.label ?? event.stepId ?? event.nodeId ?? "Agent", status, event.error ?? event.result);
  }
  if (event.type === "agent_failed") {
    return baseItem(event, "agent", event.label ?? event.stepId ?? "Agent", "failed", event.error);
  }
  if (event.type === "parallel_started") {
    return baseItem(event, "parallel", event.label ?? "Parallel", "started");
  }
  if (event.type === "parallel_completed") {
    return baseItem(event, "parallel", event.label ?? "Parallel", "completed");
  }

  return undefined;
}

function verificationEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type === "verification_started") {
    return baseItem(event, "verification", "开始验证", "started");
  }
  if (event.type === "verification_done") {
    if ("version" in event.decision && event.decision.version === 2) {
      return baseItem(event, "verification", event.decision.decision.summary, event.decision.status, validatorResultsMessage(event.decision.validatorResults));
    }
    return baseItem(event, "verification", event.decision.summary, event.decision.status, verificationChecksMessage(event.decision.checks));
  }
  if (event.type === "validator_started") {
    return baseItem(event, "verification", `Validator ${event.validatorId} started`, "started");
  }
  if (event.type === "validator_done") {
    return baseItem(event, "verification", event.result.label, event.result.status, event.result.evidence);
  }
  if (event.type === "verification_decided") {
    return baseItem(event, "verification", `Verification ${event.decision.status}`, event.decision.status, event.decision.repairInstructions);
  }

  return undefined;
}

function repairEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type !== "repair_started") return undefined;
  return baseItem(event, "repair", event.reason, "repairing");
}

function humanEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type !== "human_request") return undefined;
  return baseItem(event, "human", event.question, "needs_human");
}

function runDoneEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type === "run_completed") {
    return baseItem(event, "run", "完成运行", event.status);
  }
  if (event.type === "run_done") {
    return baseItem(event, "run", event.summary ?? "运行完成", event.status);
  }

  return undefined;
}

function baseItem(
  event: EngineEvent,
  kind: PreviewTimelineItem["kind"],
  label: string,
  status: string,
  message?: unknown
): PreviewTimelineItem {
  return {
    kind,
    label,
    status,
    createdAt: event.createdAt,
    sequence: event.sequence,
    stepId: "stepId" in event ? event.stepId : "nodeId" in event ? event.nodeId : "phaseId" in event ? event.phaseId : undefined,
    phaseId: "phaseId" in event ? event.phaseId : undefined,
    pipeline: "pipeline" in event && event.pipeline === true ? true : undefined,
    human: "human" in event && event.human === true ? true : undefined,
    message: typeof message === "string" ? message : undefined,
    session: "session" in event ? event.session : undefined
  };
}

function phaseLabel(event: Extract<EngineEvent, { type: "phase_started" }>): string {
  return event.label ?? event.title ?? event.phaseId ?? "Phase";
}

function runtimeScriptLabel(contractId: string): string {
  return `Runtime script ${contractId}`;
}

function runtimeAgentLabel(event: Extract<EngineEvent, { type: "agent:start" | "agent:done" | "agent:error" | "agent:cached" }>): string {
  return event.label ?? event.callSite ?? "Agent";
}

function verificationChecksMessage(checks: Array<{ rubricId: string; status: string; evidence?: string }>): string | undefined {
  if (!checks.length) return undefined;
  return checks
    .map((check) => `${humanizeCheckName(check.rubricId)}: ${check.status}${check.evidence ? ` - ${check.evidence}` : ""}`)
    .join("\n");
}

function humanizeCheckName(value: string): string {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function verificationToTimelineItems(result: VerificationResultRecord): PreviewTimelineItem[] {
  if (isVerificationResultV2(result)) {
    return [
      ...result.validatorResults.map((validatorResult) => ({
        kind: "verification" as const,
        label: validatorResult.label,
        status: validatorResult.status,
        createdAt: result.createdAt,
        message: validatorResult.evidence
      })),
      {
        kind: "verification" as const,
        label: result.decision.summary,
        status: result.decision.status,
        createdAt: result.createdAt,
        message: validatorResultsMessage(result.validatorResults)
      }
    ];
  }

  return [{
    kind: "verification",
    label: result.summary,
    status: result.status,
    createdAt: result.createdAt,
    message: result.checks.map((check) => `${check.name ?? check.rubricId ?? "check"}: ${check.status}`).join("\n") || undefined
  }];
}

function repairItems(runStatus: RunStatus, results: VerificationResultRecord[]): PreviewTimelineItem[] {
  const failed = results.find((result) => result.status === "failed");
  if (runStatus !== "repairing" && !failed) return [];

  return [
    {
      kind: "repair",
      label: failed?.summary ?? "需要修复",
      status: runStatus === "repairing" ? "repairing" : "needed",
      createdAt: failed?.createdAt
    }
  ];
}

function isEngineEvent(value: unknown): value is EngineEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<EngineEvent>;
  return typeof event.type === "string" && typeof event.runId === "string" && typeof event.sequence === "number";
}

function validatorResultsMessage(results: ValidatorResult[]): string | undefined {
  if (!results.length) return undefined;
  return results
    .map((result) => `${result.label}: ${result.status}${result.evidence ? ` - ${result.evidence}` : ""}`)
    .join("\n");
}

function isVerificationResultV2(value: VerificationResultRecord): value is VerificationResultV2 {
  return "version" in value && value.version === 2;
}
