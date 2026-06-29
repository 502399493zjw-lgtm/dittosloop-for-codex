# Verification Flow And Evaluator Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the verification architecture from `2026-06-29-verification-flow-and-evaluator-architecture-design.md`: static `verification.md`, first-class script evaluators, structured evaluator evidence, and visible evaluator-builder guidance.

**Architecture:** Keep `contract.verification` as the executable source of truth and make `verification.md` a generated static design projection. Extend verification v2 with a first-class `script` validator that runs a generated evaluator script, parses `verification_result_v1` JSON, and feeds normal decision aggregation. Keep dynamic pass/fail state in run records, `status.json`, run detail, and preview.

**Tech Stack:** TypeScript, Node.js 20 child process APIs, Vitest, existing LoopService/LoopStore runtime, existing loop workspace files, existing loop skill Markdown guidance.

## Global Constraints

- Work only in `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/.worktrees/verification-flow-spec`.
- Do not edit the main working tree directly.
- The approved design spec is `docs/superpowers/specs/2026-06-29-verification-flow-and-evaluator-architecture-design.md`.
- `contract.verification` is the only machine-executable verification definition.
- `verification.md` is generated from `contract.verification` as a static human-readable verification design.
- `verification.md` must not contain latest status, latest score, latest evidence, latest decision, waiting state, passed state, or failed state.
- Do not introduce a new `rubrics.md` for verification v2 loops.
- Legacy `rubrics.md` remains only for legacy-compatible contracts during migration.
- Script evaluators must have a script reference, checksum, successful self-check metadata, and output schema before an active loop accepts them.
- Script evaluator execution must be visible through normal validator lifecycle events and run verification records.
- Rubric-agent validation remains separate from workflow task agents.
- Workflow task success must not complete a v2 run before verification finishes.
- Existing root tests and MCP tests must pass.

---

## File Structure

- Modify `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`: render v2 `verification.md` as static design, keep run state in `status.json`, and retain legacy `rubrics.md` fallback.
- Modify `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`: add script validator types and optional script evidence decision flag.
- Modify `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`: validate script validator structure, checksum, loop/project cwd, output schema, self-check metadata, and criterion coverage.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`: add script execution, `stdin` support for command execution, structured JSON parsing, script evidence enforcement, and script result aggregation.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/contractVerification.ts`: pass loop workspace path through to v2 verification.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`: accept `contractWorkspacePath` for direct runner usage.
- Modify `plugins/dittosloop-for-codex/mcp/src/service.ts`: pass the loop workspace path into graph and non-graph verification execution.
- Modify `plugins/dittosloop-for-codex/mcp/src/workspaceDirectory.ts`: expose loop workspace path and preserve `evaluators/` files when syncing generated workspace projections.
- Modify `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`: require a visible evaluator-builder subagent before creating a loop with generated script evaluators.
- Modify `test/loop-skill-memory.test.mjs`: lock the evaluator-builder guidance.
- Modify `plugins/dittosloop-for-codex/mcp/test/service.test.ts`: lock static `verification.md` behavior and loop workspace script execution.
- Modify `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`: cover script validator contract acceptance and rejection.
- Modify `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`: cover script evaluator runtime behavior.
- Modify `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`: cover direct runner `contractWorkspacePath` propagation for script validators.

## Shared Interfaces

Use these public names and shapes across tasks.

```ts
export interface VerificationScriptValidator {
  id: string;
  type: "script";
  label: string;
  criteriaIds: string[];
  severity: "must" | "should";
  runtime: "node" | "python";
  scriptRef: {
    path: string;
    checksum: string;
    cwd: "loop" | "project" | { relativeToProject: string };
    args?: string[];
    timeoutMs: number;
  };
  input: {
    source: "workflow_result" | "artifact" | "project";
    schema?: Record<string, unknown>;
  };
  output: {
    schema: "verification_result_v1";
  };
  evidenceRequired: boolean;
  builder: {
    kind: "codex_subagent";
    builtAt: string;
    selfCheck: {
      status: "passed";
      command: string;
      args?: string[];
      evidence: string;
    };
  };
}

export interface ScriptValidatorResult extends ValidatorResultBase {
  type: "script";
  runtime: "node" | "python";
  scriptPath: string;
  cwd?: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  score?: number;
  output?: unknown;
}

export interface ScriptVerificationJson {
  status: "passed" | "failed" | "needs_human";
  score?: number;
  summary: string;
  evidence?: string[];
  criteriaResults?: Array<{
    criterionId: string;
    status: "passed" | "failed" | "needs_human";
    score?: number;
    evidence?: string;
  }>;
  output?: Record<string, unknown>;
}
```

`VerificationValidator` must become:

```ts
export type VerificationValidator =
  | VerificationCommandValidator
  | VerificationScriptValidator
  | ScoreValidator
  | VerificationRubricAgentValidator;
