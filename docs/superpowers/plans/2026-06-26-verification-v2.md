# Verification V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace rubric-first verification with runtime-owned verification v2, supporting command, score, and rubric-agent validators without allowing workflow workers to self-approve final runs.

**Architecture:** Verification v2 is a pipeline with acceptance criteria, validator execution, and decision aggregation. Contract compilation and migration produce v2 policies; the runner executes deterministic validators and delegates async rubric-agent validator writeback to service state; MCP, workspace files, and preview render both legacy and v2 results during transition.

**Tech Stack:** TypeScript, Node.js 20 child process APIs, Vitest, Zod, existing LoopService/LoopStore runtime, existing Codex session bridge.

## Global Constraints

- Work only in `/Users/edisonzhong/Documents/dittos loop/dittosloop-for-codex/.worktrees/verification-v2-design`.
- Do not edit the main working tree directly.
- New formal contracts use `verification.version: 2`.
- The current rubric-only v1 schema is rejected for new `create_loop_contract` inputs.
- V1 formal contracts and legacy loops remain readable through deterministic migration.
- Runtime verification owns final run decisions for v2 contracts.
- `record_session_result(status: "passed")` must not create final verification or complete a v2 run by itself.
- Initial validator types are exactly `command`, `score`, and `rubric_agent`.
- Command validators execute without a shell by default, use argument arrays, enforce timeout, bound stdout/stderr evidence, and do not persist environment variables.
- Command validator `cwd` resolves only under the project binding or contract workspace; unsafe absolute `cwd` is rejected.
- Rubric-agent validators require a separate verifier session unless `allowSelfReview` is explicitly true.
- Missing rubric-agent evidence fails when both validator `evidenceRequired` and decision `requireEvidenceForAgentScores` are true.
- `repairPolicy.maxAttempts` is the total number of attempts, including the first attempt.
- Old `VerificationResult` records remain readable; new v2 runs persist `VerificationResultV2`.
- Workspace files use `verification.md` for v2 formal loops; legacy rendering must not crash.
- Existing root and MCP tests must pass after migration tests are added.

---

## File Structure

- Modify `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`: add v2 contract policy, validator, criterion, result, and compatibility union types.
- Modify `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`: normalize v1-compatible inputs into v2 policies during internal compilation.
- Modify `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`: convert legacy `verification.checks` to v2 validators and criteria.
- Modify `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`: validate v2 policies and reject invalid validator definitions.
- Create `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`: deterministic validator execution, score resolution, async rubric-agent result conversion, and decision aggregation.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/verifier.ts`: keep legacy helpers and re-export v2 decision/result types where needed.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/repair.ts`: accept v2 aggregated decisions while preserving legacy behavior.
- Modify `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`: remove v2 no-verifier auto-pass and emit v2 validator lifecycle events.
- Modify `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`: add validator lifecycle event types and v2-compatible verification snapshots.
- Modify `plugins/dittosloop-for-codex/mcp/src/types.ts`: widen persisted verification result type and add workflow verification state for pending async validators.
- Modify `plugins/dittosloop-for-codex/mcp/src/service.ts`: orchestrate v2 verification, store v2 results, reject v2 `record_verification` shortcuts, and add `recordValidatorResult`.
- Modify `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`: update `create_loop_contract`, add `record_validator_result`, and return v2 verification payloads.
- Modify `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`: render `verification.md`, v2 status summaries, and legacy fallback.
- Modify `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`: render `validator_started`, `validator_done`, and `verification_decided` timeline items.
- Modify tests under `plugins/dittosloop-for-codex/mcp/test/`: update legacy assumptions, add v2 contract, runner, service, MCP, preview, and multi-agent e2e coverage.

## Shared Interfaces

All implementers must use these names and shapes unless an earlier task changes them and commits the change.

```ts
export interface VerificationPolicyV2 {
  version: 2;
  mode: "after_workflow" | "after_each_step";
  criteria: VerificationCriterion[];
  validators: VerificationValidator[];
  decision: VerificationDecisionPolicy;
}

export interface VerificationCriterion {
  id: string;
  label: string;
  description: string;
  severity: "must" | "should";
}

export type VerificationValidator =
  | CommandValidator
  | ScoreValidator
  | RubricAgentValidator;

export interface VerificationDecisionPolicy {
  requireAllMustCriteriaCovered: boolean;
  failOnMustValidatorFailure: boolean;
  failOnShouldValidatorFailure: boolean;
  requireEvidenceForAgentScores: boolean;
}

export interface CommandValidator {
  id: string;
  type: "command";
  label: string;
  command: string;
  args?: string[];
  cwd?: "project" | "contract" | { relativeToProject: string };
  timeoutMs: number;
  criteriaIds?: string[];
  severity: "must" | "should";
  parse?: CommandParseSpec;
}

export interface CommandParseSpec {
  kind: "none" | "json";
  metrics?: Record<string, string>;
}

export interface ScoreValidator {
  id: string;
  type: "score";
  label: string;
  metric: string;
  source: ScoreSource;
  operator: ">=" | ">" | "<=" | "<" | "==" | "!=";
  threshold: number;
  criteriaIds?: string[];
  severity: "must" | "should";
}

export type ScoreSource =
  | { type: "workflow_result"; path: string }
  | { type: "artifact"; artifactId: string; path: string }
  | { type: "validator_output"; validatorId: string; path: string };

export interface RubricAgentValidator {
  id: string;
  type: "rubric_agent";
  label: string;
  criteriaIds: string[];
  scoreScale: { min: number; max: number };
  passScore: number;
  evidenceRequired: boolean;
  severity: "must" | "should";
  allowSelfReview?: boolean;
  subagent?: CodexSubagentSpec;
}

export interface VerificationResultV2 {
  id: string;
  version: 2;
  runId: string;
  attemptId?: string;
  status: "passed" | "failed" | "needs_human" | "skipped";
  summary: string;
  validatorResults: ValidatorResult[];
  decision: AggregatedVerificationDecision;
  createdAt: string;
}
```

