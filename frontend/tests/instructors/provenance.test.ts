import { describe, expect, test } from "bun:test";
import { foldName } from "../../src/lib/instructors/fold";
import { HISTORY_UNIVERSE } from "./data/identities";
import cache from "./data/vsb-spring-2027-instructors.json";
import { SCENARIOS } from "./data/scenarios";

type CacheEntry = { raw: string; count: number; exampleCourse: string };
type Cache = {
  endpoint: string;
  method: string;
  fetchedAt: string;
  responseBytes: number;
  responseSha256: string;
  note: string;
  distinctInstructorStrings: number;
  instructors: CacheEntry[];
};
const inventory = cache as unknown as Cache;
const foldedRaw = new Set(inventory.instructors.map(entry => foldName(entry.raw)));

/** Placeholder words the feed itself uses; they are not people, so the
 * distinct-instructor inventory filtered them out. */
const PLACEHOLDER_FOLDS = new Set(["staff", "tba", "closed", "none", "none none", "blank", ""]);

describe("cached vsb inventory", () => {
  test("carries its provenance: endpoint, fetch date, response size and sha256", () => {
    expect(inventory.endpoint).toBe("https://vsb.untgrades.app/data/spring-2027.json");
    expect(inventory.method).toBe("GET");
    expect(inventory.fetchedAt).toBe("2026-10-14");
    expect(inventory.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(inventory.responseBytes).toBe(15991878);
    expect(inventory.note).toContain("not committed");
    expect(inventory.distinctInstructorStrings).toBe(1796);
    expect(inventory.instructors.length).toBe(1796);
  });
});

describe("scenario provenance", () => {
  test("every fixture and vsb-fetch sectionName folds to a captured instructor string or feed placeholder", () => {
    const failures = SCENARIOS
      .filter(scenario => scenario.provenance !== "derived")
      .filter(scenario => {
        const folded = foldName(scenario.sectionName);
        return !foldedRaw.has(folded) && !PLACEHOLDER_FOLDS.has(folded);
      })
      .map(scenario => `${scenario.provenance}: ${scenario.sectionName}`);
    expect(failures).toEqual([]);
  });

  test("derived scenarios explain their derivation in the note", () => {
    const missing = SCENARIOS
      .filter(scenario => scenario.provenance === "derived")
      .filter(scenario => !scenario.note || scenario.note.length < 20)
      .map(scenario => scenario.sectionName);
    expect(missing).toEqual([]);
  });

  test("every scenario documents where it came from", () => {
    const missing = SCENARIOS.filter(scenario => !scenario.note).map(scenario => scenario.sectionName);
    expect(missing).toEqual([]);
  });

  test("every scenario names a family and an in-scope expectation", () => {
    for (const scenario of SCENARIOS) {
      expect(scenario.family.length).toBeGreaterThan(0);
      if (scenario.expected !== null) {
        expect(scenario.candidates.some(candidate => candidate.id === scenario.expected)).toBe(true);
      }
    }
  });
});

describe("the identity universe", () => {
  test("carries the eight real identities recorded from the grade-history fixtures", () => {
    expect(HISTORY_UNIVERSE.length).toBe(8);
    for (const candidate of HISTORY_UNIVERSE) {
      expect(candidate.id).toBe(JSON.stringify([candidate.firstName, candidate.lastName]));
      expect(candidate.name).toBe(`${candidate.firstName} ${candidate.lastName}`);
      expect(candidate.firstName.length).toBeGreaterThan(0);
      expect(candidate.lastName.length).toBeGreaterThan(0);
    }
  });

  test("ids are unique", () => {
    expect(new Set(HISTORY_UNIVERSE.map(candidate => candidate.id)).size).toBe(HISTORY_UNIVERSE.length);
  });
});

describe("authored text", () => {
  test("no scenario, note or identity contains a mid dot", () => {
    const strings: string[] = [];
    for (const scenario of SCENARIOS) {
      strings.push(scenario.sectionName, scenario.family, scenario.provenance, scenario.note ?? "");
      strings.push(...scenario.candidates.flatMap(candidate => [candidate.id, candidate.name, candidate.firstName, candidate.lastName]));
    }
    expect(strings.filter(text => text.includes("·"))).toEqual([]);
  });
});