```

`VerificationPolicyV2["decision"]` must become:

```ts
decision: {
  requireAllMustCriteriaCovered: boolean;
  failOnMustValidatorFailure: boolean;
  failOnShouldValidatorFailure: boolean;
  requireEvidenceForAgentScores: boolean;
  requireEvidenceForScriptResults?: boolean;
};
```

---

### Task 1: Make V2 `verification.md` Static

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

**Interfaces:**
- Consumes: existing `FormalLoopContract`, `VerificationResultRecord`, and `loopWorkspaceFiles(state, loopId)`.
- Produces: `verification.md` content generated only from `contract.verification`; `status.json.latestVerification` remains the dynamic run-state projection.

- [ ] **Step 1: Update the workspace file test to fail on run-state leakage**

In `plugins/dittosloop-for-codex/mcp/test/service.test.ts`, update the existing workspace file test that seeds `verification_v2_1`. Replace the current `verificationFile` assertions with:

```ts
  const verificationFile = files.find((file) => file.path === "verification.md")?.content ?? "";
  expect(verificationFile).toContain("## Criteria");
  expect(verificationFile).toContain("## Evaluators");
  expect(verificationFile).toContain("## Decision Policy");
  expect(verificationFile).toContain("| `daily-report` | must |");
  expect(verificationFile).toContain("| `quality-review` | rubric_agent | must |");
  expect(verificationFile).toContain("- requireAllMustCriteriaCovered: true");
  expect(verificationFile).not.toContain("包含来源");
  expect(verificationFile).not.toMatch(/latest status/i);
  expect(verificationFile).not.toMatch(/latest score/i);
  expect(verificationFile).not.toMatch(/latest evidence/i);
  expect(verificationFile).not.toMatch(/latest decision/i);
  expect(verificationFile).not.toMatch(/status:\s*(通过|passed|failed|失败|not-run|未运行)/i);
```

Keep the existing `statusJson.latestVerification` assertion unchanged so run state remains visible in `status.json`.

- [ ] **Step 2: Run the targeted test and verify it fails**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "workspace"
```

Expected: FAIL because the current v2 `verification.md` still renders latest validator evidence and decision state.

- [ ] **Step 3: Remove latest verification input from v2 markdown rendering**

In `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`, change the v2 file entry from:

```ts
content: verificationFile({ contract: input.contract, latestVerification })
```

to:

```ts
content: verificationFile({ contract: input.contract })
```

Change the `verificationFile` signature to:

```ts
function verificationFile(input: {
  contract: FormalLoopContract;
}): string {
```

Keep the legacy branch wired to `legacyRubricsFile` only from the caller, not from inside the v2 renderer.

- [ ] **Step 4: Render criteria, evaluators, and decision policy only**

Replace the v2 body of `verificationFile` with this structure:

```ts
  return [
    `# ${input.contract.title} verification`,
    "",
    `Mode: \`${verification.mode}\``,
    "",
    "## Criteria",
    "| id | severity | description | evaluated by |",
    "| --- | --- | --- | --- |",
    ...verification.criteria.map((criterion) => {
      const coveringValidatorIds = verification.validators
        .filter((validator) => validator.criteriaIds?.includes(criterion.id))
        .map((validator) => validator.id);
      return [
        `| \`${criterion.id}\``,
        criterion.severity,
        escapeMarkdownTableCell(criterion.description),
        coveringValidatorIds.map((id) => `\`${id}\``).join(", ") || "none"
      ].join(" | ") + " |";
    }),
    "",
    "## Evaluators",
    "| id | type | severity | evaluates | evidence | failure effect |",
    "| --- | --- | --- | --- | --- | --- |",
    ...verification.validators.map((validator) => [
      `| \`${validator.id}\``,
      validator.type,
      validator.severity,
      (validator.criteriaIds ?? []).map((id) => `\`${id}\``).join(", ") || "none",
      escapeMarkdownTableCell(validatorEvidenceRequirement(validator)),
      escapeMarkdownTableCell(validatorFailureEffect(validator, verification.decision))
    ].join(" | ") + " |"),
    "",
    "## Decision Policy",
    `- requireAllMustCriteriaCovered: ${verification.decision.requireAllMustCriteriaCovered}`,
    `- failOnMustValidatorFailure: ${verification.decision.failOnMustValidatorFailure}`,
    `- failOnShouldValidatorFailure: ${verification.decision.failOnShouldValidatorFailure}`,
    `- requireEvidenceForAgentScores: ${verification.decision.requireEvidenceForAgentScores}`,
    verification.decision.requireEvidenceForScriptResults === undefined
      ? undefined
      : `- requireEvidenceForScriptResults: ${verification.decision.requireEvidenceForScriptResults}`,
    ""
  ].filter((line): line is string => line !== undefined).join("\n");
```

Add helpers in the same file:

```ts
function validatorEvidenceRequirement(validator: FormalLoopContract["verification"]["validators"][number]): string {
  if (validator.type === "command") return "stdout/stderr";
  if (validator.type === "score") return `${validator.metric} from ${validator.source.type}`;
  if (validator.type === "rubric_agent") return validator.evidenceRequired ? "agent score with evidence" : "agent score";
  if (validator.type === "script") return validator.evidenceRequired ? "script JSON evidence" : "script JSON summary";
  return "verification result";
}

