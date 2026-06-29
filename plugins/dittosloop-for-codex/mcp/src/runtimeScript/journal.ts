import { createId } from "../id.js";
import { LoopStore } from "../store.js";
import type { RuntimeScriptJournalRecord } from "../types.js";

export interface RuntimeScriptJournal {
  get(key: string): Promise<RuntimeScriptJournalRecord | undefined>;
  recordCompleted(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord>;
  recordFailed(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord>;
}

export type RuntimeScriptJournalRecordInput = Omit<
  RuntimeScriptJournalRecord,
  "id" | "createdAt" | "updatedAt" | "key" | "promptHash" | "optionsHash" | "scriptHash" | "argsHash"
> & {
  source: string;
  args: unknown;
  prompt: string;
  options: unknown;
  scriptHash: string;
  argsHash: string;
  promptHash: string;
  optionsHash: string;
  key?: string;
};

class LoopStoreRuntimeScriptJournal implements RuntimeScriptJournal {
  constructor(
    private readonly store: LoopStore,
    private readonly now: () => string = () => new Date().toISOString()
  ) {}

  async get(key: string): Promise<RuntimeScriptJournalRecord | undefined> {
    const state = await this.store.readState();
    return state.runtimeScriptJournals.find((record) => record.key === key);
  }

  async recordCompleted(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    return this.upsert({
      ...input,
      status: "completed"
    });
  }

  async recordFailed(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    return this.upsert({
      ...input,
      status: "failed"
    });
  }

  private async upsert(
    input: Omit<RuntimeScriptJournalRecord, "id" | "createdAt" | "updatedAt">
  ): Promise<RuntimeScriptJournalRecord> {
    const timestamp = this.now();
    let storedRecord!: RuntimeScriptJournalRecord;

    await this.store.updateState((state) => {
      const existing = state.runtimeScriptJournals.find((record) => record.key === input.key);
      storedRecord = {
        ...input,
        id: existing?.id ?? createId("journal"),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp
      };

      return {
        ...state,
        runtimeScriptJournals: existing
          ? state.runtimeScriptJournals.map((record) => (record.key === input.key ? storedRecord : record))
          : [...state.runtimeScriptJournals, storedRecord]
      };
    });

    return storedRecord;
  }
}

export function createLoopStoreRuntimeScriptJournal(store: LoopStore): RuntimeScriptJournal {
  return new LoopStoreRuntimeScriptJournal(store);
}