---

### Task 1: Contract V2 Types, Validation, And Migration

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

**Interfaces:**
- Consumes: existing `FormalLoopContractInput`, `LoopContract`, `CodexSubagentSpec`.
- Produces: `VerificationPolicyV2`, `LegacyVerificationPolicy`, `FormalLoopContract["verification"]` as `VerificationPolicyV2`, and `migrateVerificationToV2(input: LegacyVerificationPolicy | VerificationPolicyV2): VerificationPolicyV2`.

- [ ] **Step 1: Add failing v2 contract tests**

Append these tests to `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`:

```ts
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
```

- [ ] **Step 2: Run contract tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
```

Expected: FAIL with TypeScript errors or assertions because v2 types and migration do not exist yet.

- [ ] **Step 3: Add contract v2 types and compatibility aliases**

In `plugins/dittosloop-for-codex/mcp/src/contract/types.ts`, replace the old verification interfaces with the shared interfaces plus:

```ts
export interface LegacyVerificationRubric {
  id: string;
  label: string;
  requirement: string;
  severity: "must" | "should";
}

export interface LegacyVerificationPolicy {
  mode: "after_workflow" | "after_each_agent";
  rubrics: LegacyVerificationRubric[];
}

export type VerificationPolicyInput = VerificationPolicyV2 | LegacyVerificationPolicy;
export type VerificationPolicy = VerificationPolicyV2;
```

Keep `FormalLoopContract.verification` typed as `VerificationPolicy`, and keep `FormalLoopContractInput` accepting `verification: VerificationPolicyInput` by replacing its definition with:

```ts
export type FormalLoopContractInput =
  & Pick<FormalLoopContract, "id" | "title" | "goal" | "body">
  & { verification: VerificationPolicyInput }
  & Partial<Omit<FormalLoopContract, "id" | "title" | "goal" | "body" | "verification">>;
```

- [ ] **Step 4: Implement migration helpers**

In `plugins/dittosloop-for-codex/mcp/src/contract/compileContract.ts`, add and export:

```ts
import type {
  FormalLoopContract,
  FormalLoopContractInput,
  LegacyVerificationPolicy,
  VerificationPolicyInput,
  VerificationPolicyV2
} from "./types.js";

const defaultDecision = {
  requireAllMustCriteriaCovered: true,
  failOnMustValidatorFailure: true,
  failOnShouldValidatorFailure: false,
  requireEvidenceForAgentScores: true
} satisfies VerificationPolicyV2["decision"];

export function migrateVerificationToV2(input: VerificationPolicyInput): VerificationPolicyV2 {
  if ("version" in input && input.version === 2) {
    return input;
  }

  const legacy = input as LegacyVerificationPolicy;
  const criteria = legacy.rubrics.map((rubric) => ({
    id: rubric.id,
    label: rubric.label,
    description: rubric.requirement,
    severity: rubric.severity
  }));

  return {
    version: 2,
    mode: legacy.mode === "after_each_agent" ? "after_each_step" : "after_workflow",
    criteria,
    validators: criteria.length
      ? [
          {
            id: "rubric-agent",
            type: "rubric_agent",
            label: "Rubric review",
            criteriaIds: criteria.map((criterion) => criterion.id),
            scoreScale: { min: 0, max: 1 },
            passScore: 1,
            evidenceRequired: true,
            severity: "must"
          }
        ]
      : [],
    decision: defaultDecision
  };
}
```

Update `compileContract()` so the returned contract always has `verification: migrateVerificationToV2(input.verification)`.

- [ ] **Step 5: Implement legacy command migration**

In `plugins/dittosloop-for-codex/mcp/src/contract/migrateLegacyContract.ts`, add helpers:

```ts
function commandValidatorForCheck(check: string, id: string) {
  const match = /^(npm)(?:\s+run)?\s+(test|build|lint|typecheck)$/.exec(check.trim());
  if (!match) return undefined;

  const script = match[2];
  const args = script === "test" ? ["test"] : ["run", script];
  return {
    id: `${id}-command`,
    type: "command" as const,
    label: check,
    command: "npm",
    args,
    cwd: "project" as const,
    timeoutMs: 120000,
    severity: "must" as const,
    parse: { kind: "none" as const }
  };
}
```

Build `criteria` only for non-command checks and add one generated `legacy-rubric-agent` validator when non-command criteria exist. Keep command validators first in input order.

- [ ] **Step 6: Implement validation rules**

In `plugins/dittosloop-for-codex/mcp/src/contract/validateContract.ts`, replace rubric validation with `validateVerificationV2(contract.verification, contract.projectBinding, errors)`. Include these exact error substrings:

```ts
"verification.version must be 2"
"verification.mode must be after_workflow or after_each_step"
"criterion id must be unique"
"validator id must be unique"
"validator references missing criterion"
"verification.validators must contain at least one validator"
"command validator command is required"
"command validator cwd must not be absolute"
"score validator threshold must be finite"
"rubric_agent validator passScore must be inside scoreScale"
```

Keep existing step, repair, stop, budget, escalation, and subagent validation behavior.

- [ ] **Step 7: Run contract tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts
```

