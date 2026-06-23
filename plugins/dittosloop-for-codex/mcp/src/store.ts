import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { LoopState } from "./types.js";

const STATE_FILE = "state.json";

export function createEmptyState(): LoopState {
  return {
    version: 1,
    loops: [],
    runs: [],
    attempts: [],
    events: [],
    verificationResults: [],
    humanRequests: [],
    memoryCommits: [],
    artifacts: []
  };
}

export class LoopStore {
  private readonly statePath: string;

  constructor(private readonly dataDir: string) {
    this.statePath = join(dataDir, STATE_FILE);
  }

  async readState(): Promise<LoopState> {
    try {
      const raw = await readFile(this.statePath, "utf8");
      return normalizeState(JSON.parse(raw));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return createEmptyState();
      }

      throw error;
    }
  }

  async updateState(mutator: (state: LoopState) => LoopState | Promise<LoopState>): Promise<LoopState> {
    const current = await this.readState();
    const next = normalizeState(await mutator(current));

    await this.writeState(next);

    return next;
  }

  private async writeState(state: LoopState): Promise<void> {
    await mkdir(this.dataDir, { recursive: true });

    const tempPath = `${this.statePath}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    await rename(tempPath, this.statePath);
  }
}

function normalizeState(value: Partial<LoopState> | undefined): LoopState {
  return {
    ...createEmptyState(),
    ...value,
    version: 1,
    loops: value?.loops ?? [],
    runs: value?.runs ?? [],
    attempts: value?.attempts ?? [],
    events: value?.events ?? [],
    verificationResults: value?.verificationResults ?? [],
    humanRequests: (value?.humanRequests ?? []).map((request) => ({
      ...request,
      status: request.status ?? "open"
    })),
    memoryCommits: value?.memoryCommits ?? [],
    artifacts: value?.artifacts ?? []
  };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
