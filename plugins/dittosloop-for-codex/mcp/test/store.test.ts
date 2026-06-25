import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("normalizes old state without human request status", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 1,
      humanRequests: [
        {
          id: "human_1",
          runId: "run_1",
          question: "Continue?",
          createdAt: "2026-06-23T00:00:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    attempts: [],
    version: 2,
    workflowContexts: [],
    humanRequests: [{ id: "human_1", status: "open" }]
  });
});

test("preserves workflow contexts when normalizing v2 state", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 2,
      workflowContexts: [
        {
          id: "workflow_1",
          runId: "run_1",
          loopId: "loop_1",
          attemptId: "attempt_1",
          contractId: "loop_1",
          status: "suspended",
          cursor: { state: "waiting_for_session", stepId: "scan", sessionId: "session_1" },
          vars: {},
          steps: {
            scan: {
              status: "suspended",
              sessionId: "session_1",
              updatedAt: "2026-06-23T00:00:00.000Z"
            }
          },
          taskRuns: [
            {
              id: "task_1",
              runId: "run_1",
              attemptId: "attempt_1",
              stepId: "scan",
              sessionId: "session_1",
              status: "suspended",
              createdAt: "2026-06-23T00:00:00.000Z",
              updatedAt: "2026-06-23T00:00:00.000Z"
            }
          ],
          pendingSessionIds: ["session_1"],
          idempotencyKeys: [],
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    version: 2,
    workflowContexts: [
      {
        id: "workflow_1",
        status: "suspended",
        pendingSessionIds: ["session_1"],
        taskRuns: [{ id: "task_1", sessionId: "session_1", status: "suspended" }]
      }
    ]
  });
});

test("derives canonical loop operational state while normalizing existing state", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 2,
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
      ],
      runs: [
        {
          id: "run_1",
          loopId: "loop_1",
          status: "completed",
          goal: "Run checks",
          trigger: "manual",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:01:00.000Z",
          completedAt: "2026-06-23T00:01:00.000Z"
        },
        {
          id: "run_2",
          loopId: "loop_1",
          status: "failed",
          goal: "Run checks again",
          trigger: "manual",
          createdAt: "2026-06-24T00:00:00.000Z",
          updatedAt: "2026-06-24T00:01:00.000Z",
          completedAt: "2026-06-24T00:01:00.000Z"
        }
      ],
      memoryCommits: [
        {
          id: "memory_1",
          loopId: "loop_1",
          runId: "run_2",
          summary: "Keep the stricter source rule.",
          createdAt: "2026-06-24T00:02:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    loopStates: [
      {
        loopId: "loop_1",
        cursor: null,
        consecutiveFailures: 1,
        paused: false,
        running: false,
        runCount: 2,
        lastRunAt: Date.parse("2026-06-24T00:01:00.000Z")
      }
    ]
  });
});

test("derives newest-first loop memory while normalizing legacy memory commits", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 2,
      loops: [
        {
          id: "loop_1",
          title: "Daily source monitor",
          intent: "Remember source filters",
          trigger: { mode: "manual" },
          verification: { checks: ["manual"] },
          status: "active",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      memoryCommits: [
        {
          id: "memory_1",
          loopId: "loop_1",
          summary: "Prefer official sources.",
          createdAt: "2026-06-23T00:02:00.000Z"
        },
        {
          id: "memory_2",
          loopId: "loop_1",
          summary: "Ignore duplicate syndicated posts.",
          createdAt: "2026-06-24T00:02:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    loopMemories: [
      {
        loopId: "loop_1",
        content: "Ignore duplicate syndicated posts.\nPrefer official sources.\n",
        updatedAt: "2026-06-24T00:02:00.000Z"
      }
    ]
  });
});

test("derives newest-first loop memory for tied legacy memory commits", async () => {
  const dir = await createTempDir();
  await writeFile(
    join(dir, "state.json"),
    `${JSON.stringify({
      version: 2,
      loops: [
        {
          id: "loop_1",
          title: "Daily source monitor",
          intent: "Remember source filters",
          trigger: { mode: "manual" },
          verification: { checks: ["manual"] },
          status: "active",
          createdAt: "2026-06-23T00:00:00.000Z",
          updatedAt: "2026-06-23T00:00:00.000Z"
        }
      ],
      memoryCommits: [
        {
          id: "memory_1",
          loopId: "loop_1",
          summary: "Prefer official sources.",
          createdAt: "2026-06-24T00:02:00.000Z"
        },
        {
          id: "memory_2",
          loopId: "loop_1",
          summary: "Ignore duplicate syndicated posts.",
          createdAt: "2026-06-24T00:02:00.000Z"
        }
      ]
    })}\n`,
    "utf8"
  );

  const store = new LoopStore(dir);

  await expect(store.readState()).resolves.toMatchObject({
    loopMemories: [
      {
        loopId: "loop_1",
        content: "Ignore duplicate syndicated posts.\nPrefer official sources.\n",
        updatedAt: "2026-06-24T00:02:00.000Z"
      }
    ]
  });
});