Expected: PASS for all contract tests.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/contract plugins/dittosloop-for-codex/mcp/test/contract.test.ts
git commit -m "feat: add verification v2 contract model"
```

---

### Task 2: Deterministic Verification Runner And Aggregator

**Files:**
- Create: `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/verifier.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/repair.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`

**Interfaces:**
- Consumes: `VerificationPolicyV2`, `VerificationValidator`, `VerificationResultV2`, workflow result `unknown`.
- Produces: `runVerificationV2(input): Promise<VerificationResultV2>`, `aggregateVerificationDecision(policy, validatorResults): AggregatedVerificationDecision`, `recordedRubricAgentResultToValidatorResult(validator, input): RubricAgentValidatorResult`.

- [ ] **Step 1: Add failing runner tests**

Append to `plugins/dittosloop-for-codex/mcp/test/verifier.test.ts`:

```ts
import { runVerificationV2, aggregateVerificationDecision } from "../src/runner/verificationV2.js";

test("verification v2 command validators pass and fail by exit code", async () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "unit-tests",
      type: "command",
      label: "Unit tests",
      command: "npm",
      args: ["test"],
      cwd: "project",
      timeoutMs: 1000,
      criteriaIds: ["tests-pass"],
      severity: "must",
      parse: { kind: "none" }
    }
  ]);

  const passed = await runVerificationV2({
    id: "verification_1",
    runId: "run_1",
    attemptId: "attempt_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: {},
    projectPath: "/repo",
    commandExecutor: async () => ({ exitCode: 0, stdout: "ok", stderr: "" })
  });
  const failed = await runVerificationV2({
    id: "verification_2",
    runId: "run_1",
    attemptId: "attempt_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: {},
    projectPath: "/repo",
    commandExecutor: async () => ({ exitCode: 1, stdout: "", stderr: "boom" })
  });

  expect(passed).toMatchObject({ version: 2, status: "passed", validatorResults: [{ validatorId: "unit-tests", status: "passed" }] });
  expect(failed).toMatchObject({ version: 2, status: "failed", validatorResults: [{ validatorId: "unit-tests", status: "failed" }] });
});

test("verification v2 score validators read workflow and validator output metrics", async () => {
  const policy = verificationPolicyWithValidators([
    {
      id: "coverage",
      type: "score",
      label: "Coverage",
      metric: "coverage",
      source: { type: "workflow_result", path: "metrics.coverage" },
      operator: ">=",
      threshold: 0.8,
      criteriaIds: ["tests-pass"],
      severity: "must"
    }
  ]);

  const result = await runVerificationV2({
    id: "verification_1",
    runId: "run_1",
    createdAt: "2026-06-26T00:00:00.000Z",
    policy,
    workflowResult: { metrics: { coverage: 0.91 } },
    commandExecutor: async () => ({ exitCode: 0, stdout: "", stderr: "" })
  });

  expect(result).toMatchObject({
    status: "passed",
    validatorResults: [{ validatorId: "coverage", type: "score", score: 0.91, threshold: 0.8 }]
  });
});

test("verification v2 uncovered must criteria fail aggregation", () => {
  const policy = verificationPolicyWithValidators([]);
  const decision = aggregateVerificationDecision(policy, []);

  expect(decision).toMatchObject({
    status: "failed",
    failedCriterionIds: ["tests-pass"]
  });
});

function verificationPolicyWithValidators(validators: VerificationPolicyV2["validators"]): VerificationPolicyV2 {
  return {
    version: 2,
    mode: "after_workflow",
    criteria: [
      { id: "tests-pass", label: "Tests pass", description: "Tests pass.", severity: "must" }
    ],
    validators,
    decision: {
      requireAllMustCriteriaCovered: true,
      failOnMustValidatorFailure: true,
      failOnShouldValidatorFailure: false,
      requireEvidenceForAgentScores: true
    }
  };
}
```

- [ ] **Step 2: Run runner tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts
```