function validatorFailureEffect(
  validator: FormalLoopContract["verification"]["validators"][number],
  decision: FormalLoopContract["verification"]["decision"]
): string {
  if (validator.severity === "must") {
    return decision.failOnMustValidatorFailure ? "must failure fails the run" : "must failure records a warning";
  }
  return decision.failOnShouldValidatorFailure ? "should failure fails the run" : "should failure warns";
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
```

- [ ] **Step 5: Run the targeted test and verify it passes**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "workspace"
```

Expected: PASS for the workspace file test.

- [ ] **Step 6: Commit Task 1**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts
git commit -m "fix: render verification design without run state"
```

Expected: one commit that only changes static v2 `verification.md` behavior and its regression test.

---

### Task 2: Add Script Evaluator Contract Types And Validation

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

**Interfaces:**
- Consumes: existing `VerificationPolicyV2`, `VerificationValidator`, `CommandValidatorCwd`, and `validateContract(contract)`.
- Produces: `VerificationScriptValidator`, `requireEvidenceForScriptResults?: boolean`, and strict script validator validation.

- [ ] **Step 1: Add failing contract tests for script evaluators**

Append these tests to `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`:

```ts
test("accepts verification v2 script validators with builder self-check metadata", () => {
  const contract = compileContract(
    {
      id: "loop_script",
      title: "Script evaluator loop",
      goal: "Verify structured workflow output with a generated evaluator",
      body: {
        steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft release notes." }]
      },
      verification: {
        version: 2,
        mode: "after_workflow",
        criteria: [
          { id: "release-coverage", label: "Release coverage", description: "Release notes cover every user-facing change.", severity: "must" }
        ],
        validators: [
          {
            id: "release-note-script",
            type: "script",
            label: "Release note script",
            criteriaIds: ["release-coverage"],
            severity: "must",
            runtime: "node",
            scriptRef: {
              path: "evaluators/release-note-script/evaluator.mjs",
              checksum: "sha256:0123456789abcdef",
              cwd: "loop",
              args: [],
              timeoutMs: 30000
            },
            input: { source: "workflow_result" },
            output: { schema: "verification_result_v1" },
            evidenceRequired: true,
            builder: {
              kind: "codex_subagent",
              builtAt: fixedTime,
              selfCheck: {
                status: "passed",
                command: "node",
                args: ["evaluators/release-note-script/evaluator.mjs"],
                evidence: "fixture passed"
              }
            }
          }
        ],
        decision: {
          requireAllMustCriteriaCovered: true,
          failOnMustValidatorFailure: true,
          failOnShouldValidatorFailure: false,
          requireEvidenceForAgentScores: true,
          requireEvidenceForScriptResults: true
        }
      }
    },
    fixedTime
  );

  expect(() => validateContract(contract)).not.toThrow();
});

test("rejects script validators without script refs checksums output schema or self-check", () => {
  const contract = compileContract(
    {
      id: "loop_bad_script",
      title: "Bad script evaluator loop",
      goal: "Reject incomplete generated evaluators",
      body: {
        steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft release notes." }]
      },
      verification: {
        version: 2,
        mode: "after_workflow",
        criteria: [
          { id: "release-coverage", label: "Release coverage", description: "Release notes cover every user-facing change.", severity: "must" }
        ],
        validators: [
          {
            id: "release-note-script",
            type: "script",
            label: "Release note script",
            criteriaIds: ["release-coverage"],
            severity: "must",
            runtime: "node",
            scriptRef: {
              path: "../outside.mjs",
              checksum: "",
              cwd: "loop",
              timeoutMs: 0
            },
            input: { source: "workflow_result" },
            output: { schema: "anything_else" },
            evidenceRequired: true,
            builder: {
              kind: "codex_subagent",
              builtAt: "",
              selfCheck: {
                status: "failed",
                command: "",
                evidence: ""
              }
            }
          } as any
        ],
        decision: {
          requireAllMustCriteriaCovered: true,
          failOnMustValidatorFailure: true,
          failOnShouldValidatorFailure: false,
          requireEvidenceForAgentScores: true,
          requireEvidenceForScriptResults: true
        }
      }
    },
    fixedTime
  );

  expect(() => validateContract(contract)).toThrow(/script validator/i);
});
```

- [ ] **Step 2: Run the targeted contract tests and verify they fail**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts -t "script validators"
```

Expected: FAIL because `script` is not yet a supported validator type.

- [ ] **Step 3: Add script validator types**

In `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`, add the `VerificationScriptValidator` interface from Shared Interfaces after `VerificationCommandValidator`.

Update `VerificationValidator` to include `VerificationScriptValidator`.

Add `requireEvidenceForScriptResults?: boolean` to `VerificationPolicyV2["decision"]`.

Update `CommandValidatorCwd` so script cwd can use loop workspace:

```ts
export type ValidatorCwd =
  | "project"
  | "contract"
  | "loop"
  | { relativeToProject: string };

export type CommandValidatorCwd = Exclude<ValidatorCwd, "loop">;
export type ScriptValidatorCwd = ValidatorCwd;
```

- [ ] **Step 4: Add script validation**

In `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`, import `VerificationScriptValidator` and add a `case "script"` branch:

```ts
case "script":
  validateScriptValidator(validator, errors);
  return;
```

Add these helpers:

```ts
function validateScriptValidator(validator: VerificationScriptValidator, errors: string[]): void {
  if (!Array.isArray(validator.criteriaIds) || validator.criteriaIds.length === 0) {
    errors.push("script validator criteriaIds must contain at least one criterion");
  }
  if (validator.runtime !== "node" && validator.runtime !== "python") {
    errors.push("script validator runtime must be node or python");
  }
  validateScriptRef(validator, errors);
  if (validator.input?.source !== "workflow_result" && validator.input?.source !== "artifact" && validator.input?.source !== "project") {
    errors.push("script validator input.source must be workflow_result, artifact, or project");
  }
  if (validator.output?.schema !== "verification_result_v1") {
    errors.push("script validator output.schema must be verification_result_v1");
  }
  if (validator.builder?.kind !== "codex_subagent") {
    errors.push("script validator builder.kind must be codex_subagent");
  }
  required(validator.builder?.builtAt, "script validator builder.builtAt", errors);
  if (validator.builder?.selfCheck?.status !== "passed") {
    errors.push("script validator builder.selfCheck.status must be passed");
  }
  required(validator.builder?.selfCheck?.command, "script validator builder.selfCheck.command", errors);
  required(validator.builder?.selfCheck?.evidence, "script validator builder.selfCheck.evidence", errors);
}

function validateScriptRef(validator: VerificationScriptValidator, errors: string[]): void {
  const ref = validator.scriptRef;
  if (!ref || typeof ref !== "object") {
    errors.push("script validator scriptRef is required");
    return;
  }
  if (!ref.path || ref.path.trim().length === 0) {
    errors.push("script validator scriptRef.path is required");
  } else {
    validateSafeRelativePath(ref.path, "script validator scriptRef.path", errors);
  }
  if (!ref.checksum || ref.checksum.trim().length === 0) {
    errors.push("script validator scriptRef.checksum is required");
  }
  if (!Number.isInteger(ref.timeoutMs) || ref.timeoutMs <= 0) {
    errors.push("script validator scriptRef.timeoutMs must be a positive integer");
  }
  validateScriptCwd(ref.cwd, errors);
}
```

Use the same relative path safety as command validator cwd by extracting a shared helper:

```ts
function validateSafeRelativePath(relativePath: string, label: string, errors: string[]): void {
  if (path.isAbsolute(relativePath)) {
    errors.push(`${label} must not be absolute`);
    return;
  }
  const normalized = path.normalize(relativePath);
  if (normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    errors.push(`${label} must stay within the workspace`);
  }
}
```

`validateScriptCwd` accepts `"loop"`, `"project"`, `"contract"`, or `{ relativeToProject }`; for `relativeToProject`, call `validateSafeRelativePath`.

- [ ] **Step 5: Run the targeted contract tests and verify they pass**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts -t "script validators"
```

Expected: PASS for the script validator contract tests.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/contract/types.ts plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts plugins/dittosloop-for-codex/mcp/test/contract.test.ts
git commit -m "feat: add script evaluator contract shape"
```

Expected: one commit that adds script evaluator schema support without executing scripts yet.

---

### Task 3: Execute Script Evaluators And Parse Structured Results

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`

**Interfaces:**
- Consumes: `VerificationScriptValidator`, existing `CommandExecutor`, `runVerificationV2(input)`, and `aggregateVerificationDecision(policy, results)`.
- Produces: `ScriptValidatorResult`, `CommandExecutionRequest.stdin?: string`, and structured `verification_result_v1` parsing.

- [ ] **Step 1: Add failing script evaluator runtime tests**

Append these tests to `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`:

```ts
test("verification v2 script validators parse structured JSON results", async () => {
  const requests: Array<{ command: string; args: string[]; cwd?: string; stdin?: string }> = [];
  const policy = verificationPolicyWithValidators([
    scriptValidatorFixture()
  ]);

  const result = await runVerificationV2({
    id: "verification_script",
    runId: "run_1",
    attemptId: "attempt_1",
    createdAt: "2026-06-29T00:00:00.000Z",
    policy,
    workflowResult: { releaseNotes: "All changes covered." },
    contractWorkspacePath: "/loop-workspace",
    commandExecutor: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          score: 0.92,
          summary: "Release notes cover all changes.",
          evidence: ["Matched 8 of 8 commits."],
          criteriaResults: [
            {
              criterionId: "tests-pass",
              status: "passed",
              score: 0.92,
              evidence: "Every user-facing change is represented."
            }
          ],
          output: { matchedCommits: 8, totalCommits: 8 }
        }),
        stderr: ""
      };
    }
  });

  expect(requests[0]).toMatchObject({
    command: "node",
    args: ["evaluators/release-note-script/evaluator.mjs"],
    cwd: "/loop-workspace"
  });
  expect(JSON.parse(requests[0].stdin ?? "{}")).toMatchObject({
    validatorId: "release-note-script",
    workflowResult: { releaseNotes: "All changes covered." }
  });
  expect(result).toMatchObject({
    status: "passed",
    validatorResults: [
      {
        validatorId: "release-note-script",
        type: "script",
        status: "passed",
        score: 0.92,
        evidence: "Matched 8 of 8 commits."
      }
    ]
  });
});

