import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { defaultSkillAvailabilityProvider } from "../src/codex/skillPreflight.js";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";
import type { IdPrefix } from "../src/id.js";
import type { LoopContract, LoopRun } from "../src/types.js";
import type {
  CodexSessionBridge,
  CodexSessionRef,
  CodexSessionRequest,
  CodexSessionResult
} from "../src/codex/sessionBridge.js";

const tempDirs: string[] = [];
const fixedTime = "2026-06-23T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createService() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888"
  });
}

async function createServiceWithSequentialIds() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
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
    previewBaseUrl: "http://127.0.0.1:47888"
  });
}

async function createServiceWithSkillAvailability(
  checker: (requirement: { id: string }, profile: { id: string; label: string; stepId: string }) => Promise<{
    status: "passed" | "missing" | "unknown";
    message: string;
    locations?: string[];
  }>
) {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);

  return new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    skillAvailabilityProvider: {
      check: checker
    }
  } as any);
}

async function createServiceWithStore(
  store: LoopStore,
  options: {
    sessionBridge?: CodexSessionBridge;
    skillAvailabilityProvider?: {
      check: (requirement: { id: string }, profile: { id: string; label: string; stepId: string }) => Promise<{
        status: "passed" | "missing" | "unknown";
        message: string;
        locations?: string[];
      }>;
    };
  } = {}
) {
  return new LoopService({
    store,
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: options.sessionBridge,
    skillAvailabilityProvider: options.skillAvailabilityProvider
  });
}

async function makeTempStore() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  return new LoopStore(dir);
}

async function createFormalLoop(
  service: LoopService,
  input: {
    title?: string;
    goal?: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  } = {}
) {
  const contract = await service.createLoopContract({
    title: input.title ?? "Code health",
    goal: input.goal ?? "Keep checks visible",
    codexProjectId: input.codexProjectId,
    projectLabel: input.projectLabel,
    projectPath: input.projectPath,
    body: {
      steps: [
        {
          id: "run-worker",
          kind: "agent",
          label: "Run worker",
          prompt: "Run the loop workflow."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "done",
          label: "Done",
          requirement: "The workflow result satisfies the loop goal.",
          severity: "must"
        }
      ]
    }
  });

  expect(contract.verification).toMatchObject({
    version: 2,
    validators: [expect.objectContaining({ type: "rubric_agent" })]
  });
  return contract;
}

async function startFormalRun(
  service: LoopService,
  input: {
    title?: string;
    goal?: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  } = {}
) {
  const loop = await createFormalLoop(service, input);
  const loopProjection = (await service.listLoops()).find((candidate) => candidate.id === loop.id);
  if (!loopProjection) {
    throw new Error(`Missing loop projection for ${loop.id}`);
  }
  const run = await seedLegacyRun(service, loopProjection, { goal: input.goal ?? "Run checks" });

  return { loop, run };
}

async function removeVerificationInputKindMarker(service: LoopService, loopId: string) {
  await (service as any).options.store.updateState((state) => ({
    ...state,
    formalContracts: state.formalContracts.map((contract) => {
      if (contract.id !== loopId) return contract;

      const { __dittosLoopVerificationInputKind, ...verification } = contract.verification as any;
      return { ...contract, verification };
    })
  }));
}

async function seedLegacyLoop(
  service: LoopService,
  input: {
    title?: string;
    intent?: string;
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  } = {}
): Promise<LoopContract> {
  const loop: LoopContract = {
    id: "loop_1",
    title: input.title ?? "Legacy Monitor",
    intent: input.intent ?? "Watch updates",
    trigger: { mode: "manual" },
    verification: { checks: [] },
    status: "active",
    codexProjectId: input.codexProjectId,
    projectLabel: input.projectLabel,
    projectPath: input.projectPath,
    createdAt: fixedTime,
    updatedAt: fixedTime
  };

  await (service as any).options.store.updateState((state) => ({
    ...state,
    loops: [...state.loops, loop]
  }));

  return loop;
}

async function seedLegacyRun(
  service: LoopService,
  loop: LoopContract,
  input: { goal?: string } = {}
): Promise<LoopRun> {
  const run: LoopRun = {
    id: "run_1",
    loopId: loop.id,
    status: "running",
    goal: input.goal ?? "Run checks",
    trigger: "manual",
    codexProjectId: loop.codexProjectId,
    projectLabel: loop.projectLabel,
    projectPath: loop.projectPath,
    createdAt: fixedTime,
    updatedAt: fixedTime
  };

  await (service as any).options.store.updateState((state) => ({
    ...state,
    runs: [...state.runs, run]
  }));

  return run;
}

function createCompletedSessionBridge(resultText: string) {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "completed",
        createdAt: fixedTime,
        prompt: request.prompt,
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
        threadTitle: "DittosLoop: Worker",
        threadUrl: "codex://thread/thread_1",
        createdAt: fixedTime
      };
    }
  };

  return { bridge, requests };
}

