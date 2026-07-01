import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { MAX_LOOP_MEMORY_READ_LIMIT, type LoopService } from "./service.js";
import type { ArtifactRef, LoopRun, RunDetail, VerificationResult, WorkflowTaskRun } from "./types.js";

export interface TextToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export type ToolHandler = (input: unknown) => Promise<TextToolResult>;
export type ToolHandlerMap = Record<string, ToolHandler>;

type WorkflowSessionResultStatus = Extract<LoopRun["status"], "completed" | "failed" | "waiting_for_human">;

interface WorkflowSessionResultEnvelope {
  status: WorkflowSessionResultStatus;
  finalAnswer: string;
  summary: string;
  result?: unknown;
  verification?: {
    status: VerificationResult["status"];
    summary: string;
    checks: VerificationResult["checks"];
  };
  artifacts: ArtifactRef[];
  humanRequest?: {
    id: string;
    question: string;
  };
}

type WorkflowToolResponse = LoopRun & {
  run: LoopRun;
  sessionResult?: WorkflowSessionResultEnvelope;
};

export interface ToolRegistrar {
  registerTool(name: string, ...args: any[]): unknown;
}

const eventKindSchema = z.enum([
  "note",
  "run_created",
  "attempt_started",
  "attempt_completed",
  "verification_recorded",
  "human_request",
  "memory_committed",
  "artifact_added",
  "run_completed"
]);

const verificationStatusSchema = z.enum(["passed", "failed", "skipped"]);
const verificationDecisionStatusSchema = z.enum(["passed", "failed", "needs_human"]);
const verificationSeveritySchema = z.enum(["must", "should"]);
const pausedReasonSchema = z.enum(["failures", "budget", "escalation"]);
const immediatePausedReasonSchema = z.enum(["budget", "escalation"]);

const subagentSchema = z.object({
  ref: z.string().min(1).optional(),
  role: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  tools: z.array(z.string().min(1)).optional(),
  workdir: z.string().min(1).optional(),
  env: z.record(z.string()).optional(),
  permissions: z.object({
    filesystem: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    network: z.enum(["enabled", "disabled"]).optional()
  }).optional(),
  timeoutMs: z.number().int().positive().optional(),
  context: z.record(z.unknown()).optional()
});

const skillRequirementSchema = z.object({
  id: z.string().min(1),
  source: z.enum(["plugin", "project", "user", "system"]).optional(),
  pluginId: z.string().min(1).optional(),
  version: z.string().min(1).optional()
});

const agentProfileSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  role: z.string().min(1),
  instructions: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  workdir: z.string().min(1).optional(),
  requiredSkills: z.array(skillRequirementSchema).optional(),
  advisorySkills: z.array(skillRequirementSchema).optional(),
  allowedTools: z.array(z.string().min(1)).optional(),
  permissions: subagentSchema.shape.permissions.optional(),
  env: z.record(z.string()).optional(),
  timeoutMs: z.number().int().positive().optional(),
  context: z.record(z.unknown()).optional()
});

const agentStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("agent"),
  label: z.string().min(1),
  prompt: z.string().min(1),
  agentProfileRef: z.string().min(1).optional(),
  verifierRef: z.string().optional(),
  sessionPolicy: z.literal("new").optional(),
  subagent: subagentSchema.optional()
});

const taskStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("task"),
  runtime: z.literal("codex"),
  label: z.string().min(1),
  prompt: z.string().min(1),
  agentProfileRef: z.string().min(1).optional(),
  verifierRef: z.string().optional(),
  sessionPolicy: z.literal("new").optional(),
  outputSchema: z.record(z.unknown()).optional(),
  human: z.boolean().optional(),
  subagent: subagentSchema.optional()
});

type StepSchema = z.infer<typeof agentStepSchema> | z.infer<typeof taskStepSchema> | {
  id: string;
  kind: "phase";
  label: string;
  pipeline?: boolean;
  children: StepSchema[];
} | {
  id: string;
  kind: "parallel";
  label: string;
  children: StepSchema[];
};

