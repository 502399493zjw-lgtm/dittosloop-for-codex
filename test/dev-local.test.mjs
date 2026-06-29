import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

test("package exposes a dev:local command", async () => {
  const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));

  assert.equal(packageJson.scripts["dev:local"], "node scripts/dev-local.mjs");
});

test("dev-local dry-run prints the local validation and cache sync plan", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "dittosloop-dev-local-"));
  const cacheDir = path.join(root, "cache");
  const scriptPath = path.join(repoRoot, "scripts/dev-local.mjs");

  const { stdout } = await execFileAsync(process.execPath, [
    scriptPath,
    "--dry-run",
    "--cache-dir",
    cacheDir
  ]);

  assert.match(stdout, /DittosLoop local plugin development sync/);
  assert.match(stdout, /DRY RUN/);
  assert.match(stdout, /npm test/);
  assert.match(stdout, /npm run build/);
  assert.match(stdout, /npm --prefix plugins\/dittosloop-for-codex\/mcp test/);
  assert.match(stdout, new RegExp(cacheDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(await pathExists(cacheDir), false);
});
