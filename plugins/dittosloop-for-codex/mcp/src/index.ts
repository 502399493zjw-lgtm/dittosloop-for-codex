import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./mcpServer.js";
import { HostMediatedSessionBridge } from "./codex/hostMediatedBridge.js";
import { startPreviewServer } from "./previewServer.js";
import { resolveRuntimeConfig } from "./runtime.js";
import { LoopService } from "./service.js";
import { LoopStore } from "./store.js";

async function main(): Promise<void> {
  const pluginRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const config = resolveRuntimeConfig(process.env, pluginRoot, homedir());
  const store = new LoopStore(config.dataDir);
  const service = new LoopService({
    store,
    sessionBridge: new HostMediatedSessionBridge(),
    previewBaseUrl: config.previewBaseUrl,
    codexProjects: config.codexProjects
  });

  const previewServer = await startPreviewServer({
    service,
    staticDir: config.staticDir,
    templatesFile: config.templatesFile,
    port: config.previewPort
  });
  service.setPreviewUrl(previewServer.url);

  const server = createMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