const stepSchema: z.ZodType<StepSchema> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    agentStepSchema,
    taskStepSchema,
    z.object({
      id: z.string().min(1),
      kind: z.literal("phase"),
      label: z.string().min(1),
      pipeline: z.boolean().optional(),
      children: z.array(stepSchema)
    }),
    z.object({
      id: z.string().min(1),
      kind: z.literal("parallel"),
      label: z.string().min(1),
      children: z.array(stepSchema)
    })
  ])
);

const scriptCallSchema: z.ZodType<{ fn: string; args?: unknown[] }> = z.object({
  fn: z.string().min(1),
  args: z.array(z.unknown()).optional()
});

const scriptSchema = z.object({
  build: z.array(scriptCallSchema).min(1)
});

const runtimeScriptLimitsSchema = z.object({
  timeoutMs: z.number().int().positive().optional(),
  maxAgentCalls: z.number().int().positive().optional(),
  maxParallelBranches: z.number().int().positive().optional(),
  maxPipelineItems: z.number().int().positive().optional(),
  maxLogChars: z.number().int().positive().optional()
}).strict();

const verificationCriterionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  severity: verificationSeveritySchema
});

const verificationDecisionPolicySchema = z.object({
  requireAllMustCriteriaCovered: z.boolean(),
  failOnMustValidatorFailure: z.boolean(),
  failOnShouldValidatorFailure: z.boolean(),
  requireEvidenceForAgentScores: z.boolean(),
  requireEvidenceForScriptResults: z.boolean().optional()
});

const commandValidatorSchema = z.object({
  id: z.string().min(1),
  type: z.literal("command"),
  label: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  cwd: z.union([
    z.literal("project"),
    z.literal("contract"),
    z.object({ relativeToProject: z.string().min(1) })
  ]).optional(),
  timeoutMs: z.number().int().positive().optional(),
  criteriaIds: z.array(z.string().min(1)).optional(),
  severity: verificationSeveritySchema,
  parse: z.object({ kind: z.literal("none") })
});

const scoreSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("workflow_result"), path: z.string().min(1) }),
  z.object({ type: z.literal("artifact"), artifactId: z.string().min(1), path: z.string().min(1) }),
  z.object({ type: z.literal("validator_output"), validatorId: z.string().min(1), path: z.string().min(1) })
]);

const scoreValidatorSchema = z.object({
  id: z.string().min(1),
  type: z.literal("score"),
  label: z.string().min(1),
  metric: z.string().min(1),
  source: scoreSourceSchema,
  operator: z.enum([">=", ">", "<=", "<", "==", "!="]),
  threshold: z.number().finite(),
  criteriaIds: z.array(z.string().min(1)).optional(),
  severity: verificationSeveritySchema
});

const rubricAgentValidatorSchema = z.object({
  id: z.string().min(1),
  type: z.literal("rubric_agent"),
  label: z.string().min(1),
  criteriaIds: z.array(z.string().min(1)).min(1),
  prompt: z.string().min(1),
  scoreScale: z.object({
    min: z.number().finite(),
    max: z.number().finite()
  }).optional(),
  passScore: z.number().finite().optional(),
  evidenceRequired: z.boolean().optional(),
  subagent: subagentSchema.optional(),
  allowSelfReview: z.boolean().optional(),
  severity: verificationSeveritySchema
});

const scriptValidatorSchema = z.object({
  id: z.string().min(1),
  type: z.literal("script"),
  label: z.string().min(1),
  criteriaIds: z.array(z.string().min(1)).min(1),
  severity: verificationSeveritySchema,
  runtime: z.enum(["node", "python"]),
  scriptRef: z.object({
    path: z.string().min(1),
    checksum: z.string().min(1),
    cwd: z.union([
      z.literal("project"),
      z.literal("contract"),
      z.literal("loop"),
      z.object({ relativeToProject: z.string().min(1) })
    ]).optional(),
    args: z.array(z.string()).optional(),
    timeoutMs: z.number().int().positive()
  }),
  input: z.object({
    source: z.enum(["workflow_result", "artifact", "project"])
  }),
  output: z.object({
    schema: z.literal("verification_result_v1")
  }),
  evidenceRequired: z.boolean(),
  builder: z.object({
    kind: z.literal("codex_subagent"),
    builtAt: z.string().min(1),
    selfCheck: z.object({
      status: z.literal("passed"),
      command: z.string().min(1),
      args: z.array(z.string()).optional(),
      evidence: z.string().min(1)
    })
  })
});

