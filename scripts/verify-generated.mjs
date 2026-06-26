import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const DEFAULT_GENERATED_FILES = ["plugins/dittosloop-for-codex/mcp/dist/index.js"];

async function hasGitMetadata(root) {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--git-dir"]);
    return true;
  } catch {
    return false;
  }
}

async function generatedFileMatchesIndex(root, filePath) {
  try {
    await execFileAsync("git", ["-C", root, "diff", "--quiet", "--", filePath]);
    return true;
  } catch (error) {
    if (error?.code === 1) {
      return false;
    }
    throw error;
  }
}

export async function verifyGeneratedFilesClean(rootDir = process.cwd(), files = DEFAULT_GENERATED_FILES) {
  const root = path.resolve(rootDir);
  const checks = [];
  const errors = [];

  if (!(await hasGitMetadata(root))) {
    errors.push("generated file verification requires git metadata");
    return { ok: false, errors, checks };
  }

  for (const file of files) {
    if (await generatedFileMatchesIndex(root, file)) {
      checks.push(`${file} matches the git index`);
    } else {
      errors.push(`${file} changed after build; run npm run build and git add ${file}`);
    }
  }

  return errors.length > 0 ? { ok: false, errors, checks } : { ok: true, checks };
}

function printResult(result) {
  if (result.ok) {
    console.log(`generated file verification ok (${result.checks.length} checks)`);
    for (const check of result.checks) {
      console.log(`- ${check}`);
    }
    return;
  }

  console.error(`generated file verification failed (${result.errors.length} errors)`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (directRunPath === fileURLToPath(import.meta.url)) {
  const result = await verifyGeneratedFilesClean(process.cwd());
  printResult(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}
