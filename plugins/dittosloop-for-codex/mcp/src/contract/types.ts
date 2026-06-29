import type { LoopStatus, LoopTrigger } from "../types.js";

export interface CodexSubagentSpec {
  ref?: string;
  role?: string;
  model?: string;
  tools?: string[];
  workdir?: string;
  env?: Record<string, string>;
  permissions?: {
    filesystem?: "read-only" | "workspace-write" | "danger-full-access";
    network?: "enabled" | "disabled";
  };
  timeoutMs?: number;
  context?: Record<string, unknown>;
}

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

export interface EffectiveAgentProfile extends Omit<AgentProfile, "requiredSkills" | "advisorySkills"> {
  source: "declared" | "legacy-inline";
  stepId: string;
  requestedRef?: string;
  requiredSkills: SkillRequirement[];
  advisorySkills: SkillRequirement[];
}

export type Step =
  | AgentStep
  | TaskStep
  | ParallelStep
  | PhaseStep;

export interface AgentStep {
  id: string;
  kind: "agent";
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  agentProfileRef?: string;
  subagent?: CodexSubagentSpec;
}

export interface TaskStep {
  id: string;
  kind: "task";
  runtime: "codex";
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  outputSchema?: Record<string, unknown>;
  agentProfileRef?: string;
  human?: boolean;
  subagent?: CodexSubagentSpec;
}

export interface ParallelStep {
  id: string;
  kind: "parallel";
  label: string;
  children: Step[];
}

export interface PhaseStep {
  id: string;
  kind: "phase";
  label: string;
  pipeline?: boolean;
  children: Step[];
}

export interface ExecutionBody {
  steps: Step[];
}

export interface VerificationCriterion {
  id: string;
  label: string;
  description: string;
  severity: "must" | "should";
}

export type ValidatorCwd =
  | "project"
  | "contract"
  | "loop"
  | { relativeToProject: string };

export type CommandValidatorCwd = Exclude<ValidatorCwd, "loop">;
export type ScriptValidatorCwd = ValidatorCwd;

export interface VerificationCommandValidator {
  id: string;
  type: "command";
  label: string;
  command: string;
  args?: string[];
  cwd?: CommandValidatorCwd;
  timeoutMs?: number;
  criteriaIds?: string[];
  severity: "must" | "should";
  parse: {
    kind: "none";
  };
}

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
    cwd?: ScriptValidatorCwd;
    args?: string[];
    timeoutMs: number;
  };
  input?: {
    source: "workflow_result" | "artifact" | "project";
  };
  output?: {
    schema: "verification_result_v1" | string;
  };
  evidenceRequired: boolean;
  builder?: {
    kind: "codex_subagent";
    builtAt: string;
    selfCheck?: {
      status: "passed" | "failed";
      command: string;
      args?: string[];
      evidence: string;
    };
  };
}

export type ScoreSource =
  | { type: "workflow_result"; path: string }
  | { type: "artifact"; artifactId: string; path: string }
  | { type: "validator_output"; validatorId: string; path: string };

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

export interface VerificationRubricAgentValidator {
  id: string;
  type: "rubric_agent";
  label: string;
  criteriaIds: string[];
  scoreScale: {
    min: number;
    max: number;
  };
  passScore: number;
  evidenceRequired: boolean;
  severity: "must" | "should";
}

export type VerificationValidator =
  | VerificationCommandValidator
  | VerificationScriptValidator
  | ScoreValidator
  | VerificationRubricAgentValidator;

export interface VerificationPolicyV2 {
  version: 2;
  mode: "after_workflow" | "after_each_step";
  criteria: VerificationCriterion[];
  validators: VerificationValidator[];
  decision: {
    requireAllMustCriteriaCovered: boolean;
    failOnMustValidatorFailure: boolean;
    failOnShouldValidatorFailure: boolean;
    requireEvidenceForAgentScores: boolean;
    requireEvidenceForScriptResults?: boolean;
  };
}

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

export interface RepairPolicy {
  maxAttempts: number;
  strategy: "repair_then_retry" | "ask_human" | "fail_run";
}

export interface StopPolicy {
  rule: string;
  maxConsecutiveFailures?: number;
}

export interface CodexProjectBinding {
  codexProjectId?: string;
  projectLabel?: string;
  projectPath?: string;
}

export interface MemoryPolicy {
  summary?: string;
}

export interface FormalLoopContract {
  id: string;
  title: string;
  goal: string;
  intent?: string;
  body: ExecutionBody;
  trigger: LoopTrigger;
  verification: VerificationPolicy;
  repairPolicy: RepairPolicy;
  stopPolicy: StopPolicy;
  budgetUsd?: number;
  escalation?: string[];
  agentProfiles?: Record<string, AgentProfile>;
  projectBinding?: CodexProjectBinding;
  memoryPolicy?: MemoryPolicy;
  status: LoopStatus;
  createdAt: string;
  updatedAt: string;
}

export type FormalLoopContractInput =
  & Pick<FormalLoopContract, "id" | "title" | "goal" | "body">
  & { verification: VerificationPolicyInput }
  & Partial<Omit<FormalLoopContract, "id" | "title" | "goal" | "body" | "verification">>;