const verificationValidatorSchema = z.discriminatedUnion("type", [
  commandValidatorSchema,
  scoreValidatorSchema,
  rubricAgentValidatorSchema,
  scriptValidatorSchema
]);

const verificationV2Schema = z.object({
  version: z.literal(2),
  mode: z.enum(["after_workflow", "after_each_step"]),
  criteria: z.array(verificationCriterionSchema).min(1),
  validators: z.array(verificationValidatorSchema).min(1),
  decision: verificationDecisionPolicySchema
});

const createLoopContractObjectSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  goal: z.string().min(1),
  workflowKind: z.enum(["static_steps", "runtime_script"]).optional(),
  intent: z.string().optional(),
  body: z.object({ steps: z.array(stepSchema).min(1) }).optional(),
  script: z.union([scriptSchema, z.string().min(1)]).optional(),
  args: z.record(z.unknown()).optional(),
  limits: runtimeScriptLimitsSchema.optional(),
  verification: verificationV2Schema,
  repairPolicy: z.object({
    maxAttempts: z.number().int().nonnegative(),
    strategy: z.enum(["repair_then_retry", "ask_human", "fail_run"])
  }).optional(),
  stopPolicy: z.object({
    rule: z.string().min(1),
    maxConsecutiveFailures: z.number().int().nonnegative().optional()
  }).optional(),
  budgetUsd: z.number().positive().max(20).optional(),
  escalation: z.array(z.string().min(1)).optional(),
  agentProfiles: z.record(agentProfileSchema).optional(),
  projectBinding: z.object({
    codexProjectId: z.string().optional(),
    projectLabel: z.string().optional(),
    projectPath: z.string().optional()
  }).optional()
});

const createLoopContractSchema = createLoopContractObjectSchema.superRefine(validateCreateLoopContractInput);

function validateCreateLoopContractInput(input: z.infer<typeof createLoopContractObjectSchema>, ctx: z.RefinementCtx): void {
  if (input.body && input.script !== undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one of body or script is required; choose either body.steps or script, not both",
      path: ["script"]
    });
  }

  if (!input.body && input.script === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "exactly one of body or script is required"
    });
  }

  if (input.body && input.workflowKind === "runtime_script") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "body.steps cannot be used with workflowKind runtime_script",
      path: ["body"]
    });
  }

  if (typeof input.script === "string" && input.workflowKind !== "runtime_script") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'string script requires workflowKind: "runtime_script"',
      path: ["workflowKind"]
    });
  }

  if (input.script !== undefined && typeof input.script !== "string" && input.workflowKind === "runtime_script") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "script.build is a static_steps builder script; use a string script with workflowKind runtime_script",
      path: ["script"]
    });
  }
}

const startCodexSessionSchema = z.object({
  loopId: z.string().min(1),
  goal: z.string().optional(),
  codexProjectId: z.string().optional(),
  projectLabel: z.string().optional(),
  projectPath: z.string().optional(),
  allowDegradedProfiles: z.boolean().optional()
});

const pauseLoopSchema = z.object({
  loopId: z.string().min(1),
  reason: pausedReasonSchema.optional()
});

const resumeLoopSchema = z.object({
  loopId: z.string().min(1)
});

const approveRuntimeScriptSchema = z.object({
  loopId: z.string().min(1),
  approvedBy: z.string().min(1)
});

const executeWorkflowAttemptSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1).optional()
});

const proposeWorkflowRevisionObjectSchema = z.object({
  loopId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  authorSessionId: z.string().min(1).optional(),
  authorThreadId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  contract: createLoopContractObjectSchema.optional(),
  patch: createLoopContractObjectSchema.partial().optional()
});

const proposeWorkflowRevisionSchema = proposeWorkflowRevisionObjectSchema.refine((value) => Boolean(value.reason || value.rationale), {
  message: "reason or rationale is required"
}).refine((value) => Boolean(value.contract || value.patch), {
  message: "contract or patch is required"
}).refine((value) => !(value.contract?.body && value.contract?.script), {
  message: "contract cannot include both body and script"
});

