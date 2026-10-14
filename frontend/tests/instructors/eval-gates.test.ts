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
    expect(Number.isFinite(gates.precision)).toBe(true);
    expect(gates.precision).toBeGreaterThanOrEqual(0.98);
    expect(gates.failures).toEqual([]);
    expect(gates.pass).toBe(true);
  });

  test("too few labeled pairs and scenarios fail even with perfect precision", () => {
    const positive = SCENARIOS.find(scenario => scenario.expected !== null)!;
    const gates = evaluate([positive]);
    expect(gates.precision).toBe(1);
    expect(gates.pass).toBe(false);
    expect(gates.failures.some(failure => failure.includes("150-pair floor"))).toBe(true);
    expect(gates.failures.some(failure => failure.includes("40 floor"))).toBe(true);
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

  test("compound surnames also match within semicolon-separated display fields", () => {
    const result = matchInstructor("Fernando Mosquera Ferrandiz; Jane Smith", [FERNANDO]);
    expect(result.candidateId).toBe(FERNANDO.id);
    expect(result.reason).toBe("one of 2 listed instructors; matched on surname and first name");
  });

  test("one matching instructor preserves the co-teaching count in raw and display forms", () => {
    for (const field of [
      "Mosquera Ferrandiz,Fernando,Smith,Jane,Jones,John",
      "Fernando Mosquera Ferrandiz; Jane Smith; John Jones",
    ]) {
      const result = matchInstructor(field, [FERNANDO]);
      expect(result.candidateId).toBe(FERNANDO.id);
      expect(result.confidence).toBe(0.95);
      expect(result.reason).toBe("one of 3 listed instructors; matched on surname and first name");
    }
  });

  test("candidate slots reject field separators without rejecting raw section pairs", () => {
    for (const separator of [",", ";"]) {
      const malformed: Candidate = { id: "bad", name: "Jane Smith", firstName: `J${separator}ane`, lastName: "Smith" };
      expect(matchInstructor("Smith,John", [malformed]).candidateId).toBeNull();
      const surname: Candidate = { id: "bad", name: "John Smith", firstName: "John", lastName: `S${separator}mith` };
      expect(matchInstructor("S Mith,John", [surname]).candidateId).toBeNull();
    }
    const john: Candidate = { id: "john", name: "John Smith", firstName: "John", lastName: "Smith" };
    expect(matchInstructor("Smith,John", [john]).candidateId).toBe("john");
  });

  test("a consistent middle initial preserves exact-first-name confidence", () => {
    for (const firstName of ["John P", "John Patrick"]) {
      const john: Candidate = { id: "john", name: `${firstName} Smith`, firstName, lastName: "Smith" };
      expect(matchInstructor("Smith,John", [john]).confidence).toBe(0.95);
      expect(matchInstructor("Smith,John P", [john])).toEqual({
        candidateId: "john", confidence: 0.95, reason: "matched on surname and first name",
      });
      expect(matchInstructor("Smith,J P", [john]).confidence).toBe(0.9);
      expect(matchInstructor("Smith,John Q", [john]).candidateId).toBeNull();
    }
  });

  test("a trailing initial preserves confidence from two matching full tokens", () => {
    const john: Candidate = { id: "john", name: "John Patrick Q Smith", firstName: "John Patrick Q", lastName: "Smith" };
    expect(matchInstructor("Smith,John Patrick", [john]).confidence).toBe(1);
    expect(matchInstructor("Smith,John Patrick Q", [john])).toEqual({
      candidateId: "john", confidence: 1, reason: "matched on surname and full first name",
    });
  });

  test("conflicting suffixes abstain in raw and display forms", () => {
    const senior: Candidate = { id: "senior", name: "John Smith Sr", firstName: "John", lastName: "Smith Sr" };
    const junior: Candidate = { id: "junior", name: "John Smith Jr", firstName: "John Jr", lastName: "Smith" };
    for (const field of ["Smith Jr,John", "John Smith Jr"]) {
      expect(matchInstructor(field, [senior])).toEqual({
        candidateId: null, confidence: 0, reason: "section surname matches but the suffix does not",
      });
      expect(matchInstructor(field, [senior, junior]).candidateId).toBe("junior");
    }
    expect(matchInstructor("Smith,John", [senior]).candidateId).toBe("senior");
    expect(matchInstructor("Smith Sr,John", [senior]).candidateId).toBe("senior");
  });

  test("unknown punctuation cannot invent initials on either side", () => {
    const john: Candidate = { id: "john", name: "John Smith", firstName: "John", lastName: "Smith" };
    for (const punctuation of ["@", "/", ":", "!", "_"]) {
      const malformed: Candidate = {
        id: "jane", name: `J${punctuation}ane Smith`, firstName: `J${punctuation}ane`, lastName: "Smith",
      };
      expect(matchInstructor("Smith,John", [malformed]).candidateId).toBeNull();
      expect(matchInstructor(`Smith,J${punctuation}ane`, [john])).toEqual({
        candidateId: null, confidence: 0, reason: "section instructor name has unsupported characters",
      });
    }
    expect(matchInstructor("Smith,John", [john]).candidateId).toBe("john");
  });

  test("empty raw comma slots abstain rather than realigning names", () => {
    const john: Candidate = { id: "john", name: "John Smith", firstName: "John", lastName: "Smith" };
    for (const field of ["Smith,,John", ",Smith,John", "Smith,John,", "Smith, ,John"]) {
      expect(matchInstructor(field, [john])).toEqual({
        candidateId: null, confidence: 0, reason: "section instructor field is unparseable",
      });
    }
    expect(matchInstructor("Smith,John", [john]).candidateId).toBe("john");
    expect(matchInstructor("None,Smith,John", [john]).candidateId).toBe("john");
  });

  test("unsupported candidate letters cannot invent a matching first-name initial", () => {
    const result = matchInstructor("Smith,Sam", [
      { id: "sirri", name: "Sırrı Smith", firstName: "Sırrı", lastName: "Smith" },
    ]);
    expect(result).toEqual({
      candidateId: null,
      confidence: 0,
      reason: "no candidate shares the section surname",
    });
  });

  test("unstripped combining marks cannot invent a matching first-name initial", () => {
    const ian: Candidate = { id: "ian", name: "Ian Smith", firstName: "Ian", lastName: "Smith" };
    const result = matchInstructor("Smith,I᪰pek", [ian]);
    expect(result).toEqual({
      candidateId: null,
      confidence: 0,
      reason: "section instructor name has unsupported characters",
    });
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
