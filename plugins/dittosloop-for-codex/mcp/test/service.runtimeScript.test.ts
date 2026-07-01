import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test, vi } from "vitest";

import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../src/codex/sessionBridge.js";
import {
  hashRuntimeScriptArgs,
  hashRuntimeScriptSource,
  runtimeAgentJournalKey
} from "../src/runtimeScript/hash.js";
import { createRuntimeScriptContextArgs } from "../src/runtimeScript/sandbox.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-29T00:00:00.000Z";
const fixedRuntimeArgs = createRuntimeScriptContextArgs({}, fixedTime);

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService(sessionBridge?: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-service-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge
  });
}

async function createServiceWithSequentialIds(sessionBridge?: CodexSessionBridge) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-service-"));
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

async function createServiceWithMutableNow(input: {
  sessionBridge?: CodexSessionBridge;
  now: () => string;
}) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();

  return new LoopService({
    store: new LoopStore(dir),
    now: input.now,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: input.sessionBridge
  });
}

function createCompletedSessionBridge(resultText: string) {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "completed",
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
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult> {
      return {
        status: "completed",
        text: resultText,
        threadId: "thread_1",
        threadTitle: "Runtime script worker",
        threadUrl: "codex://thread/thread_1",
        createdAt: fixedTime
      };
    }
  };

  return { bridge, requests };
}

function createPendingSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
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
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult | undefined> {
      return undefined;
    }
  };

  return { bridge, requests };
}

function createBarrierPendingSessionBridge(expectedRequests: number) {
  const requests: CodexSessionRequest[] = [];
  let releaseReads!: () => void;
  const allSessionsStarted = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      if (requests.length === expectedRequests) {
        releaseReads();
      }
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        attemptId: request.attemptId,
        workflowContextId: request.workflowContextId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
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
      } satisfies CodexSessionRef;
    },
    async sendMessage() {},
    async recordResult() {},
    async readResult(): Promise<CodexSessionResult | undefined> {
      await allSessionsStarted;
      return undefined;
    }
  };

  return { bridge, requests };
}

function runtimeExplicitAgentJournalKey(
  contractId: string,
  source: string,
  prompt: string,
  options: { key: string; label: string }
) {
  return runtimeAgentJournalKey({
    contractId,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs(fixedRuntimeArgs),
    callSite: options.key,
    prompt,
    options
  });
}

test("creates a runtime script loop without body steps", async () => {
  const service = await createService();

  const contract = await service.createLoopContract({
    title: "Runtime script review",
    goal: "Run a dynamic review flow",
    workflowKind: "runtime_script",
    script: 'return { summary: "ok", score: 1 };',
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script completed", severity: "must" }]
    }
  });

  expect(contract.workflow).toMatchObject({
    kind: "runtime_script",
    language: "javascript",
    source: 'return { summary: "ok", score: 1 };'
  });
  expect(contract.body).toBeUndefined();
});

test("rejects direct runtime script workflow object input", async () => {
  const service = await createService();

  await expect(
    service.createLoopContract({
      title: "Runtime workflow object",
      goal: "Reject non-explicit runtime script input",
      workflow: {
        kind: "runtime_script",
        language: "javascript",
        source: "return 'not explicit';"
      },
      verification: {
        mode: "after_workflow",
        rubrics: [{ id: "done", label: "Done", requirement: "Runtime script completed", severity: "must" }]
      }
    } as any)
  ).rejects.toThrow(/workflowKind.*runtime_script.*string script/i);
});

