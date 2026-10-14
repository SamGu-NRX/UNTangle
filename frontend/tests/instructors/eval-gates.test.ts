import { describe, expect, test } from "bun:test";
import { CONFIDENCE_THRESHOLD, matchInstructor, type Candidate } from "../../src/lib/instructors/match";
import { evaluate, scoreScenario } from "./eval";
import { SCENARIOS, type Scenario } from "./data/scenarios";

describe("the labeled evaluation runs inside the test suite", () => {
  test("the real dataset passes every eval gate", () => {
    const gates = evaluate(SCENARIOS);
    expect(gates.unknownFamilyCount).toBe(0);
    expect(gates.pairs).toBeGreaterThanOrEqual(150);
    expect(gates.hardCases).toBeGreaterThanOrEqual(40);
    expect(gates.precision).toBeDefined();
    expect(gates.precision).toBeGreaterThanOrEqual(0.98);
    expect(gates.failures).toEqual([]);
    expect(gates.pass).toBe(true);
  });

  test("every returned match clears the exported threshold and names an in-scope candidate", () => {
    for (const scenario of SCENARIOS) {
      const result = matchInstructor(scenario.sectionName, scenario.candidates);
      if (result.candidateId === null) {
        expect(result.confidence).toBe(0);
        continue;
      }
      expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
      expect(scenario.candidates.map(candidate => candidate.id)).toContain(result.candidateId);
    }
  });
});

describe("a corpus with nothing returned fails the precision gate", () => {
  const allAbstain: Scenario[] = [
    {
      sectionName: "Staff",
      candidates: [{ id: "Smith,John", name: "John Smith", firstName: "John", lastName: "Smith" }],
      expected: null,
      family: "unusable-instructor",
      provenance: "derived",
      note: "synthetic: nothing returned",
    },
    {
      sectionName: "Curran Jr,Anthony A",
      candidates: [{ id: "Smith,John", name: "John Smith", firstName: "John", lastName: "Smith" }],
      expected: null,
      family: "surnames",
      provenance: "derived",
      note: "synthetic: nothing returned",
    },
  ];

  test("a zero denominator reports undefined precision and fails the gates", () => {
    const gates = evaluate(allAbstain);
    expect(gates.pass).toBe(false);
    expect(gates.precision).toBeUndefined();
    expect(gates.failures.some(failure => failure.includes("precision is undefined"))).toBe(true);
  });

  test("the synthetic corpus really produces no returned match", () => {
    const counts = scoreScenario(allAbstain[0]!);
    expect(counts.tp).toBe(0);
    expect(counts.fp).toBe(0);
    expect(counts.pairs).toBe(1);
  });
});

describe("review hard cases", () => {
  const FERNANDO: Candidate = {
    id: "Mosquera Ferrandiz,Fernando",
    name: "Fernando Mosquera Ferrandiz",
    firstName: "Fernando",
    lastName: "Mosquera Ferrandiz",
  };

  test("the display form of a compound surname matches the same candidate as the raw form", () => {
    const display = matchInstructor("Fernando Mosquera Ferrandiz", [FERNANDO]);
    const raw = matchInstructor("Mosquera Ferrandiz,Fernando", [FERNANDO]);
    expect(display.candidateId).toBe(FERNANDO.id);
    expect(raw.candidateId).toBe(FERNANDO.id);
    expect(display.candidateId).toBe(raw.candidateId);
  });

  test("the display form still matches a plain single-token surname candidate", () => {
    const plain: Candidate = { id: "Smith,John", name: "John Smith", firstName: "John", lastName: "Smith" };
    const result = matchInstructor("John Smith", [plain]);
    expect(result.candidateId).toBe(plain.id);
    expect(result.reason).toBe("matched on surname and first name");
  });

  test("adjacent dotted initials stay separate initials", () => {
    const michael: Candidate = {
      id: "Hickman,Michael Thomas",
      name: "Michael Thomas Hickman",
      firstName: "Michael Thomas",
      lastName: "Hickman",
    };
    const john: Candidate = {
      id: "Hickman,Michael John",
      name: "Michael John Hickman",
      firstName: "Michael John",
      lastName: "Hickman",
    };
    const matching = matchInstructor("Hickman,M.T.", [michael]);
    expect(matching.candidateId).toBe(michael.id);
    expect(matching.reason).toBe("matched on surname and first-name initial");
    const contradicting = matchInstructor("Hickman,M.T.", [john]);
    expect(contradicting.candidateId).toBeNull();
    expect(contradicting.reason).toBe("section surname matches but the first name does not");
  });

  test("a dotted capital I folds through instead of inventing a false initial", () => {
    const ian: Candidate = { id: "Smith,Ian", name: "Ian Smith", firstName: "Ian", lastName: "Smith" };
    const ipek: Candidate = { id: "Smith,İpek", name: "İpek Smith", firstName: "İpek", lastName: "Smith" };
    const againstIan = matchInstructor("Smith,İpek", [ian]);
    expect(againstIan.candidateId).toBeNull();
    const againstIpek = matchInstructor("Smith,İpek", [ipek]);
    expect(againstIpek.candidateId).toBe(ipek.id);
  });

  test("letters outside the fold map abstain instead of guessing", () => {
    const sectionSide = matchInstructor("Smith,Sırr", [
      { id: "Smith,Jane", name: "Jane Smith", firstName: "Jane", lastName: "Smith" },
    ]);
    expect(sectionSide.candidateId).toBeNull();
    expect(sectionSide.reason).toBe("section instructor name has unsupported characters");
    const candidateSide = matchInstructor("Smith,Jane", [
      { id: "Smith,Sırr", name: "Sırr Smith", firstName: "Sırr", lastName: "Smith" },
    ]);
    expect(candidateSide.candidateId).toBeNull();
  });
});
