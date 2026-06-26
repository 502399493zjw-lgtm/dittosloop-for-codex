# Create Loop

Read this when the user wants a new Dittos loop or a new formal loop contract.

## Creation Flow

1. Shape the loop contract: title, goal or intent, manual trigger, verification expectations, and whether it needs a structured workflow body.
2. Choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop.
4. New loops should be formal runtime contracts, even when the workflow is compact.
5. Prefer `task` steps with `runtime: "codex"`; old `agent` steps are compatibility aliases.
6. Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
7. When a task needs a local Codex specialist, put the desired `subagent` role, model, tools, and permissions on the task.
8. DittosLoop records and passes subagent hints to the Codex host bridge; it does not enforce tool allowlists itself.

## Contract Shape

Keep the first formal contract small and actionable:

```text
Title: short responsibility name
Goal: what the loop is responsible for
Body: ordered phase, task(runtime: codex), compatibility agent, and parallel steps
Session policy: omit it or use sessionPolicy: "new"; reuse-run/reuse-step are not supported yet
Subagent: optional role/model/tools/permissions hints for Codex task sessions
Verification rubrics: must/should checks
Repair policy: whether failed verification should retry, ask the user, or fail
Stop policy: when the loop should stop
Project binding: optional Codex project id, label, and path
```

The final response after creating a formal loop should state the selected workflow style, the task names and responsibilities, the verifier rubrics, and the repair/stop policy.
