import type { FormalLoopContract } from "../contract/types.js";
import { runBody } from "../engine/runBody.js";
import { runFlow } from "../engine/runFlow.js";
import type { EngineEvent, Executor } from "../engine/types.js";
import { shouldRepair as decideRepair } from "./repair.js";
import { createPassedDecision, type VerificationDecision } from "./verifier.js";

export interface LoopRunnerOptions {
  executor: Executor;
  verifier?: LoopVerifier;
  now?: () => string;
}

export interface LoopRunRequest {
  contract: FormalLoopContract;
  runId: string;
  attemptNumber?: number;
  emit?: (event: EngineEvent) => void;
}

export interface LoopRunResult {
  status: "completed";
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
    const flowResult = await runFlow(
      (api) => runBody(request.contract.body, api),
      {
        runId: request.runId,
        executor: this.options.executor,
        emit: request.emit,
        now: this.options.now
      }
    );
    const verification = await this.verify(request.contract, flowResult.result);

    return {
      status: "completed",
      output: flowResult.result,
      verification,
      shouldRepair: decideRepair(verification, request.contract.repairPolicy, request.attemptNumber ?? 1)
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
