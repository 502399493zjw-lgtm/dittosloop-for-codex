import { join } from "node:path";

import type { CodexProjectRef } from "./types.js";

export interface RuntimeConfig {
  dataDir: string;
  previewPort: number;
  previewBaseUrl: string;
  staticDir: string;
  templatesFile: string;
  codexProjects: CodexProjectRef[];
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv, pluginRoot: string, homeDir: string): RuntimeConfig {
  const previewPort = parsePreviewPort(env.DITTOSLOOP_PREVIEW_PORT);

  return {
    dataDir: env.DITTOSLOOP_DATA_DIR || join(homeDir, ".codex", "dittosloop-for-codex"),
    previewPort,
    previewBaseUrl: `http://127.0.0.1:${previewPort}`,
    staticDir: join(pluginRoot, "preview"),
    templatesFile: join(pluginRoot, "templates", "templates.json"),
    codexProjects: parseCodexProjects(env)
  };
}

function parsePreviewPort(value: string | undefined): number {
  if (!value) {
    return 47888;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 47888;
}

function parseCodexProjects(env: NodeJS.ProcessEnv): CodexProjectRef[] {
  const projects = parseCodexProjectList(env.DITTOSLOOP_CODEX_PROJECTS);
  const singleProject = normalizeCodexProject({
    id: env.DITTOSLOOP_CODEX_PROJECT_ID,
    name: env.DITTOSLOOP_CODEX_PROJECT_NAME ?? env.DITTOSLOOP_CODEX_PROJECT_LABEL,
    path: env.DITTOSLOOP_CODEX_PROJECT_PATH
  });

  const byId = new Map<string, CodexProjectRef>();
  for (const project of [...projects, singleProject].filter((item): item is CodexProjectRef => Boolean(item))) {
    byId.set(project.id, project);
  }

  return [...byId.values()];
}

function parseCodexProjectList(value: string | undefined): CodexProjectRef[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => normalizeCodexProject(item))
      .filter((item): item is CodexProjectRef => Boolean(item));
  } catch {
    return [];
  }
}

function normalizeCodexProject(value: unknown): CodexProjectRef | null {
  if (!value || typeof value !== "object") return null;

  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  const name =
    typeof record.name === "string"
      ? record.name
      : typeof record.label === "string"
        ? record.label
        : undefined;
  const path = typeof record.path === "string" ? record.path : undefined;

  if (!id || !name || !path) return null;

  return { id, name, path };
}
