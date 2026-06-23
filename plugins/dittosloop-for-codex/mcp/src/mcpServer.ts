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

const createLoopSchema = z.object({
  title: z.string().min(1),
  intent: z.string().min(1),
  verificationChecks: z.array(z.string().min(1)).optional()
});

const triggerRunSchema = z.object({
  loopId: z.string().min(1),
  goal: z.string().optional()
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
  status: verificationStatusSchema,
  summary: z.string().min(1),
  checks: z.array(verificationCheckSchema).optional()
});

const recordHumanRequestSchema = z.object({
  runId: z.string().min(1),
  question: z.string().min(1)
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

const emptySchema = z.object({});

export function createToolHandlers(service: LoopService): ToolHandlerMap {
  return {
    create_loop: async (input) => {
      const args = createLoopSchema.parse(input);
      return toToolResult(await service.createLoop(args));
    },
    list_loops: async () => toToolResult(await service.listLoops()),
    trigger_run: async (input) => {
      const args = triggerRunSchema.parse(input);
      return toToolResult(await service.triggerRun(args.loopId, { goal: args.goal }));
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
    name: "create_loop",
    title: "Create loop",
    description: "Create a local Dittos loop contract.",
    schema: createLoopSchema
  },
  {
    name: "list_loops",
    title: "List loops",
    description: "List local Dittos loop contracts.",
    schema: emptySchema
  },
  {
    name: "trigger_run",
    title: "Trigger run",
    description: "Start a manual run for a loop.",
    schema: triggerRunSchema
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
    name: "complete_run",
    title: "Complete run",
    description: "Mark a run completed or failed.",
    schema: completeRunSchema
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
