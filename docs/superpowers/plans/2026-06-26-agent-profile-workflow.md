# Agent Profile Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement reusable workflow agent profiles for DittosLoop For Codex so loop steps choose explicit worker environments, skill requirements are checked before launch, and run/task state records the effective profile used.

**Architecture:** Extend the formal contract with `agentProfiles` and `agentProfileRef`, keep legacy `subagent` hints as compatibility overrides, resolve every executable step to an effective profile snapshot, run local conservative skill preflight in `start_codex_session`, persist profile/preflight data through run state, workflow task runs, session bridge requests, workspace files, and preview display, and rename the generated per-loop guide from `skill/` to `runtime/`.

**Tech Stack:** TypeScript, Zod, Vitest, Node fs/path APIs, existing DittosLoop MCP service/store, existing preview JavaScript/CSS, existing plugin validation scripts.

## Global Constraints

- Work only in the `codex/agent-profiles-workflow` worktree.
- Preserve all existing contracts that only use `subagent`.
- Keep `task` with `runtime: "codex"` as the preferred executable workflow step.
- Do not claim native Codex skill enforcement; this implementation records expectations and performs best-effort local preflight only.
- Required skills with `missing` or `unknown` status block `start_codex_session` unless `allowDegradedProfiles: true` is passed.
- Advisory skill failures warn but never block.
- Store effective profile snapshots on pending/running task state so later workflow revisions cannot mutate already-launched task environments.
- Use TDD for each implementation step: add or update the focused test first, confirm it fails for the expected reason, then implement.
- Keep generated local state outside committed files.
- Do not merge this branch without explicit user approval.

---

## Task 1: Add contract profile types, validation, and normalization

- [x] Task status

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts`
  - `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
  - `plugins/dittosloop-for-codex/mcp/src/service.ts`
  - `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

  Add tests first:

  - A contract with `agentProfiles.researcher` and a task with `agentProfileRef: "researcher"` validates.
  - `resolveEffectiveAgentProfile(contract, step)` returns a profile with `id`, `label`, `role`, `requiredSkills`, `advisorySkills`, `allowedTools`, `permissions`, and `source: "declared"`.
  - A task whose legacy `subagent.ref` matches a declared profile validates and inline `subagent` fields override profile defaults.
  - A task whose `agentProfileRef` points to a missing profile throws an error mentioning `agentProfileRef`.
  - Invalid skill requirement ids, invalid skill sources, invalid `allowedTools`, and invalid profile permissions throw actionable validation errors.

  Test command:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
  ```

  Expected first failure:

  - TypeScript or Vitest fails because `agentProfiles`, `agentProfileRef`, and `resolveEffectiveAgentProfile` do not exist yet.

  Implementation notes:

  - Extend `CodexSubagentSpec` only where needed for compatibility; do not remove current fields.
  - Add contract profile types:

    ```ts
    export type SkillRequirementSource = "plugin" | "project" | "user" | "system";

    export interface SkillRequirement {
      id: string;
      source?: SkillRequirementSource;
      pluginId?: string;
      version?: string;
    }

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
      permissions?: CodexSubagentSpec["permissions"];
      env?: Record<string, string>;
      timeoutMs?: number;
      context?: Record<string, unknown>;
    }

    export interface EffectiveAgentProfile extends AgentProfile {
      source: "declared" | "legacy-inline";
      stepId: string;
      requestedRef?: string;
      requiredSkills: SkillRequirement[];
      advisorySkills: SkillRequirement[];
    }
    ```

  - Add `agentProfiles?: Record<string, AgentProfile>` to `FormalLoopContract`.
  - Add `agentProfileRef?: string` to `AgentStep` and `TaskStep`.
  - Add `plugins/dittosloop-for-codex/mcp/src/contract/agentProfiles.ts` with:

    ```ts
    export function resolveEffectiveAgentProfile(
      contract: FormalLoopContract,
      step: AgentStep | TaskStep
    ): EffectiveAgentProfile | undefined;

    export function resolveEffectiveProfilesByStep(
      contract: FormalLoopContract
    ): Map<string, EffectiveAgentProfile>;

    export function effectiveProfileToSubagent(
      profile: EffectiveAgentProfile | undefined,
      legacySubagent?: CodexSubagentSpec
    ): CodexSubagentSpec | undefined;
    ```

  - Normalization rules:
    - `agentProfileRef` wins when present and must point to `contract.agentProfiles`.
    - If no `agentProfileRef` exists and `subagent.ref` matches a profile id, use that profile.
    - Inline `subagent` values override profile fields for compatibility.
    - `subagent.tools` maps to `allowedTools`.
    - If no declared profile is found but inline `subagent` exists, create a legacy inline effective profile.
  - Update `applyContractPatch` in `service.ts` to preserve `agentProfiles` across workflow revisions.

