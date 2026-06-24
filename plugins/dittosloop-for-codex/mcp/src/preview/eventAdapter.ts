import type { EngineEvent } from "../engine/types.js";
import type { RunDetail, RunStatus, VerificationResult } from "../types.js";

export interface PreviewRunDetail extends RunDetail {
  engineEvents: EngineEvent[];
  timeline: PreviewTimelineSection[];
}

export interface PreviewTimelineSection {
  id: "workflow" | "verification" | "repair" | "run";
  title: string;
  items: PreviewTimelineItem[];
}

export interface PreviewTimelineItem {
  kind: "run" | "phase" | "agent" | "parallel" | "verification" | "repair";
  label: string;
  status: string;
  createdAt?: string;
  sequence?: number;
  stepId?: string;
  message?: string;
}

export function enrichRunDetail(detail: RunDetail): PreviewRunDetail {
  const engineEvents = extractEngineEvents(detail);

  return {
    ...detail,
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
  const workflow = engineEvents.map(engineEventToTimelineItem).filter((item): item is PreviewTimelineItem => Boolean(item));
  if (workflow.length > 0) {
    sections.push({ id: "workflow", title: "Workflow", items: workflow });
  }

  const verification = detail.verificationResults.map(verificationToTimelineItem);
  if (verification.length > 0) {
    sections.push({ id: "verification", title: "Verification", items: verification });
  }

  const repair = repairItems(detail.run.status, detail.verificationResults);
  if (repair.length > 0) {
    sections.push({ id: "repair", title: "Repair", items: repair });
  }

  if (sections.length === 0) {
    sections.push({
      id: "run",
      title: "Run",
      items: [{ kind: "run", label: detail.run.goal, status: detail.run.status, createdAt: detail.run.createdAt }]
    });
  }

  return sections;
}

function engineEventToTimelineItem(event: EngineEvent): PreviewTimelineItem | undefined {
  if (event.type === "run_started") {
    return baseItem(event, "run", "Run started", "started");
  }
  if (event.type === "run_completed") {
    return baseItem(event, "run", "Run completed", event.status);
  }
  if (event.type === "run_failed") {
    return baseItem(event, "run", "Run failed", event.status, event.error);
  }
  if (event.type === "phase_started") {
    return baseItem(event, "phase", event.label, "started");
  }
  if (event.type === "agent_started") {
    return baseItem(event, "agent", event.label ?? event.stepId ?? "Agent", "started");
  }
  if (event.type === "agent_done") {
    return baseItem(event, "agent", event.label ?? event.stepId ?? "Agent", "completed", event.result);
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
    stepId: "stepId" in event ? event.stepId : undefined,
    message: typeof message === "string" ? message : undefined
  };
}

function verificationToTimelineItem(result: VerificationResult): PreviewTimelineItem {
  return {
    kind: "verification",
    label: result.summary,
    status: result.status,
    createdAt: result.createdAt,
    message: result.checks.map((check) => `${check.name}: ${check.status}`).join("\n") || undefined
  };
}

function repairItems(runStatus: RunStatus, results: VerificationResult[]): PreviewTimelineItem[] {
  const failed = results.find((result) => result.status === "failed");
  if (runStatus !== "repairing" && !failed) return [];

  return [
    {
      kind: "repair",
      label: failed?.summary ?? "Repair requested",
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
