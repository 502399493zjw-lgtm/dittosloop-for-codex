// Minimal JSON-shape checker used only at record_session_result writeback.
// Supports a tiny subset of JSON Schema: type / required / properties.
// No new dependency; if a real validator is desired later, swap the impl.

export function validateOutputAgainstSchema(result: string, schema: Record<string, unknown>): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(result);
  } catch {
    throw new Error("outputSchema validation failed: result is not valid JSON");
  }

  checkValue(parsed, schema, "result");
}

function checkValue(value: unknown, schema: Record<string, unknown>, path: string): void {
  const expectedType = schema.type;
  if (typeof expectedType === "string" && !matchesType(value, expectedType)) {
    throw new Error(`outputSchema validation failed: ${path} must be of type ${expectedType}`);
  }

  if (expectedType === "object" || (expectedType === undefined && isPlainObject(value))) {
    const objectValue = isPlainObject(value) ? value : undefined;

    const required = schema.required;
    if (Array.isArray(required)) {
      if (!objectValue) {
        throw new Error(`outputSchema validation failed: ${path} must be an object`);
      }
      for (const key of required) {
        if (typeof key === "string" && !(key in objectValue)) {
          throw new Error(`outputSchema validation failed: ${path} is missing required property "${key}"`);
        }
      }
    }

    const properties = schema.properties;
    if (objectValue && isPlainObject(properties)) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (key in objectValue && isPlainObject(childSchema)) {
          checkValue(objectValue[key], childSchema as Record<string, unknown>, `${path}.${key}`);
        }
      }
    }
  }
}

function matchesType(value: unknown, expectedType: string): boolean {
  switch (expectedType) {
    case "object":
      return isPlainObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      // Unknown type keyword: do not block.
      return true;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
