import { describe, expect, test } from "vitest";

import { evalScriptAst } from "../../src/script/evalScript.js";
import { budget, log, parallel, phase, pipeline, task, human, workflow } from "../../src/script/builder.js";

describe("evalScriptAst", () => {
  test("compiles a JSON builder-call AST to the same workflow as the hand-written builders", () => {
    const ast = {
      build: [
        { fn: "log", args: ["daily upstream scan"] },
        { fn: "budget", args: [2] },
        {
          fn: "phase",
          args: [
            "collect",
            "Collect",
            [
              {
                fn: "parallel",
                args: [
                  "scan",
                  "Scan sources",
                  [
                    { fn: "task", args: [{ id: "scan-a", label: "Scan A", prompt: "..." }] },
                    { fn: "task", args: [{ id: "scan-b", label: "Scan B", prompt: "..." }] }
                  ]
                ]
              }
            ]
          ]
        },
        {
          fn: "pipeline",
          args: [
            "produce",
            "Produce report",
            [
              { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "...", outputSchema: { type: "object", required: ["summary"] } }] },
              { fn: "task", args: [{ id: "review", label: "Review", prompt: "..." }] }
            ]
          ]
        },
        { fn: "human", args: ["signoff", "Human sign-off", "Approve the report?"] }
      ]
    };

    const expected = workflow({
      steps: [
        log("daily upstream scan"),
        budget(2),
        phase("collect", "Collect", [
          parallel("scan", "Scan sources", [
            task({ id: "scan-a", label: "Scan A", prompt: "..." }),
            task({ id: "scan-b", label: "Scan B", prompt: "..." })
          ])
        ]),
        pipeline("produce", "Produce report", [
          task({ id: "draft", label: "Draft", prompt: "...", outputSchema: { type: "object", required: ["summary"] } }),
          task({ id: "review", label: "Review", prompt: "..." })
        ]),
        human("signoff", "Human sign-off", "Approve the report?")
      ]
    });

    expect(evalScriptAst(ast)).toEqual(expected);
  });

  test("throws on an unknown fn", () => {
    expect(() => evalScriptAst({ build: [{ fn: "exec", args: ["rm -rf /"] }] })).toThrow(/Unknown builder fn: exec/);
  });

  test("treats a code-like string arg as a plain prompt, never as code", () => {
    const built = evalScriptAst({
      build: [{ fn: "task", args: [{ id: "x", label: "X", prompt: "process.exit(1); require('fs')" }] }]
    });
    expect(built.steps).toEqual([
      { id: "x", kind: "task", runtime: "codex", label: "X", prompt: "process.exit(1); require('fs')" }
    ]);
  });

  test("rejects a missing build array", () => {
    expect(() => evalScriptAst({} as never)).toThrow(/build array/);
  });
});
