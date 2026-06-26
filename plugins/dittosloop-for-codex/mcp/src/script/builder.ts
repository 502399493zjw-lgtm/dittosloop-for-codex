import type {
  AgentStep,
  CodexSubagentSpec,
  PhaseStep,
  ParallelStep,
  Step,
  TaskStep
} from "../contract/types.js";

export interface TaskOpts {
  id: string;
  label: string;
  prompt: string;
  verifierRef?: string;
  sessionPolicy?: "new";
  outputSchema?: Record<string, unknown>;
  subagent?: CodexSubagentSpec;
}

export type ScriptDirective =
  | { kind: "directive"; directive: "log"; message: string }
  | { kind: "directive"; directive: "budget"; usd: number };

export interface ScriptWorkflow {
  steps: Step[];
  budgetUsd?: number;
  logs?: string[];
}

// task / agent — a single visible Codex node.
export function task(opts: TaskOpts): TaskStep {
  const step: TaskStep = {
    id: opts.id,
    kind: "task",
    runtime: "codex",
    label: opts.label,
    prompt: opts.prompt
  };
  if (opts.verifierRef !== undefined) step.verifierRef = opts.verifierRef;
  if (opts.sessionPolicy !== undefined) step.sessionPolicy = opts.sessionPolicy;
  if (opts.outputSchema !== undefined) step.outputSchema = opts.outputSchema;
  if (opts.subagent !== undefined) step.subagent = opts.subagent;
  return step;
}

// agent — compat alias; emits an AgentStep without runtime/outputSchema.
export function agent(opts: Omit<TaskOpts, "outputSchema">): AgentStep {
  const step: AgentStep = {
    id: opts.id,
    kind: "agent",
    label: opts.label,
    prompt: opts.prompt
  };
  if (opts.verifierRef !== undefined) step.verifierRef = opts.verifierRef;
  if (opts.sessionPolicy !== undefined) step.sessionPolicy = opts.sessionPolicy;
  if (opts.subagent !== undefined) step.subagent = opts.subagent;
  return step;
}

// phase — sequential group, lifecycle-bracketed.
export function phase(id: string, label: string, children: Step[]): PhaseStep {
  return { id, kind: "phase", label, children };
}

// parallel — all-settle fan-out.
export function parallel(id: string, label: string, children: Step[]): ParallelStep {
  return { id, kind: "parallel", label, children };
}

// pipeline — sequential hand-off; a phase with the pipeline marker so the executor
// threads each child's memoized output into the next child's prompt context.
export function pipeline(id: string, label: string, children: Step[]): PhaseStep {
  return { id, kind: "phase", label, pipeline: true, children };
}

// log — non-executable annotation directive folded into the contract.
export function log(message: string): ScriptDirective {
  return { kind: "directive", directive: "log", message };
}

// budget — sets/overrides contract.budgetUsd for this script.
export function budget(usd: number): ScriptDirective {
  return { kind: "directive", directive: "budget", usd };
}

// human — an explicit human-input node; compiles to a task step that suspends
// with needs_human semantics (no Codex output written; resolved via resolve_human_request).
export function human(id: string, label: string, question: string): TaskStep {
  return {
    id,
    kind: "task",
    runtime: "codex",
    label,
    prompt: question,
    human: true
  };
}

function isScriptDirective(value: Step | ScriptDirective): value is ScriptDirective {
  return (value as ScriptDirective).kind === "directive";
}

// Single aggregate return: the script returns one workflow() object whose `steps`
// become ExecutionBody.steps; log/budget directives fold into the contract fields.
export function workflow(input: { steps: Array<Step | ScriptDirective> }): ScriptWorkflow {
  const steps: Step[] = [];
  const logs: string[] = [];
  let budgetUsd: number | undefined;

  for (const entry of input.steps) {
    if (isScriptDirective(entry)) {
      if (entry.directive === "log") {
        logs.push(entry.message);
      } else {
        budgetUsd = entry.usd;
      }
      continue;
    }
    steps.push(entry);
  }

  const result: ScriptWorkflow = { steps };
  if (budgetUsd !== undefined) result.budgetUsd = budgetUsd;
  if (logs.length > 0) result.logs = logs;
  return result;
}