test("verification v2 script validators fail on invalid JSON output", async () => {
  const policy = verificationPolicyWithValidators([
    scriptValidatorFixture()
  ]);

  const result = await runVerificationV2({
    id: "verification_script_invalid",
    runId: "run_1",
    createdAt: "2026-06-29T00:00:00.000Z",
    policy,
    workflowResult: {},
    contractWorkspacePath: "/loop-workspace",
    commandExecutor: async () => ({
      exitCode: 0,
      stdout: "not-json",
      stderr: "warning"
    })
  });

  expect(result).toMatchObject({
    status: "failed",
    validatorResults: [
      {
        validatorId: "release-note-script",
        type: "script",
        status: "failed",
        summary: "Script validator release-note-script did not return valid verification_result_v1 JSON."
      }
    ]
  });
  expect(result.validatorResults[0]?.evidence).toContain("stdout:");
});
```

Add this helper near `verificationPolicyWithValidators`:

```ts
function scriptValidatorFixture(): VerificationPolicyV2["validators"][number] {
  return {
    id: "release-note-script",
    type: "script",
    label: "Release note script",
    criteriaIds: ["tests-pass"],
    severity: "must",
    runtime: "node",
    scriptRef: {
      path: "evaluators/release-note-script/evaluator.mjs",
      checksum: "sha256:0123456789abcdef",
      cwd: "loop",
      args: [],
      timeoutMs: 30000
    },
    input: { source: "workflow_result" },
    output: { schema: "verification_result_v1" },
    evidenceRequired: true,
    builder: {
      kind: "codex_subagent",
      builtAt: "2026-06-29T00:00:00.000Z",
      selfCheck: {
        status: "passed",
        command: "node",
        args: ["evaluators/release-note-script/evaluator.mjs"],
        evidence: "fixture passed"
      }
    }
  };
}
```

- [ ] **Step 2: Run the targeted verifier tests and verify they fail**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts -t "script validators"
```