test("executes a runtime script workflow end-to-end with a completed bridge", async () => {
  const { bridge, requests } = createCompletedSessionBridge("bridge says hello");
  const service = await createService(bridge);
  const contract = await service.createLoopContract({
    title: "Runtime script execution",
    goal: "Use a subagent result and finish",
    workflowKind: "runtime_script",
    script: `
      const output = await agent("Say hello from runtime script", { label: "greeter" });
      return {
        output,
        score: output.length
      };
    `,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script execution" });
  const verifier = vi.fn(async ({ result }) => {
    const runtimeResult = result as { output: string; score: number };

    return {
      status: runtimeResult.score >= 5 ? "passed" : "failed",
      summary: `Verified ${runtimeResult.output}`,
      checks: [{ rubricId: "done", status: "passed", evidence: runtimeResult.output }]
    };
  });

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(run.status).toBe("completed");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    workflowContractId: contract.id,
    title: "greeter",
    prompt: "Say hello from runtime script"
  });
  expect(verifier).toHaveBeenCalledWith({
    contract: expect.objectContaining({ id: contract.id }),
    result: {
      output: "bridge says hello",
      score: 17
    }
  });

  const detail = await service.getRunDetail(run.id);
  expect(detail.attempts[0]).toMatchObject({
    id: launch.attempt.id,
    status: "completed",
    summary: "Verified bridge says hello",
    completedAt: fixedTime
  });
  expect(detail.verificationResults).toMatchObject([
    {
      attemptId: launch.attempt.id,
      status: "passed",
      summary: "Verified bridge says hello"
    }
  ]);

  const context = detail.workflowContexts[0];
  expect(context.status).toBe("completed");
  expect(context.executionGraphSnapshot).toBeUndefined();
  expect(context.nodeRuns).toBeUndefined();
  expect(context.vars.runtimeScript).toMatchObject({
    status: "completed",
    result: {
      output: "bridge says hello",
      score: 17
    },
    updatedAt: fixedTime
  });

  const snapshot = await service.getSnapshot();
  expect(snapshot.runtimeScriptJournals).toMatchObject([
    {
      contractId: contract.id,
      status: "completed",
      output: "bridge says hello",
      sessionId: "session_1"
    }
  ]);
  expect(detail.run.codexSession?.subagents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session_1",
        stepId: "runtime:agent:1:greeter",
        status: "completed",
        prompt: "Say hello from runtime script"
      })
    ])
  );
  expect(
    detail.events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is { type: string; status?: string } => Boolean(event))
      .map((event) => event.type)
  ).toEqual(expect.arrayContaining(["runtime_script_started", "agent:start", "agent:done", "runtime_script_done"]));
});

test("reuses a completed pending runtime script agent result when the run resumes", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createService(bridge);
  const prompt = "Say hello after async completion";
  const options = { label: "greeter" };
  const source = `
    const output = await agent("${prompt}", ${JSON.stringify(options)});
    return { output };
  `;
  const contract = await service.createLoopContract({
    title: "Runtime script async resume",
    goal: "Resume a pending runtime script agent",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run async runtime script execution" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    workflowContractId: contract.id,
    stepId: "runtime:agent:1:greeter",
    title: "greeter",
    prompt
  });

  const idempotencyKey = runtimeAgentJournalKey({
    contractId: contract.id,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs(fixedRuntimeArgs),
    callSite: "agent:1:greeter",
    prompt,
    options
  });

  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "runtime:agent:1:greeter",
    idempotencyKey,
    status: "passed",
    summary: "async hello",
    result: "async hello"
  });

  const verifier = vi.fn(async ({ result }) => ({
    status: (result as { output: string }).output === "async hello" ? "passed" : "failed",
    summary: "Verified async hello",
    checks: [{ rubricId: "done", status: "passed", evidence: "async hello" }]
  }));

  const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier
  });

  expect(resumedRun.status).toBe("completed");
  expect(requests).toHaveLength(1);
  expect(verifier).toHaveBeenCalledWith({
    contract: expect.objectContaining({ id: contract.id }),
    result: { output: "async hello" }
  });

  const detail = await service.getRunDetail(resumedRun.id);
  expect(detail.run.codexSession?.subagents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        sessionId: "session_1",
        stepId: "runtime:agent:1:greeter",
        status: "completed",
        prompt
      })
    ])
  );
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: { output: "async hello" }
  });
  const snapshot = await service.getSnapshot();
  expect(snapshot.runtimeScriptJournals).toMatchObject([
    {
      contractId: contract.id,
      key: idempotencyKey,
      status: "completed",
      output: "async hello",
      sessionId: "session_1"
    }
  ]);
  expect(
    detail.events
      .map((event) => event.data?.engineEvent)
      .filter((event): event is { type: string } => Boolean(event))
      .map((event) => event.type)
  ).toEqual(expect.arrayContaining(["agent:cached", "runtime_script_done"]));
});

