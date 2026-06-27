import { createHash } from "node:crypto";

import { effectiveProfileToSubagent, resolveEffectiveProfilesByStep } from "../contract/agentProfiles.js";
import type { FormalLoopContract, PhaseStep, Step } from "../contract/types.js";
import type {
  ExecutionGraphEdge,
  ExecutionGraphNode,
  ExecutionGraphNodeKind,
  ExecutionGraphSnapshot
} from "./types.js";

const compilerVersion = 1;

export interface CompileExecutionGraphInput {
  contract: FormalLoopContract;
  runId: string;
  attemptId: string;
  workflowContextId: string;
  compiledAt: string;
  snapshotId: string;
  contractRevisionId?: string;
}

export function compileExecutionGraph(input: CompileExecutionGraphInput): ExecutionGraphSnapshot {
  const effectiveProfilesByStep = resolveEffectiveProfilesByStep(input.contract);
  const nodes: ExecutionGraphNode[] = [
    {
      nodeId: "root",
      kind: "root",
      label: input.contract.title,
      order: 0,
      runtime: "internal"
    }
  ];
  const edges: ExecutionGraphEdge[] = [];
  const topLevelNodeIds: string[] = [];

  input.contract.body.steps.forEach((step, index) => {
    const node = appendStepNode({
      step,
      parentNodeId: "root",
      pathPrefix: "root",
      order: index + 1,
      phaseNodeId: undefined,
      nodes,
      edges,
      effectiveProfilesByStep
    });
    topLevelNodeIds.push(node.nodeId);
    edges.push({ fromNodeId: "root", toNodeId: node.nodeId, kind: "contains" });
  });

  addSequenceEdges(edges, topLevelNodeIds);

  const verificationNode: ExecutionGraphNode = {
    nodeId: "root/verification",
    kind: "verification",
    parentNodeId: "root",
    label: "Verification",
    order: nodes.length,
    runtime: "internal"
  };
  nodes.push(verificationNode);
  edges.push({ fromNodeId: "root", toNodeId: verificationNode.nodeId, kind: "contains" });
  const verificationPredecessor = topLevelNodeIds.at(-1) ?? "root";
  edges.push({ fromNodeId: verificationPredecessor, toNodeId: verificationNode.nodeId, kind: "verification_after" });

  const graphHash = hashGraph({ compilerVersion, nodes, edges });

  return {
    snapshotId: input.snapshotId,
    runId: input.runId,
    attemptId: input.attemptId,
    workflowContextId: input.workflowContextId,
    contractId: input.contract.id,
    ...(input.contractRevisionId ? { contractRevisionId: input.contractRevisionId } : {}),
    compilerVersion,
    graphHash,
    compiledAt: input.compiledAt,
    nodes,
    edges
  };
}

interface AppendStepNodeInput {
  step: Step;
  parentNodeId: string;
  pathPrefix: string;
  order: number;
  phaseNodeId: string | undefined;
  nodes: ExecutionGraphNode[];
  edges: ExecutionGraphEdge[];
  effectiveProfilesByStep: ReturnType<typeof resolveEffectiveProfilesByStep>;
}

function appendStepNode(input: AppendStepNodeInput): ExecutionGraphNode {
  const nodeKind = graphNodeKindForStep(input.step);
  const nodeId = `${input.pathPrefix}/${nodeKind}:${input.step.id}`;
  const phaseNodeId = input.step.kind === "phase" ? nodeId : input.phaseNodeId;
  const baseNode: ExecutionGraphNode = {
    nodeId,
    kind: nodeKind,
    sourceStepId: input.step.id,
    parentNodeId: input.parentNodeId,
    ...(phaseNodeId ? { phaseNodeId } : {}),
    label: input.step.label,
    order: input.order,
    ...stepRuntimeFields(input.step, input.effectiveProfilesByStep)
  };
  input.nodes.push(baseNode);

  if (input.step.kind === "parallel") {
    input.step.children.forEach((child, index) => {
      const childNode = appendStepNode({
        step: child,
        parentNodeId: nodeId,
        pathPrefix: nodeId,
        order: index + 1,
        phaseNodeId,
        nodes: input.nodes,
        edges: input.edges,
        effectiveProfilesByStep: input.effectiveProfilesByStep
      });
      input.edges.push({ fromNodeId: nodeId, toNodeId: childNode.nodeId, kind: "contains" });
      input.edges.push({ fromNodeId: nodeId, toNodeId: childNode.nodeId, kind: "parallel_child" });
    });
  }

  if (input.step.kind === "phase") {
    const childNodeIds = input.step.children.map((child, index) => {
      const childNode = appendStepNode({
        step: child,
        parentNodeId: nodeId,
        pathPrefix: nodeId,
        order: index + 1,
        phaseNodeId,
        nodes: input.nodes,
        edges: input.edges,
        effectiveProfilesByStep: input.effectiveProfilesByStep
      });
      input.edges.push({ fromNodeId: nodeId, toNodeId: childNode.nodeId, kind: "contains" });
      return childNode.nodeId;
    });

    addSequenceEdges(input.edges, childNodeIds);
    addPipelineEdges(input.edges, input.step, childNodeIds);
  }

  return baseNode;
}

function graphNodeKindForStep(step: Step): ExecutionGraphNodeKind {
  if (step.kind === "phase" || step.kind === "parallel") {
    return step.kind;
  }
  return step.kind === "task" && step.human ? "human" : "task";
}

function stepRuntimeFields(
  step: Step,
  effectiveProfilesByStep: ReturnType<typeof resolveEffectiveProfilesByStep>
): Partial<ExecutionGraphNode> {
  if (step.kind !== "agent" && step.kind !== "task") {
    return {
      runtime: "internal",
      ...(step.kind === "phase" && step.pipeline ? { pipeline: true } : {})
    };
  }

  const agentProfile = effectiveProfilesByStep.get(step.id);
  const subagent = effectiveProfileToSubagent(agentProfile, step.subagent);
  return {
    runtime: "codex",
    prompt: step.prompt,
    ...(step.kind === "task" && step.human ? { human: true } : {}),
    ...(step.agentProfileRef ? { agentProfileRef: step.agentProfileRef } : {}),
    ...(subagent ? { subagent } : {}),
    ...(step.kind === "task" && step.outputSchema ? { outputSchema: step.outputSchema } : {})
  };
}

function addSequenceEdges(edges: ExecutionGraphEdge[], nodeIds: string[]): void {
  for (let index = 1; index < nodeIds.length; index += 1) {
    edges.push({ fromNodeId: nodeIds[index - 1], toNodeId: nodeIds[index], kind: "sequence" });
  }
}

function addPipelineEdges(edges: ExecutionGraphEdge[], step: PhaseStep, nodeIds: string[]): void {
  if (!step.pipeline) {
    return;
  }
  for (let index = 1; index < nodeIds.length; index += 1) {
    edges.push({ fromNodeId: nodeIds[index - 1], toNodeId: nodeIds[index], kind: "pipeline_data" });
  }
}

function hashGraph(input: { compilerVersion: number; nodes: ExecutionGraphNode[]; edges: ExecutionGraphEdge[] }): string {
  return createHash("sha256").update(stableStringify(input)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
