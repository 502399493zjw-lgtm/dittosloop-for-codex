import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createToolHandlers, registerDittosLoopTools } from "../src/mcpServer.js";
import { LoopService } from "../src/service.js";
import { LoopStore } from "../src/store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createHandlers() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-mcp-"));
  tempDirs.push(dir);

  const service = new LoopService({
    store: new LoopStore(dir),
    now: () => "2026-06-23T00:00:00.000Z",
    createId: (prefix) => `${prefix}_1`,
    previewBaseUrl: "http://127.0.0.1:47888"
  });

  return createToolHandlers(service);
}

test("exposes loop operations as MCP content", async () => {
  const handlers = await createHandlers();

  const loop = readResult(await handlers.create_loop({
    title: "Daily code health check",
    intent: "Keep the project healthy",
    verificationChecks: ["npm test"]
  }));
  const run = readResult(await handlers.trigger_run({ loopId: loop.id, goal: "Check tests" }));
  await handlers.append_event({ runId: run.id, message: "Started checks" });
  await handlers.record_verification({ runId: run.id, status: "passed", summary: "Tests passed" });

  const snapshot = readResult(await handlers.get_snapshot({}));

  expect(snapshot).toMatchObject({
    loops: [{ id: "loop_1", title: "Daily code health check" }],
    runs: [{ id: "run_1", loopId: "loop_1" }],
    events: [{ id: "event_1", message: "Started checks" }],
    verificationResults: [{ id: "verification_1", status: "passed" }]
  });
});

test("registers the DittosLoop tool surface", () => {
  const registeredTools: string[] = [];
  const fakeServer = {
    registerTool(name: string) {
      registeredTools.push(name);
    }
  };

  registerDittosLoopTools(fakeServer, {} as ReturnType<typeof createToolHandlers>);

  expect(registeredTools).toEqual([
    "create_loop",
    "list_loops",
    "trigger_run",
    "append_event",
    "record_verification",
    "record_human_request",
    "commit_memory",
    "add_artifact",
    "complete_run",
    "get_snapshot",
    "get_preview_url"
  ]);
});

function readResult(result: { content: Array<{ type: "text"; text: string }> }) {
  return JSON.parse(result.content[0].text);
}