const listWorkflowRevisionsSchema = z.object({
  loopId: z.string().min(1)
});

const promoteWorkflowRevisionSchema = z.object({
  loopId: z.string().min(1),
  revisionId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1)
});

const rejectWorkflowRevisionSchema = z.object({
  loopId: z.string().min(1),
  revisionId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  reason: z.string().min(1)
});

const recordCodexThreadSchema = z.object({
  runId: z.string().min(1),
  threadId: z.string().min(1),
  threadTitle: z.string().optional(),
  threadUrl: z.string().min(1).optional()
});

const recordSessionResultSchema = z.object({
  runId: z.string().min(1),
  workflowContextId: z.string().min(1).optional(),
  attemptId: z.string().min(1).optional(),
  taskRunId: z.string().min(1).optional(),
  sessionId: z.string().min(1).optional(),
  stepId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  status: z.enum(["passed", "failed", "needs_human"]),
  pausedReason: immediatePausedReasonSchema.optional(),
  summary: z.string().min(1),
  result: z.string().optional(),
  checks: z.array(z.object({
    name: z.string().min(1),
    status: verificationStatusSchema,
    output: z.string().optional()
  })).optional(),
  humanQuestion: z.string().optional()
});

const openCodexSessionSchema = z.object({
  runId: z.string().min(1)
});

const startAttemptSchema = z.object({
  runId: z.string().min(1),
  summary: z.string().optional()
});

const completeAttemptSchema = z.object({
  attemptId: z.string().min(1),
  status: z.enum(["completed", "failed"]).optional(),
  summary: z.string().optional()
});

const appendEventSchema = z.object({
  runId: z.string().min(1),
  kind: eventKindSchema.optional(),
  message: z.string().min(1),
  data: z.record(z.unknown()).optional()
});

const verificationCheckSchema = z.object({
  name: z.string().min(1),
  status: verificationStatusSchema,
  output: z.string().optional()
});

const recordVerificationSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1).optional(),
  status: verificationStatusSchema,
  summary: z.string().min(1),
  checks: z.array(verificationCheckSchema).optional(),
  repair: z.boolean().optional()
});

const validatorCriteriaResultSchema = z.object({
  criterionId: z.string().min(1),
  status: verificationDecisionStatusSchema,
  score: z.number().finite().optional(),
  maxScore: z.number().finite().optional(),
  evidence: z.string().optional()
});

const validatorResultInputSchema = z.object({
  type: z.literal("rubric_agent"),
  status: verificationDecisionStatusSchema.optional(),
  score: z.number().finite().optional(),
  evidence: z.string().optional(),
  summary: z.string().optional(),
  output: z.unknown().optional(),
  criteriaResults: z.array(validatorCriteriaResultSchema).optional()
});

const recordValidatorResultSchema = z.object({
  runId: z.string().min(1),
  workflowContextId: z.string().min(1),
  attemptId: z.string().min(1),
  sessionId: z.string().min(1).optional(),
  validatorId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  result: validatorResultInputSchema
});

const recordHumanRequestSchema = z.object({
  runId: z.string().min(1),
  question: z.string().min(1)
});

const resolveHumanRequestSchema = z.object({
  requestId: z.string().min(1),
  response: z.string().min(1),
  summary: z.string().min(1).optional()
});

const commitMemorySchema = z.object({
  loopId: z.string().min(1),
  runId: z.string().min(1).optional(),
  summary: z.string().min(1)
});

const readLoopMemorySchema = z.object({
  loopId: z.string().min(1),
  limit: z.number().int().min(1).max(MAX_LOOP_MEMORY_READ_LIMIT).optional(),
  offset: z.number().int().nonnegative().optional()
});

const addArtifactSchema = z.object({
  runId: z.string().min(1),
  title: z.string().min(1),
  path: z.string().optional(),
  url: z.string().url().optional(),
  kind: z.string().optional()
});

const completeRunSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["completed", "failed"]).optional(),
  pausedReason: immediatePausedReasonSchema.optional(),
  summary: z.string().min(1).optional(),
  result: z.string().min(1).optional()
});

const markRunRepairingSchema = z.object({
  runId: z.string().min(1),
  reason: z.string().optional()
});

const getRunDetailSchema = z.object({
  runId: z.string().min(1)
});

