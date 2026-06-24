import { describe, expect, test } from "vitest";

import { runBody } from "../src/engine/runBody.js";
import { runFlow } from "../src/engine/runFlow.js";
import type { EngineEvent, Executor } from "../src/engine/types.js";

describe("engine runtime", () => {
  test("runBody maps phase, agent, and parallel steps onto FlowApi", async () => {
    const calls: string[] = [];
    const result = await runBody(
      {
        steps: [
          {
            id: "phase-1",
            kind: "phase",
            label: "Collect",
            children: [
              { id: "scan", kind: "agent", label: "Scan", prompt: "scan prompt" },
              {
                id: "parallel-1",
                kind: "parallel",
                label: "Parallel",
                children: [
                  { id: "a", kind: "agent", label: "A", prompt: "a prompt" },
                  { id: "b", kind: "agent", label: "B", prompt: "b prompt" }
                ]
              }
            ]
          }
        ]
      },
      {
        phase(title) {
          calls.push(`phase:${title}`);
          return {
            done(status = "ok") {
              calls.push(`phase_done:${title}:${status}`);
            }
          };
        },
        async agent(prompt, opts) {
          calls.push(`agent:${opts?.label}:${prompt}`);
          return `${opts?.label}:result`;
        },
        async parallel(tasks) {
          calls.push("parallel");
          return Promise.all(tasks.map((task) => task()));
        },
        log() {},
        commit() {}
      }
    );

    expect(calls).toEqual([
      "phase:Collect",
      "agent:Scan:scan prompt",
      "parallel",
      "agent:A:a prompt",
      "agent:B:b prompt",
      "phase_done:Collect:ok"
    ]);
    expect(result).toEqual([["Scan:result", ["A:result", "B:result"]]]);
  });

  test("runFlow emits run and agent events", async () => {
    const events: EngineEvent[] = [];
    const executor: Executor = {
      async run(req) {
        return { text: `result:${req.prompt}` };
      }
    };

    const out = await runFlow(
      async (api) => {
        const phase = api.phase("Work", { phaseId: "work" });
        const result = await api.agent("do work", { label: "Worker" });
        phase.done("ok");
        return result;
      },
      {
        runId: "run_1",
        executor,
        emit: (event) => events.push(event),
        now: () => "2026-06-24T00:00:00.000Z"
      }
    );

    expect(out).toEqual({ status: "completed", result: "result:do work" });
    expect(events.map((event) => event.type)).toEqual([
      "run_started",
      "phase_started",
      "agent_started",
      "agent_done",
      "phase_done",
      "run_completed"
    ]);
    expect(events.find((event) => event.type === "phase_done")).toMatchObject({
      runId: "run_1",
      phaseId: "work",
      title: "Work",
      status: "ok"
    });
    expect(events.find((event) => event.type === "agent_started")).toMatchObject({
      runId: "run_1",
      label: "Worker"
    });
  });

  test("runBody preserves the parent phase id on nested agent events", async () => {
    const events: EngineEvent[] = [];
    const executor: Executor = {
      async run(req) {
        expect(req).toMatchObject({
          label: "Collector",
          stepId: "collect-agent",
          phaseId: "collect"
        });
        return { text: "collected" };
      }
    };

    await runFlow(
      (api) => runBody({
        steps: [
          {
            id: "collect",
            kind: "phase",
            label: "采集",
            children: [{ id: "collect-agent", kind: "agent", label: "Collector", prompt: "Collect facts" }]
          }
        ]
      }, api),
      {
        runId: "run_phase",
        executor,
        emit: (event) => events.push(event),
        now: () => "2026-06-24T00:00:00.000Z"
      }
    );

    expect(events.find((event) => event.type === "agent_started")).toMatchObject({
      type: "agent_started",
      stepId: "collect-agent",
      phaseId: "collect"
    });
    expect(events.find((event) => event.type === "agent_done")).toMatchObject({
      type: "agent_done",
      stepId: "collect-agent",
      phaseId: "collect"
    });
  });
});
