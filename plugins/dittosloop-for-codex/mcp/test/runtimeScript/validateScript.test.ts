import { describe, expect, test } from "vitest";

import { validateRuntimeScript } from "../../src/runtimeScript/validateScript.js";

describe("validateRuntimeScript", () => {
  test("accepts a simple runtime workflow script", () => {
    expect(validateRuntimeScript('const x = await agent("x"); return x;')).toEqual({
      ok: true,
      errors: []
    });
  });

  test("rejects CommonJS require access", () => {
    const result = validateRuntimeScript('const fs = require("fs"); return fs.readFileSync(".");');

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/require/i)]));
  });

  test("rejects static and dynamic import access", () => {
    const staticImportResult = validateRuntimeScript('import fs from "fs"; return fs;');
    const dynamicImportResult = validateRuntimeScript('const fs = await import("fs"); return fs;');

    expect(staticImportResult.ok).toBe(false);
    expect(staticImportResult.errors).toEqual(expect.arrayContaining([expect.stringMatching(/import/i)]));
    expect(dynamicImportResult.ok).toBe(false);
    expect(dynamicImportResult.errors).toEqual(expect.arrayContaining([expect.stringMatching(/import/i)]));
  });

  test("rejects process access", () => {
    const result = validateRuntimeScript("return process.env.HOME;");

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/process/i)]));
  });

  test("rejects globalThis access", () => {
    const result = validateRuntimeScript("return globalThis.process;");

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringMatching(/globalThis/i)]));
  });

  test("rejects Function constructor access", () => {
    const result = validateRuntimeScript('return Function("return process")();');

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Function/i),
      expect.stringMatching(/process/i)
    ]));
  });

  test("rejects nondeterministic globals listed by the runtime script design", () => {
    const result = validateRuntimeScript([
      "const started = Date.now();",
      "const random = Math.random();",
      "const id = crypto.randomUUID();",
      "return { started, random, id, now: performance.now() };"
    ].join("\n"));

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/Date/),
      expect.stringMatching(/Math\.random/),
      expect.stringMatching(/crypto/i),
      expect.stringMatching(/performance/i)
    ]));
  });

  test("reports every denied pattern present in a script", () => {
    const result = validateRuntimeScript('const fs = require("fs"); eval("process.exit()"); return globalThis;');

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/require/i),
      expect.stringMatching(/fs/i),
      expect.stringMatching(/eval/i),
      expect.stringMatching(/process/i),
      expect.stringMatching(/globalThis/i)
    ]));
  });
});
