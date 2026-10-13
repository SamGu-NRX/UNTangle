import type { UnavailableReason } from "./types";

export class GradesError extends Error {
  constructor(public readonly reason: UnavailableReason, message: string, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = "GradesError";
  }
}
export class NoHistoryError extends Error {}
export function malformed(path: string, expected: string): never {
  throw new GradesError("malformed", `untgrades.app: ${path} must be ${expected}`);
}
