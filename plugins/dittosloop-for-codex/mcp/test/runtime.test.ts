import { join } from "node:path";

import { expect, test } from "vitest";

import { resolveRuntimeConfig } from "../src/runtime.js";

test("uses explicit runtime environment settings", () => {
  const config = resolveRuntimeConfig(
    {
      DITTOSLOOP_DATA_DIR: "/tmp/dittos-data",
      DITTOSLOOP_PREVIEW_PORT: "49999",
      DITTOSLOOP_CODEX_PROJECTS: JSON.stringify([
        {
          id: "/Users/tester/project",
          label: "Tester Project",
          path: "/Users/tester/project"
        }
      ])
    },
    "/plugin/root",
    "/Users/tester"
  );

  expect(config).toEqual({
    dataDir: "/tmp/dittos-data",
    previewPort: 49999,
    previewBaseUrl: "http://127.0.0.1:49999",
    staticDir: join("/plugin/root", "preview"),
    templatesFile: join("/plugin/root", "templates", "templates.json"),
    codexProjects: [
      {
        id: "/Users/tester/project",
        name: "Tester Project",
        path: "/Users/tester/project"
      }
    ]
  });
});

test("defaults to local Codex data and preview paths", () => {
  const config = resolveRuntimeConfig({}, "/plugin/root", "/Users/tester");

  expect(config).toEqual({
    dataDir: join("/Users/tester", ".codex", "dittosloop-for-codex"),
    previewPort: 47888,
    previewBaseUrl: "http://127.0.0.1:47888",
    staticDir: join("/plugin/root", "preview"),
    templatesFile: join("/plugin/root", "templates", "templates.json"),
    codexProjects: []
  });
});

test("parses a single codex project from runtime environment", () => {
  const config = resolveRuntimeConfig(
    {
      DITTOSLOOP_CODEX_PROJECT_ID: "project-id",
      DITTOSLOOP_CODEX_PROJECT_NAME: "Project Name",
      DITTOSLOOP_CODEX_PROJECT_PATH: "/Users/tester/project"
    },
    "/plugin/root",
    "/Users/tester"
  );

  expect(config.codexProjects).toEqual([
    {
      id: "project-id",
      name: "Project Name",
      path: "/Users/tester/project"
    }
  ]);
});
