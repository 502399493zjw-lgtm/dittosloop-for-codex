import { describe, expect, test } from "vitest";

import {
  effectiveProfileToSubagent,
  resolveEffectiveAgentProfile,
  resolveEffectiveProfilesByStep
} from "../src/contract/agentProfiles.js";
import { compileContract } from "../src/contract/compileContract.js";
import { migrateLegacyContract } from "../src/contract/migrateLegacyContract.js";
import { validateContract } from "../src/contract/validateContract.js";

const fixedTime = "2026-06-24T00:00:00.000Z";

describe("formal loop contracts", () => {
  test("compiles defaults for a one-step manual contract", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "AI monitor",
        goal: "Track AI tool updates",
        body: {
          steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan official updates" }]
        },
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "source", label: "Source", requirement: "Uses official sources", severity: "must" }]
        }
      },
      fixedTime
    );

    expect(contract).toMatchObject({
      id: "loop_1",
      title: "AI monitor",
      goal: "Track AI tool updates",
      trigger: { mode: "manual" },
      repairPolicy: { maxAttempts: 1, strategy: "repair_then_retry" },
      stopPolicy: { rule: "user cancels" },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });
  });

  test("rejects duplicate step ids", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad loop",
        goal: "Run duplicated steps",
        body: {
          steps: [
            { id: "scan", kind: "agent", label: "Scan 1", prompt: "one" },
            { id: "scan", kind: "agent", label: "Scan 2", prompt: "two" }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/unique/i);
  });

  test("migrates a legacy loop into a formal one-step body", () => {
    const migrated = migrateLegacyContract({
      id: "loop_1",
      title: "Legacy",
      intent: "Keep project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });

    expect(migrated.goal).toBe("Keep project healthy");
    expect(migrated.body.steps).toEqual([
      { id: "legacy-agent", kind: "agent", label: "Run loop", prompt: "Keep project healthy" }
    ]);
    expect(migrated.verification.rubrics).toEqual([
      { id: "check-1", label: "npm test", requirement: "npm test", severity: "must" }
    ]);
  });

  test("accepts structured Codex subagent specs on task steps", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Subagent workflow",
        goal: "Run a specialized local Codex worker",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: {
                ref: "researcher",
                role: "code-researcher",
                model: "gpt-5-codex",
                tools: ["rg", "sed"],
                workdir: "/tmp/project",
                env: { LANG: "en_US.UTF-8" },
                permissions: {
                  filesystem: "workspace-write",
                  network: "enabled"
                },
                timeoutMs: 120000,
                context: { topic: "release notes" }
              }
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.body.steps[0]).toMatchObject({
      kind: "task",
      subagent: {
        ref: "researcher",
        role: "code-researcher",
        tools: ["rg", "sed"],
        permissions: {
          filesystem: "workspace-write",
          network: "enabled"
        }
      }
    });
  });

  test("rejects invalid Codex subagent timeout values", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: { timeoutMs: -1 } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/timeoutMs/i);
  });

  test("rejects task steps without the Codex runtime", () => {
    const missingRuntime = compileContract(
      {
        id: "loop_1",
        title: "Bad task workflow",
        goal: "Reject missing task runtime",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              label: "Scan worker",
              prompt: "Scan project changes."
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );
    const shellRuntime = compileContract(
      {
        id: "loop_2",
        title: "Bad task workflow",
        goal: "Reject non-Codex task runtime",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "shell",
              label: "Scan worker",
              prompt: "Scan project changes."
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(missingRuntime)).toThrow(/runtime must be codex/);
    expect(() => validateContract(shellRuntime)).toThrow(/runtime must be codex/);
  });

  test("rejects invalid Codex subagent tools and permissions", () => {
    const invalidTools = compileContract(
      {
        id: "loop_1",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent tool specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: { tools: ["rg", ""] } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );
    const invalidPermissions = compileContract(
      {
        id: "loop_2",
        title: "Bad subagent workflow",
        goal: "Reject invalid subagent permission specs",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              subagent: {
                permissions: { filesystem: "write-everywhere", network: "sometimes" }
              } as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(invalidTools)).toThrow(/subagent\.tools/i);
    expect(() => validateContract(invalidPermissions)).toThrow(/subagent\.permissions\.filesystem/i);
    expect(() => validateContract(invalidPermissions)).toThrow(/subagent\.permissions\.network/i);
  });

  test("rejects unsupported session reuse policies", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Reuse policy workflow",
        goal: "Reject session reuse until the runtime implements it",
        body: {
          steps: [
            {
              id: "scan",
              kind: "task",
              runtime: "codex",
              label: "Scan worker",
              prompt: "Scan project changes.",
              sessionPolicy: "reuse-run" as any
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/sessionPolicy currently supports only new/i);
  });

  test("validates declared agent profiles and resolves effective profiles for agentProfileRef", () => {
    const contract = compileContract(
      {
        id: "loop_profiles",
        title: "Profiled workflow",
        goal: "Run profile-backed workflow tasks",
        agentProfiles: {
          researcher: {
            id: "researcher",
            label: "Researcher",
            role: "code-researcher",
            requiredSkills: [{ id: "openai-docs", source: "plugin" }],
            advisorySkills: [{ id: "skill-installer", source: "user" }],
            allowedTools: ["rg", "sed"],
            permissions: {
              filesystem: "workspace-write",
              network: "enabled"
            }
          }
        },
        body: {
          steps: [
            {
              id: "research",
              kind: "task",
              runtime: "codex",
              label: "Research",
              prompt: "Read the repo context.",
              agentProfileRef: "researcher"
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();

    const effective = resolveEffectiveAgentProfile(contract, contract.body.steps[0]);
    expect(effective).toMatchObject({
      id: "researcher",
      label: "Researcher",
      role: "code-researcher",
      requiredSkills: [{ id: "openai-docs", source: "plugin" }],
      advisorySkills: [{ id: "skill-installer", source: "user" }],
      allowedTools: ["rg", "sed"],
      permissions: {
        filesystem: "workspace-write",
        network: "enabled"
      },
      source: "declared",
      stepId: "research",
      requestedRef: "researcher"
    });

    expect(resolveEffectiveProfilesByStep(contract).get("research")).toEqual(effective);
    expect(effectiveProfileToSubagent(effective)).toMatchObject({
      ref: "researcher",
      role: "code-researcher",
      tools: ["rg", "sed"],
      permissions: {
        filesystem: "workspace-write",
        network: "enabled"
      }
    });
  });

  test("uses matching legacy subagent refs as profile defaults and lets inline subagent values override them", () => {
    const contract = compileContract(
      {
        id: "loop_legacy_profile",
        title: "Legacy profile compatibility",
        goal: "Allow inline overrides on top of declared profiles",
        agentProfiles: {
          researcher: {
            id: "researcher",
            label: "Researcher",
            role: "code-researcher",
            model: "gpt-5-codex",
            workdir: "/workspace/base",
            requiredSkills: [{ id: "deep-research", source: "project" }],
            advisorySkills: [{ id: "openai-docs", source: "system" }],
            allowedTools: ["rg"],
            permissions: {
              filesystem: "workspace-write",
              network: "disabled"
            },
            env: { LANG: "en_US.UTF-8" },
            timeoutMs: 60000,
            context: { area: "contracts" }
          }
        },
        body: {
          steps: [
            {
              id: "legacy-research",
              kind: "task",
              runtime: "codex",
              label: "Legacy research",
              prompt: "Use the compatibility path.",
              subagent: {
                ref: "researcher",
                role: "investigator",
                model: "gpt-5",
                tools: ["rg", "sed"],
                workdir: "/workspace/override",
                env: { TOPIC: "profiles" },
                permissions: {
                  filesystem: "danger-full-access",
                  network: "enabled"
                },
                timeoutMs: 90000,
                context: { area: "overrides" }
              }
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();

    const effective = resolveEffectiveAgentProfile(contract, contract.body.steps[0]);
    expect(effective).toMatchObject({
      id: "researcher",
      label: "Researcher",
      role: "investigator",
      model: "gpt-5",
      workdir: "/workspace/override",
      requiredSkills: [{ id: "deep-research", source: "project" }],
      advisorySkills: [{ id: "openai-docs", source: "system" }],
      allowedTools: ["rg", "sed"],
      permissions: {
        filesystem: "danger-full-access",
        network: "enabled"
      },
      env: { TOPIC: "profiles" },
      timeoutMs: 90000,
      context: { area: "overrides" },
      source: "declared",
      stepId: "legacy-research",
      requestedRef: "researcher"
    });
  });

  test("rejects task steps whose agentProfileRef points at a missing profile", () => {
    const contract = compileContract(
      {
        id: "loop_missing_profile",
        title: "Missing profile",
        goal: "Reject unknown profile references",
        body: {
          steps: [
            {
              id: "research",
              kind: "task",
              runtime: "codex",
              label: "Research",
              prompt: "Use a missing profile.",
              agentProfileRef: "missing-profile"
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/agentProfileRef/i);
  });

  test("does not synthesize a declared effective profile when agentProfileRef is missing but inline subagent exists", () => {
    const contract = compileContract(
      {
        id: "loop_missing_profile_inline",
        title: "Missing declared profile with inline subagent",
        goal: "Prefer missing declared refs over inline fallback",
        body: {
          steps: [
            {
              id: "research",
              kind: "task",
              runtime: "codex",
              label: "Research",
              prompt: "Use a missing profile with inline values.",
              agentProfileRef: "missing-profile",
              subagent: {
                ref: "inline-only",
                role: "inline-researcher",
                tools: ["rg"]
              }
            }
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(resolveEffectiveAgentProfile(contract, contract.body.steps[0])).toBeUndefined();
  });

  test("reports malformed agentProfiles entries as actionable validation errors", () => {
    const contract = compileContract(
      {
        id: "loop_malformed_profile",
        title: "Malformed profile entry",
        goal: "Reject non-object profile entries cleanly",
        agentProfiles: {
          broken: null as any
        },
        body: {
          steps: [{ id: "research", kind: "agent", label: "Research", prompt: "Scan." }]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/agentProfiles\.broken must be an object/i);
  });

  test("rejects invalid profile skill requirements, skill sources, allowedTools, and permissions", () => {
    const invalidSkills = compileContract(
      {
        id: "loop_invalid_skills",
        title: "Invalid skills",
        goal: "Reject bad profile skill requirements",
        agentProfiles: {
          researcher: {
            id: "researcher",
            label: "Researcher",
            role: "code-researcher",
            requiredSkills: [
              { id: "", source: "plugin" },
              { id: "openai-docs", source: "marketplace" as any }
            ]
          }
        },
        body: {
          steps: [{ id: "research", kind: "agent", label: "Research", prompt: "Scan." }]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );
    const invalidToolsAndPermissions = compileContract(
      {
        id: "loop_invalid_tools",
        title: "Invalid tools",
        goal: "Reject bad declared profile tool and permission settings",
        agentProfiles: {
          reviewer: {
            id: "reviewer",
            label: "Reviewer",
            role: "code-reviewer",
            allowedTools: ["rg", ""],
            permissions: {
              filesystem: "all-access" as any,
              network: "sometimes" as any
            }
          }
        },
        body: {
          steps: [{ id: "review", kind: "agent", label: "Review", prompt: "Review." }]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(invalidSkills)).toThrow(/requiredSkills|skill/i);
    expect(() => validateContract(invalidToolsAndPermissions)).toThrow(/allowedTools/i);
    expect(() => validateContract(invalidToolsAndPermissions)).toThrow(/permissions/i);
  });
});
