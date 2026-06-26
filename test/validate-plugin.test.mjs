import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "..");
const validatorModule = pathToFileURL(path.join(repoRoot, "scripts/validate-plugin.mjs")).href;
const { validatePlugin } = await import(validatorModule);
const execFileAsync = promisify(execFile);

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeText(filePath, value = "") {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, value);
}

async function runGit(cwd, args) {
  await execFileAsync("git", args, { cwd });
}

async function createValidFixture(options = {}) {
  const hookScriptRef = options.hookScriptRef ?? "\"${PLUGIN_ROOT}/hooks/loopable-reminder.mjs\"";
  const root = await mkdtemp(path.join(tmpdir(), "dittosloop-validator-"));
  const pluginRoot = path.join(root, "plugins/dittosloop-for-codex");

  await writeJson(path.join(root, ".agents/plugins/marketplace.json"), {
    name: "dittosloop-local",
    interface: {
      displayName: "DittosLoop Local"
    },
    plugins: [
      {
        name: "dittosloop-for-codex",
        source: {
          source: "local",
          path: "./plugins/dittosloop-for-codex"
        },
        policy: {
          installation: "AVAILABLE",
          authentication: "ON_INSTALL"
        },
        category: "Productivity"
      }
    ]
  });

  await writeJson(path.join(pluginRoot, ".codex-plugin/plugin.json"), {
    name: "dittosloop-for-codex",
    version: "0.1.0",
    description: "Turn Codex work into visible local Dittos loops.",
    author: {
      name: "Dittos Loop"
    },
    license: "MIT",
    keywords: ["codex", "loop"],
    skills: "./skills/",
    mcpServers: "./.mcp.json",
    interface: {
      displayName: "DittosLoop For Codex",
      shortDescription: "Create and inspect local Dittos loops from Codex",
      longDescription: "DittosLoop For Codex helps turn delegated work into durable visible local loops.",
      developerName: "Dittos Loop",
      category: "Productivity",
      capabilities: ["Interactive", "Read", "Write"],
      defaultPrompt: ["Turn this responsibility into a loop"],
      brandColor: "#2563EB"
    }
  });

  await writeJson(path.join(pluginRoot, ".mcp.json"), {
    mcpServers: {
      dittosloop: {
        command: "node",
        args: ["./mcp/dist/index.js"],
        cwd: ".",
        startup_timeout_sec: 20,
        tool_timeout_sec: 60
      }
    }
  });

  await writeText(path.join(pluginRoot, "skills/loop/SKILL.md"), "---\nname: loop\n---\n");
  await writeText(path.join(pluginRoot, "preview/index.html"), "<main id=\"app\"></main>\n");
  await writeText(path.join(pluginRoot, "preview/app.js"), "console.log('preview');\n");
  await writeText(path.join(pluginRoot, "preview/styles.css"), "body { margin: 0; }\n");
  await writeJson(path.join(pluginRoot, "hooks/hooks.json"), {
    hooks: {
      SessionStart: [
        {
          matcher: "startup",
          hooks: [
            {
              type: "command",
              command: `node ${hookScriptRef} session-start startup`,
              timeout: 5
            }
          ]
        }
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `node ${hookScriptRef} user-prompt-submit`,
              timeout: 5
            }
          ]
        }
      ]
    }
  });
  await writeText(path.join(pluginRoot, "hooks/loopable-reminder.mjs"), "process.exit(0);\n");
  await writeText(path.join(pluginRoot, "mcp/dist/index.js"), "console.log('mcp');\n");
  await writeJson(path.join(pluginRoot, "mcp/package.json"), {
    scripts: {
      build: "tsc -p tsconfig.json",
      test: "vitest run"
    }
  });

  return root;
}

test("accepts a complete DittosLoop plugin fixture", async () => {
  const root = await createValidFixture();

  const result = await validatePlugin(root);

  assert.equal(result.ok, true);
  assert.match(result.checks.join("\n"), /plugin manifest/);
  assert.match(result.checks.join("\n"), /marketplace entry/);
});

test("reports actionable errors for broken metadata", async () => {
  const root = await createValidFixture();
  await writeJson(path.join(root, "plugins/dittosloop-for-codex/.codex-plugin/plugin.json"), {
    name: "wrong-name",
    version: "dev",
    description: "",
    author: {},
    skills: "skills",
    interface: {
      displayName: "Wrong"
    }
  });

  const result = await validatePlugin(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /plugin name/);
  assert.match(result.errors.join("\n"), /semver/);
  assert.match(result.errors.join("\n"), /skills/);
});

test("rejects cwd-relative hook commands for plugin-owned scripts", async () => {
  const root = await createValidFixture({
    hookScriptRef: "./hooks/loopable-reminder.mjs"
  });

  const result = await validatePlugin(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /PLUGIN_ROOT/);
});

test("rejects git-backed fixtures when the built MCP entrypoint is untracked", async (t) => {
  const root = await createValidFixture();
  await writeText(path.join(root, ".gitignore"), "plugins/dittosloop-for-codex/mcp/dist/\n");

  try {
    await runGit(root, ["init"]);
    await runGit(root, ["add", "."]);
  } catch {
    t.skip("git is unavailable in this environment");
    return;
  }

  const result = await validatePlugin(root);

  assert.equal(result.ok, false);
  assert.match(result.errors.join("\n"), /git-tracked/);
});