## Task 2: Expose profile fields through MCP schemas

- [x] Task status

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
  - `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`

  Add tests first:

  - `create_loop_contract` accepts `agentProfiles` and `agentProfileRef`.
  - `start_codex_session` accepts `allowDegradedProfiles`.
  - Existing `subagent` tool passthrough tests still pass unchanged.

  Test command:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts
  ```

  Expected first failure:

  - Zod strips or rejects `agentProfiles`, `agentProfileRef`, and `allowDegradedProfiles`.

  Implementation notes:

  - Add shared Zod schemas:

    ```ts
    const skillRequirementSchema = z.object({
      id: z.string().min(1),
      source: z.enum(["plugin", "project", "user", "system"]).optional(),
      pluginId: z.string().min(1).optional(),
      version: z.string().min(1).optional()
    });

    const agentProfileSchema = z.object({
      id: z.string().min(1),
      label: z.string().min(1),
      role: z.string().min(1),
      instructions: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
      workdir: z.string().min(1).optional(),
      requiredSkills: z.array(skillRequirementSchema).optional(),
      advisorySkills: z.array(skillRequirementSchema).optional(),
      allowedTools: z.array(z.string().min(1)).optional(),
      permissions: subagentSchema.shape.permissions.optional(),
      env: z.record(z.string()).optional(),
      timeoutMs: z.number().int().positive().optional(),
      context: z.record(z.unknown()).optional()
    });
    ```

  - Add `agentProfileRef` to both executable step schemas.
  - Add `agentProfiles: z.record(agentProfileSchema).optional()` to `createLoopContractSchema`.
  - Add `allowDegradedProfiles: z.boolean().optional()` to `startCodexSessionSchema`.
  - Pass `allowDegradedProfiles` into `service.startCodexSessionRun`.

## Task 3: Implement local conservative skill preflight

- [x] Task status

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/codex/skillPreflight.ts`
  - `plugins/dittosloop-for-codex/mcp/src/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/service.ts`
  - `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

  Add tests first:

  - Required plugin skill found in an injected fake provider allows `startCodexSessionRun`.
  - Required skill marked `missing` blocks `startCodexSessionRun` by default and names the profile, step, and skill id.
  - Required skill marked `unknown` also blocks by default.
  - Advisory missing/unknown skills do not block and are stored as warnings.
  - `allowDegradedProfiles: true` starts the run and stores degraded warnings.

  Test command:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "profile preflight"
  ```

  Expected first failure:

  - `LoopServiceOptions` has no skill availability injection and `startCodexSessionRun` never checks profile requirements.

  Implementation notes:

  - Add preflight result types in `types.ts`:

    ```ts
    export type SkillPreflightStatus = "passed" | "missing" | "unknown";

    export interface SkillPreflightCheck {
      profileId: string;
      profileLabel: string;
      stepId?: string;
      skill: SkillRequirement;
      required: boolean;
      status: SkillPreflightStatus;
      message: string;
      locations?: string[];
    }

    export interface SkillPreflightReport {
      status: "passed" | "warning" | "blocked" | "degraded";
      checks: SkillPreflightCheck[];
      warnings: string[];
      blockers: string[];
      allowDegradedProfiles?: boolean;
    }
    ```

  - Add `SkillAvailabilityProvider` in `skillPreflight.ts` and accept it in `LoopServiceOptions`:

    ```ts
    export interface SkillAvailabilityProvider {
      check(requirement: SkillRequirement, profile: EffectiveAgentProfile): Promise<{
        status: SkillPreflightStatus;
        message: string;
        locations?: string[];
      }>;
    }
    ```

  - Default provider:
    - Use `process.env.CODEX_HOME ?? join(homedir(), ".codex")`.
    - Plugin skills: check `$CODEX_HOME/plugins/cache/<pluginId>/**/skills/<skillId>/SKILL.md`.
    - Project skills: check `<profile.workdir>/.codex/skills/<skillId>/SKILL.md`; return `unknown` when no `workdir`.
    - User skills: check `$CODEX_HOME/skills/<skillId>/SKILL.md`.
    - System skills: check `$CODEX_HOME/skills/.system/<skillId>/SKILL.md`.
    - When `source` is omitted, search known roots; return `passed` if found, otherwise `unknown`.
  - Compute preflight before mutating run state in `startCodexSessionRun`.
  - Throw before creating a run if `report.status === "blocked"` and `allowDegradedProfiles` is not true.
  - Store the report on `run.codexSession.profilePreflight`.

