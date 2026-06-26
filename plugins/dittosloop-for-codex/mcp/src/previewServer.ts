import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, join, relative } from "node:path";

import type { LoopService, NewLoopSessionLaunch } from "./service.js";
import { enrichRunDetail } from "./preview/eventAdapter.js";

export interface PreviewServerOptions {
  service: LoopService;
  staticDir: string;
  templatesFile?: string;
  host?: string;
  port?: number;
  platform?: NodeJS.Platform;
  spawnProcess?: TemplateLaunchSpawner;
}

export interface PreviewServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export interface LoopTemplate {
  id: string;
  title: string;
  category: string;
  cadence: string;
  desc: string;
  trigger: string;
  checks: string[];
  buildPrompt: string;
  source?: {
    label: string;
    url?: string;
  };
}

export type TemplateLaunchSpawner = (
  command: string,
  args: string[],
  options: { detached: true; stdio: "ignore" }
) => { unref: () => void };

export type TemplateLaunchResult =
  | { launched: true }
  | { launched: false; prompt: string }
  | { launched: false; prompt: string; launchRequest: NewLoopSessionLaunch["launchRequest"] };

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

export async function startPreviewServer(options: PreviewServerOptions): Promise<PreviewServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 47888;
  const templatesFile = options.templatesFile ?? join(options.staticDir, "..", "templates", "templates.json");
  const platform = options.platform ?? process.platform;
  const spawnProcess = options.spawnProcess ?? spawn;
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", `http://${request.headers.host ?? host}`);

      if (url.pathname === "/api/snapshot") {
        await sendJson(response, await options.service.getSnapshot());
        return;
      }

      if (url.pathname === "/api/new-loop-session") {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        const body = await readJsonBody(request);
        await sendJson(
          response,
          options.service.createNewLoopSessionLaunch({
            codexProjectId: typeof body.codexProjectId === "string" ? body.codexProjectId : undefined,
            projectLabel: typeof body.projectLabel === "string" ? body.projectLabel : undefined,
            projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined
          })
        );
        return;
      }

      const loopFilesMatch = url.pathname.match(/^\/api\/loops\/([^/]+)\/files$/);
      if (loopFilesMatch) {
        if (request.method !== "GET") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        await sendJson(response, await options.service.listLoopFiles(decodeURIComponent(loopFilesMatch[1])));
        return;
      }

      if (url.pathname === "/api/templates") {
        if (request.method !== "GET") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        await sendJson(response, await readTemplates(templatesFile));
        return;
      }

      const templatePromptMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/prompt$/);
      if (templatePromptMatch) {
        if (request.method !== "GET") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        const templates = await readTemplates(templatesFile);
        const templateId = decodeURIComponent(templatePromptMatch[1]);
        const template = templates.find((item) => item.id === templateId);
        if (!template) {
          response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: `Template not found: ${templateId}` })}\n`);
          return;
        }

        await sendJson(response, { prompt: template.buildPrompt });
        return;
      }

      const templateLaunchMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/launch$/);
      if (templateLaunchMatch) {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        const templates = await readTemplates(templatesFile);
        const templateId = decodeURIComponent(templateLaunchMatch[1]);
        const template = templates.find((item) => item.id === templateId);
        if (!template) {
          response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: `Template not found: ${templateId}` })}\n`);
          return;
        }

        const body = await readJsonBody(request);
        await sendJson(
          response,
          launchTemplateSession(template, {
            platform,
            spawnProcess,
            launchMode: body.launchMode === "host" ? "host" : "terminal",
            codexProjectId: typeof body.codexProjectId === "string" ? body.codexProjectId : undefined,
            projectLabel: typeof body.projectLabel === "string" ? body.projectLabel : undefined,
            projectPath: typeof body.projectPath === "string" ? body.projectPath : undefined
          })
        );
        return;
      }

      const loopMatch = url.pathname.match(/^\/api\/loops\/([^/]+)$/);
      if (loopMatch) {
        if (request.method !== "DELETE") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        await sendJson(response, await options.service.deleteLoop(decodeURIComponent(loopMatch[1])));
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

      const openSessionMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/open-codex-session$/);
      if (openSessionMatch) {
        if (request.method !== "POST") {
          response.writeHead(405, { "content-type": "application/json; charset=utf-8" });
          response.end(`${JSON.stringify({ error: "Method not allowed" })}\n`);
          return;
        }

        await sendJson(response, await options.service.openCodexSession(decodeURIComponent(openSessionMatch[1])));
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

  await listenOnAvailablePort(server, port, host);

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
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream"
    });
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

