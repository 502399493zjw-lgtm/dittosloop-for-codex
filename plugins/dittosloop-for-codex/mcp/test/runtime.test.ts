import { join } from "node:path";

import { expect, test } from "vitest";

import { resolveRuntimeConfig } from "../src/runtime.js";

test("uses explicit runtime environment settings", () => {
  const config = resolveRuntimeConfig(
    {
      DITTOSLOOP_DATA_DIR: "/tmp/dittos-data",
      DITTOSLOOP_PREVIEW_PORT: "49999"
    },
    "/plugin/root",
    "/Users/tester"
  );

  expect(config).toEqual({
    dataDir: "/tmp/dittos-data",
    previewPort: 49999,
    previewBaseUrl: "http://127.0.0.1:49999",
    staticDir: join("/plugin/root", "preview")
  });
});

test("defaults to local Codex data and preview paths", () => {
  const config = resolveRuntimeConfig({}, "/plugin/root", "/Users/tester");

  expect(config).toEqual({
    dataDir: join("/Users/tester", ".codex", "dittosloop-for-codex"),
    previewPort: 47888,
    previewBaseUrl: "http://127.0.0.1:47888",
    staticDir: join("/plugin/root", "preview")
  });
});