## Task 4: Carry effective profiles through workflow execution and sessions

- [x] Task status

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/engine/runBody.ts`
  - `plugins/dittosloop-for-codex/mcp/src/engine/runFlow.ts`
  - `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
  - `plugins/dittosloop-for-codex/mcp/src/codex/sessionBridge.ts`
  - `plugins/dittosloop-for-codex/mcp/src/service.ts`
  - `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
  - `plugins/dittosloop-for-codex/mcp/test/sessionBridge.test.ts`
  - `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`

  Add tests first:

  - `startCodexSessionRun` returns `launchRequest.workflowPlan.steps[*].agentProfile` for declared profiles.
  - `executeWorkflowAttempt` sends both the legacy-compatible `subagent` and the new `agentProfile` to the session bridge.
  - `WorkflowTaskRun` persists `agentProfile` and `profilePreflight` for the step.
  - Legacy inline `subagent` workflows still send the same `subagent` shape as before and also expose a legacy effective profile.
  - Resuming a suspended workflow after a contract revision keeps the original pending task's stored profile snapshot.

  Test commands:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "agent profile"
  npm --prefix plugins/dittosloop-for-codex/mcp test -- sessionBridge.test.ts
  npm --prefix plugins/dittosloop-for-codex/mcp test -- e2eWorkflow.test.ts
  ```

  Expected first failure:

  - Execution plan, bridge request, and task run types only carry `subagent`.

  Implementation notes:

  - Add optional fields:
    - `WorkflowLaunchPlanStep.agentProfile?: EffectiveAgentProfile`
    - `AgentRequest.agentProfile?: EffectiveAgentProfile`
    - `AgentOptions.agentProfile?: EffectiveAgentProfile`
    - `CodexSessionRequest.agentProfile?: EffectiveAgentProfile`
    - `CodexSessionRef.agentProfile?: EffectiveAgentProfile`
    - `WorkflowTaskRun.agentProfile?: EffectiveAgentProfile`
    - `LoopRun.codexSession.subagents[].agentProfile?: EffectiveAgentProfile`
    - `LoopRun.codexSession.profilePreflight?: SkillPreflightReport`
  - Keep `subagent` populated from `effectiveProfileToSubagent(...)` so existing host behavior and tests remain compatible.
  - Update `buildWorkflowExecutionPlan` and `buildWorkflowLaunch` to resolve profiles from the contract.
  - Update `runBody` to pass `agentProfile`.
  - Update `runFlow` to forward `agentProfile` into `deps.executor.run`.
  - Update `markWorkflowTaskRunning`, `attachWorkflowTaskSession`, `markRunWaitingForCodexSession`, and `codexSessionSubagentsForContract` to preserve `agentProfile` and per-step preflight checks.
  - Update `buildCodexSessionPrompt` to include:
    - declared profile catalog,
    - effective profile per executable step,
    - required/advisory skills,
    - preflight warnings/blockers,
    - explicit note that DittosLoop records expectations but the visible Codex session remains the orchestrator.

## Task 5: Update workspace files and preview display

