import { expect, test } from "vitest";

import { HostMediatedSessionBridge } from "../src/codex/hostMediatedBridge.js";

test("host-mediated bridge records session requests and accepts results", async () => {
  const bridge = new HostMediatedSessionBridge({ now: () => "2026-06-24T00:00:00.000Z" });

  const ref = await bridge.createSession({
    runId: "run_1",
    stepId: "scan",
    title: "Scan updates",
    projectPath: "/tmp/project"
  });

  await bridge.sendMessage(ref.sessionId, { text: "Run scan" });
  await bridge.recordResult(ref.sessionId, {
    status: "completed",
    text: "Scan complete",
    threadId: "thread_1",
    threadUrl: "codex://thread/thread_1"
  });

  await expect(bridge.readResult(ref.sessionId)).resolves.toMatchObject({
    status: "completed",
    text: "Scan complete",
    threadId: "thread_1"
  });
  expect(bridge.getRequests()).toHaveLength(1);
});

test("host-mediated bridge preserves workflow launch context for the Codex host", async () => {
  const bridge = new HostMediatedSessionBridge({
    now: () => "2026-06-24T00:00:00.000Z",
    makeId: () => "session_1"
  });
  const workflowPlan = {
    runtime: "dittosloop-local-workflow" as const,
    contractId: "loop_1",
    goal: "Generate a daily report",
    steps: [
      { id: "research", kind: "phase" as const, label: "Research", depth: 0 },
      {
        id: "collect",
        kind: "agent" as const,
        label: "Collect sources",
        depth: 1,
        phaseId: "research",
        prompt: "Collect official sources.",
        sessionPolicy: "new" as const
      }
    ],
    verification: {
      mode: "after_workflow" as const,
      rubrics: [{ id: "sources", label: "Sources", requirement: "Cites official sources", severity: "must" as const }]
    },
    repairPolicy: { maxAttempts: 2, strategy: "repair_then_retry" as const },
    stopPolicy: { rule: "Stop after a verified report" }
  };

  const ref = await bridge.createSession({
    runId: "run_1",
    stepId: "collect",
    phaseId: "research",
    title: "Collect sources",
    prompt: "You are running the Collect sources workflow step.",
    workflowRuntime: "dittosloop-local-workflow",
    workflowContractId: "loop_1",
    workflowPlan,
    projectId: "project_1",
    projectLabel: "dittos loop",
    projectPath: "/tmp/project"
  });

  expect(ref).toMatchObject({
    sessionId: "session_1",
    runId: "run_1",
    stepId: "collect",
    phaseId: "research",
    workflowContractId: "loop_1"
  });
  expect(bridge.getRequests()).toMatchObject([
    {
      sessionId: "session_1",
      runId: "run_1",
      stepId: "collect",
      phaseId: "research",
      prompt: "You are running the Collect sources workflow step.",
      workflowRuntime: "dittosloop-local-workflow",
      workflowContractId: "loop_1",
      workflowPlan: {
        contractId: "loop_1",
        steps: [expect.objectContaining({ id: "research" }), expect.objectContaining({ id: "collect", phaseId: "research" })]
      },
      projectLabel: "dittos loop",
      messages: []
    }
  ]);
});
