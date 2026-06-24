import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_INTERVAL = 20;
const DEFAULT_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const event = process.argv[2] ?? "";
const source = process.argv[3] ?? "";
const interval = parsePositiveInt(process.env.DITTOSLOOP_REMINDER_INTERVAL, DEFAULT_INTERVAL);
const cooldownMs = parsePositiveInt(process.env.DITTOSLOOP_REMINDER_COOLDOWN_MS, DEFAULT_COOLDOWN_MS);
const statePath =
  process.env.DITTOSLOOP_REMINDER_STATE ??
  path.join(os.homedir(), ".codex", "dittosloop-for-codex", "loopable-reminder-state.json");

const reminder = [
  "[DittosLoop reminder]",
  "When the user's work looks recurring, stateful, periodically verifiable, or worth handing back to future Codex runs, remember it may be loopable.",
  "Do not create, schedule, persist, or run a loop silently. At most, offer one concrete `/loop ...` suggestion when it clearly helps."
].join("\n");

const state = await readState(statePath);

if (event === "user-prompt-submit") {
  state.promptsSinceReminder = (state.promptsSinceReminder ?? 0) + 1;
  state.updatedAt = new Date().toISOString();
  await writeState(statePath, state);
  process.exit(0);
}

if (event !== "session-start") {
  process.exit(0);
}

const now = Date.now();
const lastReminderAt = Date.parse(state.lastReminderAt ?? "");
const isStale = Number.isNaN(lastReminderAt) || now - lastReminderAt >= cooldownMs;
const isDueByCount = (state.promptsSinceReminder ?? 0) >= interval;
const shouldRemind = source === "startup" || source === "compact" || isDueByCount || isStale;

state.lastSessionStartSource = source;
state.updatedAt = new Date(now).toISOString();

if (shouldRemind) {
  state.promptsSinceReminder = 0;
  state.lastReminderAt = new Date(now).toISOString();
  await writeState(statePath, state);
  process.stdout.write(`${reminder}\n`);
} else {
  await writeState(statePath, state);
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function readState(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return {};
  }
}

async function writeState(filePath, nextState) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}