Expected: FAIL because `runVerificationV2` does not execute `script` validators.

- [ ] **Step 3: Extend command execution with stdin**

In `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`, add `stdin?: string` to `CommandExecutionRequest`.

Inside `defaultCommandExecutor`, change `stdio` to:

```ts
stdio: ["pipe", "pipe", "pipe"]
```

After registering event handlers, write stdin:

```ts
if (request.stdin !== undefined) {
  child.stdin.end(request.stdin);
} else {
  child.stdin.end();
}
```

- [ ] **Step 4: Add script result types and switch branch**

In `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`, import `VerificationScriptValidator`.

Add `ScriptValidatorResult` from Shared Interfaces and include it in `ValidatorResult`.

Update `runDeterministicValidator`:

```ts
case "script":
  return runScriptValidator(validator, input);
```

- [ ] **Step 5: Implement script execution**

Add:

```ts
async function runScriptValidator(
  validator: VerificationScriptValidator,
  input: RunVerificationV2Input
): Promise<ScriptValidatorResult> {
  const executor = input.commandExecutor ?? defaultCommandExecutor;
  const cwd = resolveScriptCwd(validator, input);
  const execution = await executor({
    command: scriptRuntimeCommand(validator.runtime),
    args: [validator.scriptRef.path, ...(validator.scriptRef.args ?? [])],
    cwd,
    timeoutMs: validator.scriptRef.timeoutMs,
    stdin: JSON.stringify(scriptValidatorInputEnvelope(validator, input))
  });
  const stdout = truncateEvidence(execution.stdout);
  const stderr = truncateEvidence(execution.stderr);
  const error = execution.error ? truncateEvidence(execution.error) : undefined;

  if (execution.exitCode !== 0 || execution.timedOut || error) {
    return {
      validatorId: validator.id,
      type: "script",
      label: validator.label,
      severity: validator.severity,
      criteriaIds: validator.criteriaIds,
      status: "failed",
      summary: `Script validator ${validator.id} failed to execute.`,
      evidence: commandEvidence(stdout, stderr, error),
      runtime: validator.runtime,
      scriptPath: validator.scriptRef.path,
      cwd,
      exitCode: execution.exitCode,
      stdout,
      stderr
    };
  }

  const parsed = parseScriptVerificationJson(stdout);
  if (!parsed.ok) {
    return {
      validatorId: validator.id,
      type: "script",
      label: validator.label,
      severity: validator.severity,
      criteriaIds: validator.criteriaIds,
      status: "failed",
      summary: `Script validator ${validator.id} did not return valid verification_result_v1 JSON.`,
      evidence: commandEvidence(stdout, stderr, parsed.error),
      runtime: validator.runtime,
      scriptPath: validator.scriptRef.path,
      cwd,
      exitCode: execution.exitCode,
      stdout,
      stderr
    };
  }

  const evidence = scriptEvidenceText(parsed.value);
  return {
    validatorId: validator.id,
    type: "script",
    label: validator.label,
    severity: validator.severity,
    criteriaIds: validator.criteriaIds,
    status: parsed.value.status,
    summary: parsed.value.summary,
    evidence,
    runtime: validator.runtime,
    scriptPath: validator.scriptRef.path,
    cwd,
    exitCode: execution.exitCode,
    stdout,
    stderr,
    score: parsed.value.score,
    output: parsed.value.output ?? { criteriaResults: parsed.value.criteriaResults }
  };
}
```

Add helpers:

```ts
function scriptRuntimeCommand(runtime: VerificationScriptValidator["runtime"]): string {
  return runtime === "node" ? "node" : "python3";
}

function scriptValidatorInputEnvelope(validator: VerificationScriptValidator, input: RunVerificationV2Input): Record<string, unknown> {
  return {
    validatorId: validator.id,
    criteriaIds: validator.criteriaIds,
    source: validator.input.source,
    workflowResult: input.workflowResult
  };
}

function parseScriptVerificationJson(stdout: string): { ok: true; value: ScriptVerificationJson } | { ok: false; error: string } {
  try {
    const value = JSON.parse(stdout) as ScriptVerificationJson;
    if (value.status !== "passed" && value.status !== "failed" && value.status !== "needs_human") {
      return { ok: false, error: "status must be passed, failed, or needs_human" };
    }
    if (!value.summary || typeof value.summary !== "string") {
      return { ok: false, error: "summary is required" };
    }
    if (value.score !== undefined && (typeof value.score !== "number" || !Number.isFinite(value.score))) {
      return { ok: false, error: "score must be finite" };
    }
    return { ok: true, value };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function scriptEvidenceText(value: ScriptVerificationJson): string | undefined {
  const evidence = [
    ...(value.evidence ?? []),
    ...(value.criteriaResults ?? []).map((result) => result.evidence).filter((item): item is string => Boolean(item?.trim()))
  ];
  return evidence.length > 0 ? evidence.join("\n") : undefined;
}
```

