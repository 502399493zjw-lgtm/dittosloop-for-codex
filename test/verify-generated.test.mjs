import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const verifierModule = pathToFileURL(path.join(repoRoot, "scripts/verify-generated.mjs")).href;
const { verifyGeneratedFilesClean } = await import(verifierModule);
const execFileAsync = promisify(execFile);

async function writeText(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
}

async function runGit(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

async function createTrackedFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "dittosloop-generated-"));
  const generatedFile = "plugins/dittosloop-for-codex/mcp/dist/index.js";
  await writeText(path.join(root, generatedFile), "console.log('generated v1');\n");
  await runGit(root, ["init"]);
  await runGit(root, ["add", generatedFile]);
  return { root, generatedFile };
}

test("accepts generated files that match the git index", async () => {
  const { root, generatedFile } = await createTrackedFixture();

  const result = await verifyGeneratedFilesClean(root, [generatedFile]);

  assert.equal(result.ok, true);
  assert.match(result.checks.join("\n"), /matches the git index/);
});

test("rejects generated files changed by a local build", async () => {
  const { root, generatedFile } = await createTrackedFixture();
  await writeText(path.join(root, generatedFile), "console.log('generated v2');\n");

  const result = await verifyGeneratedFilesClean(root, [generatedFile]);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /changed after build/);
});
