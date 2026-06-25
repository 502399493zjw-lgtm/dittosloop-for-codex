import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(import.meta.dirname, "..");
const skillPath = path.join(repoRoot, "plugins/dittosloop-for-codex/skills/loop/SKILL.md");

test("loop skill documents memory reads and post-verifier memory ownership", async () => {
  const skill = await readFile(skillPath, "utf8");

  assert.match(skill, /read_loop_memory/);
  assert.match(skill, /verifier/);
  assert.match(skill, /commit_memory/);
  assert.match(skill, /top-level visible Codex session|顶层 Codex session/);
});