Add `resolveScriptCwd` next to `resolveCommandCwd`:

```ts
function resolveScriptCwd(validator: VerificationScriptValidator, input: RunVerificationV2Input): string | undefined {
  const cwd = validator.scriptRef.cwd;
  if (cwd === "loop" || cwd === "contract") {
    return input.contractWorkspacePath;
  }
  if (cwd === "project") {
    return input.projectPath;
  }
  return input.projectPath ? path.resolve(input.projectPath, cwd.relativeToProject) : cwd.relativeToProject;
}
```

- [ ] **Step 6: Run the targeted verifier tests and verify they pass**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts -t "script validators"
```

Expected: PASS for both script validator runtime tests.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts plugins/dittosloop-for-codex/mcp/test/verifier.test.ts
git commit -m "feat: run script evaluators"
```

Expected: one commit that executes script validators and records structured results.

---

### Task 4: Wire Loop Workspace Paths Into Runtime Verification

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceDirectory.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/contractVerification.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`

**Interfaces:**
- Consumes: `RunVerificationV2Input.contractWorkspacePath`, `LoopService.options.store.dataDir`, and loop id.
- Produces: `loopWorkspacePath(dataDir, loopId)` and runtime support for script validators with `scriptRef.cwd: "loop"`.

- [ ] **Step 1: Add direct runner test for contract workspace path**

Append to `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`:

```ts
test("passes contract workspace path to script validators", async () => {
  const requests: Array<{ cwd?: string; stdin?: string }> = [];
  const scriptContract = {
    ...contract,
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Output is acceptable.", severity: "must" }
      ],
      validators: [
        {
          id: "script-quality",
          type: "script",
          label: "Script quality",
          criteriaIds: ["quality"],
          severity: "must",
          runtime: "node",
          scriptRef: {
            path: "evaluators/script-quality/evaluator.mjs",
            checksum: "sha256:0123456789abcdef",
            cwd: "loop",
            timeoutMs: 30000
          },
          input: { source: "workflow_result" },
          output: { schema: "verification_result_v1" },
          evidenceRequired: true,
          builder: {
            kind: "codex_subagent",
            builtAt: "2026-06-29T00:00:00.000Z",
            selfCheck: {
              status: "passed",
              command: "node",
              args: ["evaluators/script-quality/evaluator.mjs"],
              evidence: "fixture passed"
            }
          }
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true,
        requireEvidenceForScriptResults: true
      }
    }
  } satisfies FormalLoopContract;

  const runner = new LoopRunner({
    executor: { async run() { return { text: "candidate" }; } },
    commandExecutor: async (request) => {
      requests.push(request);
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          status: "passed",
          summary: "Script accepted output.",
          evidence: ["checked candidate"]
        }),
        stderr: ""
      };
    },
    contractWorkspacePath: "/loop-workspace",
    now: () => "2026-06-29T00:00:00.000Z"
  });

  const result = await runner.run({ contract: scriptContract, runId: "run_script", attemptId: "attempt_script" });

  expect(result.status).toBe("completed");
  expect(requests[0]).toMatchObject({ cwd: "/loop-workspace" });
});
```

- [ ] **Step 2: Add service integration test for loop-owned script evaluator**

Append to `plugins/dittosloop-for-codex/mcp/test/service.test.ts`:

```ts
test("executes loop-owned script evaluators from the loop workspace", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Script verification",
    goal: "Verify workflow output through a generated script",
    body: {
      steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft result." }]
    },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Output passes script quality checks.", severity: "must" }
      ],
      validators: [
        {
          id: "script-quality",
          type: "script",
          label: "Script quality",
          criteriaIds: ["quality"],
          severity: "must",
          runtime: "node",
          scriptRef: {
            path: "evaluators/script-quality/evaluator.mjs",
            checksum: "sha256:0123456789abcdef",
            cwd: "loop",
            timeoutMs: 30000
          },
          input: { source: "workflow_result" },
          output: { schema: "verification_result_v1" },
          evidenceRequired: true,
          builder: {
            kind: "codex_subagent",
            builtAt: fixedTime,
            selfCheck: {
              status: "passed",
              command: "node",
              args: ["evaluators/script-quality/evaluator.mjs"],
              evidence: "fixture passed"
            }
          }
        }
      ],
      decision: {
        requireAllMustCriteriaCovered: true,
        failOnMustValidatorFailure: true,
        failOnShouldValidatorFailure: false,
        requireEvidenceForAgentScores: true,
        requireEvidenceForScriptResults: true
      }
    }
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run script verification" });
  const dataDir = (service as any).options.store.dataDir as string;
  const evaluatorDir = join(dataDir, "loops", formal.id, "evaluators", "script-quality");
  await mkdir(evaluatorDir, { recursive: true });
  await writeFile(
    join(evaluatorDir, "evaluator.mjs"),
    [
      "const chunks = [];",
      "for await (const chunk of process.stdin) chunks.push(chunk);",
      "const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
      "const payload = JSON.stringify(input.workflowResult);",
      "const passed = payload.includes('accepted');",
      "console.log(JSON.stringify({",
      "  status: passed ? 'passed' : 'failed',",
      "  summary: passed ? 'accepted' : 'missing accepted marker',",
      "  evidence: [payload],",
      "  output: { checked: true }",
      "}));"
    ].join("\n"),
    "utf8"
  );

  const run = await service.executeWorkflowAttempt(launch.run.id, {
    attemptId: launch.attempt.id,
    executor: {
      async run() {
        return { text: "accepted result" };
      }
    }
  });
  const detail = await service.getRunDetail(run.id);

  expect(detail.verificationResults).toMatchObject([
    {
      version: 2,
      status: "passed",
      validatorResults: [
        {
          validatorId: "script-quality",
          type: "script",
          status: "passed",
          evidence: "accepted result"
        }
      ]
    }
  ]);
});
```

- [ ] **Step 3: Run targeted tests and verify they fail**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts -t "contract workspace path"
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "loop-owned script evaluators"
```