function createPendingSessionBridge(startIndex = 0) {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${startIndex + requests.length}`,
        runId: request.runId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
        createdAt: fixedTime,
        prompt: request.prompt,
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
    async readResult() {
      return undefined;
    }
  };

  return { bridge, requests };
}

function createSkewedPendingSessionBridge() {
  const requests: CodexSessionRequest[] = [];
  const bridge: CodexSessionBridge = {
    async createSession(request) {
      requests.push(request);
      return {
        sessionId: `session_${requests.length}`,
        runId: request.runId,
        stepId: request.stepId,
        phaseId: request.phaseId,
        title: request.title,
        status: "requested",
        createdAt: fixedTime,
        prompt: request.prompt,
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
    async readResult(sessionId) {
      if (sessionId === "session_2") {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return undefined;
    }
  };

  return { bridge, requests };
}

function v2RubricAgentLoopInput() {
  return {
    title: "Verifier owned loop",
    goal: "Separate work from verification",
    body: {
      steps: [{ id: "draft", kind: "task" as const, runtime: "codex" as const, label: "Draft", prompt: "Draft answer" }]
    },
    verification: {
      version: 2 as const,
      mode: "after_workflow" as const,
      criteria: [
        { id: "quality", label: "Quality", description: "Verifier accepts the result.", severity: "must" as const }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent" as const,
          label: "Quality review",
          criteriaIds: ["quality"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must" as const
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  };
}

function v2LegacyLikeRubricAgentLoopInput() {
  return {
    title: "Explicit V2 legacy-like loop",
    goal: "Keep explicit v2 async even when it looks like migrated legacy",
    body: {
      steps: [{ id: "draft", kind: "task" as const, runtime: "codex" as const, label: "Draft", prompt: "Draft answer" }]
    },
    verification: {
      version: 2 as const,
      mode: "after_workflow" as const,
      criteria: [
        { id: "quality", label: "Quality", description: "Verifier accepts the result.", severity: "must" as const }
      ],
      validators: [
        {
          id: "rubric-agent",
          type: "rubric_agent" as const,
          label: "Rubric review",
          criteriaIds: ["quality"],
          scoreScale: { min: 0, max: 1 },
          passScore: 1,
          evidenceRequired: true,
          severity: "must" as const
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    }
  };
}

async function createPendingServiceWithSequentialIds() {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });

  return { service, requests };
}

async function startTwoStepPendingWorkflow(service: LoopService) {
  const loop = await service.createLoopContract({
    title: "Dual write workflow",
    goal: "Track node runs while legacy execution still launches sessions",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect notes." },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review notes." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run dual write workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  return launch;
}

test("creates a formal loop contract with manual trigger defaults", async () => {
  const service = await createService();

  const loop = await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: { steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run npm test" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "tests", label: "Tests", requirement: "npm test passes", severity: "must" }]
    }
  });

  await expect(service.listLoops()).resolves.toEqual([
    {
      id: "loop_1",
      title: "Daily code health check",
      intent: "Keep the project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test passes"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    }
  ]);
  expect(loop.id).toBe("loop_1");
});

test("does not expose legacy simple loop creation or run methods", async () => {
  const service = await createService();

  expect("createLoop" in service).toBe(false);
  expect("triggerRun" in service).toBe(false);
  expect((service as any).startLoopRun).toBeUndefined();
  expect((service as any).resumeLoopRun).toBeUndefined();
});

test("creates a formal loop contract and starts a visible Codex session run", async () => {
  const service = await createService();

  const formal = await service.createLoopContract({
    title: "AI monitor",
    goal: "Track AI tool updates",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  });

  expect(formal.body.steps[0]).toMatchObject({ id: "scan", kind: "agent" });

  const launch = await service.startCodexSessionRun(formal.id, { goal: "Manual check" });

  expect(launch.run).toMatchObject({
    id: "run_1",
    loopId: formal.id,
    status: "running",
    goal: "Manual check",
    codexSession: { status: "requested" }
  });
  expect(launch.attempt).toMatchObject({
    id: "attempt_1",
    runId: launch.run.id,
    status: "running"
  });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    events: [
      {
        kind: "run_created",
        data: { codexSession: { status: "requested" } }
      },
      {
        kind: "attempt_started",
        data: { attemptId: launch.attempt.id }
      }
    ]
  });
});

test("prepares workflow context with immutable graph snapshot and node runs", async () => {
  const service = await createService();
  const loop = await service.createLoopContract({
    title: "Graph launch",
    goal: "Create graph state",
    body: {
      steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Graph state exists", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run graph launch" });
  const detail = await service.getRunDetail(launch.run.id);
  const context = detail.workflowContexts[0];

  expect(context.executionGraphSnapshot).toMatchObject({
    snapshotId: "graph_1",
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    contractId: loop.id
  });
  expect(context.nodeRuns?.map((nodeRun) => [nodeRun.nodeId, nodeRun.status])).toEqual([
    ["root", "pending"],
    ["root/task:scan", "pending"],
    ["root/verification", "pending"]
  ]);
});

test("normalizes project fields on formal loop creation into the contract binding and preview loop", async () => {
  const service = await createService();

  const formal = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成中文日报",
    body: { steps: [{ id: "write", kind: "agent", label: "日报 worker", prompt: "生成中文日报" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "zh", label: "中文日报", requirement: "输出中文日报", severity: "must" }]
    },
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  expect(formal.projectBinding).toEqual({
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [
      {
        id: formal.id,
        codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
        projectLabel: "dittos loop",
        projectPath: "/Users/edisonzhong/Documents/dittos loop"
      }
    ],
    formalContracts: [
      {
        id: formal.id,
        projectBinding: {
          codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
          projectLabel: "dittos loop",
          projectPath: "/Users/edisonzhong/Documents/dittos loop"
        }
      }
    ]
  });
});

test("renders loop directory files from stored loop state", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成 AI 开发工具中文日报",
    body: {
      steps: [
        {
          id: "write-report",
          kind: "task",
          runtime: "codex",
          label: "日报 worker",
          prompt: "生成中文日报。",
          subagent: {
            role: "report-writer",
            tools: ["web.run", "rg"],
            permissions: { filesystem: "workspace-write", network: "enabled" }
          }
        }
      ]
    },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "daily-report", label: "中文日报", description: "输出中文日报。", severity: "must" }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent",
          label: "Quality review",
          criteriaIds: ["daily-report"],
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
  const { run } = await service.startCodexSessionRun(formal.id, { goal: "生成今天的中文日报" });
  await service.commitMemory(formal.id, { runId: run.id, summary: "保留昨天的来源筛选规则。" });
  await (service as any).options.store.updateState((state: any) => ({
    ...state,
    verificationResults: [
      ...state.verificationResults,
      {
        id: "verification_v2_1",
        version: 2,
        runId: run.id,
        attemptId: "attempt_1",
        status: "passed",
        summary: "Verification passed.",
        checks: [{ rubricId: "daily-report", status: "passed", evidence: "包含来源" }],
        validatorResults: [
          {
            id: "quality-review",
            type: "rubric_agent",
            label: "Quality review",
            status: "passed",
            criteriaIds: ["daily-report"],
            score: 1,
            maxScore: 1,
            evidence: "包含来源",
            output: { notes: "中文日报完整。" }
          }
        ],
        decision: {
          status: "passed",
          summary: "Verification passed.",
          failedValidatorIds: [],
          needsHumanValidatorIds: [],
          failedCriterionIds: [],
          uncoveredMustCriterionIds: [],
          warnings: []
        },
        createdAt: fixedTime
      }
    ]
  }));
  const dataDir = (service as any).options.store.dataDir as string;
  const loopDir = join(dataDir, "loops", formal.id);
  await mkdir(join(loopDir, "skill"), { recursive: true });
  await writeFile(join(loopDir, "flow.js"), "stale", "utf8");
  await writeFile(join(loopDir, "session.json"), "stale", "utf8");
  await writeFile(join(loopDir, "skill", "old.md"), "stale", "utf8");

  const files = await service.listLoopFiles(formal.id);

  expect(files.map((file) => file.path)).toEqual([
    "memory.md",
    "workflow.json",
    "verification.md",
    "status.json",
    "contract.json",
    "skill/dittosloop-for-codex-loop.md"
  ]);
  expect(files.map((file) => file.path)).not.toContain("rubrics.md");
  expect(files.every((file) => file.size === Buffer.byteLength(file.content, "utf8"))).toBe(true);
  expect(files.find((file) => file.path === "flow.js")).toBeUndefined();
  expect(files.find((file) => file.path === "agents.md")).toBeUndefined();
  expect(files.find((file) => file.path === "tool-list.md")).toBeUndefined();
  expect(files.find((file) => file.path === "session.json")).toBeUndefined();
  expect(files.find((file) => file.path === "memory.md")?.content).toContain("保留昨天的来源筛选规则。");
  expect(files.find((file) => file.path === "skill/dittosloop-for-codex-loop.md")?.content).toContain(
    "Loop: AI 开发工具日报"
  );
  expect(files.find((file) => file.path === "status.json")?.content).toContain("\"latestRun\"");
  expect(files.find((file) => file.path === "contract.json")?.content).toContain("\"formalContract\"");
  const verificationFile = files.find((file) => file.path === "verification.md")?.content ?? "";
  expect(verificationFile).toContain("## Criteria");
  expect(verificationFile).toContain("## Validators");
  expect(verificationFile).toContain("## Decision");
  expect(verificationFile).toContain("包含来源");
  const statusJson = JSON.parse(files.find((file) => file.path === "status.json")?.content ?? "{}");
  expect(statusJson.latestVerification).toMatchObject({
    version: 2,
    status: "passed",
    decision: { status: "passed" },
    validators: [
      expect.objectContaining({
        id: "quality-review",
        status: "passed",
        score: 1,
        maxScore: 1,
        evidence: "包含来源"
      })
    ]
  });

  await expect(readFile(join(loopDir, "memory.md"), "utf8")).resolves.toContain("保留昨天的来源筛选规则。");
  await expect(readFile(join(loopDir, "workflow.json"), "utf8")).resolves.toContain("AI 开发工具日报");
  await expect(readFile(join(loopDir, "verification.md"), "utf8")).resolves.toContain("## Criteria");
  await expect(readFile(join(loopDir, "skill", "dittosloop-for-codex-loop.md"), "utf8")).resolves.toContain(
    "dittosloop-for-codex:loop"
  );
  await expect(readFile(join(loopDir, "flow.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(loopDir, "session.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  await expect(readFile(join(loopDir, "skill", "old.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
});

test("renders legacy workspace verification state without v2 fields", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "Legacy verifier",
    goal: "Keep old state readable",
    body: {
      steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan updates." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources.", severity: "must" }]
    }
  });
  const { run } = await service.startCodexSessionRun(formal.id, { goal: "Legacy run" });
  await service.recordVerification(run.id, {
    status: "failed",
    summary: "Missing source",
    checks: [{ name: "Source", status: "failed", output: "No official source" }]
  });

  const files = await service.listLoopFiles(formal.id);

  expect(files.find((file) => file.path === "rubrics.md")?.content).toContain("No official source");
  expect(() => JSON.parse(files.find((file) => file.path === "status.json")?.content ?? "{}")).not.toThrow();
});

test("projects canonical status for failed loop history", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Failing monitor",
    goal: "Show failed status",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run and fail" });
  await service.completeRun(launch.run.id, { status: "failed" });

  const files = await service.listLoopFiles(formal.id);
  const status = JSON.parse(files.find((file) => file.path === "status.json")!.content);
  const runStatus = status.runs.find((run: { id: string }) => run.id === launch.run.id);

  expect(status).toMatchObject({
    loopId: formal.id,
    cursor: null,
    paused: false,
    running: false,
    runCount: 1,
    lastRunAt: Date.parse(fixedTime),
    consecutiveFailures: 1
  });
  expect(runStatus).toMatchObject({
    id: launch.run.id,
    status: "failed"
  });
});

test("pauses canonical loop after stop policy failure threshold", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Fragile monitor",
    goal: "Pause after repeated failures",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    },
    stopPolicy: { rule: "pause after two failed runs", maxConsecutiveFailures: 2 }
  });

  const first = await service.startCodexSessionRun(formal.id, { goal: "First failing run" });
  await service.completeRun(first.run.id, { status: "failed" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "active" }],
    formalContracts: [{ id: formal.id, status: "active" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: false,
        running: false,
        runCount: 1
      }
    ]
  });

  const second = await service.startCodexSessionRun(formal.id, { goal: "Second failing run" });
  await service.completeRun(second.run.id, { status: "failed" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "paused" }],
    formalContracts: [{ id: formal.id, status: "paused" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 2,
        paused: true,
        pausedReason: "failures",
        running: false,
        runCount: 2
      }
    ]
  });
  await expect(service.startCodexSessionRun(formal.id, { goal: "Third run" })).rejects.toThrow(/Loop is paused/);

  const files = await service.listLoopFiles(formal.id);
  expect(JSON.parse(files.find((file) => file.path === "status.json")!.content)).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 2,
    paused: true,
    pausedReason: "failures",
    running: false
  });
});

test("pauses canonical loop after failed Codex session result reaches threshold", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Failing session monitor",
    goal: "Pause from session result",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    },
    stopPolicy: { rule: "pause after first failed session", maxConsecutiveFailures: 1 }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run through Codex session" });

  await service.recordSessionResult(launch.run.id, {
    status: "failed",
    summary: "Codex session failed verification."
  });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "paused" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: true,
        pausedReason: "failures",
        running: false,
        runCount: 1
      }
    ]
  });
  await expect(service.startCodexSessionRun(formal.id, { goal: "Retry while paused" })).rejects.toThrow(/Loop is paused/);
});

test("pauses canonical loop immediately when a Codex session reports a budget stop", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Budgeted monitor",
    goal: "Respect a per-run budget",
    budgetUsd: 0.5,
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run with budget cap" });

  const failedRun = await service.recordSessionResult(launch.run.id, {
    status: "failed",
    summary: "Per-run budget cap exceeded.",
    pausedReason: "budget"
  });

  expect(formal.budgetUsd).toBe(0.5);
  expect(failedRun).toMatchObject({
    id: launch.run.id,
    status: "failed",
    pausedReason: "budget"
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "paused" }],
    formalContracts: [{ id: formal.id, status: "paused", budgetUsd: 0.5 }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: true,
        pausedReason: "budget",
        running: false,
        runCount: 1
      }
    ],
    runs: [{ id: launch.run.id, pausedReason: "budget" }]
  });
  await expect(service.startCodexSessionRun(formal.id, { goal: "Retry while budget paused" })).rejects.toThrow(/Loop is paused/);

  const files = await service.listLoopFiles(formal.id);
  expect(JSON.parse(files.find((file) => file.path === "status.json")!.content)).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 1,
    paused: true,
    pausedReason: "budget",
    running: false,
    latestRun: {
      id: launch.run.id,
      status: "failed",
      pausedReason: "budget"
    }
  });
});

test("rejects external failure stop reasons so stopPolicy owns failure pausing", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Failure threshold owner",
    goal: "Let stopPolicy decide failure pauses",
    stopPolicy: { rule: "pause after two failed sessions", maxConsecutiveFailures: 2 },
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Fail once" });

  await expect(
    service.recordSessionResult(launch.run.id, {
      status: "failed",
      summary: "Session failed once.",
      pausedReason: "failures" as never
    })
  ).rejects.toThrow(/Failure pauses are derived from stopPolicy/);
});

test("rejects manual failure stop reasons so completeRun cannot bypass failure thresholds", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Manual failure threshold owner",
    goal: "Let stopPolicy decide manual failure pauses",
    stopPolicy: { rule: "pause after two manual failures", maxConsecutiveFailures: 2 },
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Fail once" });

  await expect(
    service.completeRun(launch.run.id, {
      status: "failed",
      pausedReason: "failures" as never
    })
  ).rejects.toThrow(/Failure pauses are derived from stopPolicy/);
  const snapshot = await service.getSnapshot();
  expect(snapshot).toMatchObject({
    loops: [{ id: formal.id, status: "active" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 0,
        paused: false,
        running: true,
        runCount: 0
      }
    ],
    runs: [{ id: launch.run.id, status: "running" }]
  });
  expect("pausedReason" in snapshot.runs[0]).toBe(false);
});

test("pauses canonical loop for escalation without counting it as a normal failure", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Escalation monitor",
    goal: "Stop before crossing approval boundaries",
    escalation: ["production deploy"],
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Attempt an escalation boundary" });

  const stoppedRun = await service.recordSessionResult(launch.run.id, {
    status: "failed",
    summary: "Escalation boundary requested: production deploy.",
    pausedReason: "escalation"
  });

  expect(formal.escalation).toEqual(["production deploy"]);
  expect(stoppedRun).toMatchObject({
    id: launch.run.id,
    status: "failed",
    pausedReason: "escalation"
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "paused" }],
    formalContracts: [{ id: formal.id, status: "paused", escalation: ["production deploy"] }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 0,
        paused: true,
        pausedReason: "escalation",
        running: false,
        runCount: 1
      }
    ],
    runs: [{ id: launch.run.id, pausedReason: "escalation" }]
  });
  await expect(service.startCodexSessionRun(formal.id, { goal: "Retry while escalation paused" })).rejects.toThrow(/Loop is paused/);
});

test("resumes paused canonical loop and clears failure stop state", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Recoverable monitor",
    goal: "Resume after failure review",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    },
    stopPolicy: { rule: "pause after first failed run", maxConsecutiveFailures: 1 }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Fail once" });
  await service.completeRun(launch.run.id, { status: "failed" });

  const resumed = await service.resumeLoop(formal.id);

  expect(resumed.loop).toMatchObject({ id: formal.id, status: "active" });
  expect(resumed.state).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 0,
    paused: false,
    running: false,
    runCount: 1,
    lastRunAt: Date.parse(fixedTime)
  });
  expect(resumed.state.pausedReason).toBeUndefined();

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "active" }],
    formalContracts: [{ id: formal.id, status: "active" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 0,
        paused: false,
        running: false,
        runCount: 1
      }
    ]
  });
  const files = await service.listLoopFiles(formal.id);
  const status = JSON.parse(files.find((file) => file.path === "status.json")!.content);
  expect(status).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 0,
    paused: false,
    running: false
  });
  expect(status.pausedReason).toBeUndefined();

  const retry = await service.startCodexSessionRun(formal.id, { goal: "Retry after resume" });
  expect(retry.run).toMatchObject({ id: "run_2", loopId: formal.id, status: "running" });
});

test("manual pause blocks new loop runs until resume", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  const paused = await service.pauseLoop(formal.id);

  expect(paused.loop).toMatchObject({ id: formal.id, status: "paused" });
  expect(paused.state).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 0,
    paused: true,
    running: false,
    runCount: 0
  });
  expect(paused.state.pausedReason).toBeUndefined();
  await expect(service.startCodexSessionRun(formal.id, { goal: "Should not start" })).rejects.toThrow(/Loop is paused/);

  const resumed = await service.resumeLoop(formal.id);
  expect(resumed.state).toMatchObject({
    loopId: formal.id,
    consecutiveFailures: 0,
    paused: false,
    running: false,
    runCount: 0
  });
  expect(resumed.state.pausedReason).toBeUndefined();
  await expect(service.startCodexSessionRun(formal.id, { goal: "Run after resume" })).resolves.toMatchObject({
    run: { id: "run_1", loopId: formal.id, status: "running" }
  });
});

test("resume resets the failure counter for subsequent failed runs", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Resettable monitor",
    goal: "Retry from a clean failure counter",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Run the loop workflow." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "The workflow result is acceptable.", severity: "must" }]
    },
    stopPolicy: { rule: "pause after two consecutive failed runs", maxConsecutiveFailures: 2 }
  });
  const first = await service.startCodexSessionRun(formal.id, { goal: "First failure" });
  await service.completeRun(first.run.id, { status: "failed" });
  await service.pauseLoop(formal.id);
  await service.resumeLoop(formal.id);

  const retry = await service.startCodexSessionRun(formal.id, { goal: "Retry after reset" });
  await service.completeRun(retry.run.id, { status: "failed" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: formal.id, status: "active" }],
    formalContracts: [{ id: formal.id, status: "active" }],
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: false,
        running: false,
        runCount: 2
      }
    ]
  });
});

test("persists canonical loop operational state across run lifecycle", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: formal.id,
        cursor: null,
        consecutiveFailures: 0,
        paused: false,
        running: false,
        runCount: 0
      }
    ]
  });

  const first = await service.startCodexSessionRun(formal.id, { goal: "First run" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 0,
        paused: false,
        running: true,
        runCount: 0,
        activeRunId: first.run.id,
        activeRunStatus: "running"
      }
    ]
  });
  await expect(service.startCodexSessionRun(formal.id, { goal: "Overlapping run" })).rejects.toThrow(/already running/);

  await service.recordHumanRequest(first.run.id, { question: "Need input?" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [{ loopId: formal.id, activeRunId: first.run.id, activeRunStatus: "waiting_for_human" }]
  });
  const waitingFiles = await service.listLoopFiles(formal.id);
  const waitingStatus = JSON.parse(waitingFiles.find((file) => file.path === "status.json")!.content);
  expect(waitingStatus).toMatchObject({
    activeRunId: first.run.id,
    activeRunStatus: "waiting_for_human",
    latestRun: { id: first.run.id, status: "waiting_for_human" },
    runs: [{ id: first.run.id, status: "waiting_for_human" }]
  });

  await service.markRunRepairing(first.run.id, { reason: "Repair after missing source." });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [{ loopId: formal.id, activeRunId: first.run.id, activeRunStatus: "repairing" }]
  });
  const repairingFiles = await service.listLoopFiles(formal.id);
  const repairingStatus = JSON.parse(repairingFiles.find((file) => file.path === "status.json")!.content);
  expect(repairingStatus).toMatchObject({
    activeRunId: first.run.id,
    activeRunStatus: "repairing",
    latestRun: { id: first.run.id, status: "repairing" },
    runs: [{ id: first.run.id, status: "repairing" }]
  });

  await service.completeRun(first.run.id, { status: "failed" });
  await service.commitMemory(formal.id, { runId: first.run.id, summary: "Keep stricter source rules." });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: false,
        running: false,
        runCount: 1,
        lastRunAt: Date.parse(fixedTime)
      }
    ]
  });

  const second = await service.startCodexSessionRun(formal.id, { goal: "Second run" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 1,
        paused: false,
        running: true,
        runCount: 1,
        activeRunId: second.run.id,
        activeRunStatus: "running"
      }
    ]
  });
  await service.completeRun(second.run.id, { status: "completed" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: formal.id,
        consecutiveFailures: 0,
        paused: false,
        running: false,
        runCount: 2,
        lastRunAt: Date.parse(fixedTime)
      }
    ]
  });
});

test("persists newest-first loop memory across commits", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run memory updater" });

  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Prefer official sources." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Ignore duplicate syndicated posts." });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loopMemories: [
      {
        loopId: formal.id,
        content: "Ignore duplicate syndicated posts.\nPrefer official sources.\n",
        updatedAt: fixedTime
      }
    ],
    memoryCommits: [
      { loopId: formal.id, runId: launch.run.id, summary: "Prefer official sources." },
      { loopId: formal.id, runId: launch.run.id, summary: "Ignore duplicate syndicated posts." }
    ]
  });

  const files = await service.listLoopFiles(formal.id);
  expect(files.find((file) => file.path === "memory.md")?.content).toBe("Ignore duplicate syndicated posts.\nPrefer official sources.\n");
  const contract = JSON.parse(files.find((file) => file.path === "contract.json")!.content);
  expect(contract).toMatchObject({
    memoryCommits: [
      { id: "memory_1", summary: "Prefer official sources." },
      { id: "memory_2", summary: "Ignore duplicate syndicated posts." }
    ]
  });
  expect(contract).not.toHaveProperty("memoryRevision");
});

test("reads loop memory in bounded newest-first windows", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run memory updater" });

  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "First durable lesson." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Second durable lesson." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Third durable lesson." });

  await expect(service.readLoopMemory(formal.id, { limit: 2 })).resolves.toEqual({
    loopId: formal.id,
    limit: 2,
    offset: 0,
    returnedLines: 2,
    totalLines: 3,
    remainingLines: 1,
    content:
      "Third durable lesson.\nSecond durable lesson.\n还有 1 条记忆未读取。可调用 read_loop_memory({ loopId: \"loop_1\", offset: 2, limit: 2 }) 继续读取。"
  });

  await expect(service.readLoopMemory(formal.id, { limit: 2, offset: 2 })).resolves.toEqual({
    loopId: formal.id,
    limit: 2,
    offset: 2,
    returnedLines: 1,
    totalLines: 3,
    remainingLines: 0,
    content: "First durable lesson."
  });

  await expect(service.readLoopMemory(formal.id)).resolves.toMatchObject({
    loopId: formal.id,
    limit: 80,
    offset: 0,
    returnedLines: 3,
    totalLines: 3,
    remainingLines: 0
  });
});

test("returns structured empty loop memory windows", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  await expect(service.readLoopMemory(formal.id)).resolves.toEqual({
    loopId: formal.id,
    limit: 80,
    offset: 0,
    returnedLines: 0,
    totalLines: 0,
    remainingLines: 0,
    content: "暂无长期记忆。"
  });
});

test("returns an exhausted message when loop memory exists but the offset is past the end", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run memory updater" });

  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "First durable lesson." });
  await service.commitMemory(formal.id, { runId: launch.run.id, summary: "Second durable lesson." });

  await expect(service.readLoopMemory(formal.id, { limit: 2, offset: 5 })).resolves.toEqual({
    loopId: formal.id,
    limit: 2,
    offset: 5,
    returnedLines: 0,
    totalLines: 2,
    remainingLines: 0,
    content: "没有更多长期记忆。"
  });
});

test("rejects invalid loop memory window requests", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);

  await expect(service.readLoopMemory("missing_loop")).rejects.toThrow(/Loop not found/);
  await expect(service.readLoopMemory(formal.id, { limit: 0 })).rejects.toThrow(/limit must be between 1 and 200/);
  await expect(service.readLoopMemory(formal.id, { limit: 201 })).rejects.toThrow(/limit must be between 1 and 200/);
  await expect(service.readLoopMemory(formal.id, { offset: -1 })).rejects.toThrow(/offset must be greater than or equal to 0/);
});

test("proposes workflow revisions from a visible Codex session without replacing the active contract", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "AI Dev Tools Update Monitor",
    goal: "Monitor Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates",
    body: {
      steps: [
        {
          id: "collect",
          kind: "agent",
          label: "Collect updates",
          prompt: "Collect notable updates without sources"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "sources",
          label: "Sources",
          requirement: "Every notable update includes an official source",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" },
    stopPolicy: { rule: "stop after verification passes or attempts are exhausted" }
  });

  const launch = await service.startCodexSessionRun(formal.id, { goal: "Check today updates" });
  await service.recordCodexThread(launch.run.id, {
    threadId: "thread_main",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor"
  });

  const revision = await service.proposeWorkflowRevision(formal.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    authorSessionId: "session_collect",
    rationale: "Missing official sources.",
    patch: {
      body: {
        steps: [
          {
            id: "collect",
            kind: "agent",
            label: "Collect updates",
            prompt: "Collect notable updates with official sources"
          }
        ]
      }
    }
  });

  expect(revision).toMatchObject({
    loopId: formal.id,
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    authorSessionId: "session_collect",
    authorThreadId: "thread_main",
    status: "draft",
    reason: "Missing official sources.",
    contract: {
      id: formal.id,
      body: {
        steps: [{ id: "collect", kind: "agent", prompt: "Collect notable updates with official sources" }]
      }
    }
  });

  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.workflowRevisions).toHaveLength(1);
  expect(detail.workflowRevisions[0]).toMatchObject({
    id: revision.id,
    status: "draft",
    reason: "Missing official sources."
  });

  const snapshot = await service.getSnapshot();
  expect(snapshot.formalContracts?.[0].body.steps[0]).toMatchObject({
    id: "collect",
    kind: "agent",
    prompt: "Collect notable updates without sources"
  });
  expect(snapshot.workflowRevisions?.[0].contract.body.steps[0]).toMatchObject({
    id: "collect",
    kind: "agent",
    prompt: "Collect notable updates with official sources"
  });

  const promoted = await service.promoteWorkflowRevision(formal.id, revision.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  expect(promoted.status).toBe("promoted");
  await expect(
    service.rejectWorkflowRevision(formal.id, revision.id, {
      runId: launch.run.id,
      attemptId: launch.attempt.id,
      reason: "Do not mutate the active revision."
    })
  ).rejects.toThrow(/Only draft workflow revisions can be rejected/);

  const followUpRevision = await service.proposeWorkflowRevision(formal.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    rationale: "Narrow the monitor to official release channels.",
    contract: {
      title: formal.title,
      goal: formal.goal,
      body: {
        steps: [
          {
            id: "collect",
            kind: "agent",
            label: "Collect updates",
            prompt: "Collect official release-channel updates only"
          }
        ]
      },
      verification: formal.verification,
      repairPolicy: formal.repairPolicy,
      stopPolicy: formal.stopPolicy
    }
  });
  await service.promoteWorkflowRevision(formal.id, followUpRevision.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    formalContracts: [
      {
        id: formal.id,
        body: {
          steps: [{ id: "collect", kind: "agent", prompt: "Collect official release-channel updates only" }]
        }
      }
    ],
    workflowRevisions: [
      { id: revision.id, status: "superseded" },
      { id: followUpRevision.id, status: "promoted" }
    ]
  });
});

test("requires visible run and attempt context for workflow revision mutations", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Check today updates" });

  await expect(
    service.proposeWorkflowRevision(formal.id, {
      reason: "Tighten the workflow.",
      patch: { goal: "Check official updates" }
    } as any)
  ).rejects.toThrow(/runId and attemptId/);
  await expect(
    service.proposeWorkflowRevision(formal.id, {
      runId: launch.run.id,
      reason: "Tighten the workflow.",
      patch: { goal: "Check official updates" }
    } as any)
  ).rejects.toThrow(/runId and attemptId/);

  const draft = await service.proposeWorkflowRevision(formal.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Tighten the workflow.",
    patch: { goal: "Check official updates" }
  });

  await expect((service.promoteWorkflowRevision as any)(formal.id, draft.id)).rejects.toThrow(/runId and attemptId/);
  await expect(
    (service.promoteWorkflowRevision as any)(formal.id, draft.id, {
      runId: launch.run.id,
      attemptId: "attempt_from_another_session"
    })
  ).rejects.toThrow(/Attempt not found|Attempt does not belong/);
  await expect((service.rejectWorkflowRevision as any)(formal.id, draft.id, { reason: "Needs more work." })).rejects.toThrow(
    /runId and attemptId/
  );
});

test("keeps promoted workflow revision contract snapshots immutable", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const times = [
    "2026-06-23T00:00:00.000Z",
    "2026-06-23T00:01:00.000Z",
    "2026-06-23T00:02:00.000Z",
    "2026-06-23T00:03:00.000Z",
    "2026-06-23T00:04:00.000Z"
  ];
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => times.shift() ?? "2026-06-23T00:05:00.000Z",
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888"
  });
  const formal = await service.createLoopContract({
    title: "Revision immutability",
    goal: "Keep workflow revision proposals immutable",
    body: {
      steps: [{ id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect notes" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Revision is tracked", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  const revision = await service.proposeWorkflowRevision(formal.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Add synthesis.",
    patch: {
      body: {
        steps: [
          { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect notes" },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write summary" }
        ]
      }
    }
  });
  const proposedContract = JSON.parse(JSON.stringify(revision.contract));

  const promoted = await service.promoteWorkflowRevision(formal.id, revision.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });
  const snapshot = await service.getSnapshot();

  expect(promoted.contract).toEqual(proposedContract);
  expect(snapshot.workflowRevisions[0].contract).toEqual(proposedContract);
  expect(snapshot.formalContracts[0]).toMatchObject({
    id: formal.id,
    updatedAt: "2026-06-23T00:04:00.000Z",
    body: { steps: [{ id: "collect" }, { id: "write" }] }
  });
});

test("uses the configured Codex session bridge as the default formal workflow executor", async () => {
  const { bridge, requests } = createCompletedSessionBridge("完成中文日报，包含来源、风险和建议动作。");
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const formal = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成 AI 开发工具中文日报",
    body: {
      steps: [
        {
          id: "research",
          kind: "phase",
          label: "信息收集",
          children: [
            {
              id: "write-report",
              kind: "agent",
              label: "日报 worker",
              prompt: "生成 OpenClaw、Claude Code、Codex、Hermes 的中文日报。",
              sessionPolicy: "new"
            }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "daily-report",
          label: "中文日报",
          requirement: "输出中文日报并包含来源、风险和建议动作。",
          severity: "must"
        }
      ]
    },
    projectBinding: {
      codexProjectId: "project-dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    }
  });

  const launch = await service.startCodexSessionRun(formal.id, {
    goal: "生成今天的中文日报"
  });
  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    verifier: ({ result }) => ({
      status: JSON.stringify(result).includes("来源") ? "passed" : "failed",
      summary: "日报通过验证。",
      checks: [{ rubricId: "daily-report", status: "passed", evidence: "包含来源、风险和建议动作" }]
    })
  });

  expect(run).toMatchObject({
    loopId: formal.id,
    status: "completed",
    goal: "生成今天的中文日报"
  });

  expect(run.codexSession).toMatchObject({
    mode: "new_session",
    status: "completed",
    threadId: "thread_1",
    threadTitle: "DittosLoop: Worker",
    threadUrl: "codex://thread/thread_1",
    codexProjectId: "project-dittos-loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop",
    subagents: [
      {
        role: "日报 worker",
        status: "completed",
        threadId: "thread_1",
        threadTitle: "DittosLoop: Worker",
        threadUrl: "codex://thread/thread_1",
        prompt: "生成 OpenClaw、Claude Code、Codex、Hermes 的中文日报。"
      }
    ],
    prompt: "生成 OpenClaw、Claude Code、Codex、Hermes 的中文日报。"
  });
  expect(requests).toMatchObject([
    {
      runId: run.id,
      stepId: "write-report",
      phaseId: "research",
      title: "日报 worker",
      prompt: "生成 OpenClaw、Claude Code、Codex、Hermes 的中文日报。",
      workflowRuntime: "dittosloop-local-workflow",
      workflowContractId: formal.id,
      workflowPlan: {
        contractId: formal.id,
        steps: [
          { id: "research", kind: "phase", label: "信息收集", depth: 0 },
          {
            id: "write-report",
            kind: "agent",
            label: "日报 worker",
            phaseId: "research",
            sessionPolicy: "new",
            depth: 1
          }
        ]
      },
      projectId: "project-dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    }
  ]);
  const detail = await service.getRunDetail(run.id);
  const engineEvents = detail.events.map((event) => event.data?.engineEvent).filter(Boolean);
  expect(engineEvents).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: "phase_started", phaseId: "research" }),
      expect.objectContaining({ type: "agent_started", stepId: "write-report" }),
      expect.objectContaining({
        type: "agent_done",
        stepId: "write-report",
        session: expect.objectContaining({
          sessionId: "session_1",
          threadId: "thread_1",
          threadUrl: "codex://thread/thread_1"
        })
      }),
      expect.objectContaining({ type: "verification_done" })
    ])
  );
});

test("keeps a bridge-backed formal workflow running while the Codex session result is pending", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const formal = await service.createLoopContract({
    title: "AI 开发工具日报",
    goal: "生成 AI 开发工具中文日报",
    body: {
      steps: [
        {
          id: "write-report",
          kind: "agent",
          label: "日报 worker",
          prompt: "生成中文日报。",
          sessionPolicy: "new"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "daily-report",
          label: "中文日报",
          requirement: "输出中文日报。",
          severity: "must"
        }
      ]
    },
    projectBinding: {
      codexProjectId: "project-dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    }
  });

  const launch = await service.startCodexSessionRun(formal.id, {
    goal: "生成今天的中文日报"
  });
  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(run).toMatchObject({
    loopId: formal.id,
    status: "running",
    codexSession: {
      mode: "new_session",
      status: "requested",
      codexProjectId: "project-dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop",
      subagents: [
        {
          role: "日报 worker",
          status: "requested",
          prompt: "生成中文日报。"
        }
      ],
      prompt: "生成中文日报。"
    }
  });
  expect(requests).toHaveLength(1);
  const rerun = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });
  expect(rerun.id).toBe(run.id);
  expect(requests).toHaveLength(1);
  const detail = await service.getRunDetail(run.id);
  expect(detail.attempts).toMatchObject([{ status: "running" }]);
  const engineEventTypes = detail.events.map((event) => event.data?.engineEvent?.type).filter(Boolean);
  expect(engineEventTypes).toContain("agent_started");
  expect(engineEventTypes).not.toContain("agent_failed");
  expect(engineEventTypes).not.toContain("run_failed");
  expect(
    detail.events.some((event) => event.data?.engineEvent?.type === "phase_done" && event.data.engineEvent.status !== "ok")
  ).toBe(false);
  expect(detail.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "note",
        message: "Codex session requested; waiting for worker result",
        data: expect.objectContaining({
          codexSession: expect.objectContaining({
            sessionId: "session_1",
            stepId: "write-report"
          })
        })
      })
    ])
  );
});

test("keeps a formal workflow waiting when verifier needs human input", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Ambiguous source monitor",
    goal: "Decide whether community-only signals are acceptable",
    body: {
      steps: [
        {
          id: "collect",
          kind: "agent",
          label: "Collect signals",
          prompt: "Collect release signals"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "source-policy",
          label: "Source policy",
          requirement: "Clarify whether unofficial sources are allowed",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 1, strategy: "ask_human" }
  });

  const launch = await service.startCodexSessionRun(formal.id, {
    goal: formal.goal
  });
  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    executor: {
      async run() {
        return { text: "Only community source found" };
      }
    },
    verifier: () => ({
      status: "needs_human",
      summary: "Source policy is ambiguous.",
      humanQuestion: "Should this loop include community-only signals when official sources are absent?",
      checks: [{ rubricId: "source-policy", status: "needs_human" }]
    })
  });

  expect(run).toMatchObject({
    loopId: formal.id,
    status: "waiting_for_human"
  });

  const detail = await service.getRunDetail(run.id);
  expect(detail.attempts).toMatchObject([
    { status: "completed", summary: "Source policy is ambiguous." }
  ]);
  expect(detail.humanRequests).toMatchObject([
    {
      status: "open",
      question: "Should this loop include community-only signals when official sources are absent?"
    }
  ]);
  expect(detail.events.map((event) => event.data?.engineEvent?.type).filter(Boolean)).toContain("human_request");
});

test("records a run lifecycle in the snapshot", async () => {
  const service = await createService();
  const loop = await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: { steps: [{ id: "check", kind: "agent", label: "Run checks", prompt: "Run npm test" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "tests", label: "Tests", requirement: "npm test passes", severity: "must" }]
    }
  });

  const { run } = await service.startCodexSessionRun(loop.id, { goal: "Check current tests" });
  await service.appendEvent(run.id, { kind: "note", message: "Started local checks" });
  await service.recordVerification(run.id, {
    status: "passed",
    summary: "Tests passed",
    checks: [{ name: "npm test", status: "passed", output: "2 passed" }]
  });
  await service.recordHumanRequest(run.id, { question: "Should this loop run every morning?" });
  await service.commitMemory(loop.id, {
    runId: run.id,
    summary: "Manual check loop should stay local-first."
  });
  await service.addArtifact(run.id, {
    title: "Preview",
    url: "http://127.0.0.1:47888",
    kind: "preview"
  });
  await service.completeRun(run.id, { status: "completed" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    runs: [{ id: "run_1", loopId: "loop_1", status: "completed", completedAt: fixedTime }],
    events: expect.arrayContaining([
      { id: "event_1", runId: "run_1", kind: "note", message: "Started local checks", createdAt: fixedTime }
    ]),
    verificationResults: [{ id: "verification_1", runId: "run_1", status: "passed" }],
    humanRequests: [{ id: "human_1", runId: "run_1", question: "Should this loop run every morning?" }],
    memoryCommits: [{ id: "memory_1", loopId: "loop_1", runId: "run_1" }],
    artifacts: [{ id: "artifact_1", runId: "run_1", title: "Preview" }]
  });
  expect(service.getPreviewUrl()).toBe("http://127.0.0.1:47888");
});

test("updates the preview URL after the runtime binds a fallback port", async () => {
  const service = await createService();

  service.setPreviewUrl("http://127.0.0.1:47901");

  expect(service.getPreviewUrl()).toBe("http://127.0.0.1:47901");
  await expect(service.getSnapshot()).resolves.toMatchObject({
    previewUrl: "http://127.0.0.1:47901"
  });
});

test("deletes a loop and its run history", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "Daily code health check",
    goal: "Keep the project healthy",
    body: {
      steps: [
        {
          id: "check",
          kind: "agent",
          label: "Run checks",
          prompt: "Run the local health checks."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "tests",
          label: "Tests",
          requirement: "Tests pass",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" }
  });
  const { run, attempt } = await service.startCodexSessionRun(formal.id, {
    goal: "Run the local health checks."
  });
  await service.proposeWorkflowRevision(formal.id, {
    runId: run.id,
    attemptId: attempt.id,
    rationale: "Missing artifact.",
    patch: {
      stopPolicy: { rule: "Stop after the verification artifact is captured" }
    }
  });
  await service.appendEvent(run.id, { kind: "note", message: "Started local checks" });
  await service.recordHumanRequest(run.id, { question: "Ship it?" });
  await service.commitMemory(formal.id, { runId: run.id, summary: "Checks passed locally." });
  await service.addArtifact(run.id, { title: "Preview", url: "http://127.0.0.1:47888" });

  const deleted = await service.deleteLoop(formal.id);

  expect(deleted).toMatchObject({ id: formal.id, title: "Daily code health check" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    loops: [],
    formalContracts: [],
    workflowRevisions: [],
    workflowContexts: [],
    runs: [],
    attempts: [],
    events: [],
    verificationResults: [],
    humanRequests: [],
    memoryCommits: [],
    loopMemories: [],
    artifacts: []
  });
});

test("deletes a loop workspace directory from disk", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888"
  });
  const formal = await createFormalLoop(service, {
    title: "Daily code health check",
    goal: "Keep the project healthy"
  });

  await service.listLoopFiles(formal.id);
  await expect(access(join(dir, "loops", formal.id))).resolves.toBeUndefined();

  await service.deleteLoop(formal.id);

  await expect(access(join(dir, "loops", formal.id))).rejects.toMatchObject({ code: "ENOENT" });
});

test("binds loop runs to the Codex project selected for the loop", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "Project monitor",
    goal: "Watch a Codex project",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  const { run } = await service.startCodexSessionRun(loop.id, { goal: "Run scheduled check" });

  expect(run).toMatchObject({
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });
});

test("starts and completes an attempt under a run", async () => {
  const service = await createService();
  const { run } = await startFormalRun(service);

  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  const completed = await service.completeAttempt(attempt.id, {
    status: "completed",
    summary: "Tests passed"
  });

  expect(completed).toMatchObject({
    id: "attempt_1",
    runId: run.id,
    status: "completed",
    summary: "Tests passed",
    completedAt: fixedTime
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    attempts: [{ id: "attempt_1", runId: run.id, status: "completed" }],
    events: expect.arrayContaining([
      expect.objectContaining({ kind: "attempt_started", runId: run.id, message: "First pass" }),
      expect.objectContaining({ kind: "attempt_completed", runId: run.id, message: "Tests passed" })
    ])
  });
});

test("starts a host-mediated Codex session launch request with project binding and prompt intent", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates and Twitter/X signals"
  });

  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop"
  });

  expect(launch.run).toMatchObject({
    id: "run_1",
    loopId: loop.id,
    goal: "Check today updates",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop",
    codexSession: {
      mode: "new_session",
      status: "requested",
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop",
      subagents: [
        {
          role: "Run worker",
          status: "requested"
        }
      ]
    }
  });
  expect(launch.attempt).toMatchObject({
    id: "attempt_1",
    runId: launch.run.id,
    status: "running",
    summary: "Request a new Codex session for AI Dev Tools Update Monitor"
  });
  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    loopId: loop.id,
    title: "DittosLoop: AI Dev Tools Update Monitor",
    codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
    projectLabel: "dittos loop",
    projectPath: "/Users/edisonzhong/Documents/dittos loop",
    prompt: launch.prompt
  });
  expect(launch.prompt).toContain("AI Dev Tools Update Monitor");
  expect(launch.prompt).toContain("Check today updates");
  expect(launch.prompt).toContain("The workflow result satisfies the loop goal");
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { codexSession: { status: "requested" } },
    loop: {
      codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    },
    events: [
      {
        kind: "run_created",
        data: {
          codexSession: {
            mode: "new_session",
            status: "requested",
            codexProjectId: "/Users/edisonzhong/Documents/dittos loop",
            projectLabel: "dittos loop",
            projectPath: "/Users/edisonzhong/Documents/dittos loop",
            subagents: [{ role: "Run worker", status: "requested" }]
          }
        }
      },
      { kind: "attempt_started" }
    ]
  });
});

test("creates a workflow context when requesting a visible Codex session", async () => {
  const service = await createServiceWithSequentialIds();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates and Twitter/X signals"
  });

  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates"
  });

  expect(launch.launchRequest).toMatchObject({
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    workflowContextId: "workflow_1"
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    version: 2,
    workflowContexts: [
      {
        id: "workflow_1",
        runId: launch.run.id,
        loopId: loop.id,
        attemptId: launch.attempt.id,
        contractId: loop.id,
        contractSnapshot: {
          id: loop.id,
          body: {
            steps: [{ id: "run-worker", kind: "agent", prompt: "Run the loop workflow." }]
          }
        },
        status: "ready",
        cursor: { state: "created" },
        taskRuns: [],
        pendingSessionIds: []
      }
    ]
  });
});

test("executes a session run against the workflow snapshot captured at launch", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Snapshot workflow",
    goal: "Run the launched workflow version",
    body: {
      steps: [{ id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Use launch-time prompt" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run the launch snapshot" });
  const revision = await service.proposeWorkflowRevision(loop.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    rationale: "Use a newer prompt for future runs.",
    patch: {
      body: {
        steps: [
          { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Use promoted prompt" }
        ]
      }
    }
  });
  await service.promoteWorkflowRevision(loop.id, revision.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests).toMatchObject([{ stepId: "collect", prompt: "Use launch-time prompt" }]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    formalContracts: [
      {
        id: loop.id,
        body: { steps: [{ id: "collect", prompt: "Use promoted prompt" }] }
      }
    ],
    workflowContexts: [
      {
        id: "workflow_1",
        contractSnapshot: {
          body: { steps: [{ id: "collect", prompt: "Use launch-time prompt" }] }
        },
        steps: {
          collect: { status: "suspended", sessionId: "session_1" }
        }
      }
    ]
  });
});

test("executes a visible session workflow attempt through the same attempt and suspends on pending Codex work", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates and Twitter/X signals"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates"
  });

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id
  });

  expect(run).toMatchObject({
    id: launch.run.id,
    status: "running",
    codexSession: {
      status: "requested",
      subagents: [{ role: "Run worker", status: "requested", prompt: "Run the loop workflow." }]
    }
  });
  expect(requests).toMatchObject([
    {
      runId: launch.run.id,
      stepId: "run-worker",
      title: "Run worker",
      prompt: "Run the loop workflow."
    }
  ]);
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    attempts: [{ id: launch.attempt.id, status: "running" }]
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        runId: launch.run.id,
        attemptId: launch.attempt.id,
        status: "suspended",
        cursor: { state: "waiting_for_session", stepId: "run-worker", sessionId: "session_1" },
        steps: {
          "run-worker": {
            status: "suspended",
            sessionId: "session_1"
          }
        },
        taskRuns: [
          {
            id: "task_1",
            runId: launch.run.id,
            attemptId: launch.attempt.id,
            stepId: "run-worker",
            sessionId: "session_1",
            status: "suspended"
          }
        ],
        pendingSessionIds: ["session_1"]
      }
    ]
  });

  const replay = await service.recordSessionResult(launch.run.id, {
    workflowContextId: "workflow_1",
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "run-worker",
    idempotencyKey: "session_1:final",
    status: "passed",
    summary: "Worker result passed verification",
    result: "Daily report body"
  });
  const replayDetail = await service.getRunDetail(launch.run.id);
  const runWorkerTransitions = replayDetail.events
    .map((event) => event.data?.nodeTransition)
    .filter((transition): transition is { nodeId: string; fromStatus: string; toStatus: string } =>
      Boolean(transition) && typeof transition === "object" && "nodeId" in transition
    )
    .filter((transition) => transition.nodeId === "root/task:run-worker" && transition.toStatus === "completed");
  expect(replay.status).toBe("completed");
  expect(replayDetail.verificationResults).toHaveLength(1);
  expect(replayDetail.events.filter((event) => event.kind === "verification_recorded")).toHaveLength(0);
  expect(runWorkerTransitions).toEqual([
    expect.objectContaining({
      nodeId: "root/task:run-worker",
      fromStatus: "waiting_for_session",
      toStatus: "completed"
    })
  ]);
  expect(replayDetail.workflowContexts[0]).toMatchObject({
    schedulerMode: "scheduler",
    nodeRuns: expect.arrayContaining([
      expect.objectContaining({ nodeId: "root/task:run-worker", status: "completed" })
    ])
  });
});

test("v2 worker session result cannot complete a run before validator results exist", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker says done",
    result: "candidate"
  });

  expect(run.status).not.toBe("completed");
  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.verificationResults).toHaveLength(0);
  expect(detail.workflowContexts[0].verification).toMatchObject({
    status: "waiting_for_validator",
    pendingValidatorIds: ["quality-review"],
    validatorResults: []
  });
});

test("unmarked legacy-migrated contracts keep legacy completion behavior", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  await removeVerificationInputKindMarker(service, formal.id);
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "run-worker",
    status: "passed",
    summary: "Worker says done",
    result: "legacy candidate"
  });

  expect(run.status).toBe("completed");
  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.verificationResults).toHaveLength(1);
  expect(detail.verificationResults[0]).toMatchObject({
    status: "passed",
    summary: "Worker says done"
  });
  expect(detail.verificationResults[0]).not.toHaveProperty("version");
  expect(detail.workflowContexts[0].verification).toMatchObject({
    status: "not_started",
    pendingValidatorIds: [],
    validatorResults: []
  });
});

test("recordValidatorResult finalizes v2 verification from a separate rubric agent", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const verification = await service.recordValidatorResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "validator-quality-review-1",
    result: {
      type: "rubric_agent",
      status: "passed",
      evidence: "Candidate is complete.",
      criteriaResults: [
        { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete answer." }
      ]
    }
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "completed" },
    verificationResults: [{ version: 2, status: "passed" }],
    workflowContexts: [
      {
        verification: {
          status: "completed",
          pendingValidatorIds: [],
          resultId: verification.id
        }
      }
    ]
  });
});

test("recordValidatorResult rejects workflow task session identity", async () => {
  const { bridge } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  await service.executeWorkflowAttempt(launch.run.id, launch.attempt.id);
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "session_1:draft:passed",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const workerWriteback = {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    validatorId: "quality-review",
    idempotencyKey: "validator-quality-review-worker",
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

  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "running" },
    verificationResults: []
  });

  const verification = await service.recordValidatorResult(launch.run.id, {
    ...workerWriteback,
    sessionId: "verifier-session",
    idempotencyKey: "validator-quality-review-verifier",
    result: {
      ...workerWriteback.result,
      evidence: "Independent verifier approved the candidate."
    }
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });
});

test("recordValidatorResult rejects writeback before the worker enters verification", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });

  await expect(
    service.recordValidatorResult(launch.run.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      validatorId: "quality-review",
      idempotencyKey: "validator-quality-review-early",
      result: {
        type: "rubric_agent",
        status: "passed",
        evidence: "Early validator result.",
        criteriaResults: [
          { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete answer." }
        ]
      }
    })
  ).rejects.toThrow("Workflow verification has not started");

  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "running" },
    verificationResults: []
  });
});

test("explicit v2 legacy-like rubric agent policy still requires async validator writeback", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2LegacyLikeRubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker says done",
    result: "candidate"
  });

  expect(run.status).not.toBe("completed");
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    verificationResults: [],
    workflowContexts: [
      {
        verification: {
          status: "waiting_for_validator",
          pendingValidatorIds: ["rubric-agent"]
        }
      }
    ]
  });

  const verification = await service.recordValidatorResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "rubric-agent",
    idempotencyKey: "validator-rubric-agent-1",
    result: {
      type: "rubric_agent",
      status: "passed",
      evidence: "Candidate is complete.",
      criteriaResults: [
        { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete answer." }
      ]
    }
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "completed" },
    verificationResults: [{ version: 2, status: "passed" }]
  });
});

test("recordValidatorResult is idempotent by idempotencyKey", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });
  const input = {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "validator-quality-review-1",
    result: {
      type: "rubric_agent" as const,
      status: "passed" as const,
      evidence: "Candidate is complete.",
      criteriaResults: [
        { criterionId: "quality", status: "passed" as const, score: 1, maxScore: 1, evidence: "Complete answer." }
      ]
    }
  };

  const first = await service.recordValidatorResult(launch.run.id, input);
  const replay = await service.recordValidatorResult(launch.run.id, input);

  expect(replay.id).toBe(first.id);
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    verificationResults: [{ id: first.id, version: 2, status: "passed" }]
  });
  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.verificationResults).toHaveLength(1);
});

test("failed v2 validator result repairs with validator and criterion ids in the reason", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    ...v2RubricAgentLoopInput(),
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" as const }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  await service.recordValidatorResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "validator-quality-review-failed",
    result: {
      type: "rubric_agent",
      status: "failed",
      evidence: "Candidate is incomplete.",
      criteriaResults: [
        { criterionId: "quality", status: "failed", score: 0, maxScore: 1, evidence: "Missing required content." }
      ]
    }
  });

  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.run.status).toBe("repairing");
  expect(detail.verificationResults).toMatchObject([{ version: 2, status: "failed" }]);
  expect(detail.workflowContexts[0]).toMatchObject({
    status: "repairing",
    cursor: { state: "repairing" },
    vars: {
      repairReason: expect.stringContaining("quality-review")
    }
  });
  expect(detail.workflowContexts[0].vars.repairReason).toContain("quality");
});

test("records a targeted session result against the specified workflow context, attempt, and pending task", async () => {
  const { bridge } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const unrelatedAttempt = await service.startAttempt(launch.run.id, { summary: "Manual follow-up" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: "workflow_1",
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "run-worker",
    idempotencyKey: "session_1:final",
    status: "passed",
    summary: "Worker result passed verification",
    result: "Daily report body"
  });

  expect(run.status).toBe("completed");
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    attempts: [
      { id: launch.attempt.id, status: "completed", summary: "No verifier configured; workflow completed." },
      { id: unrelatedAttempt.id, status: "running", summary: "Manual follow-up" }
    ],
    verificationResults: [{ attemptId: launch.attempt.id, status: "passed" }]
  });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        status: "completed",
        cursor: { state: "completed" },
        pendingSessionIds: [],
        idempotencyKeys: ["session_1:final"],
        taskRuns: [
          {
            id: "task_1",
            sessionId: "session_1",
            status: "completed",
            result: "Daily report body"
          }
        ]
      }
    ]
  });
});

test("uses the workflow context attempt when precise writeback omits attemptId", async () => {
  const { bridge } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const laterAttempt = await service.startAttempt(launch.run.id, { summary: "Later manual attempt" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: "workflow_1",
    sessionId: "session_1",
    stepId: "run-worker",
    idempotencyKey: "session_1:context-only",
    status: "passed",
    summary: "Worker result passed verification",
    result: "Daily report body"
  });

  expect(run.status).toBe("completed");
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    attempts: [
      { id: launch.attempt.id, status: "completed", summary: "No verifier configured; workflow completed." },
      { id: laterAttempt.id, status: "running", summary: "Later manual attempt" }
    ],
    verificationResults: [{ attemptId: launch.attempt.id, status: "passed" }]
  });
});

test("dual-writes node runs when a workflow task suspends and resumes", async () => {
  const { service } = await createPendingServiceWithSequentialIds();
  const launch = await startTwoStepPendingWorkflow(service);

  let context = (await service.getRunDetail(launch.run.id)).workflowContexts[0];
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:collect")).toMatchObject({
    status: "waiting_for_session",
    taskRunId: "task_1",
    sessionId: "session_1"
  });

  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    workflowContextId: context.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collect done",
    result: "COLLECTED"
  });

  context = (await service.getRunDetail(launch.run.id)).workflowContexts[0];
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:collect")).toMatchObject({
    status: "completed",
    output: "COLLECTED",
    idempotencyKeys: ["collect:done"]
  });
  expect(context.nodeRuns?.find((node) => node.nodeId === "root/task:review")).toMatchObject({
    status: "waiting_for_session",
    sessionId: "session_2"
  });
});

test("duplicate workflow task writeback does not duplicate node-run completion", async () => {
  const { service } = await createPendingServiceWithSequentialIds();
  const launch = await startTwoStepPendingWorkflow(service);

  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collected notes.",
    result: "COLLECTED"
  });
  const afterFirst = await service.getRunDetail(launch.run.id);
  const firstContext = afterFirst.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);
  const firstCollectRun = firstContext?.nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:collect");

  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:done",
    status: "passed",
    summary: "Collected notes replay.",
    result: "COLLECTED"
  });
  const afterSecond = await service.getRunDetail(launch.run.id);
  const secondContext = afterSecond.workflowContexts.find((context) => context.id === launch.launchRequest.workflowContextId);
  const secondCollectRun = secondContext?.nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:collect");
  const collectCompletionAudits = afterSecond.events
    .map((event) => event.data?.nodeTransition)
    .filter((transition): transition is { nodeId: string; fromStatus: string; toStatus: string } =>
      Boolean(transition) && typeof transition === "object" && "nodeId" in transition
    )
    .filter((transition) => transition.nodeId === "root/task:collect" && transition.toStatus === "completed");

  expect(secondCollectRun?.idempotencyKeys.filter((key) => key === "collect:done")).toHaveLength(1);
  expect(secondCollectRun?.completedAt).toBe(firstCollectRun?.completedAt);
  expect(collectCompletionAudits).toEqual([
    expect.objectContaining({
      nodeId: "root/task:collect",
      fromStatus: "waiting_for_session",
      toStatus: "completed"
    })
  ]);
});

test("scheduler resumes a sequential workflow without replaying completed nodes", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Scheduler sequential",
    goal: "Resume from node runs",
    body: {
      steps: [
        { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review" }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run scheduler sequential" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "draft:done",
    status: "passed",
    summary: "Draft done",
    result: "DRAFT"
  });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["draft", "review"]);
  const detail = await service.getRunDetail(launch.run.id);
  const agentDoneEvents = detail.events
    .map((event) => event.data?.engineEvent)
    .filter((event: any) => event?.type === "agent_done" && event.stepId === "draft");
  expect(agentDoneEvents).toHaveLength(0);
  expect(detail.workflowContexts[0].nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:draft")).toMatchObject({
    status: "completed",
    output: "DRAFT"
  });
  expect(detail.workflowContexts[0].nodeRuns?.find((nodeRun) => nodeRun.nodeId === "root/task:review")).toMatchObject({
    status: "waiting_for_session",
    sessionId: "session_2"
  });
});

test("rejects session result writeback when workflowContextId and attemptId disagree", async () => {
  const { bridge } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const laterAttempt = await service.startAttempt(launch.run.id, { summary: "Later manual attempt" });

  await expect(
    service.recordSessionResult(launch.run.id, {
      workflowContextId: "workflow_1",
      attemptId: laterAttempt.id,
      sessionId: "session_1",
      stepId: "run-worker",
      idempotencyKey: "session_1:wrong-attempt",
      status: "passed",
      summary: "Worker result passed verification",
      result: "Daily report body"
    })
  ).rejects.toThrow(/Workflow context does not belong to attempt/);
});

test("resumes the workflow after a targeted Codex task result without relaunching completed steps", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Two step Codex workflow",
    goal: "Collect and synthesize updates",
    body: {
      steps: [
        {
          id: "collect",
          kind: "task",
          runtime: "codex",
          label: "Collect updates",
          prompt: "Collect official updates.",
          subagent: {
            ref: "researcher",
            role: "code-researcher",
            tools: ["rg"],
            permissions: { filesystem: "workspace-write", network: "enabled" }
          }
        },
        {
          id: "synthesize",
          kind: "task",
          runtime: "codex",
          label: "Synthesize report",
          prompt: "Turn collected updates into a report."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run two-step workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["collect"]);
  expect(requests[0].subagent).toMatchObject({
    ref: "researcher",
    role: "code-researcher",
    tools: ["rg"],
    permissions: { filesystem: "workspace-write", network: "enabled" }
  });

  const afterCollect = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:final",
    status: "passed",
    summary: "Collected source notes.",
    result: "Collected notes"
  });

  expect(afterCollect.status).toBe("running");
  expect(requests.map((request) => request.stepId)).toEqual(["collect", "synthesize"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        status: "suspended",
        pendingSessionIds: ["session_2"],
        steps: {
          collect: {
            status: "completed",
            output: "Collected notes",
            sessionId: "session_1"
          },
          synthesize: {
            status: "suspended",
            sessionId: "session_2"
          }
        },
        taskRuns: [
          {
            id: "task_1",
            stepId: "collect",
            sessionId: "session_1",
            status: "completed",
            result: "Collected notes",
            subagent: {
              ref: "researcher",
              role: "code-researcher",
              tools: ["rg"],
              permissions: { filesystem: "workspace-write", network: "enabled" }
            }
          },
          {
            id: "task_2",
            stepId: "synthesize",
            sessionId: "session_2",
            status: "suspended"
          }
        ],
        idempotencyKeys: ["collect:final"]
      }
    ]
  });

  const completed = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_2",
    stepId: "synthesize",
    idempotencyKey: "synthesize:final",
    status: "passed",
    summary: "Report passed.",
    result: "Final report"
  });

  expect(completed.status).toBe("completed");
  expect(requests.map((request) => request.stepId)).toEqual(["collect", "synthesize"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        status: "completed",
        cursor: { state: "completed" },
        pendingSessionIds: [],
        steps: {
          collect: { status: "completed", output: "Collected notes" },
          synthesize: { status: "completed", output: "Final report" }
        },
        idempotencyKeys: ["collect:final", "synthesize:final"]
      }
    ],
    runs: [{ id: launch.run.id, status: "completed" }],
    attempts: [{ id: launch.attempt.id, status: "completed", summary: "No verifier configured; workflow completed." }]
  });
});

test("does not reopen a completed workflow context when executed again", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Completed workflow guard",
    goal: "Keep completed workflow state immutable on replay",
    body: {
      steps: [{ id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect notes." }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run once" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:final",
    status: "passed",
    summary: "Collected notes passed.",
    result: "Collected notes"
  });
  const beforeReplay = await service.getSnapshot();

  const replayed = await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(replayed.status).toBe("completed");
  expect(requests.map((request) => request.stepId)).toEqual(["collect"]);
  const afterReplay = await service.getSnapshot();
  expect(afterReplay.workflowContexts).toEqual(beforeReplay.workflowContexts);
  expect(afterReplay.events).toEqual(beforeReplay.events);
  expect(afterReplay.verificationResults).toEqual(beforeReplay.verificationResults);
});

test("resumes a suspended workflow from persisted state after the service restarts", async () => {
  const initialBridge = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const createSequentialId = (prefix: IdPrefix) => {
    const next = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, next);
    return `${prefix}_${next}`;
  };
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: createSequentialId,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: initialBridge.bridge
  });
  const loop = await service.createLoopContract({
    title: "Restartable Codex workflow",
    goal: "Continue workflow from local state after restart",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect updates", prompt: "Collect updates." },
        { id: "synthesize", kind: "task", runtime: "codex", label: "Synthesize report", prompt: "Write report." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run restartable workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(initialBridge.requests.map((request) => request.stepId)).toEqual(["collect"]);

  const resumedBridge = createPendingSessionBridge(1);
  const resumedService = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: createSequentialId,
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: resumedBridge.bridge
  });

  const resumedRun = await resumedService.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:after-restart",
    status: "passed",
    summary: "Collected notes after restart.",
    result: "Collected notes"
  });

  expect(resumedRun.status).toBe("running");
  expect(initialBridge.requests.map((request) => request.stepId)).toEqual(["collect"]);
  expect(resumedBridge.requests.map((request) => request.stepId)).toEqual(["synthesize"]);
  await expect(resumedService.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        status: "suspended",
        pendingSessionIds: ["session_2"],
        steps: {
          collect: { status: "completed", output: "Collected notes", sessionId: "session_1" },
          synthesize: { status: "suspended", sessionId: "session_2" }
        },
        taskRuns: [
          { id: "task_1", stepId: "collect", sessionId: "session_1", status: "completed" },
          { id: "task_2", stepId: "synthesize", sessionId: "session_2", status: "suspended" }
        ],
        idempotencyKeys: ["collect:after-restart"]
      }
    ]
  });
});

test("continues a suspended workflow against its launch snapshot after a revision is promoted", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Suspended snapshot workflow",
    goal: "Continue the suspended workflow version",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect using original prompt." },
        { id: "synthesize", kind: "task", runtime: "codex", label: "Synthesize", prompt: "Synthesize original result." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run suspended snapshot workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const revision = await service.proposeWorkflowRevision(loop.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    rationale: "Future runs should use a different second step.",
    patch: {
      body: {
        steps: [
          { id: "collect", kind: "task", runtime: "codex", label: "Collect", prompt: "Collect using promoted prompt." },
          { id: "write", kind: "task", runtime: "codex", label: "Write", prompt: "Write the promoted workflow result." }
        ]
      }
    }
  });
  await service.promoteWorkflowRevision(loop.id, revision.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id
  });

  const resumed = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:promoted-after-suspend",
    status: "passed",
    summary: "Collected original notes.",
    result: "Original notes"
  });

  expect(resumed.status).toBe("running");
  expect(requests.map((request) => [request.stepId, request.prompt])).toEqual([
    ["collect", "Collect using original prompt."],
    ["synthesize", "Synthesize original result."]
  ]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    formalContracts: [
      {
        id: loop.id,
        body: { steps: [{ id: "collect", prompt: "Collect using promoted prompt." }, { id: "write" }] }
      }
    ],
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        contractSnapshot: {
          body: { steps: [{ id: "collect", prompt: "Collect using original prompt." }, { id: "synthesize" }] }
        },
        pendingSessionIds: ["session_2"],
        steps: {
          collect: { status: "completed", output: "Original notes" },
          synthesize: { status: "suspended", sessionId: "session_2" }
        }
      }
    ]
  });
});

test("waits for all skewed parallel Codex sessions to suspend before returning", async () => {
  const { bridge, requests } = createSkewedPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Skewed parallel workflow",
    goal: "Start both branches before returning control",
    body: {
      steps: [
        {
          id: "parallel-collect",
          kind: "parallel",
          label: "Parallel collect",
          children: [
            { id: "left", kind: "task", runtime: "codex", label: "Left branch", prompt: "Collect left branch." },
            { id: "right", kind: "task", runtime: "codex", label: "Right branch", prompt: "Collect right branch." }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Both branches complete", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run skewed parallel workflow" });

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        status: "suspended",
        pendingSessionIds: ["session_1", "session_2"],
        taskRuns: [
          { id: "task_1", stepId: "left", sessionId: "session_1", status: "suspended" },
          { id: "task_2", stepId: "right", sessionId: "session_2", status: "suspended" }
        ]
      }
    ]
  });
});

test("waits for existing parallel Codex task sessions before resuming fan-in", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Parallel Codex workflow",
    goal: "Collect two branches and merge",
    body: {
      steps: [
        {
          id: "parallel-collect",
          kind: "parallel",
          label: "Parallel collect",
          children: [
            {
              id: "left",
              kind: "task",
              runtime: "codex",
              label: "Left branch",
              prompt: "Collect left branch."
            },
            {
              id: "right",
              kind: "task",
              runtime: "codex",
              label: "Right branch",
              prompt: "Collect right branch."
            }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Both branches complete", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run parallel workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await expect(
    service.recordSessionResult(launch.run.id, {
      attemptId: launch.attempt.id,
      idempotencyKey: "ambiguous:final",
      status: "passed",
      summary: "Ambiguous branch complete.",
      result: "Ambiguous result"
    })
  ).rejects.toThrow(/Multiple workflow task runs are pending/);

  const afterLeft = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "left",
    idempotencyKey: "left:final",
    status: "passed",
    summary: "Left branch complete.",
    result: "Left result"
  });

  expect(afterLeft.status).toBe("running");
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    verificationResults: [],
    workflowContexts: [
      {
        id: "workflow_1",
        status: "running",
        pendingSessionIds: ["session_2"],
        steps: {
          left: { status: "completed", output: "Left result" },
          right: { status: "suspended", sessionId: "session_2" }
        }
      }
    ]
  });

  const completed = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_2",
    stepId: "right",
    idempotencyKey: "right:final",
    status: "passed",
    summary: "Both branches complete.",
    result: "Right result"
  });

  expect(completed.status).toBe("completed");
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        status: "completed",
        pendingSessionIds: [],
        steps: {
          left: { status: "completed", output: "Left result" },
          right: { status: "completed", output: "Right result" }
        }
      }
    ],
    runs: [{ id: launch.run.id, status: "completed" }],
    attempts: [{ id: launch.attempt.id, status: "completed", summary: "No verifier configured; workflow completed." }]
  });
  const detail = await service.getRunDetail(launch.run.id);
  const engineEventTypes = detail.events
    .map((event) => event.data?.engineEvent)
    .filter((event): event is { type: string } => Boolean(event) && typeof event === "object" && "type" in event)
    .map((event) => event.type);
  const taskCompletionAudits = detail.events
    .map((event) => event.data?.nodeTransition)
    .filter((transition): transition is { nodeId: string; fromStatus: string; toStatus: string } =>
      Boolean(transition) && typeof transition === "object" && "nodeId" in transition
    )
    .filter((transition) => transition.toStatus === "completed");
  expect(engineEventTypes.filter((type) => type === "agent_done")).toHaveLength(0);
  expect(engineEventTypes).toContain("parallel_completed");
  expect(taskCompletionAudits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        nodeId: "root/parallel:parallel-collect/task:left",
        fromStatus: "waiting_for_session",
        toStatus: "completed"
      }),
      expect.objectContaining({
        nodeId: "root/parallel:parallel-collect/task:right",
        fromStatus: "waiting_for_session",
        toStatus: "completed"
      })
    ])
  );
});

test("rejects conflicting workflow task result locators without mutating context", async () => {
  const { service } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Parallel locator workflow",
    goal: "Reject conflicting task writeback locators",
    body: {
      steps: [
        {
          id: "parallel-collect",
          kind: "parallel",
          label: "Parallel collect",
          children: [
            { id: "left", kind: "task", runtime: "codex", label: "Left branch", prompt: "Collect left branch." },
            { id: "right", kind: "task", runtime: "codex", label: "Right branch", prompt: "Collect right branch." }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Both branches complete", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run parallel workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const beforeContexts = (await service.getSnapshot()).workflowContexts;

  await expect(
    service.recordSessionResult(launch.run.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      sessionId: "session_1",
      stepId: "right",
      idempotencyKey: "conflict:session-step",
      status: "passed",
      summary: "Conflicting branch complete.",
      result: "Conflicting result"
    })
  ).rejects.toThrow(/locator fields disagree/);
  await expect(
    service.recordSessionResult(launch.run.id, {
      workflowContextId: launch.launchRequest.workflowContextId,
      attemptId: launch.attempt.id,
      taskRunId: "task_1",
      sessionId: "session_2",
      idempotencyKey: "conflict:task-session",
      status: "passed",
      summary: "Conflicting branch complete.",
      result: "Conflicting result"
    })
  ).rejects.toThrow(/locator fields disagree/);

  expect((await service.getSnapshot()).workflowContexts).toEqual(beforeContexts);
});

test("continues from completed parallel children into the fan-in task exactly once", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Parallel fan-in workflow",
    goal: "Collect two branches and synthesize them",
    body: {
      steps: [
        {
          id: "parallel-collect",
          kind: "parallel",
          label: "Parallel collect",
          children: [
            { id: "left", kind: "task", runtime: "codex", label: "Left branch", prompt: "Collect left branch." },
            { id: "right", kind: "task", runtime: "codex", label: "Right branch", prompt: "Collect right branch." }
          ]
        },
        {
          id: "join",
          kind: "task",
          runtime: "codex",
          label: "Join branches",
          prompt: "Synthesize left and right branch results."
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Joined result is complete", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run fan-in workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "left",
    idempotencyKey: "left:final",
    status: "passed",
    summary: "Left branch complete.",
    result: "Left result"
  });
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right"]);

  const afterRight = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_2",
    stepId: "right",
    idempotencyKey: "right:final",
    status: "passed",
    summary: "Right branch complete.",
    result: "Right result"
  });

  expect(afterRight.status).toBe("running");
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right", "join"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    workflowContexts: [
      {
        id: "workflow_1",
        status: "suspended",
        pendingSessionIds: ["session_3"],
        steps: {
          left: { status: "completed", output: "Left result" },
          right: { status: "completed", output: "Right result" },
          join: { status: "suspended", sessionId: "session_3" }
        },
        taskRuns: [
          { id: "task_1", stepId: "left", status: "completed" },
          { id: "task_2", stepId: "right", status: "completed" },
          { id: "task_3", stepId: "join", status: "suspended" }
        ]
      }
    ]
  });

  const completed = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    taskRunId: "task_3",
    idempotencyKey: "join:final",
    status: "passed",
    summary: "Joined result passed.",
    result: "Joined result"
  });

  expect(completed.status).toBe("completed");
  expect(requests.map((request) => request.stepId)).toEqual(["left", "right", "join"]);
});

test("updates the original workflow subagent when writeback only provides taskRunId", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Task id writeback workflow",
    goal: "Resume from a taskRunId-only result",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect updates", prompt: "Collect official updates." },
        { id: "synthesize", kind: "task", runtime: "codex", label: "Synthesize report", prompt: "Write a report." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run task id workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const afterCollect = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    taskRunId: "task_1",
    idempotencyKey: "task_1:final",
    status: "passed",
    summary: "Collected updates.",
    result: "Collected notes"
  });

  expect(requests.map((request) => request.stepId)).toEqual(["collect", "synthesize"]);
  expect(afterCollect.codexSession?.subagents).toEqual([
    expect.objectContaining({
      role: "Collect updates",
      stepId: "collect",
      sessionId: "session_1",
      status: "completed"
    }),
    expect.objectContaining({
      role: "Synthesize report",
      stepId: "synthesize",
      sessionId: "session_2",
      status: "requested"
    })
  ]);
  expect(afterCollect.codexSession?.subagents?.some((subagent) => subagent.role === "loop-runner")).toBe(false);
});

test("keeps needs_human workflow task results suspended instead of completed-cacheable", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Human decision workflow",
    goal: "Pause when a worker needs human input",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect updates", prompt: "Collect official updates." },
        { id: "synthesize", kind: "task", runtime: "codex", label: "Synthesize report", prompt: "Write a report." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run human decision workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  const waiting = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:needs-human",
    status: "needs_human",
    summary: "Need user to choose source scope.",
    result: "Waiting on scope decision.",
    humanQuestion: "Which sources should the worker include?"
  });

  expect(waiting.status).toBe("waiting_for_human");
  const snapshot = await service.getSnapshot();
  expect(snapshot).toMatchObject({
    attempts: [{ id: launch.attempt.id, status: "running" }],
    workflowContexts: [
      {
        id: "workflow_1",
        status: "suspended",
        cursor: { state: "waiting_for_human", stepId: "collect", sessionId: "session_1" },
        pendingSessionIds: [],
        steps: {
          collect: { status: "suspended", sessionId: "session_1" }
        },
        taskRuns: [
          {
            id: "task_1",
            stepId: "collect",
            sessionId: "session_1",
            status: "suspended"
          }
        ],
        idempotencyKeys: ["collect:needs-human"]
      }
    ],
    humanRequests: [{ question: "Which sources should the worker include?", status: "open" }]
  });
  expect(snapshot.attempts[0]).not.toHaveProperty("completedAt");
  expect(snapshot.workflowContexts[0].steps.collect).not.toHaveProperty("output");
  expect(snapshot.workflowContexts[0].taskRuns[0]).not.toHaveProperty("result");

  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  expect(requests.map((request) => request.stepId)).toEqual(["collect"]);
});

test("resolves a human request by writing the answer back to the suspended workflow task", async () => {
  const { service, requests } = await createPendingServiceWithSequentialIds();
  const loop = await service.createLoopContract({
    title: "Human resume workflow",
    goal: "Resume after a user decision",
    body: {
      steps: [
        { id: "collect", kind: "task", runtime: "codex", label: "Collect updates", prompt: "Collect official updates." },
        { id: "synthesize", kind: "task", runtime: "codex", label: "Synthesize report", prompt: "Write a report." }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run human resume workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "collect",
    idempotencyKey: "collect:needs-human",
    status: "needs_human",
    summary: "Need source scope.",
    humanQuestion: "Which sources should the worker include?"
  });

  const resolved = await service.resolveHumanRequest("human_1", {
    response: "Use official sources only.",
    summary: "User selected official sources."
  });

  expect(resolved).toMatchObject({
    id: "human_1",
    status: "resolved",
    response: "Use official sources only.",
    workflowContextId: launch.launchRequest.workflowContextId,
    taskRunId: "task_1",
    sessionId: "session_1",
    stepId: "collect"
  });
  expect(requests.map((request) => request.stepId)).toEqual(["collect", "synthesize"]);
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: launch.run.id, status: "running" }],
    attempts: [{ id: launch.attempt.id, status: "running" }],
    humanRequests: [{ id: "human_1", status: "resolved", response: "Use official sources only." }],
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        status: "suspended",
        pendingSessionIds: ["session_2"],
        steps: {
          collect: { status: "completed", output: "Use official sources only.", sessionId: "session_1" },
          synthesize: { status: "suspended", sessionId: "session_2" }
        },
        taskRuns: [
          { id: "task_1", stepId: "collect", sessionId: "session_1", status: "completed" },
          { id: "task_2", stepId: "synthesize", sessionId: "session_2", status: "suspended" }
        ],
        idempotencyKeys: ["collect:needs-human", "human:human_1"]
      }
    ]
  });
});

test("accepts codex task nodes as the V2 spelling for legacy agent steps", async () => {
  const service = await createService();

  const formal = await service.createLoopContract({
    title: "Codex task workflow",
    goal: "Run one codex task",
    body: {
      steps: [
        {
          id: "scan",
          kind: "task",
          runtime: "codex",
          label: "Scan updates",
          prompt: "Scan official updates"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Task finishes", severity: "must" }]
    }
  });

  expect(formal.body.steps[0]).toMatchObject({
    id: "scan",
    kind: "task",
    runtime: "codex",
    prompt: "Scan official updates"
  });

  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run task workflow" });
  expect(launch.launchRequest.workflowPlan?.steps).toEqual([
    {
      id: "scan",
      kind: "task",
      runtime: "codex",
      label: "Scan updates",
      prompt: "Scan official updates",
      depth: 0
    }
  ]);
});

test("compiles Codex session prompt from formal workflow contract when available", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "AI Dev Tools Workflow Runtime",
    goal: "Monitor AI dev tool updates through the DittosLoop runtime",
    body: {
      steps: [
        {
          id: "research",
          kind: "phase",
          label: "Research updates",
          children: [
            {
              id: "collect",
              kind: "agent",
              label: "Collect official updates",
              prompt: "Collect Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates.",
              sessionPolicy: "new"
            }
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "official-source",
          label: "Official source",
          requirement: "Every notable update cites an official source or explicitly says none was found",
          severity: "must"
        }
      ]
    },
    repairPolicy: { maxAttempts: 3, strategy: "repair_then_retry" }
  });

  const launch = await service.startCodexSessionRun(formal.id, {
    goal: "Run the monitor using the local workflow runtime"
  });

  expect(launch.prompt).toContain(`Contract id: ${formal.id}`);
  expect(launch.prompt).toContain("runId: run_1");
  expect(launch.prompt).toContain("attemptId: attempt_1");
  expect(launch.prompt).toContain("workflowContextId: workflow_1");
  expect(launch.prompt).toContain("execute_workflow_attempt");
  expect(launch.prompt).toContain("record_session_result");
  expect(launch.prompt).toContain("propose_workflow_revision");
  expect(launch.prompt).toContain("使用本地 DittosLoop workflow runtime 执行这个 contract");
  expect(launch.prompt).toContain("不要覆盖当前 active workflow contract");
  expect(launch.prompt).toContain("不要把 run/attempt/verification id、调试说明或 cite turn 残留写进正文");
  expect(launch.prompt).toContain("Collect official updates");
  expect(launch.prompt).toContain("Every notable update cites an official source");
  expect(launch.launchRequest).toMatchObject({
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: formal.id,
    workflowPlan: {
      runtime: "dittosloop-local-workflow",
      contractId: formal.id,
      goal: formal.goal,
      steps: [
        {
          id: "research",
          kind: "phase",
          label: "Research updates",
          depth: 0
        },
        {
          id: "collect",
          kind: "agent",
          label: "Collect official updates",
          prompt: "Collect Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates.",
          phaseId: "research",
          sessionPolicy: "new",
          depth: 1
        }
      ],
      verification: {
        mode: "after_workflow",
        rubrics: [
          {
            id: "official-source",
            label: "Official source",
            requirement: "Every notable update cites an official source or explicitly says none was found",
            severity: "must"
          }
        ]
      },
      repairPolicy: { maxAttempts: 3, strategy: "repair_then_retry" }
    }
  });
  expect(launch.run.codexSession?.subagents?.[0]).toMatchObject({
    role: "Collect official updates",
    status: "requested",
    prompt: "Collect Claude Code, OpenClaw, Hermes, Codex, and Twitter/X updates."
  });
});

test("injects a bounded loop memory excerpt into Codex session prompts", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await createFormalLoop(service);
  const first = await service.startCodexSessionRun(formal.id, { goal: "Seed memory" });

  for (let index = 1; index <= 82; index += 1) {
    await service.commitMemory(formal.id, { runId: first.run.id, summary: `Memory ${index}` });
  }

  await service.completeRun(first.run.id, { status: "completed" });

  const second = await service.startCodexSessionRun(formal.id, { goal: "Use memory" });
  const memorySection = second.prompt
    .split("Loop memory / 长期记忆：\n")[1]
    ?.split("\n\nMemory discipline / 记忆写入纪律：")[0]
    ?.split("\n") ?? [];

  expect(second.prompt).toContain("Loop memory / 长期记忆");
  expect(second.prompt).toContain("Memory 82");
  expect(second.prompt).toContain("Memory 3");
  expect(memorySection).not.toContain("Memory 2");
  expect(memorySection).not.toContain("Memory 1");
  expect(second.prompt).toContain(
    '还有 2 条记忆未读取。可调用 read_loop_memory({ loopId: "loop_1", offset: 80, limit: 80 }) 继续读取。'
  );
  expect(second.prompt).toContain("顶层 Codex session 在 verifier 结果可见后决定是否调用 commit_memory");
  expect(second.prompt).toContain("workflow task 如发现可复用观察，应通过 task result 回传");
});

test("records a real Codex thread without completing the session run", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI Dev Tools Update Monitor",
    goal: "Watch release updates and Twitter/X signals"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Check today updates"
  });

  const updated = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475"
  });

  expect(updated.codexSession).toMatchObject({
    status: "started",
    threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef4c5-4a52-7653-a862-6f1372f88475",
    subagents: [
      {
        role: "Run worker",
        status: "running",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    ]
  });
  expect(updated).toMatchObject({
    status: "running"
  });
  expect(updated.completedAt).toBeUndefined();
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: {
      status: "running",
      codexSession: {
        status: "started",
        threadId: "019ef4c5-4a52-7653-a862-6f1372f88475"
      }
    },
    attempts: [
      {
        status: "running",
        summary: "Request a new Codex session for AI Dev Tools Update Monitor"
      }
    ],
    events: [
      { kind: "run_created" },
      { kind: "attempt_started" },
      {
        kind: "note",
        message: "Codex thread created and attached to this run",
        data: {
          codexThread: {
            threadId: "019ef4c5-4a52-7653-a862-6f1372f88475",
            threadTitle: "DittosLoop: AI Dev Tools Update Monitor"
          }
        }
      }
    ]
  });

  const corrected = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
    threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
    threadUrl: "codex://thread/019ef7a0-bc04-72f1-8454-607c376eaaea"
  });

  expect(corrected.codexSession).toMatchObject({
    threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
    subagents: [
      {
        status: "running",
        threadId: "019ef7a0-bc04-72f1-8454-607c376eaaea",
        threadTitle: "DittosLoop: AI Dev Tools Update Monitor",
        threadUrl: "codex://thread/019ef7a0-bc04-72f1-8454-607c376eaaea"
      }
    ]
  });
});

test("recording a session result closes its subagent status", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "Chinese Daily Report",
    goal: "Write a daily report"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Start worker session"
  });
  const started = await service.recordCodexThread(launch.run.id, {
    threadId: "019ef7b4-7a0d-74f2-b1a9-10502784e636",
    threadTitle: "DittosLoop: AI 开发工具更新日报"
  });

  expect(started).toMatchObject({
    status: "running",
    codexSession: {
      subagents: [
        {
          role: "Run worker",
          status: "running",
          threadId: "019ef7b4-7a0d-74f2-b1a9-10502784e636"
        }
      ]
    }
  });

  const completed = await service.recordSessionResult(launch.run.id, {
    status: "passed",
    summary: "日报已完成并通过验证。"
  });

  const detail = await service.getRunDetail(launch.run.id);
  expect(completed).toMatchObject({
    status: "completed",
    completedAt: fixedTime
  });
  expect(detail.run).toMatchObject({
    status: "completed",
    codexSession: {
      status: "completed",
      subagents: [
        {
          role: "Run worker",
          status: "completed",
          threadId: "019ef7b4-7a0d-74f2-b1a9-10502784e636"
        }
      ]
    }
  });
});

test("records a Codex session result and completes the session-backed run", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service, {
    title: "AI 开发工具更新日报",
    goal: "生成中文日报"
  });
  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "生成今天的中文日报"
  });
  await service.recordCodexThread(launch.run.id, {
    threadId: "019ef8f0-7f39-775a-ad9c-63ad6bfe1832",
    threadTitle: "DittosLoop: AI 开发工具更新日报"
  });

  const updated = await service.recordSessionResult(launch.run.id, {
    status: "passed",
    summary: "中文日报已生成并通过校验。",
    result: "## AI 开发工具更新日报\n\n今日摘要...",
    checks: [
      {
        name: "中文日报",
        status: "passed",
        output: "包含摘要、重点更新、风险和来源。"
      }
    ]
  });

  expect(updated).toMatchObject({
    status: "completed",
    completedAt: fixedTime,
    codexSession: {
      status: "completed",
      subagents: [
        {
          role: "Run worker",
          status: "completed",
          threadId: "019ef8f0-7f39-775a-ad9c-63ad6bfe1832"
        }
      ]
    }
  });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    attempts: [
      {
        status: "completed",
        completedAt: fixedTime,
        summary: "中文日报已生成并通过校验。"
      }
    ],
    verificationResults: [
      {
        status: "passed",
        summary: "中文日报已生成并通过校验。",
        checks: [
          {
            name: "中文日报",
            status: "passed",
            output: "包含摘要、重点更新、风险和来源。"
          }
        ]
      }
    ],
    events: [
      { kind: "run_created" },
      { kind: "attempt_started" },
      { kind: "note", message: "Codex thread created and attached to this run" },
      {
        kind: "verification_recorded",
        message: "中文日报已生成并通过校验。",
        data: {
          sessionResult: {
            result: "## AI 开发工具更新日报\n\n今日摘要..."
          }
        }
      },
      { kind: "attempt_completed", message: "中文日报已生成并通过校验。" },
      { kind: "run_completed", message: "Codex session result passed" }
    ]
  });
});

test("opens a Codex session backed run without creating a new run", async () => {
  const service = await createService();
  const formal = await service.createLoopContract({
    title: "AI 开发工具更新日报",
    goal: "生成中文 AI 开发工具日报",
    body: {
      steps: [
        {
          id: "write-report",
          kind: "agent",
          label: "撰写日报",
          prompt: "整理 OpenClaw、Claude Code、Codex、Hermes 的中文日报。"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [
        {
          id: "zh-report",
          label: "中文日报",
          requirement: "输出中文日报并包含来源、风险和建议动作。",
          severity: "must"
        }
      ]
    },
    projectBinding: {
      codexProjectId: "project-dittos-loop",
      projectLabel: "dittos loop",
      projectPath: "/Users/edisonzhong/Documents/dittos loop"
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, {
    goal: "生成今天的中文日报"
  });
  await service.recordCodexThread(launch.run.id, {
    threadId: "019ef91e-0f19-74d5-b14c-bac2f257d269",
    threadTitle: "DittosLoop: AI 开发工具更新日报",
    threadUrl: "codex://thread/019ef91e-0f19-74d5-b14c-bac2f257d269"
  });

  const opened = await service.openCodexSession(launch.run.id);
  expect(opened).toEqual({
    runId: launch.run.id,
    status: "ready",
    message: "Codex session is ready to open.",
    threadId: "019ef91e-0f19-74d5-b14c-bac2f257d269",
    threadTitle: "DittosLoop: AI 开发工具更新日报",
    threadUrl: "codex://thread/019ef91e-0f19-74d5-b14c-bac2f257d269"
  });
  expect((service as any).resumeLoopRun).toBeUndefined();
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [
      {
        id: launch.run.id,
        status: "running"
      }
    ]
  });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    attempts: [
      {
        status: "running",
        summary: "Request a new Codex session for AI 开发工具更新日报"
      }
    ],
    events: [
      { kind: "run_created" },
      { kind: "attempt_started" },
      { kind: "note", message: "Codex thread created and attached to this run" },
      { kind: "note", message: "Codex session open requested" }
    ]
  });
});

test("records a default subagent when older session runs have none", async () => {
  const service = await createService();
  const loop = await seedLegacyLoop(service, {
    title: "Legacy Monitor",
    intent: "Watch updates"
  });
  const run = await seedLegacyRun(service, loop, { goal: "Check today updates" });
  await service.appendEvent(run.id, { message: "legacy setup" });
  await (service as any).options.store.updateState((state) => ({
    ...state,
    runs: state.runs.map((candidate) =>
      candidate.id === run.id
        ? {
            ...candidate,
            codexSession: {
              mode: "new_session",
              status: "requested",
              prompt: "legacy prompt"
            }
          }
        : candidate
    )
  }));

  const updated = await service.recordCodexThread(run.id, {
    threadId: "019ef4e5-21f0-7131-be8c-708f720e49de"
  });

  expect(updated.codexSession?.subagents).toEqual([
    {
      role: "loop-runner",
      status: "running",
      threadId: "019ef4e5-21f0-7131-be8c-708f720e49de",
      threadTitle: undefined,
      threadUrl: undefined
    }
  ]);
});

test("agent profile preflight allows starting when required skills are available", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => ({
    status: "passed",
    message: `${requirement.id} is installed`,
    locations: ["/mock/.codex/skills/research-pack/SKILL.md"]
  }));
  const loop = await service.createLoopContract({
    title: "Profile preflight available",
    goal: "Run with an available required skill",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        requiredSkills: [{ id: "research-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "agent",
          label: "Research",
          prompt: "Gather the relevant updates.",
          agentProfileRef: "researcher"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Research completes", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run research" });
  const effectiveProfile = {
    id: "researcher",
    label: "Researcher",
    role: "Research specialist",
    source: "declared",
    stepId: "research",
    requestedRef: "researcher",
    requiredSkills: [{ id: "research-pack", source: "user" }],
    advisorySkills: []
  };

  expect(launch.run.codexSession?.profilePreflight).toEqual({
    status: "passed",
    checks: [
      {
        profileId: "researcher",
        profileLabel: "Researcher",
        stepId: "research",
        required: true,
        skill: { id: "research-pack", source: "user" },
        status: "passed",
        message: "research-pack is installed",
        locations: ["/mock/.codex/skills/research-pack/SKILL.md"]
      }
    ],
    warnings: [],
    blockers: [],
    allowDegradedProfiles: undefined
  });
  expect(launch.launchRequest.workflowPlan?.steps.find((step) => step.id === "research")).toMatchObject({
    agentProfile: effectiveProfile,
    subagent: {
      ref: "researcher",
      role: "Research specialist"
    }
  });
  expect(launch.run.codexSession?.subagents?.[0]).toMatchObject({
    stepId: "research",
    agentProfile: effectiveProfile,
    subagent: {
      ref: "researcher",
      role: "Research specialist"
    }
  });
  expect(launch.prompt).toContain("DittosLoop records these profile expectations and performs best-effort checks");
  expect(launch.prompt).toContain("does not provide native Codex skill enforcement");
});

test("agent profile snapshots flow through workflow sessions and task runs", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createServiceWithStore(await makeTempStore(), {
    sessionBridge: bridge,
    skillAvailabilityProvider: {
      check: async (requirement) => ({
        status: "passed",
        message: `${requirement.id} is installed`,
        locations: [`/mock/.codex/skills/${requirement.id}/SKILL.md`]
      })
    }
  });
  const loop = await service.createLoopContract({
    title: "Profile workflow execution",
    goal: "Run a profile-backed workflow",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        model: "gpt-5.4-mini",
        allowedTools: ["rg", "sed"],
        permissions: { filesystem: "workspace-write", network: "disabled" },
        requiredSkills: [{ id: "research-pack", source: "user" }],
        advisorySkills: [{ id: "browser-pack", source: "plugin", pluginId: "browser" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "task",
          runtime: "codex",
          label: "Research",
          prompt: "Gather the relevant updates.",
          agentProfileRef: "researcher"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Research completes", severity: "must" }]
    }
  });
  const expectedProfile = {
    id: "researcher",
    label: "Researcher",
    role: "Research specialist",
    source: "declared",
    stepId: "research",
    requestedRef: "researcher",
    model: "gpt-5.4-mini",
    allowedTools: ["rg", "sed"],
    permissions: { filesystem: "workspace-write", network: "disabled" },
    requiredSkills: [{ id: "research-pack", source: "user" }],
    advisorySkills: [{ id: "browser-pack", source: "plugin", pluginId: "browser" }]
  };

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run research" });
  const run = await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });
  const detail = await service.getRunDetail(launch.run.id);
  const taskRun = detail.workflowContexts[0]?.taskRuns[0];

  expect(run.status).toBe("running");
  expect(requests[0]).toMatchObject({
    stepId: "research",
    subagent: {
      ref: "researcher",
      role: "Research specialist",
      model: "gpt-5.4-mini",
      tools: ["rg", "sed"],
      permissions: { filesystem: "workspace-write", network: "disabled" }
    },
    agentProfile: expectedProfile
  });
  expect(taskRun).toMatchObject({
    stepId: "research",
    sessionId: "session_1",
    status: "suspended",
    subagent: {
      ref: "researcher",
      role: "Research specialist",
      model: "gpt-5.4-mini",
      tools: ["rg", "sed"],
      permissions: { filesystem: "workspace-write", network: "disabled" }
    },
    agentProfile: expectedProfile,
    profilePreflight: {
      checks: [
        expect.objectContaining({
          profileId: "researcher",
          stepId: "research",
          skill: { id: "research-pack", source: "user" }
        }),
        expect.objectContaining({
          profileId: "researcher",
          stepId: "research",
          skill: { id: "browser-pack", source: "plugin", pluginId: "browser" }
        })
      ]
    }
  });
  expect(detail.run.codexSession?.subagents?.[0]).toMatchObject({
    stepId: "research",
    sessionId: "session_1",
    agentProfile: expectedProfile
  });
});

test("agent profile preflight survives workflow resume into the next Codex task", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const service = await createServiceWithStore(await makeTempStore(), {
    sessionBridge: bridge,
    skillAvailabilityProvider: {
      check: async (requirement) => ({
        status: "passed",
        message: `${requirement.id} is installed`,
        locations: [`/mock/.codex/skills/${requirement.id}/SKILL.md`]
      })
    }
  });
  const loop = await service.createLoopContract({
    title: "Profile resume preflight",
    goal: "Keep step preflight available after resume",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        requiredSkills: [{ id: "research-pack", source: "user" }]
      },
      reviewer: {
        id: "reviewer",
        label: "Reviewer",
        role: "Review specialist",
        requiredSkills: [{ id: "review-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "task",
          runtime: "codex",
          label: "Research",
          prompt: "Gather the evidence.",
          agentProfileRef: "researcher"
        },
        {
          id: "review",
          kind: "task",
          runtime: "codex",
          label: "Review",
          prompt: "Review the evidence.",
          agentProfileRef: "reviewer"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Workflow completes", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run research then review" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["research"]);

  const resumed = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "research",
    idempotencyKey: "research:final",
    status: "passed",
    summary: "Research complete.",
    result: "Evidence bundle"
  });
  const detail = await service.getRunDetail(launch.run.id);
  const reviewTaskRun = detail.workflowContexts[0]?.taskRuns.find((taskRun) => taskRun.stepId === "review");

  expect(resumed.codexSession?.profilePreflight).toMatchObject({
    checks: [
      expect.objectContaining({
        profileId: "researcher",
        stepId: "research",
        skill: { id: "research-pack", source: "user" }
      }),
      expect.objectContaining({
        profileId: "reviewer",
        stepId: "review",
        skill: { id: "review-pack", source: "user" }
      })
    ]
  });
  expect(requests.map((request) => request.stepId)).toEqual(["research", "review"]);
  expect(reviewTaskRun).toMatchObject({
    stepId: "review",
    sessionId: "session_2",
    status: "suspended"
  });
  expect(reviewTaskRun?.profilePreflight).toBeDefined();
  expect(detail.run.codexSession?.subagents?.find((subagent) => subagent.stepId === "review")).toMatchObject({
    sessionId: "session_2"
  });
  expect(detail.run.codexSession?.subagents?.find((subagent) => subagent.stepId === "review")?.profilePreflight).toBeDefined();
});

test("agent profile snapshots remain stable when resuming after a workflow revision", async () => {
  const initialBridge = createPendingSessionBridge();
  const store = await makeTempStore();
  const service = await createServiceWithStore(store, {
    sessionBridge: initialBridge.bridge,
    skillAvailabilityProvider: {
      check: async (requirement) => ({
        status: "passed",
        message: `${requirement.id} is installed`
      })
    }
  });
  const loop = await service.createLoopContract({
    title: "Profile resume snapshot",
    goal: "Resume with the originally launched profile",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Original researcher",
        requiredSkills: [{ id: "research-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "task",
          runtime: "codex",
          label: "Research",
          prompt: "Gather the original evidence.",
          agentProfileRef: "researcher"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Research completes", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run research" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  await service.proposeWorkflowRevision(loop.id, {
    runId: launch.run.id,
    attemptId: launch.attempt.id,
    reason: "Switch to a writer for later runs.",
    patch: {
      agentProfiles: {
        researcher: {
          id: "researcher",
          label: "Researcher",
          role: "Revised researcher",
          requiredSkills: [{ id: "revised-pack", source: "user" }]
        }
      }
    }
  });

  const resumedBridge = createPendingSessionBridge(1);
  (service as any).options.sessionBridge = resumedBridge.bridge;
  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    sessionId: "session_1",
    stepId: "research",
    idempotencyKey: "session_1:research:passed",
    status: "passed",
    summary: "Research finished.",
    result: "Original research output."
  });

  const detail = await service.getRunDetail(launch.run.id);
  const taskRun = detail.workflowContexts[0]?.taskRuns.find((candidate) => candidate.stepId === "research");
  expect(taskRun?.agentProfile).toMatchObject({
    id: "researcher",
    role: "Original researcher",
    requiredSkills: [{ id: "research-pack", source: "user" }]
  });
  expect(taskRun?.agentProfile).not.toMatchObject({
    role: "Revised researcher"
  });
});

test("agent profile step preflight status stays local to each step", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => {
    if (requirement.id === "research-pack") {
      return {
        status: "passed",
        message: "research-pack is installed"
      };
    }

    return {
      status: "unknown",
      message: `${requirement.id} could not be verified`
    };
  });
  const loop = await service.createLoopContract({
    title: "Profile status locality",
    goal: "Keep each step preflight status local",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        requiredSkills: [{ id: "research-pack", source: "user" }]
      },
      reviewer: {
        id: "reviewer",
        label: "Reviewer",
        role: "Code reviewer",
        requiredSkills: [{ id: "review-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "task",
          runtime: "codex",
          label: "Research",
          prompt: "Gather the relevant evidence.",
          agentProfileRef: "researcher"
        },
        {
          id: "review",
          kind: "task",
          runtime: "codex",
          label: "Review",
          prompt: "Review the evidence.",
          agentProfileRef: "reviewer"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Work completes", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Run mixed profile steps",
    allowDegradedProfiles: true
  });

  expect(launch.run.codexSession?.profilePreflight).toMatchObject({
    status: "degraded",
    blockers: [expect.stringMatching(/review-pack/)]
  });
  expect(launch.run.codexSession?.subagents?.find((subagent) => subagent.stepId === "research")?.profilePreflight)
    .toMatchObject({
      status: "passed"
    });
  expect(launch.run.codexSession?.subagents?.find((subagent) => subagent.stepId === "review")?.profilePreflight).toMatchObject(
    {
      status: "degraded"
    }
  );
});

test("profile preflight finds plugin skills stored directly under the plugin cache root", async () => {
  const codexHome = await mkdtemp(join(tmpdir(), "dittosloop-codex-home-"));
  tempDirs.push(codexHome);
  const skillPath = join(
    codexHome,
    "plugins",
    "cache",
    "demo-plugin",
    "skills",
    "research-pack",
    "SKILL.md"
  );
  await mkdir(join(skillPath, ".."), { recursive: true });
  await writeFile(skillPath, "# Research Pack\n", "utf8");

  const previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;

  try {
    const result = await defaultSkillAvailabilityProvider.check(
      {
        id: "research-pack",
        source: "plugin",
        pluginId: "demo-plugin"
      },
      {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        source: "declared",
        stepId: "research",
        requiredSkills: [],
        advisorySkills: []
      }
    );

    expect(result).toEqual({
      status: "passed",
      message: "Found research-pack",
      locations: [skillPath]
    });
  } finally {
    if (previousCodexHome === undefined) {
      delete process.env.CODEX_HOME;
    } else {
      process.env.CODEX_HOME = previousCodexHome;
    }
  }
});

test("profile preflight blocks required missing skills by default", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => ({
    status: "missing",
    message: `${requirement.id} is not installed`
  }));
  const loop = await service.createLoopContract({
    title: "Profile preflight blocked",
    goal: "Refuse missing required skills",
    agentProfiles: {
      reviewer: {
        id: "reviewer",
        label: "Reviewer",
        role: "Code reviewer",
        requiredSkills: [{ id: "code-review-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "review",
          kind: "agent",
          label: "Review",
          prompt: "Review the diff.",
          agentProfileRef: "reviewer"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Review completes", severity: "must" }]
    }
  });

  await expect(service.startCodexSessionRun(loop.id, { goal: "Run review" })).rejects.toThrow(
    /Reviewer|review|code-review-pack/
  );
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: []
  });
});

test("profile preflight blocks required unknown skills by default", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => ({
    status: "unknown",
    message: `${requirement.id} could not be verified`
  }));
  const loop = await service.createLoopContract({
    title: "Profile preflight unknown",
    goal: "Refuse unverifiable required skills",
    agentProfiles: {
      reporter: {
        id: "reporter",
        label: "Reporter",
        role: "Daily reporter",
        requiredSkills: [{ id: "daily-briefing", source: "project" }]
      }
    },
    body: {
      steps: [
        {
          id: "report",
          kind: "agent",
          label: "Report",
          prompt: "Write the report.",
          agentProfileRef: "reporter"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Report completes", severity: "must" }]
    }
  });

  await expect(service.startCodexSessionRun(loop.id, { goal: "Run report" })).rejects.toThrow(
    /Reporter|report|daily-briefing/
  );
});

test("profile preflight stores advisory missing and unknown skills as warnings", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => {
    if (requirement.id === "optional-browser") {
      return {
        status: "missing",
        message: "optional-browser is not installed"
      };
    }

    return {
      status: "unknown",
      message: `${requirement.id} could not be verified`
    };
  });
  const loop = await service.createLoopContract({
    title: "Profile preflight warnings",
    goal: "Record advisory warnings",
    agentProfiles: {
      analyst: {
        id: "analyst",
        label: "Analyst",
        role: "Analyst",
        advisorySkills: [
          { id: "optional-browser", source: "user" },
          { id: "project-memory", source: "project" }
        ]
      }
    },
    body: {
      steps: [
        {
          id: "analyze",
          kind: "agent",
          label: "Analyze",
          prompt: "Analyze the project state.",
          agentProfileRef: "analyst"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Analysis completes", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run analysis" });

  expect(launch.run.codexSession?.profilePreflight).toMatchObject({
    status: "warning",
    warnings: [
      expect.stringMatching(/optional-browser/),
      expect.stringMatching(/project-memory/)
    ],
    blockers: []
  });
});

test("profile preflight allows degraded start when required skills cannot be confirmed", async () => {
  const service = await createServiceWithSkillAvailability(async (requirement) => ({
    status: "unknown",
    message: `${requirement.id} could not be verified`
  }));
  const loop = await service.createLoopContract({
    title: "Profile preflight degraded",
    goal: "Allow degraded profile execution",
    agentProfiles: {
      worker: {
        id: "worker",
        label: "Worker",
        role: "Worker",
        requiredSkills: [{ id: "repo-memory", source: "project" }],
        advisorySkills: [{ id: "nice-to-have", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "work",
          kind: "agent",
          label: "Work",
          prompt: "Do the task.",
          agentProfileRef: "worker"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Work completes", severity: "must" }]
    }
  });

  const launch = await service.startCodexSessionRun(loop.id, {
    goal: "Run degraded work",
    allowDegradedProfiles: true
  });

  expect(launch.run.codexSession?.profilePreflight).toMatchObject({
    status: "degraded",
    allowDegradedProfiles: true,
    warnings: [expect.stringMatching(/nice-to-have/)],
    blockers: [expect.stringMatching(/repo-memory/)]
  });
});

test("profile preflight keeps the launched run on the same contract snapshot used for preflight", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const store = new LoopStore(dir);
  const service = await createServiceWithStore(store, {
    skillAvailabilityProvider: {
      check: async (requirement) => ({
        status: "passed",
        message: `${requirement.id} is installed`,
        locations: [`/mock/.codex/skills/${requirement.id}/SKILL.md`]
      })
    }
  });
  const loop = await service.createLoopContract({
    title: "Profile preflight snapshot",
    goal: "Keep preflight and launch aligned",
    agentProfiles: {
      researcher: {
        id: "researcher",
        label: "Researcher",
        role: "Research specialist",
        requiredSkills: [{ id: "research-pack", source: "user" }]
      }
    },
    body: {
      steps: [
        {
          id: "research",
          kind: "agent",
          label: "Research",
          prompt: "Gather the relevant updates.",
          agentProfileRef: "researcher"
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Research completes", severity: "must" }]
    }
  });

  const originalUpdateState = store.updateState.bind(store);
  let driftInjected = false;
  store.updateState = async (mutator) =>
    originalUpdateState(async (state) => {
      let nextState = state;
      if (!driftInjected) {
        driftInjected = true;
        nextState = {
          ...state,
          formalContracts: state.formalContracts.map((contract) =>
            contract.id === loop.id
              ? {
                  ...contract,
                  agentProfiles: {
                    writer: {
                      id: "writer",
                      label: "Writer",
                      role: "Writer",
                      requiredSkills: [{ id: "writer-pack", source: "user" }]
                    }
                  },
                  body: {
                    steps: [
                      {
                        id: "write",
                        kind: "agent",
                        label: "Write",
                        prompt: "Write the final brief.",
                        agentProfileRef: "writer"
                      }
                    ]
                  }
                }
              : contract
          )
        };
      }

      return mutator(nextState);
    });

  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run research" });

  expect(launch.run.codexSession?.profilePreflight).toMatchObject({
    checks: [
      expect.objectContaining({
        profileId: "researcher",
        stepId: "research",
        skill: { id: "research-pack", source: "user" }
      })
    ]
  });
  expect(launch.launchRequest.workflowPlan?.steps).toEqual([
    expect.objectContaining({
      id: "research",
      label: "Research",
      prompt: "Gather the relevant updates."
    })
  ]);
  expect(launch.run.codexSession?.subagents).toEqual([
    expect.objectContaining({
      stepId: "research",
      role: "Research",
      prompt: "Gather the relevant updates."
    })
  ]);
});

test("does not mark a Codex session ready without an openable thread URL", async () => {
  const service = await createService();
  const loop = await service.createLoopContract({
    title: "Session Link Check",
    goal: "Verify session linking",
    body: {
      steps: [{ id: "run-worker", kind: "agent", label: "Run worker", prompt: "Start a worker session" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "linked", label: "Linked", requirement: "Session has an openable URL", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Start a worker session" });
  await service.recordCodexThread(launch.run.id, {
    threadId: "019ef4e5-21f0-7131-be8c-708f720e49de"
  });

  await expect(service.openCodexSession(launch.run.id)).resolves.toEqual({
    runId: launch.run.id,
    status: "unavailable",
    message: "The Codex session has not been created by the host yet."
  });
});

test("records failed verification against an attempt and marks run repairing when requested", async () => {
  const service = await createService();
  const { run } = await startFormalRun(service);
  const attempt = await service.startAttempt(run.id);

  const result = await service.recordVerification(run.id, {
    attemptId: attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true,
    checks: [{ name: "npm run build", status: "failed", output: "TS error" }]
  });

  expect(result).toMatchObject({ runId: run.id, attemptId: attempt.id, status: "failed" });
  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: run.id, status: "repairing", updatedAt: fixedTime }],
    verificationResults: [{ id: "verification_1", attemptId: attempt.id }]
  });
});

test("recording a repairable verification moves the visible workflow context to repairing", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });

  await service.recordVerification(launch.run.id, {
    attemptId: launch.attempt.id,
    status: "failed",
    summary: "Build failed",
    repair: true,
    checks: [{ name: "npm run build", status: "failed", output: "TS error" }]
  });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: launch.run.id, status: "repairing" }],
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        runId: launch.run.id,
        attemptId: launch.attempt.id,
        status: "repairing",
        cursor: { state: "repairing" },
        vars: { repairReason: "Build failed" },
        pendingSessionIds: []
      }
    ],
    verificationResults: [{ id: "verification_1", attemptId: launch.attempt.id, status: "failed" }]
  });
});

test("marking a session run repairing moves its visible workflow context to repairing", async () => {
  const service = await createService();
  const loop = await createFormalLoop(service);
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run checks" });

  await service.markRunRepairing(launch.run.id, { reason: "Apply reviewer feedback" });

  await expect(service.getSnapshot()).resolves.toMatchObject({
    runs: [{ id: launch.run.id, status: "repairing" }],
    workflowContexts: [
      {
        id: launch.launchRequest.workflowContextId,
        runId: launch.run.id,
        attemptId: launch.attempt.id,
        status: "repairing",
        cursor: { state: "repairing" },
        vars: { repairReason: "Apply reviewer feedback" },
        pendingSessionIds: []
      }
    ]
  });
});

test("keeps a workflow attempt repairable when verifier failure still has repair attempts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return prefix === "attempt" ? `persisted_attempt_${next}` : `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888"
  });
  const loop = await service.createLoopContract({
    title: "Repairable workflow",
    goal: "Produce sourced notes",
    body: {
      steps: [{ id: "collect", kind: "agent", label: "Collect", prompt: "Collect official sources" }]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Includes an official source", severity: "must" }]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run repairable workflow" });

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    executor: {
      async run() {
        return { text: "Collected notes without an official source." };
      }
    },
    verifier: async () => ({
      status: "failed",
      summary: "Missing official source.",
      repairInstructions: "Add one official source and retry.",
      checks: [{ rubricId: "source", status: "failed" }]
    })
  });

  const detail = await service.getRunDetail(launch.run.id);
  const engineAttemptIds = detail.events.flatMap((event) => {
    const engineEvent = event.data?.engineEvent;
    return engineEvent && typeof engineEvent === "object" && "attemptId" in engineEvent
      ? [(engineEvent as { attemptId: string }).attemptId]
      : [];
  });

  expect(run.status).toBe("repairing");
  expect(detail.attempts).toMatchObject([{ id: launch.attempt.id, status: "running" }]);
  expect(detail.workflowContexts).toMatchObject([
    {
      id: launch.launchRequest.workflowContextId,
      status: "repairing",
      cursor: { state: "repairing" }
    }
  ]);
  expect(detail.verificationResults).toMatchObject([
    { attemptId: launch.attempt.id, status: "failed", summary: "Missing official source." }
  ]);
  expect(engineAttemptIds).toEqual([
    launch.attempt.id,
    launch.attempt.id,
    launch.attempt.id
  ]);
});

