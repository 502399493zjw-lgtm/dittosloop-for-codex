import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, test } from "vitest";

import { loopWorkspacePath, syncLoopWorkspaceDirectory } from "../src/workspaceDirectory.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("syncLoopWorkspaceDirectory preserves evaluators while removing unrelated stale files", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "dittosloop-workspace-"));
  tempDirs.push(dataDir);
  const loopDir = loopWorkspacePath(dataDir, "loop_1");

  await mkdir(join(loopDir, "evaluators", "script-quality"), { recursive: true });
  await mkdir(join(loopDir, "notes"), { recursive: true });
  await writeFile(join(loopDir, "evaluators", "script-quality", "evaluator.mjs"), "export {};\n", "utf8");
  await writeFile(join(loopDir, "obsolete.txt"), "stale\n", "utf8");
  await writeFile(join(loopDir, "notes", "old.md"), "stale\n", "utf8");

  const files = await syncLoopWorkspaceDirectory(dataDir, "loop_1", [
    { path: "memory.md", content: "fresh memory\n" }
  ]);

  expect(files).toMatchObject([{ path: "memory.md", content: "fresh memory\n" }]);
  await expect(readFile(join(loopDir, "evaluators", "script-quality", "evaluator.mjs"), "utf8")).resolves.toBe("export {};\n");
  await expect(access(join(loopDir, "obsolete.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  await expect(access(join(loopDir, "notes", "old.md"))).rejects.toMatchObject({ code: "ENOENT" });
});