Expected: FAIL because `verificationV2.ts` does not exist.

- [ ] **Step 3: Implement result and executor types**

Create `plugins/dittosloop-for-codex/mcp/src/runner/verificationV2.ts` with exported `ValidatorResult` union, `RunVerificationV2Input`, `CommandExecutionResult`, and `CommandExecutor`. Include `MAX_EVIDENCE_CHARS = 8000`.

```ts
export interface RunVerificationV2Input {
  id: string;
  runId: string;
  attemptId?: string;
  createdAt: string;
  policy: VerificationPolicyV2;
  workflowResult: unknown;
  projectPath?: string;
  contractWorkspacePath?: string;
  priorValidatorResults?: ValidatorResult[];
  commandExecutor?: CommandExecutor;
}
```

- [ ] **Step 4: Implement command and score validators**

In `verificationV2.ts`, implement:

```ts
export async function runVerificationV2(input: RunVerificationV2Input): Promise<VerificationResultV2> {
  const validatorResults: ValidatorResult[] = [...(input.priorValidatorResults ?? [])];
  for (const validator of input.policy.validators) {
    if (validatorResults.some((result) => result.validatorId === validator.id)) continue;
    if (validator.type === "rubric_agent") continue;
    validatorResults.push(await runDeterministicValidator(validator, input, validatorResults));
  }
  const decision = aggregateVerificationDecision(input.policy, validatorResults);
  return {
    id: input.id,
    version: 2,
    runId: input.runId,
    attemptId: input.attemptId,
    status: decision.status,
    summary: decisionSummary(decision),
    validatorResults,
    decision,
    createdAt: input.createdAt
  };
}
```

Use injected `commandExecutor` in tests and a real `spawn`-based executor when absent. The real executor must set `shell: false`, pass `command` and `args` separately, kill on timeout, and return bounded evidence.

- [ ] **Step 5: Implement decision aggregation**

Implement `aggregateVerificationDecision(policy, validatorResults)` with these rules:

```ts
const mustFailures = validatorResults.filter((result) => result.severity === "must" && result.status === "failed");
const shouldFailures = validatorResults.filter((result) => result.severity === "should" && result.status === "failed");
const needsHuman = validatorResults.filter((result) => result.status === "needs_human");
```

Return `needs_human` if any validator needs human. Return `failed` when must failures exist and `failOnMustValidatorFailure` is true. Return `failed` when should failures exist and `failOnShouldValidatorFailure` is true. Return `failed` for uncovered must criteria when `requireAllMustCriteriaCovered` is true. Otherwise return `passed` with warning strings for should failures.

- [ ] **Step 6: Keep legacy repair tests passing**

Update `plugins/dittosloop-for-codex/mcp/src/runner/repair.ts` so `shouldRepair()` accepts both legacy `VerificationDecision` and v2 `AggregatedVerificationDecision`:

```ts
type RepairableDecision = Pick<VerificationDecision, "status"> & {
  repairInstructions?: string;
};
```

No legacy test expectation should change.

- [ ] **Step 7: Run runner tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- verifier.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/runner plugins/dittosloop-for-codex/mcp/test/verifier.test.ts
git commit -m "feat: add verification v2 runner"
```

---

### Task 3: LoopRunner V2 Integration And Engine Events

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/engine.test.ts`

**Interfaces:**
- Consumes: `runVerificationV2`, `VerificationResultV2`, legacy `LoopVerifier`.
- Produces: `LoopRunResult.verification` as `VerificationDecision | VerificationResultV2`, engine events `validator_started`, `validator_done`, `verification_decided`, `verification_done`.

- [ ] **Step 1: Add failing LoopRunner v2 tests**

Append to `plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts`:

```ts
test("does not auto-pass verification v2 contracts when no validator passes", async () => {
  const v2Contract = {
    ...contract,
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Output meets quality.", severity: "must" }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent",
          label: "Quality review",
          criteriaIds: ["quality"],
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
  } satisfies FormalLoopContract;

  const runner = new LoopRunner({
    executor: { async run() { return { text: "candidate" }; } },
    now: () => "2026-06-26T00:00:00.000Z"
  });

  const result = await runner.run({ contract: v2Contract, runId: "run_1", attemptNumber: 1 });

  expect(result.status).toBe("repairing");
  expect(result.verification).toMatchObject({
    version: 2,
    status: "failed",
    decision: { failedCriterionIds: ["quality"] }
  });
});
```

- [ ] **Step 2: Add failing event tests**

In the existing `"executes a formal contract body and returns verifier outcome"` test, add a second v2-specific test that collects event types and expects:

```ts
expect(events).toEqual(expect.arrayContaining([
  "verification_started",
  "validator_started",
  "validator_done",
  "verification_decided",
  "verification_done"
]));
```

Use a command validator with injected `commandExecutor` support from Task 2.

