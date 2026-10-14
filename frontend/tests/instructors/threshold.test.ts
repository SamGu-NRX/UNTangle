import { expect, test } from "bun:test";
import { matchInstructor, matchInstructorWith, type Candidate } from "../../src/lib/instructors/match";

const full: Candidate = { id: "john", name: "John Smith", firstName: "John", lastName: "Smith" };
const initial: Candidate = { id: "j", name: "J Smith", firstName: "J", lastName: "Smith" };

test("a weak pair abstains at a raised threshold", () => {
  expect(matchInstructorWith("Smith,J", [full], 0.95)).toEqual({
    candidateId: null, confidence: 0, reason: "section surname matches but first-name evidence is insufficient",
  });
});

test("raising the threshold excludes weak pairs before deciding ambiguity", () => {
  expect(matchInstructorWith("Smith,John", [full, initial], 0.95)).toEqual({
    candidateId: "john", confidence: 0.95, reason: "matched on surname and first name",
  });
  expect(matchInstructorWith("Smith,John P", [{ ...full, firstName: "John Patrick" }], 0.95)).toEqual({
    candidateId: "john", confidence: 0.95, reason: "matched on surname and first name",
  });
});

test("the public matcher still uses the default threshold", () => {
  expect(matchInstructor("Smith,J", [full])).toEqual({
    candidateId: "john", confidence: 0.9, reason: "matched on surname and first-name initial",
  });
  expect(matchInstructor("Smith,John", [full, initial])).toEqual({
    candidateId: null, confidence: 0, reason: "ambiguous: several candidates match the section name",
  });
});