const emptySchema = z.object({});

export function createToolHandlers(service: LoopService): ToolHandlerMap {
  return {
    create_loop_contract: async (input) => {
      const args = createLoopContractSchema.parse(input);
      return toToolResult(await service.createLoopContract(args));
    },
    list_loops: async () => toToolResult(await service.listLoops()),
    pause_loop: async (input) => {
      const args = pauseLoopSchema.parse(input);
      return toToolResult(await service.pauseLoop(args.loopId, { reason: args.reason }));
    },
    resume_loop: async (input) => {
      const args = resumeLoopSchema.parse(input);
      return toToolResult(await service.resumeLoop(args.loopId));
    },
    approve_runtime_script: async (input) => {
      const args = approveRuntimeScriptSchema.parse(input);
      return toToolResult(await service.approveRuntimeScript(args.loopId, {
        approvedBy: args.approvedBy
      }));
    },
    start_codex_session: async (input) => {
      const args = startCodexSessionSchema.parse(input);
      return toToolResult(await service.startCodexSessionRun(args.loopId, {
        goal: args.goal,
        codexProjectId: args.codexProjectId,
        projectLabel: args.projectLabel,
        projectPath: args.projectPath,
        allowDegradedProfiles: args.allowDegradedProfiles
      }));
    },
    execute_workflow_attempt: async (input) => {
      const args = executeWorkflowAttemptSchema.parse(input);
      const detail = await service.getRunDetail(args.runId);
      assertCodexThreadBoundForWorkflowExecution(detail.run);
      const run = await service.executeWorkflowAttempt(args.runId, {
        attemptId: args.attemptId
      });
      return toToolResult(await toWorkflowToolResponse(service, run));
    },
    propose_workflow_revision: async (input) => {
      const args = proposeWorkflowRevisionSchema.parse(input);
      return toToolResult(await service.proposeWorkflowRevision(args.loopId, {
        runId: args.runId,
        attemptId: args.attemptId,
        authorSessionId: args.authorSessionId,
        authorThreadId: args.authorThreadId,
        reason: args.reason,
        rationale: args.rationale,
        contract: args.contract,
        patch: args.patch
      }));
    },
    list_workflow_revisions: async (input) => {
      const args = listWorkflowRevisionsSchema.parse(input);
      return toToolResult(await service.listWorkflowRevisions(args.loopId));
    },
    promote_workflow_revision: async (input) => {
      const args = promoteWorkflowRevisionSchema.parse(input);
      return toToolResult(await service.promoteWorkflowRevision(args.loopId, args.revisionId, {
        runId: args.runId,
        attemptId: args.attemptId
      }));
    },
    reject_workflow_revision: async (input) => {
      const args = rejectWorkflowRevisionSchema.parse(input);
      return toToolResult(await service.rejectWorkflowRevision(args.loopId, args.revisionId, {
        runId: args.runId,
        attemptId: args.attemptId,
        reason: args.reason
      }));
    },
    record_codex_thread: async (input) => {
      const args = recordCodexThreadSchema.parse(input);
      return toToolResult(
        await service.recordCodexThread(args.runId, {
          threadId: args.threadId,
          threadTitle: args.threadTitle,
          threadUrl: args.threadUrl
        })
      );
    },
    record_session_result: async (input) => {
      const args = recordSessionResultSchema.parse(input);
      const run = await service.recordSessionResult(args.runId, {
        workflowContextId: args.workflowContextId,
        attemptId: args.attemptId,
        taskRunId: args.taskRunId,
        sessionId: args.sessionId,
        stepId: args.stepId,
        idempotencyKey: args.idempotencyKey,
        status: args.status,
        pausedReason: args.pausedReason,
        summary: args.summary,
        result: args.result,
        checks: args.checks,
        humanQuestion: args.humanQuestion
      });
      return toToolResult(await toWorkflowToolResponse(service, run));
    },
    record_validator_result: async (input) => {
      const args = recordValidatorResultSchema.parse(input);
      const verification = await service.recordValidatorResult(args.runId, {
        workflowContextId: args.workflowContextId,
        attemptId: args.attemptId,
        sessionId: args.sessionId,
        validatorId: args.validatorId,
        idempotencyKey: args.idempotencyKey,
        result: args.result
      });
      const detail = await service.getRunDetail(args.runId);
      if (!isWorkflowSessionResultStatus(detail.run.status)) {
        return toToolResult(verification);
      }

      return toToolResult({
        ...verification,
        run: detail.run,
        sessionResult: buildWorkflowSessionResultEnvelope(detail, detail.run.status)
      });
    },
    open_codex_session: async (input) => {
      const args = openCodexSessionSchema.parse(input);
      return toToolResult(await service.openCodexSession(args.runId));
    },
    start_attempt: async (input) => {
      const args = startAttemptSchema.parse(input);
      return toToolResult(await service.startAttempt(args.runId, { summary: args.summary }));
    },
    complete_attempt: async (input) => {
      const args = completeAttemptSchema.parse(input);
      return toToolResult(
        await service.completeAttempt(args.attemptId, {
          status: args.status,
          summary: args.summary
        })
      );
    },
    append_event: async (input) => {
      const args = appendEventSchema.parse(input);
      return toToolResult(await service.appendEvent(args.runId, args));
    },
    record_verification: async (input) => {
      const args = recordVerificationSchema.parse(input);
      return toToolResult(await service.recordVerification(args.runId, args));
    },
    record_human_request: async (input) => {
      const args = recordHumanRequestSchema.parse(input);
      return toToolResult(await service.recordHumanRequest(args.runId, args));
    },
    resolve_human_request: async (input) => {
      const args = resolveHumanRequestSchema.parse(input);
      return toToolResult(await service.resolveHumanRequest(args.requestId, {
        response: args.response,
        summary: args.summary
      }));
    },
    read_loop_memory: async (input) => {
      const args = readLoopMemorySchema.parse(input);
      return toToolResult(await service.readLoopMemory(args.loopId, {
        limit: args.limit,
        offset: args.offset
      }));
    },
    commit_memory: async (input) => {
      const args = commitMemorySchema.parse(input);
      return toToolResult(await service.commitMemory(args.loopId, args));
    },
    add_artifact: async (input) => {
      const args = addArtifactSchema.parse(input);
      return toToolResult(await service.addArtifact(args.runId, args));
    },
    complete_run: async (input) => {
      const args = completeRunSchema.parse(input);
      const run = await service.completeRun(args.runId, {
        status: args.status,
        pausedReason: args.pausedReason,
        summary: args.summary,
        result: args.result
      });
      const detail = await service.getRunDetail(run.id);
      return toToolResult({
        ...detail.run,
        summary: args.result ?? args.summary ?? detail.run.summary,
        result: args.result,
        run: detail.run,
        sessionResult: buildWorkflowSessionResultEnvelope(detail, (run.status as WorkflowSessionResultStatus))
      });
    },
    mark_run_repairing: async (input) => {
      const args = markRunRepairingSchema.parse(input);
      return toToolResult(await service.markRunRepairing(args.runId, { reason: args.reason }));
    },
    get_run_detail: async (input) => {
      const args = getRunDetailSchema.parse(input);
      return toToolResult(await service.getRunDetail(args.runId));
    },
    get_snapshot: async () => toToolResult(await service.getSnapshot()),
    get_preview_url: async () => toToolResult({ previewUrl: service.getPreviewUrl() })
  };
}

