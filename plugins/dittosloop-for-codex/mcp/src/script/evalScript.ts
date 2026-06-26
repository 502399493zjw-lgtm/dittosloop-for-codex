import type { Step } from "../contract/types.js";
import {
  agent,
  budget,
  human,
  log,
  parallel,
  phase,
  pipeline,
  task,
  workflow,
  type ScriptDirective,
  type ScriptWorkflow
} from "./builder.js";

export interface ScriptCall {
  fn: string;
  args?: unknown[];
}

export interface ScriptAst {
  build: ScriptCall[];
}

type BuilderNode = Step | ScriptDirective;

// Interpret a JSON builder-call AST by dispatching to the pure builder functions.
// No eval / no vm / no sandbox: every arg is data, never code.
export function evalScriptAst(ast: ScriptAst): ScriptWorkflow {
  if (!ast || !Array.isArray(ast.build)) {
    throw new Error("Script AST must have a build array of builder calls");
  }

  const steps: BuilderNode[] = [];
  for (const call of ast.build) {
    steps.push(dispatch(call));
  }

  return workflow({ steps });
}

function dispatch(call: ScriptCall): BuilderNode {
  if (!call || typeof call.fn !== "string") {
    throw new Error("Each builder call requires a string fn");
  }
  const args = call.args ?? [];

  switch (call.fn) {
    case "task":
      return task(expectObject(args[0], "task"));
    case "agent":
      return agent(expectObject(args[0], "agent"));
    case "phase":
      return phase(expectString(args[0], "phase id"), expectString(args[1], "phase label"), expectChildren(args[2], "phase"));
    case "parallel":
      return parallel(
        expectString(args[0], "parallel id"),
        expectString(args[1], "parallel label"),
        expectChildren(args[2], "parallel")
      );
    case "pipeline":
      return pipeline(
        expectString(args[0], "pipeline id"),
        expectString(args[1], "pipeline label"),
        expectChildren(args[2], "pipeline")
      );
    case "human":
      return human(
        expectString(args[0], "human id"),
        expectString(args[1], "human label"),
        expectString(args[2], "human question")
      );
    case "log":
      return log(expectString(args[0], "log message"));
    case "budget":
      return budget(expectNumber(args[0], "budget usd"));
    default:
      throw new Error(`Unknown builder fn: ${call.fn}`);
  }
}

function expectChildren(value: unknown, fn: string): Step[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fn} children must be an array of builder calls`);
  }
  return value.map((child) => {
    const node = dispatch(child as ScriptCall);
    if ((node as ScriptDirective).kind === "directive") {
      throw new Error(`${fn} children cannot be directives`);
    }
    return node as Step;
  });
}

function expectObject<T>(value: unknown, fn: string): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fn} requires an options object`);
  }
  return value as T;
}

function expectString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function expectNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}
