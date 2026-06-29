export interface RuntimeScriptValidationResult {
  ok: boolean;
  errors: string[];
}

interface DeniedRuntimeScriptPattern {
  label: string;
  pattern: RegExp;
}

const deniedRuntimeScriptPatterns: DeniedRuntimeScriptPattern[] = [
  { label: "require", pattern: /\brequire\s*\(/ },
  { label: "import", pattern: /\bimport\s*(?:\(|{|[A-Za-z_*])/ },
  { label: "process", pattern: /\bprocess\b/ },
  { label: "globalThis", pattern: /\bglobalThis\b/ },
  { label: "fetch", pattern: /\bfetch\s*\(/ },
  { label: "fs", pattern: /\bfs\b/ },
  { label: "child_process", pattern: /\bchild_process\b/ },
  { label: "net", pattern: /\bnet\b/ },
  { label: "http", pattern: /\bhttp\b/ },
  { label: "https", pattern: /\bhttps\b/ },
  { label: "os", pattern: /\bos\b/ },
  { label: "vm", pattern: /\bvm\b/ },
  { label: "eval", pattern: /\beval\s*\(/ },
  { label: "Function", pattern: /\bFunction\s*\(/ },
  { label: "constructor", pattern: /\bconstructor\b/ },
  { label: "__proto__", pattern: /__proto__/ },
  { label: "Date", pattern: /\bDate\b/ },
  { label: "Math.random", pattern: /\bMath\s*\.\s*random\s*\(/ },
  { label: "crypto", pattern: /\bcrypto\b/ },
  { label: "performance", pattern: /\bperformance\b/ }
];

export function validateRuntimeScript(source: string): RuntimeScriptValidationResult {
  const errors = deniedRuntimeScriptPatterns.flatMap(({ label, pattern }) =>
    pattern.test(source) ? [`Runtime script cannot access ${label}`] : []
  );

  return {
    ok: errors.length === 0,
    errors
  };
}