export function createMcpServer(service: LoopService): McpServer {
  const server = new McpServer({
    name: "dittosloop-for-codex",
    version: "0.1.6"
  });

  registerDittosLoopTools(server, createToolHandlers(service));

  return server;
}

export function registerDittosLoopTools(server: ToolRegistrar, handlers: ToolHandlerMap): void {
  for (const definition of toolDefinitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.schema
      },
      async (input: unknown) => handlers[definition.name](input ?? {})
    );
  }
}

function toToolResult(payload: unknown): TextToolResult {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}

async function toWorkflowToolResponse(service: LoopService, run: LoopRun): Promise<WorkflowToolResponse> {
  if (!isWorkflowSessionResultStatus(run.status)) {
    return { ...run, run };
  }

  const detail = await service.getRunDetail(run.id);
  return {
    ...detail.run,
    run: detail.run,
    sessionResult: buildWorkflowSessionResultEnvelope(detail, run.status)
  };
}

function assertCodexThreadBoundForWorkflowExecution(run: LoopRun): void {
  const codexSession = run.codexSession;
  if (!codexSession || codexSession.mode !== "new_session" || codexSession.threadId || codexSession.threadUrl) {
    return;
  }

  throw new Error(
    `Codex thread must be bound before executing workflow attempts for run ${run.id}. ` +
      "Create a new Codex thread from launchRequest.prompt, call record_codex_thread with the real threadId or threadUrl, then retry execute_workflow_attempt."
  );
}

