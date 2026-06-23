import { createServer, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import type { LoopService } from "./service.js";

export interface PreviewServerOptions {
  service: LoopService;
  staticDir: string;
  host?: string;
  port?: number;
}

export interface PreviewServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 47888;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);

      if (url.pathname === "/api/snapshot") {
        await sendJson(response, await options.service.getSnapshot());
        return;
      }

      await sendStaticFile(response, options.staticDir, url.pathname);
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Preview server error" }));
    }
  });

  await listen(server, port, host);

  const address = server.address();
  const actualPort = typeof address === "object" && address ? address.port : port;

  return {
    url: `http://${host}:${actualPort}`,
    port: actualPort,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      })
  };
}

async function sendJson(response: ServerResponse, payload: unknown): Promise<void> {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

async function sendStaticFile(response: ServerResponse, staticDir: string, pathname: string): Promise<void> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = join(staticDir, safePath);
  const pathFromStaticRoot = relative(staticDir, filePath);

  if (pathFromStaticRoot.startsWith("..") || isAbsolute(pathFromStaticRoot)) {
    response.writeHead(403, { "content-type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, { "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream" });
    response.end(body);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    throw error;
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
