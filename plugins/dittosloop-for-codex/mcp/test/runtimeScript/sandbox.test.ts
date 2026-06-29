import { spawn } from "node:child_process";

import { describe, expect, test } from "vitest";

import { runRuntimeScriptInVm } from "../../src/runtimeScript/sandbox.js";
import type { RuntimeScriptJournal } from "../../src/runtimeScript/journal.js";
import type {
  RuntimeScriptEventInput,
  RuntimeScriptRunInput,
  WorkflowSubagentBridge,
  WorkflowSubagentInput,
  WorkflowSubagentResult
} from "../../src/runtimeScript/types.js";
import type { RuntimeScriptJournalRecord } from "../../src/types.js";

class FakeSubagentBridge implements WorkflowSubagentBridge {
  readonly calls: WorkflowSubagentInput[] = [];
  responses: Array<WorkflowSubagentResult | (() => Promise<WorkflowSubagentResult>)> = [];

  constructor(responses: Array<WorkflowSubagentResult | (() => Promise<WorkflowSubagentResult>)> = []) {
    this.responses = responses;
  }

  async runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult> {
    this.calls.push(input);
    const next = this.responses.shift();
    return typeof next === "function"
      ? next()
      : next ?? { status: "completed", output: input.prompt };
  }
}

class MemoryRuntimeScriptJournal implements RuntimeScriptJournal {
  readonly records = new Map<string, RuntimeScriptJournalRecord>();

  async get(key: string): Promise<RuntimeScriptJournalRecord | undefined> {
    return this.records.get(key);
  }

  async recordCompleted(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    return this.upsert(input);
  }

  async recordFailed(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    return this.upsert(input);
  }

  private async upsert(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    const existing = this.records.get(input.key);
    const record: RuntimeScriptJournalRecord = {
      ...input,
      id: existing?.id ?? `journal_${this.records.size + 1}`,
      createdAt: existing?.createdAt ?? "2026-06-29T00:00:00.000Z",
      updatedAt: "2026-06-29T00:00:00.000Z"
    };
    this.records.set(input.key, record);
    return record;
  }
}

function completed(output: string): WorkflowSubagentResult {
  return { status: "completed", output };
}

function createRunInput(overrides: Partial<RuntimeScriptRunInput> = {}): RuntimeScriptRunInput {
  return {
    runId: "run_1",
    attemptId: "attempt_1",
    workflowContextId: "workflow_1",
    contractId: "contract_1",
    source: 'return await agent("hello");',
    args: {},
    limits: {
      timeoutMs: 10_000,
      maxAgentCalls: 10,
      maxParallelBranches: 4,
      maxPipelineItems: 10,
      maxLogChars: 1_000
    },
    journal: new MemoryRuntimeScriptJournal(),
    subagentBridge: new FakeSubagentBridge([completed("hello from bridge")]),
    now: () => "2026-06-29T00:00:00.000Z",
    ...overrides
  };
}