test("keeps runtime context args stable when a pending run resumes later", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  let currentTime = fixedTime;
  const service = await createServiceWithMutableNow({
    sessionBridge: bridge,
    now: () => currentTime
  });
  const prompt = "Say hello after delayed resume";
  const options = { label: "greeter" };
  const source = `
    const output = await agent("${prompt}", ${JSON.stringify(options)});
    return { triggerTimeIso: args.triggerTimeIso, output };
  `;
  const contract = await service.createLoopContract({
    title: "Runtime script delayed resume",
    goal: "Resume a pending runtime script agent after wall-clock time changes",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run delayed runtime script execution" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(1);

  const idempotencyKey = runtimeAgentJournalKey({
    contractId: contract.id,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs(fixedRuntimeArgs),
    callSite: "agent:1:greeter",
    prompt,
    options
  });

  currentTime = "2026-06-29T01:00:00.000Z";

  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "runtime:agent:1:greeter",
    idempotencyKey,
    status: "passed",
    summary: "async hello",
    result: "async hello"
  });

  const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier: async ({ result }) => ({
      status: (result as { triggerTimeIso: string; output: string }).triggerTimeIso === fixedTime ? "passed" : "failed",
      summary: "Verified stable runtime context",
      checks: [{ rubricId: "done", status: "passed", evidence: JSON.stringify(result) }]
    })
  });

  expect(resumedRun.status).toBe("completed");
  expect(requests).toHaveLength(1);

  const detail = await service.getRunDetail(resumedRun.id);
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: {
      triggerTimeIso: fixedTime,
      output: "async hello"
    }
  });
});

test("runtime script v2 rubric agent verification waits for validator writeback after worker completion", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createServiceWithSequentialIds(bridge);
  const prompt = "Draft the runtime script answer";
  const options = { label: "draft-worker" };
  const source = `
    const output = await agent(${JSON.stringify(prompt)}, ${JSON.stringify(options)});
    return { output };
  `;
  const contract = await service.createLoopContract({
    title: "Runtime script rubric validation",
    goal: "Wait for rubric validator writeback",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        {
          id: "quality",
          label: "Quality",
          description: "The runtime script output is complete.",
          severity: "must"
        }
      ],
      validators: [
        {
          id: "rubric-agent",
          type: "rubric_agent",
          label: "Rubric agent review",
          criteriaIds: ["quality"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must"
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  });
  expect(contract.verification).toMatchObject({
    version: 2,
    validators: [expect.objectContaining({ id: "rubric-agent", type: "rubric_agent" })]
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run runtime script validator workflow" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    workflowContextId: launch.launchRequest.workflowContextId,
    workflowContractId: contract.id,
    stepId: "runtime:agent:1:draft-worker",
    title: "draft-worker",
    prompt
  });

  const idempotencyKey = runtimeAgentJournalKey({
    contractId: contract.id,
    scriptHash: hashRuntimeScriptSource(source),
    argsHash: hashRuntimeScriptArgs(fixedRuntimeArgs),
    callSite: "agent:1:draft-worker",
    prompt,
    options
  });

  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "runtime:agent:1:draft-worker",
    idempotencyKey,
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id
  });

  expect(resumedRun.status).toBe("running");
  const detail = await service.getRunDetail(resumedRun.id);
  expect(detail.verificationResults).toEqual([]);
  expect(detail.workflowContexts[0].verification).toMatchObject({
    status: "waiting_for_validator",
    pendingValidatorIds: ["rubric-agent"],
    validatorResults: []
  });
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: { output: "candidate" }
  });
  expect(detail.workflowContexts[0].executionGraphSnapshot).toBeUndefined();
  expect(detail.workflowContexts[0].nodeRuns).toBeUndefined();

  const workerWriteback = {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    validatorId: "rubric-agent",
    idempotencyKey: "validator-rubric-agent-worker",
    result: {
      type: "rubric_agent" as const,
      status: "passed" as const,
      evidence: "Worker self-approval should not count.",
      criteriaResults: [
        { criterionId: "quality", status: "passed" as const, score: 1, maxScore: 1, evidence: "Self-approved." }
      ]
    }
  };

  await expect(service.recordValidatorResult(launch.run.id, workerWriteback)).rejects.toThrow(
    "Validator result session cannot be a workflow task session"
  );

  const verification = await service.recordValidatorResult(launch.run.id, {
    ...workerWriteback,
    sessionId: "verifier-session",
    idempotencyKey: "validator-rubric-agent-verifier",
    result: {
      ...workerWriteback.result,
      evidence: "Independent verifier approved the candidate."
    }
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "completed" },
    verificationResults: [expect.objectContaining({ version: 2, status: "passed" })]
  });
});

