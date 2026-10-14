import { describe, expect, test } from "bun:test";
import { matchInstructor } from "../../frontend/src/lib/instructors/match";
import type { Candidate } from "../src/shared/api-types";

const smith: Candidate = { id: JSON.stringify(["John", "Smith"]), firstName: "John", lastName: "Smith", name: "John Smith" };

describe("matchInstructor (contract pinning for the extension)", () => {
  test("matches a row's raw name to the grade-history candidate", () => {
    const result = matchInstructor("Smith, John R.", [smith]);
    expect(result.candidateId).toBe(smith.id);
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  test("abstains when no candidate exists", () => {
    expect(matchInstructor("Nobody, Ada", [smith]).candidateId).toBeNull();
  });

  test("abstains when several candidates match the same name", () => {
    const twin: Candidate = { id: JSON.stringify(["John", "Smith", "2"]), firstName: "John", lastName: "Smith", name: "John Smith" };
    const result = matchInstructor("Smith, John R.", [smith, twin]);
    expect(result.candidateId).toBeNull();
  });
});
