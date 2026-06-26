import { describe, expect, test } from "vitest";

import { validateOutputAgainstSchema } from "../../src/script/validateOutput.js";

describe("validateOutputAgainstSchema", () => {
  test("accepts a conforming JSON object", () => {
    expect(() =>
      validateOutputAgainstSchema(JSON.stringify({ summary: "ok", count: 3 }), {
        type: "object",
        required: ["summary"],
        properties: { summary: { type: "string" }, count: { type: "number" } }
      })
    ).not.toThrow();
  });

  test("throws when a required key is missing", () => {
    expect(() =>
      validateOutputAgainstSchema(JSON.stringify({ count: 3 }), {
        type: "object",
        required: ["summary"]
      })
    ).toThrow(/missing required property "summary"/);
  });

  test("throws when a property has the wrong type", () => {
    expect(() =>
      validateOutputAgainstSchema(JSON.stringify({ summary: 42 }), {
        type: "object",
        required: ["summary"],
        properties: { summary: { type: "string" } }
      })
    ).toThrow(/result\.summary must be of type string/);
  });

  test("throws when the result is not valid JSON", () => {
    expect(() => validateOutputAgainstSchema("not json", { type: "object" })).toThrow(/not valid JSON/);
  });

  test("throws when the top-level type mismatches", () => {
    expect(() => validateOutputAgainstSchema(JSON.stringify(["a"]), { type: "object" })).toThrow(
      /result must be of type object/
    );
  });
});
