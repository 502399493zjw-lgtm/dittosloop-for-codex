import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../../src/codex/sessionBridge.js";
import { compileContract } from "../../src/contract/compileContract.js";
import { LoopService } from "../../src/service.js";
import { LoopStore } from "../../src/store.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createSessionRef(request: CodexSessionRequest, index: number, status: CodexSessionRef["status"] = "requested"): CodexSessionRef {
  return {
    sessionId: `session_${index}`,
    runId: request.runId,
    attemptId: request.attemptId,
    workflowContextId: request.workflowContextId,
    stepId: request.stepId,
    phaseId: request.phaseId,
    title: request.title,
    status,
    createdAt: fixedTime,
    prompt: request.prompt,
    subagent: request.subagent,
    agentProfile: request.agentProfile,
    workflowRuntime: request.workflowRuntime,
    workflowContractId: request.workflowContractId,
    workflowPlan: request.workflowPlan,
    projectId: request.projectId,
    projectLabel: request.projectLabel,
    projectPath: request.projectPath
  };
}

function createMutableSessionBridge(initialResults: Record<string, CodexSessionResult | undefined> = {}) {
  const requests: CodexSessionRequest[] = [];
  const refs = new Map<string, CodexSessionRef>();
  const results = new Map<string, CodexSessionResult | undefined>(Object.entries(initialResults));
  const bridge: CodexSessionBridge = {
    createSession: vi.fn(async (request) => {
      requests.push(request);
      const ref = createSessionRef(request, requests.length);
      refs.set(ref.sessionId, ref);
      return ref;
    }),
    sendMessage: vi.fn(async () => {}),
    recordResult: vi.fn(async (sessionId, result) => {
      results.set(sessionId, result);
    }),
    readResult: vi.fn(async (sessionId) => results.get(sessionId))
  };

  return { bridge, requests, refs, results };
}

async function createService(sessionBridge?: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-verification-subagent-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });
}

