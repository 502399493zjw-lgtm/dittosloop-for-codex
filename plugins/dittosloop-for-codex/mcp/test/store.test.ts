import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { createEmptyState, LoopStore } from "../src/store.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createTempDir() {
  const dir = await mkdtemp(join(tmpdir(), "dittosloop-store-"));
  tempDirs.push(dir);
  return dir;
}

test("creates an empty state when the state file does not exist", async () => {
  const dir = await createTempDir();
  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toEqual(createEmptyState());
});

test("persists state updates to disk", async () => {
  const dir = await createTempDir();
  const store = new LoopStore(dir);

  await store.updateState((state) => ({
    ...state,
    loops: [
      {
        id: "loop_1",
        title: "Daily code health check",
        intent: "Keep the project healthy",
        trigger: { mode: "manual" },
        verification: { checks: ["npm test"] },
        status: "active",
        createdAt: "2026-06-23T00:00:00.000Z",
        updatedAt: "2026-06-23T00:00:00.000Z"
      }
    ]
  }));

  const secondStore = new LoopStore(dir);

  await expect(secondStore.readState()).resolves.toMatchObject({
    loops: [
      {
        id: "loop_1",
        title: "Daily code health check"
      }
    ]
  });
});
