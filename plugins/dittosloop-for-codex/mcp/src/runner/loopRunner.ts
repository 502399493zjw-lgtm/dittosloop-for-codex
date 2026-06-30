import type { ExecutionBody, FormalLoopContract, Step } from "../contract/types.js";
import { effectiveProfileToSubagent, resolveEffectiveProfilesByStep } from "../contract/agentProfiles.js";
import { runBody } from "../engine/runBody.js";
import { runFlow } from "../engine/runFlow.js";
import type { EngineEvent, EngineEventInput, Executor, WorkflowExecutionPlan, WorkflowExecutionPlanStep } from "../engine/types.js";
import { runContractVerification } from "./contractVerification.js";
import { shouldRepair as decideRepair } from "./repair.js";
import { type CommandExecutor, type VerificationResultV2 } from "./verificationV2.js";
import type { VerificationDecision } from "./verifier.js";

export interface LoopRunnerOptions {
  executor: Executor;
  verifier?: LoopVerifier;
  commandExecutor?: CommandExecutor;
  contractWorkspacePath?: string;
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
  verification: VerificationDecision | VerificationResultV2;
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

    const body = requireStaticWorkflowBody(request.contract);
    const flowResult = await runFlow(
      (api) => runBody(body, api, resolveEffectiveProfilesByStep(request.contract)),
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
    const verification = await runContractVerification({
      contract: request.contract,
      result: flowResult.result,
      runId: request.runId,
      attemptId,
      now,
      contractWorkspacePath: this.options.contractWorkspacePath,
      verifier: this.options.verifier,
      commandExecutor: this.options.commandExecutor,
      emit: emitRuntimeEvent
    });
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

}

export function buildWorkflowExecutionPlan(contract: FormalLoopContract): WorkflowExecutionPlan {
  const effectiveProfilesByStep = resolveEffectiveProfilesByStep(contract);
  const body = requireStaticWorkflowBody(contract);

  return {
    runtime: "dittosloop-local-workflow",
    contractId: contract.id,
    goal: contract.goal,
    steps: flattenWorkflowSteps(body.steps, effectiveProfilesByStep),
    verification: contract.verification,
    repairPolicy: contract.repairPolicy,
    stopPolicy: contract.stopPolicy,
    budgetUsd: contract.budgetUsd,
    escalation: contract.escalation
  };
}

function requireStaticWorkflowBody(contract: FormalLoopContract): ExecutionBody {
  const body = contract.body ?? (contract.workflow.kind === "static_steps" ? contract.workflow.body : undefined);
  if (!body) {
    throw new Error("Static workflow execution requires body.steps");
  }
  return body;
}

function flattenWorkflowSteps(
  steps: Step[],
  effectiveProfilesByStep: ReturnType<typeof resolveEffectiveProfilesByStep>,
  phaseId?: string,
  depth = 0
): WorkflowExecutionPlanStep[] {
  return steps.flatMap((step) => {
    const agentProfile = step.kind === "agent" || step.kind === "task"
      ? effectiveProfilesByStep.get(step.id)
      : undefined;
    const current: WorkflowExecutionPlanStep = {
      id: step.id,
      kind: step.kind,
      runtime: step.kind === "task" ? step.runtime : undefined,
      label: step.label,
      depth,
      phaseId,
      prompt: step.kind === "agent" || step.kind === "task" ? step.prompt : undefined,
      sessionPolicy: step.kind === "agent" || step.kind === "task" ? step.sessionPolicy : undefined,
      pipeline: step.kind === "phase" ? step.pipeline : undefined,
      human: step.kind === "task" ? step.human : undefined,
      subagent: step.kind === "agent" || step.kind === "task" ? effectiveProfileToSubagent(agentProfile, step.subagent) : undefined,
      agentProfile
    };
    if (step.kind === "agent" || step.kind === "task") {
      return [current];
    }

    const childPhaseId = step.kind === "phase" ? step.id : phaseId;
    return [current, ...flattenWorkflowSteps(step.children, effectiveProfilesByStep, childPhaseId, depth + 1)];
  });
}
