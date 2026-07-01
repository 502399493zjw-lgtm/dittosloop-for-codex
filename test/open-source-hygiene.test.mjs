import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(import.meta.dirname, "..");
const pluginManifestPath = "plugins/dittosloop-for-codex/.codex-plugin/plugin.json";
const packageManifestPaths = ["package.json", "plugins/dittosloop-for-codex/mcp/package.json"];
const packageLockPaths = ["plugins/dittosloop-for-codex/mcp/package-lock.json"];
const mcpServerMetadataPaths = [
  "plugins/dittosloop-for-codex/mcp/src/mcpServer.ts",
  "plugins/dittosloop-for-codex/mcp/dist/index.js"
];
const trackedDirectoryDenylist = ["docs/superpowers/", ".superpowers/"];
const personalPathPattern = /\/Users\/|Documents\/dittos loop|projects\/dittos-loop/;
const mcpServerVersionPattern = /name\s*:\s*["']dittosloop-for-codex["']\s*,\s*version\s*:\s*["']([^"']+)["']/;
const textFilePattern = /\.(json|js|mjs|md|ts|tsx|html|css|txt|yml|yaml)$/;

async function gitTrackedFiles() {
  const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: repoRoot });
  return stdout.split("\n").filter(Boolean);
}

test("public repository metadata is present", async () => {
  for (const file of ["LICENSE", "CONTRIBUTING.md", "SECURITY.md"]) {
    await access(path.join(repoRoot, file));
  }
});

test("package metadata stays aligned with the plugin manifest", async () => {
  const pluginManifest = JSON.parse(await readFile(path.join(repoRoot, pluginManifestPath), "utf8"));

  for (const packageManifestPath of packageManifestPaths) {
    const packageManifest = JSON.parse(await readFile(path.join(repoRoot, packageManifestPath), "utf8"));

    assert.equal(packageManifest.version, pluginManifest.version, `${packageManifestPath} version`);
    assert.equal(packageManifest.license, pluginManifest.license, `${packageManifestPath} license`);
    assert.equal(typeof packageManifest.description, "string", `${packageManifestPath} description`);
    assert.equal(typeof packageManifest.repository?.url, "string", `${packageManifestPath} repository`);
    assert.equal(typeof packageManifest.bugs?.url, "string", `${packageManifestPath} bugs`);
    assert.equal(typeof packageManifest.homepage, "string", `${packageManifestPath} homepage`);
    assert.equal(typeof packageManifest.packageManager, "string", `${packageManifestPath} packageManager`);
    assert.equal(typeof packageManifest.engines?.node, "string", `${packageManifestPath} engines.node`);
  }

  for (const packageLockPath of packageLockPaths) {
    const packageLock = JSON.parse(await readFile(path.join(repoRoot, packageLockPath), "utf8"));

    assert.equal(packageLock.packages?.[""]?.version, pluginManifest.version, `${packageLockPath} root version`);
  }
});

test("MCP server metadata stays aligned with the plugin manifest", async () => {
  const pluginManifest = JSON.parse(await readFile(path.join(repoRoot, pluginManifestPath), "utf8"));

  for (const metadataPath of mcpServerMetadataPaths) {
    const content = await readFile(path.join(repoRoot, metadataPath), "utf8");
    const match = mcpServerVersionPattern.exec(content);

    assert.ok(match, `${metadataPath} should expose MCP server metadata`);
    assert.equal(match[1], pluginManifest.version, `${metadataPath} MCP server version`);
  }
});

test("internal agent development files are not tracked", async () => {
  const files = await gitTrackedFiles();

  assert.deepEqual(files.filter((file) => path.basename(file) === "AGENTS.md"), []);
  assert.deepEqual(
    files.filter((file) => trackedDirectoryDenylist.some((directory) => file.startsWith(directory))),
    []
  );
});

test("tracked text files do not contain personal local paths", async () => {
  const files = (await gitTrackedFiles()).filter((file) => textFilePattern.test(file));
  const offenders = [];

  for (const file of files) {
    const content = await readFile(path.join(repoRoot, file), "utf8");
    if (personalPathPattern.test(content)) {
      offenders.push(file);
    }
  }

  assert.deepEqual(offenders, []);
});
