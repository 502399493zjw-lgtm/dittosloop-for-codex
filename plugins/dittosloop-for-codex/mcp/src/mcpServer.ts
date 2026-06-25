import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { LoopService } from "./service.js";

export interface TextToolResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
}

export type ToolHandler = (input: unknown) => Promise<TextToolResult>;
export type ToolHandlerMap = Record<string, ToolHandler>;

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

const agentStepSchema = z.object({
  id: z.string().min(1),
  kind: z.literal("agent"),
  label: z.string().min(1),
  prompt: z.string().min(1),
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
  verifierRef: z.string().optional(),
  sessionPolicy: z.literal("new").optional(),
  outputSchema: z.record(z.unknown()).optional(),
  subagent: subagentSchema.optional()
});

type StepSchema = z.infer<typeof agentStepSchema> | z.infer<typeof taskStepSchema> | {
  id: string;
  kind: "phase" | "parallel";
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

const createLoopContractSchema = z.object({
  id: z.string().min(1).optional(),
  title: z.string().min(1),
  goal: z.string().min(1),
  intent: z.string().optional(),
  body: z.object({ steps: z.array(stepSchema).min(1) }),
  verification: z.object({
    mode: z.enum(["after_workflow", "after_each_agent"]),
    rubrics: z.array(z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      requirement: z.string().min(1),
      severity: z.enum(["must", "should"])
    }))
  }),
  repairPolicy: z.object({
    maxAttempts: z.number().int().nonnegative(),
    strategy: z.enum(["repair_then_retry", "ask_human", "fail_run"])
  }).optional(),
  stopPolicy: z.object({
    rule: z.string().min(1),
    maxConsecutiveFailures: z.number().int().nonnegative().optional()
  }).optional(),
  projectBinding: z.object({
    codexProjectId: z.string().optional(),
    projectLabel: z.string().optional(),
    projectPath: z.string().optional()
  }).optional()
});

const startCodexSessionSchema = z.object({
  loopId: z.string().min(1),
  goal: z.string().optional(),
  codexProjectId: z.string().optional(),
  projectLabel: z.string().optional(),
  projectPath: z.string().optional()
});

const executeWorkflowAttemptSchema = z.object({
  runId: z.string().min(1),
  attemptId: z.string().min(1).optional()
});

const proposeWorkflowRevisionSchema = z.object({
  loopId: z.string().min(1),
  runId: z.string().min(1),
  attemptId: z.string().min(1),
  authorSessionId: z.string().min(1).optional(),
  authorThreadId: z.string().min(1).optional(),
  reason: z.string().min(1).optional(),
  rationale: z.string().min(1).optional(),
  contract: createLoopContractSchema.optional(),
  patch: createLoopContractSchema.partial().optional()
}).refine((value) => Boolean(value.reason || value.rationale), {
  message: "reason or rationale is required"
}).refine((value) => Boolean(value.contract || value.patch), {
  message: "contract or patch is required"
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
  threadUrl: z.string().optional()
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

const addArtifactSchema = z.object({
  runId: z.string().min(1),
  title: z.string().min(1),
  path: z.string().optional(),
  url: z.string().url().optional(),
  kind: z.string().optional()
});

const completeRunSchema = z.object({
  runId: z.string().min(1),
  status: z.enum(["completed", "failed"]).optional()
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
    start_codex_session: async (input) => {
      const args = startCodexSessionSchema.parse(input);
      return toToolResult(await service.startCodexSessionRun(args.loopId, {
        goal: args.goal,
        codexProjectId: args.codexProjectId,
        projectLabel: args.projectLabel,
        projectPath: args.projectPath
      }));
    },
    execute_workflow_attempt: async (input) => {
      const args = executeWorkflowAttemptSchema.parse(input);
      return toToolResult(await service.executeWorkflowAttempt(args.runId, {
        attemptId: args.attemptId
      }));
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
      return toToolResult(await service.recordSessionResult(args.runId, {
        workflowContextId: args.workflowContextId,
        attemptId: args.attemptId,
        taskRunId: args.taskRunId,
        sessionId: args.sessionId,
        stepId: args.stepId,
        idempotencyKey: args.idempotencyKey,
        status: args.status,
        summary: args.summary,
        result: args.result,
        checks: args.checks,
        humanQuestion: args.humanQuestion
      }));
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
      return toToolResult(await service.completeRun(args.runId, { status: args.status }));
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
    version: "0.1.0"
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

const toolDefinitions = [
  {
    name: "create_loop_contract",
    title: "Create formal loop contract",
    description: "Create a structured Live Loop contract with workflow body and verification rubrics.",
    schema: createLoopContractSchema
  },
  {
    name: "list_loops",
    title: "List loops",
    description: "List local Dittos loop contracts.",
    schema: emptySchema
  },
  {
    name: "start_codex_session",
    title: "Start Codex session",
    description: "Request a new Codex session for a loop run and record the launch intent.",
    schema: startCodexSessionSchema
  },
  {
    name: "execute_workflow_attempt",
    title: "Execute workflow attempt",
    description: "Execute the structured workflow inside an existing visible Codex session attempt.",
    schema: executeWorkflowAttemptSchema
  },
  {
    name: "propose_workflow_revision",
    title: "Propose workflow revision",
    description: "Create a draft workflow revision from inside a visible Codex session.",
    schema: proposeWorkflowRevisionSchema
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
    description: "Attach a Codex thread id after the Codex App host creates the visible session.",
    schema: recordCodexThreadSchema
  },
  {
    name: "record_session_result",
    title: "Record session result",
    description: "Write a targeted Codex session result back to the workflow runner; complete, suspend, or resume the workflow as appropriate.",
    schema: recordSessionResultSchema
  },
  {
    name: "open_codex_session",
    title: "Open Codex session",
    description: "Return the real Codex thread reference for a run when the host has created it.",
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
