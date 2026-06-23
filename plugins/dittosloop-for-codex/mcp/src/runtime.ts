import { join } from "node:path";

export interface RuntimeConfig {
  dataDir: string;
  previewPort: number;
  previewBaseUrl: string;
  staticDir: string;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv, pluginRoot: string, homeDir: string): RuntimeConfig {
  const previewPort = parsePreviewPort(env.DITTOSLOOP_PREVIEW_PORT);

  return {
    dataDir: env.DITTOSLOOP_DATA_DIR || join(homeDir, ".codex", "dittosloop-for-codex"),
    previewPort,
    previewBaseUrl: `http://127.0.0.1:${previewPort}`,
    staticDir: join(pluginRoot, "preview")
  };
}

function parsePreviewPort(value: string | undefined): number {
  if (!value) {
    return 47888;
  }

  const parsed = Number(value);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : 47888;
}