- [ ] **Step 3: Run LoopRunner tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts engine.test.ts
```

Expected: FAIL because event types and runner integration are missing.

- [ ] **Step 4: Add v2 engine event types**

In `plugins/dittosloop-for-codex/mcp/src/engine/types.ts`, add:

```ts
| EngineEventBase<"validator_started", { attemptId: string; validatorId: string; validatorType: string; label?: string }>
| EngineEventBase<"validator_done", { attemptId: string; result: ValidatorResult }>
| EngineEventBase<"verification_decided", { attemptId: string; decision: AggregatedVerificationDecision }>
```

Import `ValidatorResult` and `AggregatedVerificationDecision` from `../runner/verificationV2.js`.

- [ ] **Step 5: Update LoopRunner verification branch**

In `LoopRunner.verify()`, branch on `contract.verification.version === 2`. For v2, call `runVerificationV2()` and never call `createPassedDecision()` for missing verifier. For legacy-compatible code paths, keep the existing `this.options.verifier` behavior.

Emit `validator_started` before each deterministic validator and `validator_done` after it. If the first implementation emits these from `runVerificationV2`, pass an `emit` callback through `RunVerificationV2Input`.

- [ ] **Step 6: Run LoopRunner tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- loopRunner.test.ts engine.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/engine/types.ts plugins/dittosloop-for-codex/mcp/src/runner/loopRunner.ts plugins/dittosloop-for-codex/mcp/test/loopRunner.test.ts plugins/dittosloop-for-codex/mcp/test/engine.test.ts
git commit -m "feat: wire verification v2 into loop runner"
```

---

