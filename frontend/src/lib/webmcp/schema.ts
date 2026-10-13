/**
 * The JSON Schema subset the WebMCP tools declare, and the check that
 * enforces it. Browsers pass the agent's arguments through without checking
 * them against `inputSchema` (spec issue #92), so every call is validated
 * here against the same object the agent was shown. Strings and arrays must
 * declare a maximum, so no input is unbounded.
 */

export type Schema = ObjectSchema | StringSchema | IntegerSchema | ArraySchema;

export type ObjectSchema = {
  type: "object";
  properties: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties: false;
  description?: string;
};
export type StringSchema = {
  type: "string";
  maxLength: number;
  minLength?: number;
  /** Anchored by the author; tested as written. */
  pattern?: string;
  enum?: readonly string[];
  description?: string;
};
export type IntegerSchema = { type: "integer"; minimum: number; maximum: number; description?: string };
export type ArraySchema = { type: "array"; items: Schema; maxItems: number; description?: string };

/** The first problem with `value`, as "path: what is wrong", or null when it matches. */
export function validate(schema: Schema, value: unknown, path = "input"): string | null {
  switch (schema.type) {
    case "object": {
      if (typeof value !== "object" || value === null || Array.isArray(value)) return `${path}: expected an object`;
      const record = value as Record<string, unknown>;
      // Own properties only: `in` would accept inherited names such as "__proto__", "constructor" or "toString".
      const extra = Object.keys(record).find((key) => !Object.hasOwn(schema.properties, key));
      if (extra !== undefined) return `${path}.${extra}: unknown field`;
      const missing = schema.required?.find((key) => !Object.hasOwn(record, key));
      if (missing !== undefined) return `${path}.${missing}: required`;
      for (const [key, child] of Object.entries(schema.properties)) {
        if (!Object.hasOwn(record, key)) continue;
        const problem = validate(child, record[key], `${path}.${key}`);
        if (problem) return problem;
      }
      return null;
    }
    case "string":
      if (typeof value !== "string") return `${path}: expected a string`;
      if (value.length > schema.maxLength) return `${path}: longer than ${schema.maxLength} characters`;
      if (value.length < (schema.minLength ?? 0)) return `${path}: shorter than ${schema.minLength} characters`;
      if (schema.enum && !schema.enum.includes(value)) return `${path}: expected one of ${schema.enum.join(", ")}`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: does not match ${schema.pattern}`;
      return null;
    case "integer":
      if (typeof value !== "number" || !Number.isInteger(value)) return `${path}: expected an integer`;
      if (value < schema.minimum || value > schema.maximum) return `${path}: expected ${schema.minimum} to ${schema.maximum}`;
      return null;
    case "array": {
      if (!Array.isArray(value)) return `${path}: expected an array`;
      if (value.length > schema.maxItems) return `${path}: more than ${schema.maxItems} items`;
      for (const [index, item] of value.entries()) {
        const problem = validate(schema.items, item, `${path}[${index}]`);
        if (problem) return problem;
      }
      return null;
    }
  }
}
