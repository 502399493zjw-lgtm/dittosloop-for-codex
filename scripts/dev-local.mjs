#!/usr/bin/env node

import { execFile, spawn } from "node:child_process";
import { cp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRelativePath = "plugins/dittosloop-for-codex";
const pluginSourcePath = path.join(repoRoot, pluginRelativePath);
const marketplaceName = "dittosloop";
const pluginName = "dittosloop-for-codex";

function parseArgs(argv) {
  const options = {
    dryRun: false,
    cacheDir: undefined
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (arg === "--cache-dir") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("--cache-dir requires a path");
      }
      options.cacheDir = path.resolve(value);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function readPluginVersion() {
  const manifestPath = path.join(pluginSourcePath, ".codex-plugin/plugin.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest.version) {
    throw new Error(`Plugin manifest is missing a version at ${manifestPath}`);
  }
  return manifest.version;
}

function defaultCacheDir(version) {
  return path.join(
    os.homedir(),
    ".codex/plugins/cache",
    marketplaceName,
    pluginName,
    version
  );
}

const checks = [
  {
    display: "npm test",
    command: "npm",
    args: ["test"]
  },
  {
    display: "npm --prefix plugins/dittosloop-for-codex/mcp test",
    command: "npm",
    args: ["--prefix", "plugins/dittosloop-for-codex/mcp", "test"]
  },
  {
    display: "npm run build",
    command: "npm",
    args: ["run", "build"]
  },
  {
    display: "npm run validate",
    command: "npm",
    args: ["run", "validate"]
  }
];

async function shortGitRevision() {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "rev-parse", "--short", "HEAD"]);
    return stdout.trim();
  } catch {
    return "unknown";
  }
}

async function gitDirtyState() {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoRoot, "status", "--short"]);
    return stdout.trim() ? "dirty" : "clean";
  } catch {
    return "unknown";
  }
}

function shouldCopy(sourcePath) {
  const relative = path.relative(pluginSourcePath, sourcePath);
  const parts = relative.split(path.sep);
  return !parts.includes("node_modules") && !parts.includes(".git") && !parts.includes(".DS_Store");
}

async function syncPluginCache(cacheDir) {
  await rm(cacheDir, { recursive: true, force: true });
  await mkdir(path.dirname(cacheDir), { recursive: true });
  await cp(pluginSourcePath, cacheDir, {
    recursive: true,
    filter: shouldCopy
  });
}

async function runCheck(step) {
  console.log(`\n> ${step.display}`);
  await new Promise((resolve, reject) => {
    const child = spawn(step.command, step.args, {
      cwd: repoRoot,
      stdio: "inherit"
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${step.display} failed with exit code ${code}`));
      }
    });
  });
}

function printHeader({ version, cacheDir, revision, dirtyState, dryRun }) {
  console.log("DittosLoop local plugin development sync");
  if (dryRun) {
    console.log("DRY RUN - no commands will run and no files will be copied.");
  }
  console.log(`Source: ${pluginSourcePath}`);
  console.log(`Cache:  ${cacheDir}`);
  console.log(`Version: ${version}`);
  console.log(`Revision: ${revision} (${dirtyState})`);
  console.log("\nPlan:");
  for (const check of checks) {
    console.log(`- ${check.display}`);
  }
  console.log("- sync plugin files to the Codex local plugin cache");
}

function printHelp() {
  console.log(`Usage: npm run dev:local -- [options]

Options:
  --dry-run            Print the plan without running checks or copying files.
  --cache-dir <path>   Override the Codex plugin cache destination.
  --help, -h           Show this help.
`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const version = await readPluginVersion();
  const cacheDir = options.cacheDir ?? defaultCacheDir(version);
  const [revision, dirtyState] = await Promise.all([shortGitRevision(), gitDirtyState()]);

  printHeader({
    version,
    cacheDir,
    revision,
    dirtyState,
    dryRun: options.dryRun
  });

  if (options.dryRun) {
    return;
  }

  for (const check of checks) {
    await runCheck(check);
  }

  console.log(`\n> syncing ${pluginRelativePath}`);
  await syncPluginCache(cacheDir);

  console.log("\nLocal cache updated.");
  console.log("Next checks:");
  console.log("- Restart the Codex plugin runtime or open a fresh Codex session so MCP reloads the cache.");
  console.log("- Open the DittosLoop preview URL and run a short smoke loop.");
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
