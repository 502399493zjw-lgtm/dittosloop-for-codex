import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import type { LoopService } from "./service.js";
import { enrichRunDetail } from "./preview/eventAdapter.js";

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

      const runDetailMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/);
      if (runDetailMatch) {
        await sendJson(response, enrichRunDetail(await options.service.getRunDetail(decodeURIComponent(runDetailMatch[1]))));
        return;
      }

      const codexThreadMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/codex-thread$/);
      if (codexThreadMatch) {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        const body = await readJsonBody(request);
        if (typeof body.threadId !== "string") {
          response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "threadId is required" })}\n`);
          return;
        }

        await sendJson(
          response,
          await options.service.recordCodexThread(decodeURIComponent(codexThreadMatch[1]), {
            threadId: body.threadId,
            threadTitle: typeof body.threadTitle === "string" ? body.threadTitle : undefined,
            threadUrl: typeof body.threadUrl === "string" ? body.threadUrl : undefined
          })
        );
        return;
      }

      const sessionLaunchMatch = url.pathname.match(/^\/api\/loops\/([^/]+)\/codex-session$/);
      if (sessionLaunchMatch) {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        const body = await readJsonBody(request);
        await sendJson(
          response,
          await options.service.startCodexSessionRun(decodeURIComponent(sessionLaunchMatch[1]), {
            goal: typeof body.goal === "string" ? body.goal : undefined,
            codexProjectId: typeof body.codexProjectId === "string" ? body.codexProjectId : undefined,
            projectLabel: typeof body.projectLabel === "string" ? body.projectLabel : undefined,
            projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined
          })
        );
        return;
      }

      await sendStaticFile(response, options.staticDir, url.pathname);
    } catch (error) {
      if (error instanceof Error && /^(Run|Loop) not found:/.test(error.message)) {
        response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
        response.end(`${JSON.stringify({ error: error.message })}\n`);
        return;
      }

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

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
