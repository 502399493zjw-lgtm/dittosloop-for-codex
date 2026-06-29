import { createHash } from "node:crypto";

export function stableStringify(value: unknown): string {
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

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashRuntimeScriptSource(source: string): string {
  return sha256(source);
}

export function hashRuntimeScriptArgs(args: unknown): string {
  return sha256(stableStringify(args ?? {}));
}

export function hashRuntimeScriptPrompt(prompt: string): string {
  return sha256(prompt);
}

export function hashRuntimeScriptOptions(options: unknown): string {
  return sha256(stableStringify(options ?? {}));
}

export function runtimeAgentJournalKey(input: {
  contractId: string;
  scriptHash: string;
  argsHash: string;
  callSite: string;
  prompt: string;
  options: unknown;
}): string {
  return sha256(
    stableStringify({
      contractId: input.contractId,
      scriptHash: input.scriptHash,
      argsHash: input.argsHash,
      callSite: input.callSite,
      promptHash: hashRuntimeScriptPrompt(input.prompt),
      optionsHash: hashRuntimeScriptOptions(input.options)
    })
  );
}
