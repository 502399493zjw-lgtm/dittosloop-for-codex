import type { FormalLoopContract } from "../contract/types.js";
import type { EngineEventInput } from "../engine/types.js";
import {
  runVerificationV2,
  type CommandExecutor,
  type RunVerificationV2Event,
  type VerificationResultV2
} from "./verificationV2.js";
import { createPassedDecision, type VerificationDecision } from "./verifier.js";
import type { LoopVerifier } from "./loopRunner.js";

export async function runContractVerification(input: {
  contract: FormalLoopContract;
  result: unknown;
  runId: string;
  attemptId: string;
  now: () => string;
  contractWorkspacePath?: string;
  verifier?: LoopVerifier;
  commandExecutor?: CommandExecutor;
  emit?: (event: EngineEventInput) => void;
}): Promise<VerificationDecision | VerificationResultV2> {
  const { contract, result } = input;

  if (contract.verification.version === 2) {
    return runVerificationV2({
      id: `${input.runId}:${input.attemptId}:verification`,
      runId: input.runId,
      attemptId: input.attemptId,
      createdAt: input.now(),
      policy: contract.verification,
      workflowResult: result,
      projectPath: contract.projectBinding?.projectPath,
      contractWorkspacePath: input.contractWorkspacePath,
      commandExecutor: input.commandExecutor,
      emit: (event) => input.emit?.(toEngineVerificationEvent(event, input.attemptId))
    });
  }

  if (input.verifier) {
    return input.verifier({ contract, result });
  }

  const legacyVerification = contract.verification as unknown as { rubrics?: Array<{ id: string }> };
  return createPassedDecision("No verifier configured; workflow completed.", (legacyVerification.rubrics ?? []).map((rubric) => ({
    rubricId: rubric.id
  })));
}

function toEngineVerificationEvent(event: RunVerificationV2Event, attemptId: string): EngineEventInput {
  if (event.type === "validator_started") {
    return {
      type: "validator_started",
      attemptId,
      validatorId: event.validatorId,
      validatorType: event.validatorType,
      label: event.label
    };
  }
  if (event.type === "validator_done") {
    return {
      type: "validator_done",
      attemptId,
      result: event.result
    };
  }
  return {
    type: "verification_decided",
    attemptId,
    decision: event.decision
  };
}
