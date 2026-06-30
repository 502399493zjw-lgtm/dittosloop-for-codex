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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

  test("agent uses explicit key as replay call site", async () => {
    const bridge = new FakeSubagentBridge([completed("reviewed")]);

    await expect(runRuntimeScriptInVm(createRunInput({
      source: 'return await agent("review a.ts", { key: "review:a.ts", label: "Review A" });',
      subagentBridge: bridge
    }))).resolves.toBe("reviewed");

    expect(bridge.calls).toHaveLength(1);
    expect(bridge.calls[0]).toMatchObject({
      prompt: "review a.ts",
      label: "Review A",
      callSite: "review:a.ts"
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

  test("parallel accepts varargs branch functions", async () => {
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel(
          async () => "first",
          async () => "second",
          async () => "third"
        );
      `
    }));

    expect(result).toEqual(["first", "second", "third"]);
  });

  test("parallel keeps array form with options object", async () => {
    const events: RuntimeScriptEventInput[] = [];
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          async () => "alpha",
          async () => "beta"
        ], { label: "branches" });
      `,
      emit: (event) => events.push(event)
    }));

    expect(result).toEqual(["alpha", "beta"]);
    expect(events.find((event) => event.type === "runtime_parallel_started")?.data).toMatchObject({
      label: "branches",
      count: 2
    });
  });

  test("parallel isolates handled failed agent branches and records the failure", async () => {
    const bridge = new FakeSubagentBridge([
      completed("one"),
      { status: "failed", error: "boom" },
      completed("two")
    ]);
    const journal = new MemoryRuntimeScriptJournal();
    const events: RuntimeScriptEventInput[] = [];

    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          () => agent("ok", { key: "ok" }),
          () => agent("fail", { key: "fail" }),
          () => agent("ok2", { key: "ok2" })
        ]);
      `,
      journal,
      subagentBridge: bridge,
      emit: (event) => events.push(event)
    }));

    expect(result).toEqual(["one", null, "two"]);
    expect(bridge.calls.map((call) => call.prompt)).toEqual(["ok", "fail", "ok2"]);
    expect(Array.from(journal.records.values())).toEqual(expect.arrayContaining([
      expect.objectContaining({
        callSite: "fail",
        status: "failed",
        error: "boom"
      })
    ]));
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "agent:error",
        data: expect.objectContaining({
          callSite: "fail",
          status: "failed",
          error: "boom"
        })
      })
    ]));
  });

  test("parallel throttles branch concurrency to maxParallelBranches and preserves order", async () => {
    const ids = Array.from({ length: 10 }, (_, index) => `item-${index + 1}`);
    const bridge = new class implements WorkflowSubagentBridge {
      readonly calls: WorkflowSubagentInput[] = [];
      inFlight = 0;
      maxInFlight = 0;

      async runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult> {
        this.calls.push(input);
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await sleep(10);
        this.inFlight -= 1;
        return completed(`${input.prompt}:done`);
      }
    };

    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel(
          args.ids.map((id) => () => agent("Work " + id, { key: "work:" + id }))
        );
      `,
      args: { ids },
      limits: {
        timeoutMs: 10_000,
        maxAgentCalls: 20,
        maxParallelBranches: 3,
        maxPipelineItems: 10,
        maxLogChars: 1_000
      },
      subagentBridge: bridge
    }));

    expect(result).toEqual(ids.map((id) => `Work ${id}:done`));
    expect(bridge.calls).toHaveLength(10);
    expect(bridge.maxInFlight).toBe(3);
    expect(bridge.calls.map((call) => call.prompt)).toEqual(ids.map((id) => `Work ${id}`));
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

  test("pipeline accepts varargs stage functions", async () => {
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await pipeline(
          args.items,
          async (item) => item + "-extract",
          async (item) => item + "-verify"
        );
      `,
      args: { items: ["a", "b", "c"] }
    }));

    expect(result).toEqual(["a-extract-verify", "b-extract-verify", "c-extract-verify"]);
    expect(Array.isArray(result)).toBe(true);
    expect((result as string[])).toHaveLength(3);
  });

  test("pipeline stage callbacks receive previous value, original item, and item index", async () => {
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await pipeline(
          args.items,
          async (item, originalItem, index) => ({
            step: "extract",
            previousValue: item,
            originalItem,
            index
          }),
          async (previousValue, originalItem, index) => ({
            step: "verify",
            previousValue,
            originalItem,
            index
          })
        );
      `,
      args: { items: ["a", "b"] }
    }));

    expect(result).toEqual([
      {
        step: "verify",
        previousValue: {
          step: "extract",
          previousValue: "a",
          originalItem: "a",
          index: 0
        },
        originalItem: "a",
        index: 0
      },
      {
        step: "verify",
        previousValue: {
          step: "extract",
          previousValue: "b",
          originalItem: "b",
          index: 1
        },
        originalItem: "b",
        index: 1
      }
    ]);
  });

  test("pipeline keeps array form with options object", async () => {
    const events: RuntimeScriptEventInput[] = [];
    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await pipeline(
          args.items,
          [
            async (item) => item + "-done"
          ],
          { label: "items" }
        );
      `,
      args: { items: ["a", "b", "c"] },
      emit: (event) => events.push(event)
    }));

    expect(result).toEqual(["a-done", "b-done", "c-done"]);
    expect(events.find((event) => event.type === "runtime_pipeline_started")?.data).toMatchObject({
      label: "items",
      count: 3,
      stages: 1
    });
  });

  test("pipeline throttles item execution to maxParallelBranches and preserves stage order", async () => {
    const items = ["a", "b", "c", "d", "e"];
    const bridge = new class implements WorkflowSubagentBridge {
      readonly calls: WorkflowSubagentInput[] = [];
      inFlight = 0;
      maxInFlight = 0;

      async runAgent(input: WorkflowSubagentInput): Promise<WorkflowSubagentResult> {
        this.calls.push(input);
        this.inFlight += 1;
        this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
        await sleep(10);
        this.inFlight -= 1;
        return completed(input.prompt);
      }
    };

    const result = await runRuntimeScriptInVm(createRunInput({
      source: `
        return await pipeline(
          args.items,
          async (item) => agent("extract:" + item, { key: "extract:" + item }),
          async (previous) => agent("verify:" + previous, { key: "verify:" + previous })
        );
      `,
      args: { items },
      limits: {
        timeoutMs: 10_000,
        maxAgentCalls: 20,
        maxParallelBranches: 2,
        maxPipelineItems: 10,
        maxLogChars: 1_000
      },
      subagentBridge: bridge
    }));

    expect(result).toEqual(items.map((item) => `verify:extract:${item}`));
    expect(bridge.maxInFlight).toBe(2);
    expect(bridge.calls).toHaveLength(10);
    expect(bridge.calls.map((call) => call.prompt)).toEqual([
      "extract:a",
      "extract:b",
      "verify:extract:a",
      "verify:extract:b",
      "extract:c",
      "extract:d",
      "verify:extract:c",
      "verify:extract:d",
      "extract:e",
      "verify:extract:e"
    ]);
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

  test("successful runtime script child process exits naturally after worker completes", async () => {
    const result = await runNaturalExitProbeChildProcess();

    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.signal).toBeNull();
    expect(result.stdout).toContain('"result":"ok"');
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

function runNaturalExitProbeChildProcess(): Promise<{
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
      runId: "run_success",
      attemptId: "attempt_success",
      workflowContextId: "workflow_success",
      contractId: "contract_success",
      source: 'return await agent("ok");',
      args: {},
      limits: {
        timeoutMs: 1_000,
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
      const result = await runRuntimeScriptInVm(input);
      console.log(JSON.stringify({ result }));
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 3;
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