- [x] Task status

  Files:

  - `plugins/dittosloop-for-codex/mcp/src/types.ts`
  - `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`
  - `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
  - `plugins/dittosloop-for-codex/preview/app.js`
  - `plugins/dittosloop-for-codex/preview/styles.css`
  - `test/*.test.mjs`

  Add tests first:

  - Workspace file generation includes `runtime/dittosloop-for-codex-loop.md`.
  - Workspace file generation no longer includes `skill/dittosloop-for-codex-loop.md` for new generated output.
  - `workflow.json` includes `agentProfiles`.
  - Preview app source references `agentProfile`, `profilePreflight`, required/advisory skill status, and degraded warnings.
  - Preview task rows display the effective profile before falling back to legacy `subagent` metadata.

  Test commands:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp test -- previewServer.test.ts
  npm run verify:generated
  npm run test
  ```

  Expected first failure:

  - Workspace tests still find the old `skill/` path, and preview source does not reference profile/preflight fields.

  Implementation notes:

  - Extend `LoopWorkspaceFile.kind` with `"runtime"` and keep `"skill"` in the union only for backward-compatible old state if needed.
  - Change `formalLoopDirectoryFiles` to write:

    ```ts
    {
      path: "runtime/dittosloop-for-codex-loop.md",
      kind: "runtime",
      language: "markdown",
      content: loopRuntimeGuideFile(input.contract)
    }
    ```

  - Update sorting to treat `runtime/` guide files as regular runtime metadata and stop special-casing new `skill/` files.
  - Add `agentProfiles: input.contract.agentProfiles ?? {}` to `workflow.json`.
  - Rename `loopSkillFile` to `loopRuntimeGuideFile` and update text to say this is not an installed skill.
  - In `preview/app.js`, add helpers:
    - `formatAgentProfileMeta(profile)`
    - `formatProfileSkills(profile, preflight)`
    - `profileStatusMeta(profilePreflight)`
  - In task/session card rendering, prefer `taskRun.agentProfile` and `subagent.agentProfile`; fall back to `formatSubagentMeta` only for legacy records.

## Task 6: Update installed skill guidance for creating profile-based workflows

- [ ] Task status

  Files:

  - `plugins/dittosloop-for-codex/skills/loop/SKILL.md`
  - `plugins/dittosloop-for-codex/skills/loop/references/choose-workflow.md`
  - `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`
  - `plugins/dittosloop-for-codex/skills/loop/references/execute-loop.md`
  - `plugins/dittosloop-for-codex/skills/loop/references/tool-reference.md`
  - Existing documentation tests under `test/*.test.mjs`

  Add tests first:

  - Skill/documentation tests assert `agentProfiles`, `agentProfileRef`, `requiredSkills`, `allowDegradedProfiles`, and the `runtime/` guide path are documented.
  - Skill/documentation tests assert the docs do not describe per-loop `skill/dittosloop-for-codex-loop.md` as an installed skill.

  Test command:

  ```bash
  npm run test
  ```

  Expected first failure:

  - Docs still only mention `subagent` hints and the old generated guide language.

  Implementation notes:

  - Keep the main skill progressive-disclosure flow intact.
  - In creation guidance, prefer:

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
      }
    }
    ```

  - Keep legacy `subagent` documented as compatibility hints, not the preferred structure.
  - Document `allowDegradedProfiles` as an explicit escape hatch for real-world testing.

## Task 7: Full verification and review handoff

- [ ] Task status

  Files:

  - No new implementation files unless verification exposes a focused fix.

  Verification commands:

  ```bash
  npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
  npm --prefix plugins/dittosloop-for-codex/mcp test
  npm run verify:generated
  npm run test
  npm run validate
  npm run check
  git status --short
  ```

  Expected result:

  - All checks pass.
  - Worktree contains only intentional source, docs, and test changes.
  - Branch remains unmerged and ready for review.

  Review handoff:

  - Summarize changed behavior, compatibility behavior, and any verification gaps.
  - Include the commit hash if the implementation is committed.
  - Ask for review/merge approval only after tests pass.

## Self-Review Checklist

- [ ] Spec goals are covered: profiles, required/advisory skills, preflight, persistence, prompt, preview, workspace guide rename.
- [ ] Non-goals are preserved: no direct skill invocation, no per-loop installed skill, no hidden background work, no native enforcement claim.
- [ ] Legacy `subagent` contracts still validate and run.
- [ ] Required missing/unknown skill behavior is test-covered for both blocking and degraded launch.
- [ ] Effective profile snapshots are stored where pending workflow sessions can rely on them.
- [ ] MCP schemas, TypeScript contract types, runtime service types, and preview assumptions agree on field names.
- [ ] Generated docs and plugin validation are updated together.
