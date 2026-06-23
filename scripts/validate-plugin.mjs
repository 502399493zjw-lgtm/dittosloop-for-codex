import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "dittosloop-for-codex";
const DISPLAY_NAME = "DittosLoop For Codex";
const MARKETPLACE_NAME = "dittosloop-local";
const MARKETPLACE_DISPLAY_NAME = "DittosLoop Local";
const PLUGIN_PATH = "./plugins/dittosloop-for-codex";
const MCP_ENTRYPOINT = "./mcp/dist/index.js";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(
    value
  );
}

async function pathExists(filePath, kind) {
  try {
    const details = await stat(filePath);
    if (kind === "directory") {
      return details.isDirectory();
    }
    if (kind === "file") {
      return details.isFile();
    }
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, errors, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`);
    return undefined;
  }
}

function requireEqual(actual, expected, label, errors) {
  if (actual !== expected) {
    errors.push(`${label} must be ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function requirePath(value, label, errors) {
  if (!isNonEmptyString(value) || !value.startsWith("./")) {
    errors.push(`${label} must be a ./-prefixed relative path`);
  }
}

async function requireFile(filePath, label, checks, errors) {
  if (await pathExists(filePath, "file")) {
    checks.push(`${label} exists`);
  } else {
    errors.push(`${label} is missing at ${filePath}`);
  }
}

async function requireDirectory(filePath, label, checks, errors) {
  if (await pathExists(filePath, "directory")) {
    checks.push(`${label} exists`);
  } else {
    errors.push(`${label} is missing at ${filePath}`);
  }
}

function validateManifest(manifest, errors, checks) {
  if (!isObject(manifest)) {
    errors.push("plugin manifest must be a JSON object");
    return;
  }

  requireEqual(manifest.name, PLUGIN_NAME, "plugin name", errors);
  if (!isSemver(manifest.version)) {
    errors.push("plugin version must be strict semver");
  }
  if (!isNonEmptyString(manifest.description)) {
    errors.push("plugin description must be present");
  }
  if (!isObject(manifest.author) || !isNonEmptyString(manifest.author.name)) {
    errors.push("plugin author.name must be present");
  }
  requirePath(manifest.skills, "plugin skills", errors);
  requireEqual(manifest.skills, "./skills/", "plugin skills", errors);
  requirePath(manifest.mcpServers, "plugin mcpServers", errors);
  requireEqual(manifest.mcpServers, "./.mcp.json", "plugin mcpServers", errors);

  if (!isObject(manifest.interface)) {
    errors.push("plugin interface must be present");
    return;
  }

  requireEqual(manifest.interface.displayName, DISPLAY_NAME, "plugin displayName", errors);
  if (!isNonEmptyString(manifest.interface.shortDescription)) {
    errors.push("plugin shortDescription must be present");
  }
  if (!isNonEmptyString(manifest.interface.longDescription)) {
    errors.push("plugin longDescription must be present");
  }
  if (!isNonEmptyString(manifest.interface.developerName)) {
    errors.push("plugin developerName must be present");
  }
  requireEqual(manifest.interface.category, "Productivity", "plugin category", errors);
  if (!Array.isArray(manifest.interface.capabilities) || manifest.interface.capabilities.length === 0) {
    errors.push("plugin capabilities must list at least one capability");
  }
  if (!Array.isArray(manifest.interface.defaultPrompt) || manifest.interface.defaultPrompt.length > 3) {
    errors.push("plugin defaultPrompt must be an array with at most 3 entries");
  } else {
    for (const prompt of manifest.interface.defaultPrompt) {
      if (!isNonEmptyString(prompt) || prompt.length > 128) {
        errors.push("plugin defaultPrompt entries must be non-empty strings of 128 characters or less");
        break;
      }
    }
  }
  if (!/^#[0-9A-Fa-f]{6}$/.test(manifest.interface.brandColor ?? "")) {
    errors.push("plugin brandColor must be a 6-digit hex color");
  }

  if (errors.length === 0) {
    checks.push("plugin manifest metadata is valid");
  }
}

function validateMarketplace(marketplace, errors, checks) {
  if (!isObject(marketplace)) {
    errors.push("marketplace must be a JSON object");
    return;
  }

  requireEqual(marketplace.name, MARKETPLACE_NAME, "marketplace name", errors);
  requireEqual(
    marketplace.interface?.displayName,
    MARKETPLACE_DISPLAY_NAME,
    "marketplace displayName",
    errors
  );

  const entry = Array.isArray(marketplace.plugins)
    ? marketplace.plugins.find((plugin) => plugin?.name === PLUGIN_NAME)
    : undefined;

  if (!entry) {
    errors.push(`marketplace entry for ${PLUGIN_NAME} must be present`);
    return;
  }

  requireEqual(entry.source?.source, "local", "marketplace entry source", errors);
  requireEqual(entry.source?.path, PLUGIN_PATH, "marketplace entry path", errors);
  requireEqual(entry.policy?.installation, "AVAILABLE", "marketplace installation policy", errors);
  requireEqual(entry.policy?.authentication, "ON_INSTALL", "marketplace authentication policy", errors);
  requireEqual(entry.category, "Productivity", "marketplace category", errors);

  if (errors.length === 0) {
    checks.push("marketplace entry is valid");
  }
}

function validateMcpConfig(mcpConfig, errors, checks) {
  const server = mcpConfig?.mcpServers?.dittosloop;
  if (!isObject(server)) {
    errors.push("MCP config must define mcpServers.dittosloop");
    return;
  }

  requireEqual(server.command, "node", "MCP command", errors);
  if (!Array.isArray(server.args) || !server.args.includes(MCP_ENTRYPOINT)) {
    errors.push(`MCP args must include ${MCP_ENTRYPOINT}`);
  }
  requireEqual(server.cwd, ".", "MCP cwd", errors);

  if (errors.length === 0) {
    checks.push("MCP launch config is valid");
  }
}

export async function validatePlugin(rootDir = process.cwd()) {
  const root = path.resolve(rootDir);
  const checks = [];
  const errors = [];
  const pluginRoot = path.join(root, "plugins", PLUGIN_NAME);
  const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");
  const marketplacePath = path.join(root, ".agents", "plugins", "marketplace.json");
  const mcpPath = path.join(pluginRoot, ".mcp.json");

  await requireFile(manifestPath, "plugin manifest", checks, errors);
  await requireFile(marketplacePath, "marketplace manifest", checks, errors);
  await requireFile(mcpPath, "MCP config", checks, errors);
  await requireDirectory(path.join(pluginRoot, "skills"), "skills directory", checks, errors);
  await requireFile(path.join(pluginRoot, "skills", "loop", "SKILL.md"), "loop skill", checks, errors);
  await requireFile(path.join(pluginRoot, "preview", "index.html"), "preview HTML", checks, errors);
  await requireFile(path.join(pluginRoot, "preview", "app.js"), "preview app", checks, errors);
  await requireFile(path.join(pluginRoot, "preview", "styles.css"), "preview styles", checks, errors);
  await requireFile(path.join(pluginRoot, "mcp", "package.json"), "MCP package", checks, errors);
  await requireFile(path.join(pluginRoot, "mcp", "dist", "index.js"), "built MCP entrypoint", checks, errors);

  const manifest = await readJson(manifestPath, errors, "plugin manifest");
  const marketplace = await readJson(marketplacePath, errors, "marketplace manifest");
  const mcpConfig = await readJson(mcpPath, errors, "MCP config");

  validateManifest(manifest, errors, checks);
  validateMarketplace(marketplace, errors, checks);
  validateMcpConfig(mcpConfig, errors, checks);

  if (errors.length > 0) {
    return { ok: false, errors, checks };
  }
  return { ok: true, checks };
}

function printResult(result) {
  if (result.ok) {
    console.log(`plugin validation ok (${result.checks.length} checks)`);
    for (const check of result.checks) {
      console.log(`- ${check}`);
    }
    return;
  }

  console.error(`plugin validation failed (${result.errors.length} errors)`);
  for (const error of result.errors) {
    console.error(`- ${error}`);
  }
}

const directRunPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (directRunPath === fileURLToPath(import.meta.url)) {
  const result = await validatePlugin(process.cwd());
  printResult(result);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

