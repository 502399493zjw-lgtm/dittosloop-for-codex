# Create Loop

Read this when the user wants a new Dittos loop or a new formal loop contract.

## Creation Method

Before calling `create_loop_contract`, keep the interaction lightweight and explicit:

1. Restate the inferred loop goal, boundary, trigger, and expected outputs.
2. Make reasonable defaults for low-risk details instead of asking for every missing field.
3. Ask follow-up questions only for missing details that affect safety, permissions, cost, destructive actions, external side effects, project binding, or verification.
4. When verification expectations are material, show a compact `Rubric Draft` before creating the contract. Include success criteria, `must` versus `should` severity, validators, evidence requirements, and failure handling.
5. For obvious, low-risk loops, state the inferred rubric and continue with reasonable defaults. For vague or high-impact loops, ask the user to confirm or correct the rubric before creating the contract.
6. If the request is vague but safe, propose a compact contract draft and ask the user to confirm or correct it.
7. Convert the agreed or safely inferred shape into a formal loop contract.

Use a user-facing rubric draft instead of raw JSON:

```text
Rubric Draft
- Must: the result satisfies the loop's primary goal with evidence.
- Should: the result follows the user's preferred format and tone.
- Validators: automated commands, script evaluators, rubric agents, human review, or a mix.
- Evidence: command output, cited sources, artifact links, or reviewer notes.
- Failure handling: repair, ask the user, or fail the run.
```

When the rubric draft needs a custom `script evaluator`, start a visible evaluator-builder subagent before calling `create_loop_contract`. The evaluator-builder subagent must create the evaluator script, create a fixture or dry-run sample, run a self-check, report the script checksum, and confirm that stdout uses the `verification_result_v1` JSON shape. Register the script validator only after the self-check passes; otherwise keep the loop as not created and tell the user what blocked evaluator setup.

## Creation Flow

1. Shape the loop contract: title, goal or intent, manual trigger, verification expectations, and whether it needs a structured workflow body.
2. Choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop.
4. After `create_loop_contract` succeeds, call `get_preview_url` so the user can inspect the created loop.
5. New loops should be formal runtime contracts, even when the workflow is compact.
6. Prefer `task` steps with `runtime: "codex"`; old `agent` steps are compatibility aliases.
7. Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
8. Prefer top-level `agentProfiles` plus per-task `agentProfileRef` for reusable Codex task guidance.
9. Put required installed skills in `requiredSkills` on the profile and use `allowDegradedProfiles: true` only as an explicit escape hatch for real-world testing.
10. Keep legacy `subagent` hints only for compatibility with older task shapes.
11. DittosLoop records expectations and runs a best-effort local preflight; it does not claim native Codex skill enforcement or tool allowlist enforcement.

## Contract Shape

Keep the first formal contract small and actionable:

```text
Title: short responsibility name
Goal: what the loop is responsible for
Body: ordered phase, task(runtime: codex), compatibility agent, and parallel steps
Session policy: omit it or use sessionPolicy: "new"; reuse-run/reuse-step are not supported yet
Agent profiles: optional reusable Codex task profiles keyed in `agentProfiles`
Task binding: optional `agentProfileRef` on each Codex task step
Required skills: optional `requiredSkills` on a profile; use `allowDegradedProfiles: true` only when degraded launch is acceptable
Subagent: optional compatibility-only role/model/tools/permissions hints for Codex task sessions
Verification: criteria, validators, decision policy
Repair policy: whether failed verification should retry, ask the user, or fail
Stop policy: when the loop should stop
Project binding: optional Codex project id, label, and path
```

Prefer a compact contract shape like:

```json
{
  "agentProfiles": {
    "researcher": {
      "id": "researcher",
      "label": "Researcher",
      "role": "Collect and verify source evidence",
      "requiredSkills": [{ "id": "openai-docs", "source": "system" }],
      "allowedTools": ["rg", "sed"]
    }
  },
  "body": {
    "steps": [
      {
        "id": "scan",
        "kind": "task",
        "runtime": "codex",
        "label": "Scan",
        "prompt": "Collect source evidence.",
        "agentProfileRef": "researcher"
      }
    ]
  },
  "verification": {
    "version": 2,
    "mode": "after_workflow",
    "criteria": [
      {
        "id": "source-quality",
        "label": "Source quality",
        "description": "The result cites reliable source evidence.",
        "severity": "must"
      }
    ],
    "validators": [
      {
        "id": "quality-review",
        "type": "rubric_agent",
        "label": "Quality review",
        "criteriaIds": ["source-quality"],
        "scoreScale": { "min": 0, "max": 1 },
        "passScore": 1,
        "evidenceRequired": true,
        "severity": "must"
      }
    ],
    "decision": {
      "requireAllMustCriteriaCovered": true,
      "failOnMustValidatorFailure": true,
      "failOnShouldValidatorFailure": false,
      "requireEvidenceForAgentScores": true
    }
  }
}
```

Generated per-loop guidance lives at `skill/dittosloop-for-codex-loop.md`. It is a run-specific local skill guide, not a new installed marketplace skill.

The final response after creating a formal loop should state the created `loopId`, the local DittosLoop board URL from `get_preview_url`, the selected workflow style, the task names and responsibilities, the verification criteria, validators, decision policy, and repair/stop policy.

If `get_preview_url` fails or is unavailable, still report the created `loopId` and state that the local board URL could not be retrieved.