function verificationWithVerifierSubagent(input: { allowSelfReview?: boolean } = {}) {
  return {
    version: 2 as const,
    mode: "after_workflow" as const,
    criteria: [
      {
        id: "quality",
        label: "Quality",
        description: "Verifier accepts the workflow result.",
        severity: "must" as const
      }
    ],
    validators: [
      {
        id: "quality-review",
        type: "rubric_agent" as const,
        label: "Quality review",
        criteriaIds: ["quality"],
        prompt: "Review the final result and cite evidence.",
        scoreScale: { min: 0, max: 1 },
        passScore: 1,
        evidenceRequired: true,
        subagent: {
          ref: "reviewer",
          role: "verifier",
          tools: ["rg"]
        },
        ...(input.allowSelfReview !== undefined ? { allowSelfReview: input.allowSelfReview } : {}),
        severity: "must" as const
      }
    ],
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}

async function createRuntimeScriptRun(service: LoopService) {
  const contract = await service.createLoopContract({
    title: "Runtime verifier flow",
    goal: "Run a worker and separate verifier",
    workflowKind: "runtime_script",
    script: `
      const output = await agent("Draft the candidate", { label: "draft-worker" });
      return { output };
    `,
    verification: verificationWithVerifierSubagent()
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime verifier flow" });

  return { contract, launch };
}

async function createStaticWorkflowRun(service: LoopService) {
  const contract = await service.createLoopContract({
    title: "Static verifier flow",
    goal: "Run a static worker and separate verifier",
    body: {
      steps: [{ id: "draft", kind: "task" as const, runtime: "codex" as const, label: "Draft", prompt: "Draft the candidate" }]
    },
    verification: verificationWithVerifierSubagent()
  });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run static verifier flow" });

  return { contract, launch };
}

describe("verification subagent workflow", () => {
  test("DW-SUBAGENT-003 defaults allowSelfReview to false for rubric_agent validators", () => {
    const contract = compileContract({
      id: "loop_verifier_defaults",
      title: "Verifier defaults",
      goal: "Default verifier settings",
      body: {
        steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft the candidate" }]
      },
      verification: verificationWithVerifierSubagent()
    }, fixedTime);

    expect(contract.verification.validators[0]).toMatchObject({
      id: "quality-review",
      type: "rubric_agent",
      allowSelfReview: false
    });
  });

  test("runtime script verifier subagent starts a separate visible session and waits for recorded validator result", async () => {
    const { bridge, requests } = createMutableSessionBridge();
    const service = await createService(bridge);
    const { launch } = await createRuntimeScriptRun(service);

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });

    expect(firstRun.status).toBe("running");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      stepId: "runtime:agent:1:draft-worker",
      title: "draft-worker",
      prompt: "Draft the candidate"
    });

    await service.recordSessionResult(firstRun.id, {
      attemptId: launch.attempt.id,
      workflowContextId: launch.launchRequest.workflowContextId,
      sessionId: "session_1",
      stepId: "runtime:agent:1:draft-worker",
      idempotencyKey: "runtime-worker:session_1",
      status: "passed",
      summary: "Worker produced candidate",
      result: "candidate"
    });

    const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
      attemptId: launch.attempt.id
    });

    expect(resumedRun.status).toBe("running");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      stepId: "verification:quality-review",
      title: "Quality review",
      subagent: { ref: "reviewer", role: "verifier", tools: ["rg"] }
    });
    expect(requests[1].prompt).toContain("candidate");
    expect(requests[1].prompt).toContain("Verifier accepts the workflow result.");
    expect(requests[1].prompt).toContain("Review the final result and cite evidence.");

    const detailBeforeVerification = await service.getRunDetail(resumedRun.id);
    expect(detailBeforeVerification.run.codexSession?.subagents).toEqual(expect.arrayContaining([
      expect.objectContaining({ sessionId: "session_1", stepId: "runtime:agent:1:draft-worker" }),
      expect.objectContaining({ sessionId: "session_2", stepId: "verification:quality-review" })
    ]));
    expect(detailBeforeVerification.workflowContexts[0].verification).toMatchObject({
      status: "waiting_for_validator",
      pendingValidatorIds: ["quality-review"],
      validatorResults: []
    });
    expect(detailBeforeVerification.workflowContexts[0].taskRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: "verification:quality-review",
        sessionId: "session_2",
        idempotencyKey: `verification:${launch.run.id}:${launch.attempt.id}:quality-review`,
        status: "suspended"
      })
    ]));

    const reenteredRun = await service.executeWorkflowAttempt(resumedRun.id, {
      attemptId: launch.attempt.id
    });
    expect(reenteredRun.status).toBe("running");
    expect(requests).toHaveLength(2);

    const verification = await service.recordValidatorResult(resumedRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: "session_2",
      validatorId: "quality-review",
      idempotencyKey: `verification:${launch.run.id}:${launch.attempt.id}:quality-review`,
      result: {
        type: "rubric_agent",
        status: "passed",
        summary: "Verifier approved the candidate.",
        evidence: "The candidate addresses the required workflow goal.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "The candidate addresses the required workflow goal."
          }
        ]
      }
    });

    expect(verification).toMatchObject({
      version: 2,
      status: "passed"
    });

    const detailAfterVerification = await service.getRunDetail(resumedRun.id);
    expect(detailAfterVerification.run.status).toBe("completed");
    expect(detailAfterVerification.run.codexSession?.subagents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session_2",
        stepId: "verification:quality-review",
        status: "completed"
      })
    ]));
    expect(detailAfterVerification.workflowContexts[0].taskRuns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        stepId: "verification:quality-review",
        sessionId: "session_2",
        status: "completed"
      })
    ]));
    expect(detailAfterVerification.verificationResults).toEqual([
      expect.objectContaining({
        version: 2,
        status: "passed",
        validatorResults: [
          expect.objectContaining({
            validatorId: "quality-review",
            type: "rubric_agent",
            status: "passed"
          })
        ]
      })
    ]);
  });

  test("verifier writeback requires the launched verifier session identity", async () => {
    const { bridge } = createMutableSessionBridge();
    const service = await createService(bridge);
    const { launch } = await createRuntimeScriptRun(service);

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });
    await service.recordSessionResult(firstRun.id, {
      attemptId: launch.attempt.id,
      workflowContextId: launch.launchRequest.workflowContextId,
      sessionId: "session_1",
      stepId: "runtime:agent:1:draft-worker",
      idempotencyKey: "runtime-worker:session_1",
      status: "passed",
      summary: "Worker produced candidate",
      result: "candidate"
    });
    await service.executeWorkflowAttempt(firstRun.id, {
      attemptId: launch.attempt.id
    });

    await expect(service.recordValidatorResult(firstRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      validatorId: "quality-review",
      idempotencyKey: "verification:missing-session",
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Missing verifier session identity should be rejected.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "Missing verifier session identity should be rejected."
          }
        ]
      }
    })).rejects.toThrow(/sessionId.*required|verifier session/i);

    await expect(service.recordValidatorResult(firstRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: "session_999",
      validatorId: "quality-review",
      idempotencyKey: "verification:wrong-session",
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Wrong verifier session identity should be rejected.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "Wrong verifier session identity should be rejected."
          }
        ]
      }
    })).rejects.toThrow(/verifier session/i);
  });

  test("subagent-configured validators still allow external writeback when no verifier session exists", async () => {
    const service = await createService();
    const contract = await service.createLoopContract({
      title: "No bridge verifier flow",
      goal: "Allow plain verifier writeback when no verifier session exists",
      workflowKind: "runtime_script",
      script: `
        return { output: "candidate" };
      `,
      verification: verificationWithVerifierSubagent()
    });
    await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
    const launch = await service.startCodexSessionRun(contract.id, { goal: "Run no bridge verifier flow" });

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });

    const detailBeforeVerification = await service.getRunDetail(firstRun.id);
    expect(detailBeforeVerification.workflowContexts[0].verification).toMatchObject({
      status: "waiting_for_validator",
      pendingValidatorIds: ["quality-review"]
    });
    expect(
      detailBeforeVerification.workflowContexts[0].taskRuns.some((taskRun) => taskRun.stepId === "verification:quality-review")
    ).toBe(false);

    const verification = await service.recordValidatorResult(firstRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      validatorId: "quality-review",
      idempotencyKey: "verification:no-bridge-external-writeback",
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "No bridge exists, so plain external writeback should still work.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "No bridge exists, so plain external writeback should still work."
          }
        ]
      }
    });

    expect(verification).toMatchObject({ version: 2, status: "passed" });
    await expect(service.getRunDetail(firstRun.id)).resolves.toMatchObject({
      run: { status: "completed" },
      verificationResults: [expect.objectContaining({ version: 2, status: "passed" })]
    });
  });

  test("default allowSelfReview=false rejects validator writeback that reuses the worker session", async () => {
    const { bridge } = createMutableSessionBridge();
    const service = await createService(bridge);
    const { launch } = await createRuntimeScriptRun(service);

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });
    await service.recordSessionResult(firstRun.id, {
      attemptId: launch.attempt.id,
      workflowContextId: launch.launchRequest.workflowContextId,
      sessionId: "session_1",
      stepId: "runtime:agent:1:draft-worker",
      idempotencyKey: "runtime-worker:session_1",
      status: "passed",
      summary: "Worker produced candidate",
      result: "candidate"
    });
    await service.executeWorkflowAttempt(firstRun.id, {
      attemptId: launch.attempt.id
    });

    await expect(service.recordValidatorResult(firstRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: "session_1",
      validatorId: "quality-review",
      idempotencyKey: "verification:self-review",
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Worker self-approval should not count.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "Worker self-approval should not count."
          }
        ]
      }
    })).rejects.toThrow(/self-review|workflow task session/i);
  });

  test("static workflows can launch verifier subagent sessions too", async () => {
    const { bridge, requests } = createMutableSessionBridge();
    const service = await createService(bridge);
    const { launch } = await createStaticWorkflowRun(service);

    const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
      attemptId: launch.attempt.id
    });

    expect(firstRun.status).toBe("running");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      stepId: "draft",
      title: "Draft"
    });

    const resumedRun = await service.recordSessionResult(firstRun.id, {
      attemptId: launch.attempt.id,
      workflowContextId: launch.launchRequest.workflowContextId,
      sessionId: "session_1",
      stepId: "draft",
      idempotencyKey: "static-worker:session_1",
      status: "passed",
      summary: "Worker produced candidate",
      result: "candidate"
    });

    expect(resumedRun.status).toBe("running");
    expect(requests).toHaveLength(2);
    expect(requests[1]).toMatchObject({
      stepId: "verification:quality-review",
      title: "Quality review"
    });

    await service.recordValidatorResult(resumedRun.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: "session_2",
      validatorId: "quality-review",
      idempotencyKey: `verification:${launch.run.id}:${launch.attempt.id}:quality-review`,
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Independent verifier approved the static workflow result.",
        criteriaResults: [
          {
            criterionId: "quality",
            status: "passed",
            score: 1,
            maxScore: 1,
            evidence: "Independent verifier approved the static workflow result."
          }
        ]
      }
    });

    await expect(service.getRunDetail(resumedRun.id)).resolves.toMatchObject({
      run: { status: "completed" },
      verificationResults: [expect.objectContaining({ version: 2, status: "passed" })]
    });
  });
});
