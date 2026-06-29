export const DEFAULT_RUNTIME_SCRIPT_LIMITS = {
  timeoutMs: 120_000,
  maxAgentCalls: 20,
  maxParallelBranches: 8,
  maxPipelineItems: 50,
  maxLogChars: 20_000
} as const;