test("failed pending runtime script child session resumes as null once sibling writebacks are complete", async () => {
  const { bridge, requests } = createBarrierPendingSessionBridge(2);
  const service = await createServiceWithSequentialIds(bridge);
  const okOptions = { key: "ok", label: "ok" };
  const failOptions = { key: "fail", label: "fail" };
  const source = `
    const results = await parallel(
      () => agent("ok", ${JSON.stringify(okOptions)}),
      () => agent("fail", ${JSON.stringify(failOptions)})
    );
    return { results };
  `;
  const contract = await service.createLoopContract({
    title: "Runtime script failed resume isolation",
    goal: "Resume failed pending runtime script child sessions without aborting siblings",
    workflowKind: "runtime_script",
    script: source,
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Runtime script result is acceptable", severity: "must" }]
    }
  });
  await service.approveRuntimeScript(contract.id, { approvedBy: "test" });
  const launch = await service.startCodexSessionRun(contract.id, { goal: "Run pending runtime script execution" });

  const firstRun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(firstRun.status).toBe("running");
  expect(requests).toHaveLength(2);
  expect(new Set(requests.map((request) => request.prompt))).toEqual(new Set(["ok", "fail"]));
  const sessionIdByPrompt = new Map(requests.map((request, index) => [request.prompt, `session_${index + 1}`]));

  const okIdempotencyKey = runtimeExplicitAgentJournalKey(contract.id, source, "ok", okOptions);
  const failIdempotencyKey = runtimeExplicitAgentJournalKey(contract.id, source, "fail", failOptions);

  await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: sessionIdByPrompt.get("ok"),
    stepId: "runtime:ok",
    idempotencyKey: okIdempotencyKey,
    status: "passed",
    summary: "good result",
    result: "good result"
  });

  const runAfterFailedWriteback = await service.recordSessionResult(firstRun.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: sessionIdByPrompt.get("fail"),
    stepId: "runtime:fail",
    idempotencyKey: failIdempotencyKey,
    status: "failed",
    summary: "bad exploded",
    result: "bad exploded"
  });

  expect(runAfterFailedWriteback.status).toBe("running");

  const resumedRun = await service.executeWorkflowAttempt(firstRun.id, {
    attemptId: launch.attempt.id,
    verifier: async ({ result }) => ({
      status: JSON.stringify((result as { results: Array<string | null> }).results) === JSON.stringify(["good result", null])
        ? "passed"
        : "failed",
      summary: "Verified resumed isolation",
      checks: [{ rubricId: "done", status: "passed", evidence: JSON.stringify(result) }]
    })
  });

  expect(resumedRun.status).toBe("completed");

  const detail = await service.getRunDetail(resumedRun.id);
  expect(detail.workflowContexts[0].vars.runtimeScript).toMatchObject({
    status: "completed",
    result: {
      results: ["good result", null]
    }
  });
  expect(detail.workflowContexts[0].taskRuns).toEqual(expect.arrayContaining([
    expect.objectContaining({
      sessionId: sessionIdByPrompt.get("ok"),
      stepId: "runtime:ok",
      status: "completed",
      result: "good result"
    }),
    expect.objectContaining({
      sessionId: sessionIdByPrompt.get("fail"),
      stepId: "runtime:fail",
      status: "failed",
      error: "bad exploded"
    })
  ]));
});
