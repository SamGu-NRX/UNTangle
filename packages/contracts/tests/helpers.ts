import type { z } from "zod";

/**
 * `value` sent over the wire as JSON, then decoded by `schema`. Returns
 * unknown so a test can compare the result with the plain fixture it came
 * from, whose ids aren't branded.
 */
export function decoded(schema: z.ZodType, value: unknown): unknown {
  return schema.parse(JSON.parse(JSON.stringify(value)));
}

/** Each problem zod finds in `value`, as "path: message"; [] when it parses. */
export function rejections(schema: z.ZodType, value: unknown): string[] {
  const result = schema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

/** `value` without `key`, as a client that never wrote the field would send it. */
export function without(value: object, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}
