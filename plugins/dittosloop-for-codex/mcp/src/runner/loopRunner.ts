import type { FormalLoopContract, Step } from "../contract/types.js";
import { runBody } from "../engine/runBody.js";
import { runFlow } from "../engine/runFlow.js";
import type { EngineEvent, EngineEventInput, Executor, WorkflowExecutionPlan, WorkflowExecutionPlanStep } from "../engine/types.js";
import { shouldRepair as decideRepair } from "./repair.js";
import { createPassedDecision, type VerificationDecision } from "./verifier.js";

export interface LoopRunnerOptions {
  executor: Executor;
  verifier?: LoopVerifier;
  now?: () => string;
  completedStepOutputs?: Record<string, string>;
}

export interface LoopRunRequest {
  contract: FormalLoopContract;
  runId: string;
  attemptId?: string;
  attemptNumber?: number;
  emit?: (event: EngineEvent) => void;
}

export interface LoopRunResult {
  status: "completed" | "failed" | "waiting_for_human" | "repairing";
  output: unknown;
  verification: VerificationDecision;
  shouldRepair: boolean;
}

export type LoopVerifier = (input: {
  contract: FormalLoopContract;
  result: unknown;
}) => Promise<VerificationDecision> | VerificationDecision;

export class LoopRunner {
  constructor(private readonly options: LoopRunnerOptions) {}

  async run(request: LoopRunRequest): Promise<LoopRunResult> {
    let sequence = 0;
    const now = this.options.now ?? (() => new Date().toISOString());
    const emit = (event: EngineEvent): void => {
      sequence = Math.max(sequence, event.sequence);
      request.emit?.(event);
    };
    const emitRuntimeEvent = (event: EngineEventInput): void => {
      request.emit?.({
        ...event,
        runId: request.runId,
        createdAt: now(),
        sequence: ++sequence
      } as EngineEvent);
    };

    const flowResult = await runFlow(
      (api) => runBody(request.contract.body, api),
      {
        runId: request.runId,
        executor: this.options.executor,
        workflow: buildWorkflowExecutionPlan(request.contract),
        completedStepOutputs: this.options.completedStepOutputs,
        emit,
        now
      }
    );
    const attemptId = request.attemptId ?? `attempt_${request.attemptNumber ?? 1}`;
    emitRuntimeEvent({ type: "verification_started", attemptId });
    const verification = await this.verify(request.contract, flowResult.result);
    emitRuntimeEvent({ type: "verification_done", attemptId, decision: verification });
    const shouldRepair = decideRepair(verification, request.contract.repairPolicy, request.attemptNumber ?? 1);
    const finalStatus = verification.status === "passed" ? "completed" : verification.status === "needs_human" ? "waiting_for_human" : "failed";
    const status = shouldRepair ? "repairing" : finalStatus;

    if (shouldRepair) {
      emitRuntimeEvent({
        type: "repair_started",
        attemptId,
        reason: verification.repairInstructions ?? verification.summary
      });
    } else {
      if (verification.status === "needs_human") {
        emitRuntimeEvent({
          type: "human_request",
          question: verification.humanQuestion ?? verification.summary
        });
      }
      emitRuntimeEvent({
        type: "run_done",
        status: finalStatus,
        summary: verification.summary
      });
    }

    return {
      status,
      output: flowResult.result,
      verification,
      shouldRepair
    };
  }

  private async verify(contract: FormalLoopContract, result: unknown): Promise<VerificationDecision> {
    if (this.options.verifier) {
      return this.options.verifier({ contract, result });
    }

    return createPassedDecision("No verifier configured; workflow completed.", contract.verification.rubrics.map((rubric) => ({
      rubricId: rubric.id
    })));
  }
}

function buildWorkflowExecutionPlan(contract: FormalLoopContract): WorkflowExecutionPlan {
  return {
    runtime: "dittosloop-local-workflow",
    contractId: contract.id,
    goal: contract.goal,
    steps: flattenWorkflowSteps(contract.body.steps),
    verification: contract.verification,
    repairPolicy: contract.repairPolicy,
    stopPolicy: contract.stopPolicy
  };
}

function flattenWorkflowSteps(steps: Step[], phaseId?: string, depth = 0): WorkflowExecutionPlanStep[] {
  return steps.flatMap((step) => {
    const current: WorkflowExecutionPlanStep = {
      id: step.id,
      kind: step.kind,
      runtime: step.kind === "task" ? step.runtime : undefined,
      label: step.label,
      depth,
      phaseId,
      prompt: step.kind === "agent" || step.kind === "task" ? step.prompt : undefined,
      sessionPolicy: step.kind === "agent" || step.kind === "task" ? step.sessionPolicy : undefined,
      subagent: step.kind === "agent" || step.kind === "task" ? step.subagent : undefined
    };
    if (step.kind === "agent" || step.kind === "task") {
      return [current];
    }

    const childPhaseId = step.kind === "phase" ? step.id : phaseId;
    return [current, ...flattenWorkflowSteps(step.children, childPhaseId, depth + 1)];
  });
}
