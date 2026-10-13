import type { Diagnostic } from "./model";

/** Terms with a verified vsb file. Admit another only after checking its published file. */
export const supportedTerms = [{ id: "spring-2027", label: "2027 Spring" }] as const;

// Policy defaults, not measured tuning: recheck files every 15 minutes, back off a
// minute after a failure, and abandon a request after 15 seconds.
export const ttlMs = 15 * 60_000;
export const retryMs = 60_000;
export const timeoutMs = 15_000;
// The Spring 2027 term file is 16 MB. The cap is headroom over that, not a measurement.
export const maxBytes = 64 * 1024 * 1024;

export const termPattern = /^(spring|summer|fall)-\d{4}$/;
export const subjectPattern = /^[A-Z]{3,4}$/;
export const coursePattern = /^([A-Z]{3,4}) \d{3,4}[A-Z]?$/;

/** The vsb file for a whole term, or for one subject in it. */
export function vsbUrl(term: string, subject?: string): string {
  if (!termPattern.test(term)) throw new Error(`Invalid term ${JSON.stringify(term)}`);
  if (subject === undefined) return `https://vsb.untgrades.app/data/${term}.json`;
  if (!subjectPattern.test(subject)) throw new Error(`Invalid subject ${JSON.stringify(subject)}`);
  return `https://vsb.untgrades.app/data/${term}/${subject}.json`;
}

export class SchemaError extends Error {
  name = "SchemaError";
}

export function diagnose(error: unknown): Diagnostic {
  const message = error instanceof Error ? error.message : String(error);
  return { code: error instanceof SchemaError ? "schema_error" : "upstream_error", message };
}