function isWorkflowSessionResultStatus(status: LoopRun["status"]): status is WorkflowSessionResultStatus {
  return status === "completed" || status === "failed" || status === "waiting_for_human";
}

function buildWorkflowSessionResultEnvelope(
  detail: RunDetail,
  status: WorkflowSessionResultStatus
): WorkflowSessionResultEnvelope {
  const latestTaskRun = latestCompletedTaskRunWithResult(detail);
  const latestVerification = detail.verificationResults.at(-1);
  const latestAttempt = detail.attempts.at(-1);
  const latestOpenHumanRequest = [...detail.humanRequests].reverse().find((request) => request.status === "open");
  const result = detail.run.result ?? latestTaskRun?.result ?? detail.run.summary;
  const finalAnswer =
    status === "waiting_for_human"
      ? latestOpenHumanRequest?.question ?? result ?? latestVerification?.summary ?? latestAttempt?.summary ?? detail.run.goal
      : result ?? latestVerification?.summary ?? latestAttempt?.summary ?? detail.run.goal;
  const summary = result ?? finalAnswer ?? latestVerification?.summary ?? latestAttempt?.summary;

  return {
    status,
    finalAnswer,
    summary,
    ...(result === undefined ? {} : { result }),
    ...(latestVerification
      ? {
          verification: {
            status: latestVerification.status,
            summary: latestVerification.summary,
            checks: latestVerification.checks
          }
        }
      : {}),
    artifacts: detail.artifacts,
    ...(latestOpenHumanRequest
      ? {
          humanRequest: {
            id: latestOpenHumanRequest.id,
            question: latestOpenHumanRequest.question
          }
        }
      : {})
  };
}

function latestCompletedTaskRunWithResult(detail: RunDetail): WorkflowTaskRun | undefined {
  return detail.workflowContexts
    .flatMap((context) => context.taskRuns)
    .filter(
      (taskRun) =>
        taskRun.status === "completed" &&
        taskRun.result !== undefined &&
        !isVerificationTaskStepId(taskRun.stepId)
    )
    .sort((left, right) => workflowTaskRunTimestamp(left).localeCompare(workflowTaskRunTimestamp(right)))
    .at(-1);
}

function workflowTaskRunTimestamp(taskRun: WorkflowTaskRun): string {
  return taskRun.completedAt ?? taskRun.updatedAt ?? taskRun.createdAt;
}

function isVerificationTaskStepId(stepId: string | undefined): boolean {
  return stepId?.startsWith("verification:") ?? false;
}

