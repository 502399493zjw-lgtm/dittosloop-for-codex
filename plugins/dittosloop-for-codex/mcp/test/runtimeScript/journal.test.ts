import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { LoopStore } from "../../src/store.js";
import {
  createLoopStoreRuntimeScriptJournal,
  type RuntimeScriptJournalRecordInput
} from "../../src/runtimeScript/journal.js";
import {
  hashRuntimeScriptArgs,
  hashRuntimeScriptOptions,
  hashRuntimeScriptPrompt,
  hashRuntimeScriptSource,
  runtimeAgentJournalKey
} from "../../src/runtimeScript/hash.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-runtime-script-journal-"));
  tempDirs.push(dir);
  return dir;
}

function buildRecordInput(overrides: Partial<RuntimeScriptJournalRecordInput> = {}): RuntimeScriptJournalRecordInput {
  const source = overrides.source ?? "return await agent('Summarize changes', { label: 'summary' });";
  const args = overrides.args ?? { branch: "main", files: ["README.md"] };
  const prompt = overrides.prompt ?? "Summarize the latest changes.";
  const options = overrides.options ?? { label: "summary", timeoutMs: 60_000 };

  return {
    loopId: overrides.loopId ?? "loop_1",
    runId: overrides.runId ?? "run_1",
    attemptId: overrides.attemptId ?? "attempt_1",
    workflowContextId: overrides.workflowContextId ?? "workflow_1",
    contractId: overrides.contractId ?? "contract_1",
    source,
    scriptHash: overrides.scriptHash ?? hashRuntimeScriptSource(source),
    args,
    argsHash: overrides.argsHash ?? hashRuntimeScriptArgs(args),
    callSite: overrides.callSite ?? "phase.collect.agent.summary",
    prompt,
    promptHash: overrides.promptHash ?? hashRuntimeScriptPrompt(prompt),
    options,
    optionsHash: overrides.optionsHash ?? hashRuntimeScriptOptions(options),
    status: overrides.status ?? "completed",
    output: "output" in overrides ? overrides.output : "Done.",
    error: overrides.error,
    sessionId: overrides.sessionId ?? "session_1"
  };
}

function buildKey(input: RuntimeScriptJournalRecordInput): string {
  return runtimeAgentJournalKey({
    contractId: input.contractId,
    scriptHash: input.scriptHash,
    argsHash: input.argsHash,
    callSite: input.callSite,
    prompt: input.prompt,
    options: input.options
  });
}

describe("runtime script journal", () => {
  test("same script, args, call site, prompt, and options hits cache", async () => {
    const dir = await createTempDir();
    const journal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput();

    const created = await journal.recordCompleted({
      ...recordInput,
      key: buildKey(recordInput)
    });

    await expect(journal.get(created.key)).resolves.toMatchObject({
      key: created.key,
      status: "completed",
      output: "Done."
    });
  });

  test("changed args misses cache", async () => {
    const dir = await createTempDir();
    const journal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput();

    await journal.recordCompleted({
      ...recordInput,
      key: buildKey(recordInput)
    });

    const changedArgs = buildRecordInput({
      args: { branch: "release", files: ["README.md"] }
    });

    await expect(journal.get(buildKey(changedArgs))).resolves.toBeUndefined();
  });

  test("changed prompt misses cache", async () => {
    const dir = await createTempDir();
    const journal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput();

    await journal.recordCompleted({
      ...recordInput,
      key: buildKey(recordInput)
    });

    const changedPrompt = buildRecordInput({
      prompt: "Summarize the latest changes in one sentence."
    });

    await expect(journal.get(buildKey(changedPrompt))).resolves.toBeUndefined();
  });

  test("changed options misses cache", async () => {
    const dir = await createTempDir();
    const journal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput();

    await journal.recordCompleted({
      ...recordInput,
      key: buildKey(recordInput)
    });

    const changedOptions = buildRecordInput({
      options: { label: "summary", timeoutMs: 90_000 }
    });

    await expect(journal.get(buildKey(changedOptions))).resolves.toBeUndefined();
  });

  test("failed records are not reused as successful outputs", async () => {
    const dir = await createTempDir();
    const journal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput({
      status: "failed",
      output: undefined,
      error: "subagent crashed"
    });

    await journal.recordFailed({
      ...recordInput,
      key: buildKey(recordInput)
    });

    const failedRecord = await journal.get(buildKey(buildRecordInput()));

    expect(failedRecord?.status).toBe("failed");
    expect(failedRecord?.output).toBeUndefined();
    expect(failedRecord?.error).toBe("subagent crashed");
  });

  test("journal entries survive creating a new LoopStore pointing at the same temp data dir", async () => {
    const dir = await createTempDir();
    const firstJournal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));
    const recordInput = buildRecordInput();
    const key = buildKey(recordInput);

    await firstJournal.recordCompleted({
      ...recordInput,
      key
    });

    const secondJournal = createLoopStoreRuntimeScriptJournal(new LoopStore(dir));

    await expect(secondJournal.get(key)).resolves.toMatchObject({
      key,
      status: "completed",
      output: "Done."
    });
  });
});