Expected: FAIL because service and direct runner do not yet pass loop workspace paths.

- [ ] **Step 4: Expose loop workspace path and preserve evaluator files**

In `plugins/dittosloop-for-codex/mcp/src/workspaceDirectory.ts`, add:

```ts
export function loopWorkspacePath(dataDir: string, loopId: string): string {
  return join(dataDir, "loops", loopId);
}
```

Use it in `syncLoopWorkspaceDirectory`:

```ts
const loopDir = loopWorkspacePath(dataDir, loopId);
```

Preserve generated evaluator files during stale cleanup by adding:

```ts
const PRESERVED_TOP_LEVEL_DIRS = new Set(["evaluators"]);
```

At the start of the `entry.isDirectory()` branch in `removeStaleFiles`, add:

```ts
const relativeDir = relative(rootDir, entryPath).split(sep).join("/");
if (PRESERVED_TOP_LEVEL_DIRS.has(relativeDir)) {
  continue;
}
```

- [ ] **Step 5: Pass workspace path through verification runners**

In `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`, add to `LoopRunnerOptions`:

```ts
contractWorkspacePath?: string;
```

Pass it into `runContractVerification`:

```ts
contractWorkspacePath: this.options.contractWorkspacePath,
```

In `plugins/dittosloop-for-codex/mcp/src/runner/contractVerification.ts`, add `contractWorkspacePath?: string` to the input type and pass it into `runVerificationV2`.

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, import `loopWorkspacePath` and pass:

```ts
contractWorkspacePath: loopWorkspacePath(this.options.store.dataDir, run.loopId)
```

to both:

- the `new LoopRunner({ ... })` options in `executeWorkflowAttempt`
- the direct `runContractVerification({ ... })` call in `verifyGraphWorkflowCompletion`
- the `runVerificationV2({ ... })` call in `recordValidatorResult`

- [ ] **Step 6: Run targeted tests and verify they pass**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts -t "contract workspace path"
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts -t "loop-owned script evaluators"
```

Expected: PASS for both loop workspace path tests.

- [ ] **Step 7: Commit Task 4**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workspaceDirectory.ts plugins/dittosloop-for-codex/mcp/src/runner/contractVerification.ts plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts
git commit -m "feat: resolve loop-owned evaluator scripts"
```

Expected: one commit that wires loop workspace paths through runtime verification.

---

### Task 5: Enforce Script Evidence And Update Loop Creation Guidance

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`
- Modify: `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`
- Modify: `test/loop-skill-memory.test.mjs`

**Interfaces:**
- Consumes: `requireEvidenceForScriptResults?: boolean`, `VerificationScriptValidator.evidenceRequired`, and script validator structured results.
- Produces: decision aggregation that blocks unsupported script passes and skill guidance that requires a visible evaluator-builder subagent before generated script validators are registered.

- [ ] **Step 1: Add failing script evidence policy test**

Append to `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`:

```ts
test("verification v2 script validators cannot pass without required evidence", async () => {
  const policy = verificationPolicyWithValidators([
    scriptValidatorFixture()
  ]);
  policy.decision.requireEvidenceForScriptResults = true;

  const result = await runVerificationV2({
    id: "verification_script_no_evidence",
    runId: "run_1",
    createdAt: "2026-06-29T00:00:00.000Z",
    policy,
    workflowResult: {},
    contractWorkspacePath: "/loop-workspace",
    commandExecutor: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        status: "passed",
        score: 1,
        summary: "Looks good."
      }),
      stderr: ""
    })
  });

  expect(result).toMatchObject({
    status: "needs_human",
    decision: {
      needsHumanValidatorIds: ["release-note-script"]
    }
  });
});
```

- [ ] **Step 2: Add failing loop skill guidance assertions**

In `test/loop-skill-memory.test.mjs`, extend `"create loop guidance describes clarification, creation, and preview handoff"`:

```js
  assert.match(createLoop, /evaluator-builder subagent/);
  assert.match(createLoop, /script evaluator/);
  assert.match(createLoop, /self-check/);
  assert.match(createLoop, /checksum/);
  assert.match(createLoop, /verification_result_v1/);
```

- [ ] **Step 3: Run targeted tests and verify they fail**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts -t "required evidence"
npm test -- --test-name-pattern "create loop guidance describes clarification"
```