async function readTemplates(templatesFile: string): Promise<LoopTemplate[]> {
  const raw = await readFile(templatesFile, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error("Templates file must contain an array");
  }

  return parsed.map((item) => normalizeTemplate(item));
}

function normalizeTemplate(value: unknown): LoopTemplate {
  if (!value || typeof value !== "object") {
    throw new Error("Template entry must be an object");
  }

  const record = value as Record<string, unknown>;
  const checks = record.checks;
  if (!Array.isArray(checks) || !checks.every((check) => typeof check === "string")) {
    throw new Error("Template checks must be strings");
  }

  const source = normalizeTemplateSource(record.source);

  return {
    id: requireString(record, "id"),
    title: requireString(record, "title"),
    category: requireString(record, "category"),
    cadence: requireString(record, "cadence"),
    desc: requireString(record, "desc"),
    trigger: requireString(record, "trigger"),
    checks,
    buildPrompt: requireString(record, "buildPrompt"),
    ...(source ? { source } : {})
  };
}

function normalizeTemplateSource(value: unknown): LoopTemplate["source"] {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== "object") {
    throw new Error("Template source must be an object");
  }

  const record = value as Record<string, unknown>;
  const source = {
    label: requireString(record, "label")
  } as NonNullable<LoopTemplate["source"]>;
  if (record.url === undefined) {
    return source;
  }
  if (typeof record.url !== "string" || !record.url.trim()) {
    throw new Error("Template source url must be a string");
  }

  return {
    ...source,
    url: record.url
  };
}

function requireString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Template ${key} is required`);
  }
  return value;
}

function launchTemplateSession(
  template: LoopTemplate,
  options: {
    platform: NodeJS.Platform;
    spawnProcess: TemplateLaunchSpawner;
    launchMode: "host" | "terminal";
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  }
): TemplateLaunchResult {
  if (options.launchMode === "host") {
    return {
      launched: false,
      prompt: template.buildPrompt,
      launchRequest: buildTemplateLaunchRequest(template, options)
    };
  }

  if (options.platform !== "darwin") {
    return { launched: false, prompt: template.buildPrompt };
  }

  const cwd = options.projectPath?.trim() || process.cwd();
  const shellCommand = buildTemplateLaunchShellCommand(cwd, template.buildPrompt);
  const appleScript = `tell application "Terminal" to do script ${asAppleScriptString(shellCommand)}`;
  options.spawnProcess("osascript", ["-e", appleScript], { detached: true, stdio: "ignore" }).unref();

  return { launched: true };
}

function buildTemplateLaunchRequest(
  template: LoopTemplate,
  project: {
    codexProjectId?: string;
    projectLabel?: string;
    projectPath?: string;
  }
): NewLoopSessionLaunch["launchRequest"] {
  return {
    title: `DittosLoop: ${template.title}`,
    prompt: template.buildPrompt,
    workflowRuntime: "dittosloop-loop-creator",
    ...project
  };
}

export function buildTemplateLaunchShellCommand(cwd: string, buildPrompt: string): string {
  return `cd ${shellQuote(cwd)} && codex "${escapeShellDoubleQuoted(buildPrompt)}"`;
}

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\"'\"'")}'`;
}

export function asAppleScriptString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function escapeShellDoubleQuoted(value: string): string {
  return value.replace(/(["\\$`])/g, "\\$1");
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

async function listenOnAvailablePort(server: Server, port: number, host: string): Promise<void> {
  try {
    await listen(server, port, host);
  } catch (error) {
    if (port !== 0 && isAddressInUseError(error)) {
      await listen(server, 0, host);
      return;
    }

    throw error;
  }
}

function isAddressInUseError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EADDRINUSE";
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
