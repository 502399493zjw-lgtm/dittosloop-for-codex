import { describe, expect, test } from "vitest";

import {
  effectiveProfileToSubagent,
  resolveEffectiveAgentProfile,
  resolveEffectiveProfilesByStep
} from "../src/contract/agentProfiles.js";
import { compileContract, recompileFormalContract } from "../src/contract/compileContract.js";
import { migrateLegacyContract } from "../src/contract/migrateLegacyContract.js";
import { validateContract } from "../src/contract/validateContract.js";

const fixedTime = "2026-06-24T00:00:00.000Z";

function passingLegacyVerification() {
  return {
    mode: "after_workflow" as const,
    rubrics: [{ id: "done", label: "Done", requirement: "The workflow result satisfies the loop goal.", severity: "must" as const }]
  };
}

describe("formal loop contracts", () => {
  test("accepts static body steps as a static workflow", () => {
    const contract = compileContract(
      {
        id: "loop_static_body",
        title: "Static workflow",
        goal: "Run known steps",
        body: {
          steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan official updates" }]
        },
        verification: passingLegacyVerification()
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.workflow).toEqual({
      kind: "static_steps",
      body: contract.body
    });
    expect(contract.body?.steps).toHaveLength(1);
  });

  test("accepts legacy script build input as a static workflow", () => {
    const contract = compileContract(
      {
        id: "loop_legacy_script",
        title: "Legacy script workflow",
        goal: "Build steps through the script AST",
        script: {
          build: [
            { fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Write the draft." }] }
          ]
        },
        verification: passingLegacyVerification()
      } as any,
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.workflow.kind).toBe("static_steps");
    expect(contract.body?.steps).toEqual([
      { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write the draft." }
    ]);
  });

  test("accepts runtime string script only with explicit runtime workflow kind", () => {
    const contract = compileContract(
      {
        id: "loop_runtime_script",
        workflowKind: "runtime_script",
        title: "Runtime script workflow",
        goal: "Run dynamic orchestration",
        script: "const result = await agent('Review risky files'); return result;",
        args: { maxFiles: 3 },
        limits: { maxAgentCalls: 4, timeoutMs: 120000 },
        verification: passingLegacyVerification()
      } as any,
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.workflow).toMatchObject({
      kind: "runtime_script",
      language: "javascript",
      source: "const result = await agent('Review risky files'); return result;",
      args: { maxFiles: 3 },
      limits: { maxAgentCalls: 4, timeoutMs: 120000 },
      approval: { required: true }
    });
    expect(contract).not.toHaveProperty("body.steps");
    expect(contract.body).toBeUndefined();
  });

  test("rejects runtime workflow objects as external contract input", () => {
    expect(() =>
      compileContract(
        {
          id: "loop_runtime_workflow_object",
          title: "Runtime workflow object",
          goal: "Reject non-explicit runtime input",
          workflow: {
            kind: "runtime_script",
            language: "javascript",
            source: "return await agent('Review the latest result');",
            approval: { required: true }
          },
          verification: passingLegacyVerification()
        } as any,
        fixedTime
      )
    ).toThrow(/workflowKind.*runtime_script.*string script/i);
  });

  test("preserves stored runtime workflow objects on internal recompile", () => {
    const contract = recompileFormalContract(
      {
        id: "loop_runtime_recompile",
        title: "Runtime workflow object",
        goal: "Keep runtime workflow authoritative",
        workflow: {
          kind: "runtime_script",
          language: "javascript",
          source: "return await agent('Review the latest result');",
          approval: { required: true }
        },
        body: {
          steps: [{ id: "legacy", kind: "agent", label: "Legacy", prompt: "Legacy static body." }]
        },
        verification: passingLegacyVerification()
      } as any,
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.workflow).toMatchObject({
      kind: "runtime_script",
      source: "return await agent('Review the latest result');",
      approval: { required: true }
    });
    expect(contract.body).toBeUndefined();
  });

  test("rejects string script without explicit runtime workflow kind", () => {
    expect(() =>
      compileContract(
        {
          id: "loop_implicit_runtime",
          title: "Implicit runtime",
          goal: "Reject implicit runtime scripts",
          script: "return await agent('Review');",
          verification: passingLegacyVerification()
        } as any,
        fixedTime
      )
    ).toThrow(/workflowKind.*runtime_script/i);
  });

  test("rejects body plus any script input", () => {
    expect(() =>
      compileContract(
        {
          id: "loop_mixed_static_script",
          title: "Mixed workflow",
          goal: "Reject ambiguous workflow inputs",
          body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan." }] },
          script: { build: [{ fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Draft." }] }] },
          verification: passingLegacyVerification()
        } as any,
        fixedTime
      )
    ).toThrow(/body.*script/i);
  });

  test("rejects legacy script build input with runtime workflow kind", () => {
    expect(() =>
      compileContract(
        {
          id: "loop_runtime_builder",
          workflowKind: "runtime_script",
          title: "Runtime builder",
          goal: "Reject builder AST as runtime script",
          script: { build: [{ fn: "task", args: [{ id: "draft", label: "Draft", prompt: "Draft." }] }] },
          verification: passingLegacyVerification()
        } as any,
        fixedTime
      )
    ).toThrow(/script\.build.*static/i);
  });

  test("rubric agent validator accepts verifier subagent controls", () => {
    const contract = compileContract(
      {
        id: "loop_verifier_subagent",
        title: "Verifier subagent workflow",
        goal: "Verify through a separate reviewer",
        body: {
          steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft." }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "quality", label: "Quality", description: "Meets the quality bar.", severity: "must" }
          ],
          validators: [
            {
              id: "verifier-subagent",
              type: "rubric_agent",
              label: "Verifier sub-agent",
              criteriaIds: ["quality"],
              prompt: "Verify the workflow result and cite evidence.",
              scoreScale: { min: 0, max: 1 },
              passScore: 1,
              evidenceRequired: true,
              allowSelfReview: false,
              subagent: { ref: "reviewer", role: "code-reviewer", tools: ["rg"] },
              severity: "must"
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.verification.validators[0]).toMatchObject({
      type: "rubric_agent",
      prompt: "Verify the workflow result and cite evidence.",
      allowSelfReview: false,
      subagent: { ref: "reviewer", role: "code-reviewer", tools: ["rg"] }
    });
  });

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
    expect(contract.verification).toMatchObject({
      version: 2,
      validators: [{ type: "rubric_agent" }]
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
    expect(migrated.verification).toMatchObject({
      version: 2,
      mode: "after_workflow",
      criteria: [],
      validators: [
        { id: "check-1-command", type: "command", command: "npm", args: ["test"], severity: "must" }
      ]
    });
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
        verification: {
          mode: "after_workflow",
          rubrics: [{ id: "source", label: "Source", requirement: "Uses official sources", severity: "must" }]
        }
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

  test("accepts pipeline phases and human task nodes", () => {
    const verification = {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "done", label: "Done", description: "The workflow completes.", severity: "must" }
      ],
      validators: [
        {
          id: "command-pass",
          type: "command",
          label: "Command pass",
          command: "node",
          args: ["-e", "process.exit(0)"],
          cwd: "contract",
          criteriaIds: ["done"],
          severity: "must",
          parse: { kind: "none" }
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true
      }
    } as const;

    const contract = compileContract(
      {
        id: "loop_1",
        title: "Pipeline workflow",
        goal: "Thread outputs and gate on a human",
        body: {
          steps: [
            {
              id: "produce",
              kind: "phase",
              label: "Produce",
              pipeline: true,
              children: [
                { id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Write the draft." },
                { id: "review", kind: "task", runtime: "codex", label: "Review", prompt: "Review the draft." }
              ]
            },
            {
              id: "signoff",
              kind: "task",
              runtime: "codex",
              label: "Sign-off",
              prompt: "Approve the report?",
              human: true
            }
          ]
        },
        verification
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.body.steps[0]).toMatchObject({ kind: "phase", pipeline: true });
    expect(contract.body.steps[1]).toMatchObject({ kind: "task", human: true, prompt: "Approve the report?" });
  });

  test("rejects a human task without a prompt question", () => {
    const contract = compileContract(
      {
        id: "loop_1",
        title: "Bad human workflow",
        goal: "Reject a human node without a question",
        body: {
          steps: [
            {
              id: "signoff",
              kind: "task",
              runtime: "codex",
              label: "Sign-off",
              prompt: "",
              human: true
            } as any
          ]
        },
        verification: { mode: "after_workflow", rubrics: [] }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).toThrow(/human task step .* requires a prompt question|prompt is required/i);
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
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
        verification: passingLegacyVerification()
      },
      fixedTime
    );

    expect(() => validateContract(invalidSkills)).toThrow(/requiredSkills|skill/i);
    expect(() => validateContract(invalidToolsAndPermissions)).toThrow(/allowedTools/i);
    expect(() => validateContract(invalidToolsAndPermissions)).toThrow(/permissions/i);
  });

  test("accepts verification v2 criteria validators and decision policy", () => {
    const contract = compileContract(
      {
        id: "loop_v2",
        title: "V2 loop",
        goal: "Run real verification",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan project" }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "tests-pass", label: "Tests pass", description: "The repository test command passes.", severity: "must" }
          ],
          validators: [
            {
              id: "npm-test",
              type: "command",
              label: "npm test",
              command: "npm",
              args: ["test"],
              cwd: "project",
              timeoutMs: 120000,
              criteriaIds: ["tests-pass"],
              severity: "must",
              parse: { kind: "none" }
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
    expect(contract.verification.version).toBe(2);
  });

  test("accepts score validators with workflow, artifact, and validator-output sources", () => {
    const contract = compileContract(
      {
        id: "loop_score",
        title: "Score loop",
        goal: "Validate structured numeric thresholds",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan project" }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "coverage", label: "Coverage", description: "Coverage stays high enough.", severity: "must" },
            { id: "artifact-count", label: "Artifact count", description: "Enough artifacts were produced.", severity: "should" },
            { id: "review-score", label: "Review score", description: "Review score meets the bar.", severity: "must" }
          ],
          validators: [
            {
              id: "coverage-threshold",
              type: "score",
              label: "Coverage threshold",
              metric: "coverage.lines",
              source: { type: "workflow_result", path: "coverage.lines" },
              operator: ">=",
              threshold: 0.8,
              criteriaIds: ["coverage"],
              severity: "must"
            },
            {
              id: "artifact-threshold",
              type: "score",
              label: "Artifact threshold",
              metric: "artifacts.count",
              source: { type: "artifact", artifactId: "report-json", path: "summary.count" },
              operator: ">=",
              threshold: 3,
              criteriaIds: ["artifact-count"],
              severity: "should"
            },
            {
              id: "review-threshold",
              type: "score",
              label: "Review threshold",
              metric: "review.average",
              source: { type: "validator_output", validatorId: "quality-review", path: "averageScore" },
              operator: ">=",
              threshold: 4,
              criteriaIds: ["review-score"],
              severity: "must"
            },
            {
              id: "quality-review",
              type: "rubric_agent",
              label: "Quality review",
              criteriaIds: ["review-score"],
              scoreScale: { min: 0, max: 5 },
              passScore: 4,
              evidenceRequired: true,
              severity: "must"
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(contract)).not.toThrow();
  });

  test("rejects invalid score validator sources, operators, and thresholds", () => {
    const invalidScoreValidators = compileContract(
      {
        id: "loop_bad_score",
        title: "Bad score loop",
        goal: "Reject invalid score validator contracts",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan project" }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "coverage", label: "Coverage", description: "Coverage stays high enough.", severity: "must" }
          ],
          validators: [
            {
              id: "invalid-workflow-score",
              type: "score",
              label: "Invalid workflow score",
              metric: "coverage.lines",
              source: { type: "workflow_result", path: "" },
              operator: "approximately",
              threshold: Number.POSITIVE_INFINITY,
              criteriaIds: ["coverage"],
              severity: "must"
            } as any,
            {
              id: "invalid-artifact-score",
              type: "score",
              label: "Invalid artifact score",
              metric: "artifacts.count",
              source: { type: "artifact", artifactId: "", path: "summary.count" },
              operator: ">=",
              threshold: 3,
              criteriaIds: ["coverage"],
              severity: "should"
            },
            {
              id: "invalid-validator-output-score",
              type: "score",
              label: "Invalid validator output score",
              metric: "review.average",
              source: { type: "validator_output", validatorId: "", path: "averageScore" },
              operator: ">=",
              threshold: 4,
              criteriaIds: ["coverage"],
              severity: "must"
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(invalidScoreValidators)).toThrow(/score validator source/i);
    expect(() => validateContract(invalidScoreValidators)).toThrow(/score validator operator/i);
    expect(() => validateContract(invalidScoreValidators)).toThrow(/score validator threshold must be finite/i);
  });

  test("rejects command validator cwd traversal outside the project", () => {
    const traversalContract = compileContract(
      {
        id: "loop_bad_cwd",
        title: "Bad cwd loop",
        goal: "Reject project traversal",
        body: {
          steps: [{ id: "scan", kind: "task", runtime: "codex", label: "Scan", prompt: "Scan project" }]
        },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "tests-pass", label: "Tests pass", description: "The repository test command passes.", severity: "must" }
          ],
          validators: [
            {
              id: "npm-test",
              type: "command",
              label: "npm test",
              command: "npm",
              args: ["test"],
              cwd: { relativeToProject: "../.." },
              timeoutMs: 120000,
              criteriaIds: ["tests-pass"],
              severity: "must",
              parse: { kind: "none" }
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(traversalContract)).toThrow(/command validator cwd must stay within the project/i);
  });

  test("rejects invalid verification v2 validator references and duplicate ids", () => {
    const duplicateCriteria = compileContract(
      {
        id: "loop_bad",
        title: "Bad v2 loop",
        goal: "Reject bad verification",
        body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan" }] },
        verification: {
          version: 2,
          mode: "after_workflow",
          criteria: [
            { id: "quality", label: "Quality", description: "Meets quality bar.", severity: "must" },
            { id: "quality", label: "Quality again", description: "Duplicate id.", severity: "must" }
          ],
          validators: [
            {
              id: "agent-review",
              type: "rubric_agent",
              label: "Review",
              criteriaIds: ["missing"],
              scoreScale: { min: 0, max: 1 },
              passScore: 1,
              evidenceRequired: true,
              severity: "must"
            }
          ],
          decision: {
            requireAllMustCriteriaCovered: true,
            failOnMustValidatorFailure: true,
            failOnShouldValidatorFailure: false,
            requireEvidenceForAgentScores: true
          }
        }
      },
      fixedTime
    );

    expect(() => validateContract(duplicateCriteria)).toThrow(/criterion id must be unique/i);
    expect(() => validateContract(duplicateCriteria)).toThrow(/missing criterion/i);
  });

  test("migrates legacy verification checks into v2 command and rubric-agent validators", () => {
    const migrated = migrateLegacyContract({
      id: "loop_legacy",
      title: "Legacy",
      intent: "Keep project healthy",
      trigger: { mode: "manual" },
      verification: { checks: ["npm test", "Use official sources"] },
      status: "active",
      createdAt: fixedTime,
      updatedAt: fixedTime
    });

    expect(migrated.verification).toMatchObject({
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "check-2", label: "Use official sources", description: "Use official sources", severity: "must" }
      ],
      validators: [
        { id: "check-1-command", type: "command", command: "npm", args: ["test"], severity: "must" },
        { id: "legacy-rubric-agent", type: "rubric_agent", criteriaIds: ["check-2"], evidenceRequired: true }
      ]
    });
  });
});
