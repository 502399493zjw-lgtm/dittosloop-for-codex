import { homedir } from "node:os";

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createMcpServer } from "./mcpServer.js";
import { startPreviewServer } from "./previewServer.js";
import { resolveRuntimeConfig } from "./runtime.js";
import { LoopService } from "./service.js";
import { LoopStore } from "./store.js";

async function main(): Promise<void> {
  const config = resolveRuntimeConfig(process.env, process.cwd(), homedir());
  const store = new LoopStore(config.dataDir);
  const service = new LoopService({
    store,
    previewBaseUrl: config.previewBaseUrl
  });

  await startPreviewServer({
    service,
    staticDir: config.staticDir,
    port: config.previewPort
  });

  const server = createMcpServer(service);
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
