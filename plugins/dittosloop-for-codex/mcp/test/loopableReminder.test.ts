import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.resolve(__dirname, "../../hooks/loopable-reminder.mjs");

test("prints the loopable reminder on session startup", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dittosloop-reminder-"));
  const statePath = path.join(tempDir, "state.json");

  try {
    const result = runHook(statePath, ["session-start", "startup"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[DittosLoop reminder]");
    expect(result.stdout).toContain("/loop");

    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.promptsSinceReminder).toBe(0);
    expect(state.lastReminderAt).toEqual(expect.any(String));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("counts user prompts and reminds on resume after the interval", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "dittosloop-reminder-"));
  const statePath = path.join(tempDir, "state.json");

  try {
    expect(runHook(statePath, ["session-start", "startup"]).stdout).toContain("[DittosLoop reminder]");
    expect(runHook(statePath, ["user-prompt-submit"]).stdout).toBe("");
    expect(runHook(statePath, ["session-start", "resume"]).stdout).toBe("");
    expect(runHook(statePath, ["user-prompt-submit"]).stdout).toBe("");

    const resume = runHook(statePath, ["session-start", "resume"]);
    expect(resume.stdout).toContain("[DittosLoop reminder]");

    const state = JSON.parse(await readFile(statePath, "utf8"));
    expect(state.promptsSinceReminder).toBe(0);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

function runHook(statePath: string, args: string[]) {
  return spawnSync("node", [hookPath, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      DITTOSLOOP_REMINDER_COOLDOWN_MS: "999999999",
      DITTOSLOOP_REMINDER_INTERVAL: "2",
      DITTOSLOOP_REMINDER_STATE: statePath
    }
  });
}