test("resolves a human request with a response", async () => {
  const service = await createService();
  const { run } = await startFormalRun(service);
  const request = await service.recordHumanRequest(run.id, { question: "Continue with repair?" });

  const resolved = await service.resolveHumanRequest(request.id, { response: "Yes, continue." });

  expect(resolved).toMatchObject({
    id: request.id,
    status: "resolved",
    response: "Yes, continue.",
    resolvedAt: fixedTime
  });
});

test("returns composed run detail", async () => {
  const service = await createService();
  const { loop, run } = await startFormalRun(service);
  const attempt = await service.startAttempt(run.id, { summary: "First pass" });
  await service.appendEvent(run.id, { message: "Checked package scripts" });
  await service.recordVerification(run.id, { attemptId: attempt.id, status: "passed", summary: "Tests passed" });
  await service.recordHumanRequest(run.id, { question: "Ship it?" });
  await service.commitMemory(loop.id, { runId: run.id, summary: "Checks passed locally." });
  await service.addArtifact(run.id, { title: "Preview", url: "http://127.0.0.1:47888" });

  const detail = await service.getRunDetail(run.id);

  expect(detail).toMatchObject({
    run: { id: run.id },
    loop: { id: loop.id },
    attempts: [{ id: attempt.id }],
    verificationResults: [{ attemptId: attempt.id }],
    humanRequests: [{ status: "open" }],
    memoryCommits: [{ summary: "Checks passed locally." }],
    artifacts: [{ title: "Preview" }]
  });
  expect(detail.events).toEqual(expect.arrayContaining([expect.objectContaining({ message: "Checked package scripts" })]));
});

