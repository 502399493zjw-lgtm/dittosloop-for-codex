import type { LoopContract } from "../types.js";
import { compileContract } from "./compileContract.js";
import type { FormalLoopContract } from "./types.js";

type MaybeFormalLoopContract = FormalLoopContract | LoopContract;

export function migrateLegacyContract(loop: MaybeFormalLoopContract): FormalLoopContract {
  if (isFormalContract(loop)) {
    return compileContract(loop, loop.updatedAt);
  }

  const goal = loop.intent || loop.title;
  const projectBinding =
    loop.codexProjectId || loop.projectLabel || loop.projectPath
      ? {
          codexProjectId: loop.codexProjectId,
          projectLabel: loop.projectLabel,
          projectPath: loop.projectPath
        }
      : undefined;

  return compileContract(
    {
      id: loop.id,
      title: loop.title,
      goal,
      intent: loop.intent,
      body: {
        steps: [{ id: "legacy-agent", kind: "agent", label: "Run loop", prompt: goal }]
      },
      trigger: loop.trigger,
      verification: {
        mode: "after_workflow",
        rubrics: loop.verification.checks.map((check, index) => ({
          id: `check-${index + 1}`,
          label: check,
          requirement: check,
          severity: "must"
        }))
      },
      projectBinding,
      status: loop.status,
      createdAt: loop.createdAt,
      updatedAt: loop.updatedAt
    },
    loop.updatedAt
  );
}

function isFormalContract(loop: MaybeFormalLoopContract): loop is FormalLoopContract {
  return "goal" in loop && "body" in loop && "repairPolicy" in loop && "stopPolicy" in loop;
}