### Task 4: Service State, Async Rubric-Agent Writeback, And Repair

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/types.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`

**Interfaces:**
- Consumes: `VerificationResultV2`, `ValidatorResult`, active `WorkflowContext`.
- Produces: `recordValidatorResult(runId, input): Promise<VerificationResultV2>`, persisted `VerificationResultRecord = VerificationResult | VerificationResultV2`, and `WorkflowContext.verification`.

- [ ] **Step 1: Add failing service tests for worker self-approval**

Append to `plugins/dittosloop-for-codex/mcp/test/service.test.ts`:

```ts
test("v2 worker session result cannot complete a run before validator results exist", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract({
    title: "Verifier owned loop",
    goal: "Separate work from verification",
    body: {
      steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft answer" }]
    },
    verification: {
      version: 2,
      mode: "after_workflow",
      criteria: [
        { id: "quality", label: "Quality", description: "Verifier accepts the result.", severity: "must" }
      ],
      validators: [
        {
          id: "quality-review",
          type: "rubric_agent",
          label: "Quality review",
          criteriaIds: ["quality"],
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
  });
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });

  const run = await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker says done",
    result: "candidate"
  });

  expect(run.status).not.toBe("completed");
  const detail = await service.getRunDetail(launch.run.id);
  expect(detail.verificationResults).toHaveLength(0);
});
```

- [ ] **Step 2: Add failing async validator writeback tests**

Append to `service.test.ts`:

```ts
test("recordValidatorResult finalizes v2 verification from a separate rubric agent", async () => {
  const service = await createServiceWithSequentialIds();
  const formal = await service.createLoopContract(v2RubricAgentLoopInput());
  const launch = await service.startCodexSessionRun(formal.id, { goal: "Run once" });
  await service.recordSessionResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const verification = await service.recordValidatorResult(launch.run.id, {
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "validator-quality-review-1",
    result: {
      type: "rubric_agent",
      status: "passed",
      evidence: "Candidate is complete.",
      criteriaResults: [
        { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete answer." }
      ]
    }
  });

  expect(verification).toMatchObject({ version: 2, status: "passed" });
  await expect(service.getRunDetail(launch.run.id)).resolves.toMatchObject({
    run: { status: "completed" },
    verificationResults: [{ version: 2, status: "passed" }]
  });
});
```

- [ ] **Step 3: Run service tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts
```

Expected: FAIL because v2 service state and `recordValidatorResult` do not exist.

- [ ] **Step 4: Add persisted v2 result and pending verification state**

In `plugins/dittosloop-for-codex/mcp/src/types.ts`, add:

```ts
export type VerificationResultRecord = VerificationResult | VerificationResultV2;

export interface WorkflowVerificationState {
  status: "not_started" | "running" | "waiting_for_validator" | "completed" | "failed";
  validatorResults: ValidatorResult[];
  pendingValidatorIds: string[];
  idempotencyKeys: string[];
  decision?: AggregatedVerificationDecision;
  resultId?: string;
  updatedAt: string;
}
```

Change `LoopState.verificationResults` and `RunDetail.verificationResults` to `VerificationResultRecord[]`. Add optional `verification?: WorkflowVerificationState` to `WorkflowContext`.

- [ ] **Step 5: Refactor service finalization helpers**

In `plugins/dittosloop-for-codex/mcp/src/service.ts`, add private helpers:

```ts
private async recordVerificationV2Result(runId: string, result: VerificationResultV2): Promise<VerificationResultV2>
private async finalizeV2Verification(runId: string, workflowContextId: string, result: VerificationResultV2): Promise<LoopRun>
private async startPendingRubricAgentValidators(run: LoopRun, context: WorkflowContext, policy: VerificationPolicyV2): Promise<void>
```

`finalizeV2Verification()` must apply the same pass/fail/needs-human/repair state transitions as `executeWorkflowAttempt()` uses today, but source them from `result.decision`.

- [ ] **Step 6: Block v2 self-approval in `recordSessionResult`**

In the branch that currently builds a legacy `VerificationResult` from `resultInput.status`, detect a target contract with `verification.version === 2`. For v2 workflow task results:

```ts
if (targetContract?.verification.version === 2 && isWorkflowTaskResult) {
  shouldContinueWorkflow = true;
  continuationAttemptId = attemptId;
  updatedRun = { ...run, status: "running", codexSession, updatedAt: timestamp, completedAt: undefined };
  // update context with completed task result but do not append verificationResults
  return nextStateWithContextAndEvent;
}
```

After the state update, call `executeWorkflowAttempt(runId, { attemptId: continuationAttemptId })` so the runtime, not the worker, starts verification.

- [ ] **Step 7: Implement `recordValidatorResult`**

Add public method:

```ts
async recordValidatorResult(runId: string, input: RecordValidatorResultInput): Promise<VerificationResultV2>
```

Validate run, attempt, workflow context, validator id, and idempotency key. Convert the input to a `ValidatorResult`, append it to `workflowContext.verification.validatorResults`, remove the validator from `pendingValidatorIds`, and call `runVerificationV2()` with `priorValidatorResults` when no pending validators remain.

- [ ] **Step 8: Add repair evidence mapping**

When `result.status === "failed"` and repair attempts remain, call `markWorkflowContextRepairing()` with `result.decision.repairInstructions ?? result.summary`. The repair reason must include failed validator ids and failed criterion ids in the string:

```ts
`Failed validators: ${result.decision.failedValidatorIds.join(", ")}; failed criteria: ${result.decision.failedCriterionIds.join(", ")}. ${result.summary}`
```

- [ ] **Step 9: Run service tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts e2eWorkflow.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/types.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts
git commit -m "feat: persist verification v2 results"
```

---

### Task 5: MCP Schema, Tools, And Codex Prompts

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/service.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/sessionBridge.test.ts`

**Interfaces:**
- Consumes: `LoopService.recordValidatorResult`.
- Produces: MCP tool `record_validator_result`, v2-only `create_loop_contract` schema, and v2 wording in loop creation/run prompts.

- [ ] **Step 1: Add failing MCP schema tests**

Append to `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`:

```ts
test("create_loop_contract rejects legacy rubrics shape at the MCP boundary", async () => {
  const handlers = await createHandlers();

  await expect(handlers.create_loop_contract({
    title: "Legacy shape",
    goal: "Reject rubrics",
    body: { steps: [{ id: "scan", kind: "agent", label: "Scan", prompt: "Scan" }] },
    verification: {
      mode: "after_workflow",
      rubrics: [{ id: "source", label: "Source", requirement: "Use official sources", severity: "must" }]
    }
  })).rejects.toThrow(/version/i);
});

test("record_validator_result is exposed through MCP", async () => {
  const handlers = await createHandlers();
  const contract = readResult(await handlers.create_loop_contract({
    title: "V2 verifier",
    goal: "Use separate validator",
    body: { steps: [{ id: "draft", kind: "task", runtime: "codex", label: "Draft", prompt: "Draft" }] },
    verification: v2RubricAgentVerification()
  }));
  const launch = readResult(await handlers.start_codex_session({ loopId: contract.id, goal: "Run once" }));

  await handlers.record_session_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    stepId: "draft",
    status: "passed",
    summary: "Worker produced candidate",
    result: "candidate"
  });

  const verification = readResult(await handlers.record_validator_result({
    runId: launch.run.id,
    workflowContextId: launch.launchRequest.workflowContextId,
    attemptId: launch.attempt.id,
    validatorId: "quality-review",
    idempotencyKey: "mcp-validator-1",
    result: {
      type: "rubric_agent",
      status: "passed",
      evidence: "Looks good.",
      criteriaResults: [
        { criterionId: "quality", status: "passed", score: 1, maxScore: 1, evidence: "Complete." }
      ]
    }
  }));

  expect(verification).toMatchObject({ version: 2, status: "passed" });
});
```

- [ ] **Step 2: Run MCP tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts sessionBridge.test.ts
```

Expected: FAIL because schema still accepts `rubrics` and the tool is missing.

- [ ] **Step 3: Add v2 Zod schemas**

In `plugins/dittosloop-for-codex/mcp/src/mcpServer.ts`, replace old `verification` schema with:

```ts
const verificationV2Schema = z.object({
  version: z.literal(2),
  mode: z.enum(["after_workflow", "after_each_step"]),
  criteria: z.array(verificationCriterionSchema).min(1),
  validators: z.array(verificationValidatorSchema).min(1),
  decision: verificationDecisionPolicySchema
});
```

Create discriminated validator schema for `command`, `score`, and `rubric_agent` matching the shared interfaces.

- [ ] **Step 4: Add `record_validator_result` handler**

Add schema:

```ts
const recordValidatorResultSchema = z.object({
  runId: z.string().min(1),
  workflowContextId: z.string().min(1),
  attemptId: z.string().min(1),
  validatorId: z.string().min(1),
  idempotencyKey: z.string().min(1).optional(),
  result: validatorResultInputSchema
});
```

Register the tool in `createToolHandlers()` and `registerDittosLoopTools()` with description: `"Record the result of an asynchronous verification v2 validator."`

- [ ] **Step 5: Update prompts**

In `service.ts`, update loop creation and run prompts:

```ts
"- verification.version: 2，包含 criteria、validators、decision"
"- validator types: command / score / rubric_agent"
"- workflow task session 不能把自己的 status 当最终验证；最终状态由 verification validators 决定。"
```

Replace visible "Verifier rubrics" wording with "Verification criteria and validators".

- [ ] **Step 6: Run MCP tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- mcpServer.test.ts sessionBridge.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/mcpServer.ts plugins/dittosloop-for-codex/mcp/src/service.ts plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts plugins/dittosloop-for-codex/mcp/test/sessionBridge.test.ts
git commit -m "feat: expose verification v2 mcp tools"
```

---

### Task 6: Workspace Files And Preview Rendering

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Test: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`

**Interfaces:**
- Consumes: `VerificationResultRecord`, engine validator events.
- Produces: `verification.md` for v2 loops, legacy fallback rendering, and validator timeline items.

- [ ] **Step 1: Add failing workspace file tests**

Update the existing service test that expects `rubrics.md` so v2 contracts expect:

```ts
const files = await service.listLoopFiles(formal.id);
expect(files.map((file) => file.path)).toContain("verification.md");
expect(files.map((file) => file.path)).not.toContain("rubrics.md");
expect(files.find((file) => file.path === "verification.md")?.content).toContain("## Criteria");
expect(files.find((file) => file.path === "verification.md")?.content).toContain("## Validators");
```

Add a legacy-state test that constructs an old verification result in store state and verifies preview rendering does not throw.

- [ ] **Step 2: Add failing preview timeline tests**

In `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`, add an event fixture with `validator_started`, `validator_done`, and `verification_decided`. Assert the verification timeline contains labels:

```ts
expect(section.items).toEqual(expect.arrayContaining([
  expect.objectContaining({ label: "Validator quality-review started", status: "started" }),
  expect.objectContaining({ label: "Quality review", status: "passed" }),
  expect.objectContaining({ label: "Verification passed", status: "passed" })
]));
```

- [ ] **Step 3: Run preview tests and verify failure**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts previewServer.test.ts
```

Expected: FAIL because workspace and preview still assume rubrics.

- [ ] **Step 4: Render v2 workspace files**

In `workspaceFiles.ts`, change `rootOrder` to include `verification.md` at rank `2`. For `contract.verification.version === 2`, write:

```ts
path: "verification.md",
kind: "verification",
language: "markdown",
content: verificationFile({ contract: input.contract, latestVerification })
```

`verificationFile()` must include:

```md
# <title> verification

Mode: `<mode>`

## Criteria
| id | severity | status | covering validators |

## Validators
...

## Decision
...
```

For legacy records, keep old status text and output mapping.

- [ ] **Step 5: Render v2 status JSON**

In `status.json`, include:

```ts
latestVerification: latestVerification
  ? verificationSummaryForStatus(latestVerification)
  : null
```

For v2 summaries include `version`, `status`, `decision`, and `validators` with ids, statuses, scores, thresholds, exit codes, and evidence excerpts.

- [ ] **Step 6: Render validator timeline**

In `eventAdapter.ts`, extend `verificationEventToTimelineItem()` for:

```ts
if (event.type === "validator_started") {
  return baseItem(event, "verification", `Validator ${event.validatorId} started`, "started");
}
if (event.type === "validator_done") {
  return baseItem(event, "verification", event.result.label, event.result.status, event.result.evidence);
}
if (event.type === "verification_decided") {
  return baseItem(event, "verification", `Verification ${event.decision.status}`, event.decision.status, event.decision.repairInstructions);
}
```

Update `verificationToTimelineItem()` to handle `VerificationResultV2` with validator result messages.

- [ ] **Step 7: Run preview tests and commit**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- service.test.ts previewServer.test.ts
```

Expected: PASS.

Commit:

```bash
git add plugins/dittosloop-for-codex/mcp/src/workspaceFiles.ts plugins/dittosloop-for-codex/mcp/src/preview/eventAdapter.ts plugins/dittosloop-for-codex/mcp/test/service.test.ts plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts
git commit -m "feat: render verification v2 evidence"
```

---

### Task 7: Multi-Agent E2E, Full Migration Sweep, And Verification

**Files:**
- Modify: `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/previewServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/mcpServer.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/service.test.ts`
- Modify: `plugins/dittosloop-for-codex/mcp/test/contract.test.ts`

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: full test suite passing, explicit multi-agent validation coverage, and final branch-ready verification record.

- [ ] **Step 1: Add multi-agent e2e test**

In `plugins/dittosloop-for-codex/mcp/test/e2eWorkflow.test.ts`, add a test named:

```ts
test("multi-agent workflow requires separate rubric-agent validator before completing v2 run", async () => {
  // worker task result writes candidate output
  // verifier agent writes record_validator_result
  // run completes only after verifier result
});
```

Use two separate simulated sessions in the existing bridge fixture: one worker task session and one verifier session. Assert:

```ts
expect(sessionRequests.map((request) => request.title)).toEqual(expect.arrayContaining([
  "Draft",
  "Quality review"
]));
expect(workerSessionId).not.toBe(verifierSessionId);
expect(detailBeforeValidator.run.status).not.toBe("completed");
expect(detailAfterValidator.run.status).toBe("completed");
```

- [ ] **Step 2: Add regression tests for v1 compatibility**

Update tests that still create formal contracts with `rubrics` through service internals to assert compiled contracts are v2. Keep direct old-state fixtures only where testing legacy read compatibility.

Example assertion:

```ts
expect(contract.verification).toMatchObject({
  version: 2,
  validators: [{ type: "rubric_agent" }]
});
```

- [ ] **Step 3: Run targeted suites**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp test -- contract.test.ts verifier.test.ts loopRunner.test.ts service.test.ts mcpServer.test.ts previewServer.test.ts e2eWorkflow.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run MCP typecheck and build**

Run:

```bash
npm --prefix plugins/dittosloop-for-codex/mcp run typecheck
npm --prefix plugins/dittosloop-for-codex/mcp run build
```

Expected: both commands exit `0`.

- [ ] **Step 5: Run root verification**

Run:

```bash
npm test
npm run validate
npm run verify:generated
npm run check
```

Expected:

- `npm test` passes all root Node tests.
- `npm run validate` validates plugin manifest and marketplace metadata.
- `npm run verify:generated` reports generated files are current.
- `npm run check` completes root build, generated checks, root tests, plugin validation, and MCP tests.

- [ ] **Step 6: Commit final test sweep**

Commit any remaining test-only migration updates:

```bash
git add plugins/dittosloop-for-codex/mcp/test
git commit -m "test: cover verification v2 multi-agent flow"
```

If no files remain after the full sweep, record that no commit was needed in `.superpowers/sdd/progress.md` during subagent execution.

---

## Subagent Execution Plan

Use `superpowers:subagent-driven-development` after this plan is reviewed.

- Task 1 implementer: standard model, because it changes contract types and migration across multiple files.
- Task 1 reviewer: standard model, task-scoped contract and migration review.
- Task 2 implementer: standard model, because command execution and aggregation have security-sensitive details.
- Task 2 reviewer: standard model, task-scoped validator and evidence review.
- Task 3 implementer: standard model, because runner and engine event types must stay consistent.
- Task 3 reviewer: standard model, task-scoped event and no-auto-pass review.
- Task 4 implementer: most capable model, because service state transitions and async validator writeback are high risk.
- Task 4 reviewer: most capable model, task-scoped state machine and repair review.
- Task 5 implementer: standard model, because MCP schemas and prompts touch user-facing contracts.
- Task 5 reviewer: standard model, task-scoped schema and tool review.
- Task 6 implementer: standard model, because preview/workspace rendering spans output formats.
- Task 6 reviewer: standard model, task-scoped rendering review.
- Task 7 implementer: standard model, because it is a migration and e2e test sweep.
- Task 7 reviewer: most capable model, whole branch review after final verification.

Keep `.superpowers/sdd/progress.md` updated after each reviewed task with:

```md
Task N: complete (commits <base7>..<head7>, review clean)
```

## Plan Self-Review

Spec coverage:

- Contract v2 shape, validation rules, and migration are covered by Task 1.
- Command, score, and rubric-agent validator models are covered by Tasks 1, 2, and 4.
- No v2 auto-pass behavior is covered by Task 3.
- Worker self-approval prevention is covered by Task 4.
- Persisted v2 evidence, decisions, and repair details are covered by Tasks 2 and 4.
- MCP v2 schema and `record_validator_result` are covered by Task 5.
- Workspace `verification.md` and preview timeline are covered by Task 6.
- Multi-agent verifier testing and full suite verification are covered by Task 7.

Placeholder scan:

- No unresolved placeholder markers are intentionally present.
- Each task names concrete files, test commands, expected outcomes, and commit messages.

Type consistency:

- The plan consistently uses `VerificationPolicyV2`, `VerificationResultV2`, `ValidatorResult`, `AggregatedVerificationDecision`, and `recordValidatorResult`.
- The MCP tool name is `record_validator_result`; the service method name is `recordValidatorResult`.
- The v2 mode name is `after_each_step`; legacy `after_each_agent` appears only as migration input.
