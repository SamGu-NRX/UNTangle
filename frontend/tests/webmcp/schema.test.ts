import { describe, expect, test } from "bun:test";
import { validate, type ObjectSchema } from "@/lib/webmcp/schema";

const schema: ObjectSchema = {
  type: "object",
  properties: {
    code: { type: "string", minLength: 1, maxLength: 9, pattern: "^[A-Z]{4} \\d{4}$" },
    day: { type: "string", maxLength: 3, enum: ["Mon", "Tue"] },
    credits: { type: "integer", minimum: 1, maximum: 24 },
    blocks: {
      type: "array",
      maxItems: 2,
      items: { type: "object", properties: { at: { type: "string", maxLength: 5 } }, required: ["at"], additionalProperties: false },
    },
  },
  required: ["code"],
  additionalProperties: false,
};

describe("validate", () => {
  test("accepts input that matches, with optional fields left out", () => {
    expect(validate(schema, { code: "CSCE 1030" })).toBeNull();
    expect(validate(schema, { code: "CSCE 1030", day: "Tue", credits: 24, blocks: [{ at: "09:00" }, { at: "10:00" }] })).toBeNull();
  });

  const cases: Array<[unknown, string]> = [
    [null, "input: expected an object"],
    [["CSCE 1030"], "input: expected an object"],
    [{}, "input.code: required"],
    [{ code: "CSCE 1030", userId: "x" }, "input.userId: unknown field"],
    [{ code: 1030 }, "input.code: expected a string"],
    [{ code: "" }, "input.code: shorter than 1 characters"],
    [{ code: "CSCE 10300" }, "input.code: longer than 9 characters"],
    [{ code: "csce 1030" }, "input.code: does not match ^[A-Z]{4} \\d{4}$"],
    [{ code: "CSCE 1030", day: "Sat" }, "input.day: expected one of Mon, Tue"],
    [{ code: "CSCE 1030", credits: 2.5 }, "input.credits: expected an integer"],
    [{ code: "CSCE 1030", credits: 25 }, "input.credits: expected 1 to 24"],
    [{ code: "CSCE 1030", blocks: {} }, "input.blocks: expected an array"],
    [{ code: "CSCE 1030", blocks: [{ at: "1" }, { at: "2" }, { at: "3" }] }, "input.blocks: more than 2 items"],
    [{ code: "CSCE 1030", blocks: [{ at: "09:00" }, {}] }, "input.blocks[1].at: required"],
  ];
  for (const [value, problem] of cases) {
    test(`rejects ${JSON.stringify(value)}`, () => {
      expect(validate(schema, value)).toBe(problem);
    });
  }
});
