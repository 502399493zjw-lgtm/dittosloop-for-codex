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