Expected: FAIL because script evidence policy and builder guidance are not implemented yet.

- [ ] **Step 4: Enforce script evidence in aggregation**

In `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`, update `aggregateVerificationDecision`:

```ts
const effectiveResults = validatorResults.map((result) =>
  enforceScriptPolicy(policy, enforceRubricAgentPolicy(policy, result))
);
```

Add:

```ts
function enforceScriptPolicy(policy: VerificationPolicyV2, result: ValidatorResult): ValidatorResult {
  if (result.type !== "script" || result.status !== "passed") {
    return result;
  }

  const validator = policy.validators.find((candidate) =>
    candidate.id === result.validatorId && candidate.type === "script"
  );
  const requiresEvidence = policy.decision.requireEvidenceForScriptResults
    || (validator?.type === "script" && validator.evidenceRequired);
  const hasRequiredEvidence = !requiresEvidence || Boolean(result.evidence?.trim());

  if (!hasRequiredEvidence) {
    return {
      ...result,
      status: "needs_human",
      summary: "Script validator result requires evidence."
    };
  }

  return result;
}
```

- [ ] **Step 5: Add evaluator-builder guidance**

In `plugins/dittosloop-for-codex/skills/loop/references/create-loop.md`, add this paragraph after the `Rubric Draft` block:

```markdown
When the rubric draft needs a custom `script evaluator`, start a visible evaluator-builder subagent before calling `create_loop_contract`. The evaluator-builder subagent must create the evaluator script, create a fixture or dry-run sample, run a self-check, report the script checksum, and confirm that stdout uses the `verification_result_v1` JSON shape. Register the script validator only after the self-check passes; otherwise keep the loop as not created and tell the user what blocked evaluator setup.
```

Also add `script` to the example validator list sentence:

```markdown
- Validators: automated commands, script evaluators, rubric agents, human review, or a mix.
```

- [ ] **Step 6: Run targeted tests and verify they pass**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts -t "required evidence"
npm test -- --test-name-pattern "create loop guidance describes clarification"
```

Expected: PASS for script evidence and loop skill guidance tests.

- [ ] **Step 7: Commit Task 5**

Run:

```bash
git add plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts plugins/dittosloop-for-codex/mcp/test/verifier.test.ts plugins/dittosloop-for-codex/skills/loop/references/create-loop.md test/loop-skill-memory.test.mjs
git commit -m "feat: require evidence for script evaluators"
```

Expected: one commit that enforces script evidence and documents visible evaluator building.

---

### Task 6: Final Verification And Review

**Files:**
- No new source files.
- Review every file changed by Tasks 1-5.

**Interfaces:**
- Consumes: all previous task commits.
- Produces: a reviewed implementation branch ready for user review.

- [ ] **Step 1: Run MCP typecheck**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 2: Run MCP tests**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test
```

Expected: PASS for all Vitest tests.

- [ ] **Step 3: Run root repository tests**

Run:

```bash
npm test
```

Expected: PASS for all root Node tests.

- [ ] **Step 4: Validate plugin generated files**

Run:

```bash
npm test -- --test-name-pattern "accepts generated files that match the git index"
```

Expected: PASS; if it fails because `plugins/dittosloop-for-codex/mcp/dist/index.js` is stale, run the MCP build once and re-run this command.

- [ ] **Step 5: Review all diffs**

Run:

```bash
git diff --stat main...HEAD
git diff --check main...HEAD
```

Expected: only the spec, plan, verification runtime, workspace, service, skill guidance, and tests changed; no whitespace errors.

- [ ] **Step 6: Confirm design requirements**

Manually check:

- `verification.md` for v2 loops has criteria, evaluators, evidence requirements, and decision policy.
- `verification.md` for v2 loops has no latest status, latest score, latest evidence, latest decision, or runtime waiting/passed/failed state.
- Legacy-compatible loops can still render `rubrics.md`.
- Script validators fail contract validation without script ref, checksum, output schema, and passed self-check metadata.
- Script validator execution records stdout/stderr evidence for process failures.
- Script validator execution parses valid `verification_result_v1` JSON into a normal validator result.
- Missing required script evidence changes a claimed pass into `needs_human`.
- Score validators can still read numbers from prior validator output.
- Workflow task success cannot complete a v2 run before verification finishes.
- Loop creation guidance requires a visible evaluator-builder subagent for custom script evaluators.

- [ ] **Step 7: Commit any final generated build output**

If Step 4 required a build and `plugins/dittosloop-for-codex/mcp/dist/index.js` changed, run:

```bash
git add plugins/dittosloop-for-codex/mcp/dist/index.js
git commit -m "build: update mcp bundle"
```

Expected: either no generated build commit is needed or one build-only commit is added.

---

## Self-Review Checklist

- [ ] The plan covers every requirement in `docs/superpowers/specs/2026-06-29-verification-flow-and-evaluator-architecture-design.md`.
- [ ] `verification.md` is static and generated from `contract.verification`.
- [ ] Dynamic verification results remain available through run records, `status.json`, run detail, and preview.
- [ ] No new v2 `rubrics.md` is introduced.
- [ ] Script evaluators have contract schema, validation, execution, structured result parsing, and evidence policy.
- [ ] Script evaluators can run from loop-owned workspace paths.
- [ ] The evaluator-builder subagent requirement is captured in installed loop creation guidance.
- [ ] Root tests and MCP tests are the final verification gate.
