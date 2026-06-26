# Create Loop

Read this when the user wants a new Dittos loop or a new formal loop contract.

## Creation Flow

1. Shape the loop contract: title, goal or intent, manual trigger, verification expectations, and whether it needs a structured workflow body.
2. Choose a workflow style before writing `body.steps`.
3. Use `create_loop_contract` for every new loop.
4. New loops should be formal runtime contracts, even when the workflow is compact.
5. Prefer `task` steps with `runtime: "codex"`; old `agent` steps are compatibility aliases.
6. Current task sessions only support omitted `sessionPolicy` or `sessionPolicy: "new"`.
7. Prefer top-level `agentProfiles` plus per-task `agentProfileRef` for reusable Codex task guidance.
8. Put required installed skills in `requiredSkills` on the profile and use `allowDegradedProfiles: true` only as an explicit escape hatch for real-world testing.
9. Keep legacy `subagent` hints only for compatibility with older task shapes.
10. DittosLoop records expectations and runs a best-effort local preflight; it does not claim native Codex skill enforcement or tool allowlist enforcement.

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

The final response after creating a formal loop should state the selected workflow style, the task names and responsibilities, the verification criteria, validators, decision policy, and repair/stop policy.