describe("runRuntimeScriptInVm", () => {
  test('return await agent("hello") returns fake bridge output', async () => {
    const bridge = new FakeSubagentBridge([completed("hello from bridge")]);

    await expect(runRuntimeScriptInVm(createRunInput({ subagentBridge: bridge }))).resolves.toBe("hello from bridge");
    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]).toMatchObject({
      prompt: "hello",
      callSite: expect.stringMatching(/^agent:1:/)
    });
  });

  test("parallel starts all branches before awaiting results", async () => {
    const bridge = new class implements WorkflowSubagentBridge {
      readonly calls: WorkflowSubagentInput[] = [];
      private release!: () => void;
      private readonly allStarted = new Promise<void>((resolve) => {
        this.release = resolve;
      });

      async runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult> {
        this.calls.push(input);
        if (this.calls.length === 3) {
          this.release();
        }
        await this.allStarted;
        return completed(`${input.prompt}:done`);
      }
    };

    await expect(runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          () => agent("a"),
          () => agent("b"),
          () => agent("c")
        ]);
      `,
      subagentBridge: bridge
    }))).resolves.toEqual(["a:done", "b:done", "c:done"]);
    expect(bridge.calls.map((call) => call.prompt)).toEqual(["a", "b", "c"]);
  });

  test("parallel preserves result order", async () => {
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          async () => "first",
          async () => "second",
          async () => "third"
        ]);
      `
    }));

    expect(result).toEqual(["first", "second", "third"]);
  });

  test("pipeline returns one result per input item", async () => {
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await pipeline(
          args.items,
          [
            async (item) => item + "-extract",
            async (item) => item + "-verify"
          ]
        );
      `,
      args: { items: ["a", "b", "c"] }
    }));

    expect(result).toEqual(["a-extract-verify", "b-extract-verify", "c-extract-verify"]);
  });

  test("parallel and pipeline events include count", async () => {
    const events: RuntimeScriptEventInput[] = [];

    await runRuntimeScriptInVm(createRunInput({
      source: `
        await parallel([
          async () => "a",
          async () => "b"
        ], { label: "branches" });
        return await pipeline(
          args.items,
          [
            async (item) => item
          ],
          { label: "items" }
        );
      `,
      args: { items: ["one", "two", "three"] },
      emit: (event) => events.push(event)
    }));

    expect(events.find((event) => event.type === "runtime_parallel_started")?.data).toMatchObject({ count: 2 });
    expect(events.find((event) => event.type === "runtime_parallel_completed")?.data).toMatchObject({ count: 2 });
    expect(events.find((event) => event.type === "runtime_pipeline_started")?.data).toMatchObject({ count: 3 });
    expect(events.find((event) => event.type === "runtime_pipeline_completed")?.data).toMatchObject({ count: 3 });
  });

  test("if and for JavaScript control flow can decide later agent calls", async () => {
    const bridge = new FakeSubagentBridge([completed("yes"), completed("a"), completed("b")]);

    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        const gate = await agent("gate");
        const results = [];
        if (/yes/i.test(gate)) {
          for (const item of args.items) {
            results.push(await agent("review " + item, { label: item }));
          }
        }
        return results;
      `,
      args: { items: ["a", "b"] },
      subagentBridge: bridge
    }));

    expect(result).toEqual(["a", "b"]);
    expect(bridge.calls.map((call) => call.prompt)).toEqual(["gate", "review a", "review b"]);
  });

  test("cache hit avoids a second bridge call", async () => {
    const journal = new MemoryRuntimeScriptJournal();
    const source = 'return await agent("cached", { label: "cache me" });';
    const firstBridge = new FakeSubagentBridge([completed("from first run")]);

    await expect(runRuntimeScriptInVm(createRunInput({ source, journal, subagentBridge: firstBridge }))).resolves.toBe(
      "from first run"
    );

    const secondBridge = new FakeSubagentBridge([
      async () => {
        throw new Error("bridge should not be called on cache hit");
      }
    ]);
    const events: RuntimeScriptEventInput[] = [];

    await expect(runRuntimeScriptInVm(createRunInput({
      source,
      journal,
      subagentBridge: secondBridge,
      emit: (event) => events.push(event)
    }))).resolves.toBe("from first run");

    expect(secondBridge.calls).toHaveLength(0);
    expect(events.some((event) => event.type === "agent:cached")).toBe(true);
  });

  test("max agent calls is enforced", async () => {
    const bridge = new FakeSubagentBridge([completed("one")]);

    await expect(runRuntimeScriptInVm(createRunInput({
      source: `
        await agent("one");
        return await agent("two");
      `,
      limits: {
        timeoutMs: 10_000,
        maxAgentCalls: 1,
        maxParallelBranches: 4,
        maxPipelineItems: 10,
        maxLogChars: 1_000
      },
      subagentBridge: bridge
    }))).rejects.toThrow(/maxAgentCalls/i);

    expect(bridge.calls).toHaveLength(1);
  });

  test("max parallel branches is enforced", async () => {
    await expect(runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          async () => "a",
          async () => "b"
        ]);
      `,
      limits: {
        timeoutMs: 10_000,
        maxAgentCalls: 10,
        maxParallelBranches: 1,
        maxPipelineItems: 10,
        maxLogChars: 1_000
      }
    }))).rejects.toThrow(/maxParallelBranches/i);
  });

  test("validation failure prevents execution", async () => {
    const bridge = new FakeSubagentBridge([completed("should not run")]);

    await expect(runRuntimeScriptInVm(createRunInput({
      source: 'return require("fs");',
      subagentBridge: bridge
    }))).rejects.toThrow(/failed validation/i);

    expect(bridge.calls).toHaveLength(0);
  });

  test("async CPU loop after agent is terminated by timeout without hanging the parent process", async () => {
    const result = await runTimeoutProbeChildProcess();

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Runtime script timed out");
  }, 10_000);
});

function runTimeoutProbeChildProcess(): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> {
  const childSource = `
    import { runRuntimeScriptInVm } from "./src/runtimeScript/sandbox.ts";

    class MemoryRuntimeScriptJournal {
      records = new Map();
      async get(key) {
        return this.records.get(key);
      }
      async recordCompleted(input) {
        return this.upsert(input);
      }
      async recordFailed(input) {
        return this.upsert(input);
      }
      async upsert(input) {
        const record = {
          ...input,
          id: "journal_1",
          createdAt: "2026-06-29T00:00:00.000Z",
          updatedAt: "2026-06-29T00:00:00.000Z"
        };
        this.records.set(input.key, record);
        return record;
      }
    }

    const input = {
      runId: "run_timeout",
      attemptId: "attempt_timeout",
      workflowContextId: "workflow_timeout",
      contractId: "contract_timeout",
      source: 'await agent("ok"); while (true) {}',
      args: {},
      limits: {
        timeoutMs: 100,
        maxAgentCalls: 2,
        maxParallelBranches: 2,
        maxPipelineItems: 2,
        maxLogChars: 100
      },
      journal: new MemoryRuntimeScriptJournal(),
      subagentBridge: {
        async runAgent() {
          return { status: "completed", output: "ok" };
        }
      },
      now: () => "2026-06-29T00:00:00.000Z"
    };

    try {
      await runRuntimeScriptInVm(input);
      console.log("resolved unexpectedly");
      process.exit(2);
    } catch (error) {
      console.log(error instanceof Error ? error.message : String(error));
      process.exit(/Runtime script timed out/.test(String(error instanceof Error ? error.message : error)) ? 0 : 3);
    }
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childSource], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  const killTimer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGKILL");
  }, 1_500);

  child.stdout.on("data", (chunk) => {
    stdout += String(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  return new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(killTimer);
      resolve({ code, signal, stdout, stderr, timedOut });
    });
  });
}
