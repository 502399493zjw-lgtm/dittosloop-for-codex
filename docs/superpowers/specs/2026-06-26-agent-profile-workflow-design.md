# Agent Profile Workflow Design

Status: ready for review before implementation planning starts.

## Context

The current DittosLoop For Codex runtime has a session-first workflow model: a visible Codex worker session owns the run, calls `execute_workflow_attempt`, writes task results back with `record_session_result`, and records verification before completion.

That model is sound, but the current workflow agent boundary is too soft. A step may carry `subagent` metadata such as `role`, `model`, `tools`, `workdir`, and `permissions`, but the runtime stores and passes those hints through without resolving them into a repeatable execution environment. The generated per-loop workspace file at `skill/dittosloop-for-codex-loop.md` is also a guide artifact, not an installed Codex skill, which makes the word `skill` misleading.

The original Dittos Loop dynamic workflow model is cleaner: the workflow chooses an agent, and the agent's runtime environment determines which skills and instructions are available. Claude Code gets this indirectly from the agent working directory and global/user skill locations. DittosLoop For Codex needs the same conceptual boundary without depending on private Codex App APIs.

## Goals

- Make workflow steps choose an agent profile rather than implicitly relying on whatever skills the current Codex session can see.
- Keep the visible Codex session as the top-level orchestrator.
- Keep `task` steps with `runtime: "codex"` as the preferred executable step shape.
- Preserve existing contracts that use inline `subagent` hints.
- Add explicit required skill declarations and best-effort preflight before a run starts.
- Keep workflow structure independent from direct per-step skill binding.
- Rename or reposition the per-loop generated `skill/` artifact so it no longer looks like a loadable skill.

## Non-Goals

- Do not make workflow steps invoke a skill directly.
- Do not create one installed Codex skill per loop.
- Do not rely on hidden background automation or plugin hooks.
- Do not claim DittosLoop can enforce Codex skill loading until Codex exposes a native launcher or skill selection API.
- Do not remove existing `subagent` contracts in the first migration.

## Approaches Considered

### Approach A: Leave Skills Implicit

The runtime would keep storing `subagent` hints and rely on the visible Codex session's current plugin and skill environment. This is the smallest change, but it keeps loop behavior under-specified and makes failures hard to explain when a worker cannot see a needed skill.

Rejected because it does not match the dynamic workflow model.

### Approach B: Bind Workflow Steps Directly To Skills

Each step would declare `skillRefs`, and the runtime would tell the worker to use those skills. This is explicit, but it collapses agent identity into skill selection. It also makes future model, tool, permission, and workdir boundaries awkward.

Rejected because workflow should pick the right worker role, not micromanage capability loading.

### Approach C: Introduce Agent Profiles

The contract defines reusable agent profiles. A workflow step references one profile, and the profile owns role, model, workdir, required skills, allowed tools, permissions, env, and contextual instructions. Current inline `subagent` fields become compatibility overrides that normalize into an anonymous profile.

Chosen because it mirrors the dynamic workflow structure while staying compatible with the current Codex plugin boundary.

## Contract Shape

Add a reusable profile catalog to the formal contract:

```ts
export interface AgentProfile {
  id: string;
  label: string;
  role: string;
  instructions?: string;
  model?: string;
  workdir?: string;
  requiredSkills?: SkillRequirement[];
  advisorySkills?: SkillRequirement[];
  allowedTools?: string[];
  permissions?: {
    filesystem?: "read-only" | "workspace-write" | "danger-full-access";
    network?: "enabled" | "disabled";
  };
  env?: Record<string, string>;
  context?: Record<string, unknown>;
}

export interface SkillRequirement {
  id: string;
  source?: "plugin" | "project" | "user" | "system";
  pluginId?: string;
  version?: string;
}

export interface FormalLoopContract {
  agentProfiles?: Record<string, AgentProfile>;
  body: ExecutionBody;
}
```

Steps should reference profiles by id:

```ts
{
  id: "scan-updates",
  kind: "task",
  runtime: "codex",
  label: "Scan upstream updates",
  prompt: "Find relevant updates and summarize what changed.",
  agentProfileRef: "researcher",
  sessionPolicy: "new"
}
```

The existing `subagent` field remains valid:

```ts
{
  id: "scan-updates",
  kind: "task",
  runtime: "codex",
  label: "Scan upstream updates",
  prompt: "Find relevant updates.",
  subagent: {
    ref: "researcher",
    role: "Researcher",
    model: "gpt-5",
    tools: ["web"],
    workdir: "/path/to/project"
  }
}
```

Normalization rules:

- If `agentProfileRef` is present, it must reference `contract.agentProfiles`.
- If `subagent.ref` matches a profile id, the step uses that profile and applies inline `subagent` fields as step-level overrides.
- If no profile exists, inline `subagent` becomes an anonymous profile for that step.
- `subagent.tools` maps to `allowedTools` during normalization.
- New generated contracts should prefer `agentProfiles` plus `agentProfileRef`.

## Runtime Behavior

`create_loop_contract` validates profile ids, profile references, required skill declaration shapes, and workdir values. It should reject references to missing profiles and contradictory inline overrides.

`start_codex_session` computes a profile preflight report before creating the visible run. Required skill failures block launch with an actionable message unless the caller explicitly passes an option such as `allowDegradedProfiles: true`. Advisory skill failures become warnings in run detail and preview.

`execute_workflow_attempt` passes normalized profile data into each `WorkflowTaskRun`. The task run stores the effective profile snapshot so later workflow revisions cannot change the environment of an already pending task.

The session prompt includes:

- the profile catalog,
- each step's effective profile id and label,
- required skills and advisory skills,
- workdir and permission expectations,
- a reminder that the visible worker session is the orchestrator and must not silently ignore missing required skills.

The current host-mediated bridge may only record and request this profile. It does not enforce native skill loading. The contract and run state should still be explicit so a future Codex-native profile launcher can honor the same fields without another contract redesign.

## Skill Preflight

Preflight is local and conservative:

- Check installed plugin skills when the skill requirement names a plugin id and skill id that are visible in the local Codex plugin cache.
- Check project skills when a profile declares `source: "project"` and `workdir` is present.
- Check user/system skills when they are discoverable under the local Codex skill roots.
- Return `unknown` rather than `passed` when the runtime cannot prove availability.

Required skills with status `missing` or `unknown` should block launch by default. The error should name the profile, step, missing skill id, and suggested install or workdir fix. Advisory skills never block launch.

When `allowDegradedProfiles: true` is used, the run starts but stores a degraded-mode warning on the run and on each affected task profile snapshot. The prompt must also tell the visible worker session which required skills could not be proven available.

## Workspace Files

New loop workspace generation should stop creating `skill/dittosloop-for-codex-loop.md` as if it were a loadable skill. Replace it with a runtime guide path such as:

```text
runtime/dittosloop-for-codex-loop.md
```

The content can remain short, but it should say clearly:

- this is a loop runtime guide,
- the installed plugin skill is `dittosloop-for-codex:loop`,
- workflow steps use agent profiles,
- verifier rubrics are an outer validation layer.

Existing loop directories may retain the old `skill/` file until the normal workspace sync rewrites them. New generated files should not introduce a `skill/` folder unless the runtime eventually creates a real installed skill, which is out of scope here.

## Preview Requirements

Run detail and preview should show:

- declared agent profiles,
- each task's effective profile snapshot,
- required and advisory skill preflight status,
- profile workdir, model, allowed tools, and permissions,
- any degraded-mode warning when the user chooses to continue despite missing required skills.

The preview remains display-only and must not be the source of truth for profile edits.

## Migration

- Existing contracts without `agentProfiles` continue to load.
- Existing `subagent` metadata normalizes into effective profiles at runtime.
- New loop creation guidance should prefer reusable profiles when a workflow has more than one specialized role.
- Existing persisted task runs keep their stored `subagent` metadata and may show it as a legacy inline profile.
- Workflow revisions may introduce `agentProfiles`, but in-flight pending task sessions continue using their original effective profile snapshots.

## Validation Strategy

Implementation should cover:

- contract tests for `agentProfiles`, `agentProfileRef`, inline `subagent` compatibility, and invalid profile refs,
- service tests for start preflight passed, missing, unknown, and advisory-only cases,
- workflow tests proving task runs store the effective profile snapshot,
- prompt tests proving profile catalog and required skills appear in the visible session prompt,
- workspace file tests proving new loop workspaces no longer create a misleading `skill/` guide path,
- preview tests for profile and preflight display.

## Acceptance Criteria

- New contracts can define reusable agent profiles and reference them from workflow steps.
- Old contracts that only use `subagent` still validate and run.
- Required missing or unknown skills block launch by default with an actionable message.
- Advisory missing or unknown skills warn but do not block launch.
- Task runs persist their effective profile snapshot.
- The visible Codex session prompt includes profile and skill requirements.
- New workspace generation uses a non-`skill/` runtime guide path.
- No implementation claims native Codex skill enforcement unless the host actually provides it.
- Repository validation passes, or any failure is documented with a concrete blocker.
