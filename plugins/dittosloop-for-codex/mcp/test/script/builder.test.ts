import { describe, expect, test } from "vitest";

import {
  agent,
  budget,
  human,
  log,
  parallel,
  phase,
  pipeline,
  task,
  workflow
} from "../../src/script/builder.js";

describe("script builders", () => {
  test("task emits a codex task step with optional outputSchema", () => {
    expect(task({ id: "draft", label: "Draft", prompt: "Write the draft." })).toEqual({
      id: "draft",
      kind: "task",
      runtime: "codex",
      label: "Draft",
      prompt: "Write the draft."
    });

    expect(
      task({
        id: "draft",
        label: "Draft",
        prompt: "Write the draft.",
        outputSchema: { type: "object", required: ["summary"] }
      })
    ).toMatchObject({
      kind: "task",
      outputSchema: { type: "object", required: ["summary"] }
    });
  });

  test("agent is a structural alias of task minus runtime and outputSchema", () => {
    const built = agent({ id: "scan", label: "Scan", prompt: "Scan sources." });
    expect(built).toEqual({ id: "scan", kind: "agent", label: "Scan", prompt: "Scan sources." });
    expect(built).not.toHaveProperty("runtime");
    expect(built).not.toHaveProperty("outputSchema");
  });

  test("phase, parallel, and pipeline emit the right shapes", () => {
    const child = task({ id: "a", label: "A", prompt: "..." });

    expect(phase("collect", "Collect", [child])).toEqual({
      id: "collect",
      kind: "phase",
      label: "Collect",
      children: [child]
    });
    expect(parallel("scan", "Scan", [child])).toEqual({
      id: "scan",
      kind: "parallel",
      label: "Scan",
      children: [child]
    });
    expect(pipeline("produce", "Produce", [child])).toEqual({
      id: "produce",
      kind: "phase",
      label: "Produce",
      pipeline: true,
      children: [child]
    });
  });

  test("human emits a codex task with the human marker and the question as prompt", () => {
    expect(human("signoff", "Sign-off", "Approve the report?")).toEqual({
      id: "signoff",
      kind: "task",
      runtime: "codex",
      label: "Sign-off",
      prompt: "Approve the report?",
      human: true
    });
  });

  test("workflow folds budget and log directives into the contract", () => {
    const built = workflow({
      steps: [
        log("daily upstream scan"),
        budget(2),
        phase("collect", "Collect", [task({ id: "a", label: "A", prompt: "..." })])
      ]
    });

    expect(built.budgetUsd).toBe(2);
    expect(built.logs).toEqual(["daily upstream scan"]);
    expect(built.steps).toEqual([
      { id: "collect", kind: "phase", label: "Collect", children: [{ id: "a", kind: "task", runtime: "codex", label: "A", prompt: "..." }] }
    ]);
  });

  test("workflow omits budget and logs when no directives are present", () => {
    const built = workflow({ steps: [task({ id: "a", label: "A", prompt: "..." })] });
    expect(built).toEqual({ steps: [{ id: "a", kind: "task", runtime: "codex", label: "A", prompt: "..." }] });
  });
});