const toolDefinitions = [
  {
    name: "create_loop_contract",
    title: "Create formal loop contract",
    description: "Create a structured Live Loop contract with workflow body, agent profiles, and verification v2 criteria, validators, and decision policy.",
    schema: createLoopContractObjectSchema
  },
  {
    name: "list_loops",
    title: "List loops",
    description: "List local Dittos loop contracts.",
    schema: emptySchema
  },
  {
    name: "pause_loop",
    title: "Pause loop",
    description: "Pause a local Dittos loop so new visible Codex session runs cannot start.",
    schema: pauseLoopSchema
  },
  {
    name: "resume_loop",
    title: "Resume loop",
    description: "Resume a paused local Dittos loop and clear its consecutive failure stop state.",
    schema: resumeLoopSchema
  },
  {
    name: "approve_runtime_script",
    title: "Approve runtime script",
    description: "Approve the active runtime_script contract so execution can enter the VM.",
    schema: approveRuntimeScriptSchema
  },
  {
    name: "start_codex_session",
    title: "Request Codex session",
    description: "Request a host-created Codex thread for a loop run and record the launch intent.",
    schema: startCodexSessionSchema
  },
  {
    name: "execute_workflow_attempt",
    title: "Execute workflow attempt",
    description:
      "Execute the structured workflow inside an existing visible Codex session attempt. The requested top-level Codex thread must be recorded first with record_codex_thread.",
    schema: executeWorkflowAttemptSchema
  },
  {
    name: "propose_workflow_revision",
    title: "Propose workflow revision",
    description: "Create a draft workflow revision from inside a visible Codex session.",
    schema: proposeWorkflowRevisionObjectSchema
  },
  {
    name: "list_workflow_revisions",
    title: "List workflow revisions",
    description: "List draft, promoted, and rejected workflow revisions for a loop.",
    schema: listWorkflowRevisionsSchema
  },
  {
    name: "promote_workflow_revision",
    title: "Promote workflow revision",
    description: "Make a workflow revision the active loop contract.",
    schema: promoteWorkflowRevisionSchema
  },
  {
    name: "reject_workflow_revision",
    title: "Reject workflow revision",
    description: "Reject a draft workflow revision while keeping it in local history.",
    schema: rejectWorkflowRevisionSchema
  },
  {
    name: "record_codex_thread",
    title: "Record Codex thread",
    description:
      "Attach the real Codex thread metadata after the Codex App host creates the visible session. Pass threadUrl only when the host has a real openable URL.",
    schema: recordCodexThreadSchema
  },
  {
    name: "record_session_result",
    title: "Record session result",
    description: "Write a targeted Codex session result back to the workflow runner; complete, suspend, or resume the workflow as appropriate.",
    schema: recordSessionResultSchema
  },
  {
    name: "record_validator_result",
    title: "Record validator result",
    description: "Record the result of an asynchronous verification v2 validator.",
    schema: recordValidatorResultSchema
  },
  {
    name: "open_codex_session",
    title: "Open Codex session",
    description: "Return the real Codex thread reference, or the launch request when the host thread is still missing.",
    schema: openCodexSessionSchema
  },
  {
    name: "start_attempt",
    title: "Start attempt",
    description: "Start a visible work attempt under a run.",
    schema: startAttemptSchema
  },
  {
    name: "complete_attempt",
    title: "Complete attempt",
    description: "Mark a run attempt completed or failed.",
    schema: completeAttemptSchema
  },
  {
    name: "append_event",
    title: "Append event",
    description: "Append a note or lifecycle event to a run.",
    schema: appendEventSchema
  },
  {
    name: "record_verification",
    title: "Record verification",
    description: "Record verification status and checks for a run.",
    schema: recordVerificationSchema
  },
  {
    name: "record_human_request",
    title: "Record human request",
    description: "Record a question or decision needed from the user.",
    schema: recordHumanRequestSchema
  },
  {
    name: "resolve_human_request",
    title: "Resolve human request",
    description: "Resolve a user question with the user's response.",
    schema: resolveHumanRequestSchema
  },
  {
    name: "read_loop_memory",
    title: "Read loop memory",
    description: "Read a bounded newest-first window of durable loop memory.",
    schema: readLoopMemorySchema
  },
  {
    name: "commit_memory",
    title: "Commit memory",
    description: "Attach a memory summary to a loop.",
    schema: commitMemorySchema
  },
  {
    name: "add_artifact",
    title: "Add artifact",
    description: "Attach a local path or URL artifact to a run.",
    schema: addArtifactSchema
  },
  {
    name: "mark_run_repairing",
    title: "Mark run repairing",
    description: "Move a run into repair state.",
    schema: markRunRepairingSchema
  },
  {
    name: "complete_run",
    title: "Complete run",
    description: "Mark a run completed or failed.",
    schema: completeRunSchema
  },
  {
    name: "get_run_detail",
    title: "Get run detail",
    description: "Return the composed detail view for a run.",
    schema: getRunDetailSchema
  },
  {
    name: "get_snapshot",
    title: "Get snapshot",
    description: "Return the complete local Dittos loop snapshot.",
    schema: emptySchema
  },
  {
    name: "get_preview_url",
    title: "Get preview URL",
    description: "Return the local preview URL for Codex's in-app browser.",
    schema: emptySchema
  }
] as const;
