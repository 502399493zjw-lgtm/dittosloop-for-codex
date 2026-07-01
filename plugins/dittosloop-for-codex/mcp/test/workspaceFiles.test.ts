import { describe, expect, test } from "vitest";

import { compileContract } from "../src/contract/compileContract.js";
import { createEmptyState } from "../src/store.js";
import type { LoopContract, LoopState } from "../src/types.js";
import { loopWorkspaceFiles } from "../src/workspaceFiles.js";

const fixedTime = "2026-06-29T00:00:00.000Z";

function verification() {
  return {
    mode: "after_workflow" as const,
    rubrics: [
      {
        id: "done",
        label: "Done",
        requirement: "The workflow result satisfies the loop goal.",
        severity: "must" as const
      }
    ]
  };
}

function baseLoopContract(loopId: string, title: string): LoopContract {
  return {
    id: loopId,
    title,
    intent: `${title} intent`,
    trigger: { mode: "manual" },
    verification: { checks: ["done"] },
    status: "active",
    createdAt: fixedTime,
    updatedAt: fixedTime
  };
}

function workspaceState(input: { loop: LoopContract; formalContract: ReturnType<typeof compileContract> }): LoopState {
  return {
    ...createEmptyState(),
    loops: [input.loop],
    formalContracts: [input.formalContract]
  };
}

describe("loopWorkspaceFiles", () => {
  test("static workflows keep body steps in workflow and contract files", () => {
    const formalContract = compileContract(
      {
        id: "loop_static_workspace",
        title: "Static workspace",
        goal: "Render static workflow files",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan the project." }]
        },
        verification: verification()
      },
      fixedTime
    );
    const files = loopWorkspaceFiles(
      workspaceState({
        loop: baseLoopContract(formalContract.id, formalContract.title),
        formalContract
      }),
      formalContract.id
    );

    const workflowFile = files.find((file) => file.path === "workflow.json");
    const contractFile = files.find((file) => file.path === "contract.json");

    expect(workflowFile).toMatchObject({ kind: "workflow", language: "json" });
    expect(JSON.parse(workflowFile!.content)).toMatchObject({
      workflow: {
        kind: "static_steps",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan the project." }]
        }
      },
      body: {
        steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan the project." }]
      }
    });
    expect(JSON.parse(contractFile!.content)).toMatchObject({
      formalContract: {
        workflow: {
          kind: "static_steps",
          body: {
            steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan the project." }]
          }
        },
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan the project." }]
        }
      }
    });
  });

  test("runtime script workflows render the runtime file and preserve runtime workflow kind", () => {
    const source = "const result = await agent('Inspect risky files');\nreturn result;\n";
    const formalContract = compileContract(
      {
        id: "loop_runtime_workspace",
        workflowKind: "runtime_script",
        title: "Runtime workspace",
        goal: "Render runtime workflow files",
        script: source,
        args: { focus: "risky-files" },
        limits: { maxAgentCalls: 3 },
        verification: verification()
      } as any,
      fixedTime
    );
    const files = loopWorkspaceFiles(
      workspaceState({
        loop: baseLoopContract(formalContract.id, formalContract.title),
        formalContract
      }),
      formalContract.id
    );

    const workflowFile = files.find((file) => file.path === "workflow.json");
    const runtimeFile = files.find((file) => file.path === "runtime.js");
    const contractFile = files.find((file) => file.path === "contract.json");
    const paths = files.map((file) => file.path);

    expect(paths).toEqual([
      "memory.md",
      "workflow.json",
      "runtime.js",
      "verification.md",
      "status.json",
      "contract.json"
    ]);
    expect(paths).not.toContain("skill/dittosloop-for-codex-loop.md");
    expect(paths).not.toContain("runtime/dittosloop-for-codex-loop.md");

    expect(runtimeFile).toMatchObject({
      path: "runtime.js",
      kind: "runtime",
      language: "javascript",
      content: source
    });
    expect(JSON.parse(workflowFile!.content)).toMatchObject({
      workflow: {
        kind: "runtime_script",
        language: "javascript",
        source,
        args: { focus: "risky-files" },
        limits: { maxAgentCalls: 3 },
        approval: { required: true }
      }
    });
    expect(JSON.parse(contractFile!.content)).toMatchObject({
      formalContract: {
        workflow: {
          kind: "runtime_script",
          language: "javascript",
          source,
          args: { focus: "risky-files" },
          limits: { maxAgentCalls: 3 },
          approval: { required: true }
        }
      }
    });
  });
});