test("a script-authored loop yields the same body as the equivalent hand-written contract", async () => {
  const service = await createServiceWithSequentialIds();

  const scripted = await service.createLoopContract({
    title: "Scripted",
    goal: "Author through a builder script",
    script: {
      build: [
        { fn: "budget", args: [3] },
        {
          fn: "pipeline",
          args: [
            "produce",
            "Produce",
            [
              { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write." }] },
              { fn: "task", args: [{ id: "review", label: "Review", prompt: "Review." }] }
            ]
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Output ok", severity: "must" }]
    }
  });

  expect(scripted.body.steps).toEqual([
    {
      id: "produce",
      kind: "phase",
      label: "Produce",
      pipeline: true,
      children: [
        { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write." },
        { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review." }
      ]
    }
  ]);
  expect(scripted.budgetUsd).toBe(3);
});

test("rejects a passed task result that violates the step outputSchema without mutating the workflow context", async () => {
  const { bridge } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Schema enforced workflow",
    goal: "Enforce outputSchema at writeback",
    body: {
      steps: [
        {
          id: "draft",
          kind: "task",
          runtime: "codex",
          label: "Draft",
          prompt: "Produce JSON.",
          outputSchema: { type: "object", required: ["summary"] }
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Output ok", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run schema workflow" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  await expect(
    service.recordSessionResult(launch.run.id, {
      attemptId: launch.attempt.id,
      sessionId: "session_1",
      stepId: "draft",
      idempotencyKey: "draft:final",
      status: "passed",
      summary: "Draft done.",
      result: JSON.stringify({ notes: "missing summary" })
    })
  ).rejects.toThrow(/outputSchema validation failed/);

  const snapshot = await service.getSnapshot();
  expect(snapshot.workflowContexts[0]).toMatchObject({
    status: "suspended",
    idempotencyKeys: [],
    steps: { draft: { status: "suspended" } }
  });
  expect(snapshot.workflowContexts[0].steps.draft.output).toBeUndefined();

  // A conforming result then succeeds.
  const completed = await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "draft:final",
    status: "passed",
    summary: "Draft done.",
    result: JSON.stringify({ summary: "all good" })
  });
  expect(completed.status).toBe("completed");
});

test("a pipeline threads the prior step output into the next step prompt and never relaunches completed steps", async () => {
  const { bridge, requests } = createPendingSessionBridge();
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-service-"));
  tempDirs.push(dir);
  const counters = new Map<string, number>();
  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => fixedTime,
    createId: (prefix) => {
      const next = (counters.get(prefix) ?? 0) + 1;
      counters.set(prefix, next);
      return `${prefix}_${next}`;
    },
    previewBaseUrl: "http://127.0.0.1:47888",
    sessionBridge: bridge
  });
  const loop = await service.createLoopContract({
    title: "Pipeline workflow",
    goal: "Thread outputs between pipeline steps",
    script: {
      build: [
        {
          fn: "pipeline",
          args: [
            "produce",
            "Produce",
            [
              { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write a draft." }] },
              { fn: "task", args: [{ id: "review", label: "Review", prompt: "Review the draft." }] }
            ]
          ]
        }
      ]
    },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "done", label: "Done", requirement: "Output ok", severity: "must" }]
    }
  });
  const launch = await service.startCodexSessionRun(loop.id, { goal: "Run pipeline" });
  await service.executeWorkflowAttempt(launch.run.id, { attemptId: launch.attempt.id });

  expect(requests.map((request) => request.stepId)).toEqual(["draft"]);

  await service.recordSessionResult(launch.run.id, {
    attemptId: launch.attempt.id,
    sessionId: "session_1",
    stepId: "draft",
    idempotencyKey: "draft:final",
    status: "passed",
    summary: "Draft done.",
    result: "DRAFT-OUTPUT"
  });

  // Step 1 is not relaunched (memoize-by-stepId preserved); step 2 launched once.
  expect(requests.map((request) => request.stepId)).toEqual(["draft", "review"]);
  const reviewRequest = requests.find((request) => request.stepId === "review");
  expect(reviewRequest?.prompt).toContain("Review the draft.");
  expect(reviewRequest?.prompt).toContain("[pipeline] Prior step (draft) output:");
  expect(reviewRequest?.prompt).toContain("DRAFT-OUTPUT");
});
