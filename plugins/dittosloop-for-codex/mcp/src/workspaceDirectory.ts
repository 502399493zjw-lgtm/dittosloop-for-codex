import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

import type { LoopWorkspaceFile } from "./types.js";

export async function syncLoopWorkspaceDirectory(
  dataDir: string,
  loopId: string,
  files: LoopWorkspaceFile[]
): Promise<LoopWorkspaceFile[]> {
  const loopDir = join(dataDir, "loops", loopId);
  const desiredPaths = new Set(files.map((file) => file.path));

  await mkdir(loopDir, { recursive: true });

  for (const file of files) {
    const targetPath = resolveLoopFilePath(loopDir, file.path);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, file.content, "utf8");
  }

  await removeStaleFiles(loopDir, loopDir, desiredPaths);

  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(resolveLoopFilePath(loopDir, file.path), "utf8");
      return {
        ...file,
        content,
        size: Buffer.byteLength(content, "utf8")
      };
    })
  );
}

function resolveLoopFilePath(loopDir: string, filePath: string): string {
  const parts = filePath.split("/");
  if (filePath.startsWith("/") || parts.some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`Invalid loop workspace file path: ${filePath}`);
  }

  return join(loopDir, ...parts);
}

async function removeStaleFiles(rootDir: string, currentDir: string, desiredPaths: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await removeStaleFiles(rootDir, entryPath, desiredPaths);
      const remaining = await readdir(entryPath);
      if (remaining.length === 0) {
        await rm(entryPath, { recursive: false, force: true });
      }
      continue;
    }

    const relativePath = relative(rootDir, entryPath).split(sep).join("/");
    if (!desiredPaths.has(relativePath)) {
      await rm(entryPath, { force: true });
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
