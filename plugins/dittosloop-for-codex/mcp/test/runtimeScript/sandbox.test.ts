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
    const starts: string[] = [];
    const waiters: Array<() => void> = [];
    const waitForAllStarted = () =>
      starts.length >= 3
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          });
    const markStart = (label: string) => {
      starts.push(label);
      if (starts.length === 3) {
        waiters.splice(0).forEach((resolve) => resolve());
      }
    };

    await expect(runRuntimeScriptInVm(createRunInput({
      source: `
        return await parallel([
          async () => {
            args.markStart("a");
            await args.waitForAllStarted();
            return "a:done";
          },
          async () => {
            args.markStart("b");
            await args.waitForAllStarted();
            return "b:done";
          },
          async () => {
            args.markStart("c");
            await args.waitForAllStarted();
            return "c:done";
          }
        ]);
      `,
      args: { markStart, waitForAllStarted }
    }))).resolves.toEqual(["a:done", "b:done", "c:done"]);
    expect(starts).toEqual(["a", "b", "c"]);
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
});
