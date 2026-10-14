import { describe, expect, test } from "bun:test";
import { assignColors, RING, type ColorCourse, type Hue } from "@/lib/course-colors";

const course = (id: string): ColorCourse => ({ id, department: id.split(" ")[0] });
const hues = (map: Map<string, Hue>) => Object.fromEntries(map);

describe("assignColors", () => {
  test("the mockup's Spring 2027 schedule, worked by hand", () => {
    const schedule = ["CSCE 2110", "CSCE 2610", "MATH 2700", "PHYS 2220", "TECM 2700"].map(course);
    expect(hues(assignColors(schedule))).toEqual({
      "CSCE 2110": 1, // first course: first ring hue
      "CSCE 2610": 3, // same department: next hue clockwise
      "MATH 2700": 4, // new department: free hue farthest from 1 and 3
      "PHYS 2220": 6, // every free hue is one step from a used one; ring order breaks the tie
      "TECM 2700": 2, // same tie, the first free hue in ring order
    });
  });

  test("a department grows clockwise around the ring", () => {
    const result = assignColors(["CSCE 1030", "CSCE 2100", "CSCE 2110", "CSCE 3110"].map(course));
    expect([...result.values()]).toEqual([1, 3, 6, 4]);
  });

  test("when the clockwise neighbour is taken, the department goes counterclockwise", () => {
    const result = assignColors(["CSCE 1030", "ENGL 1310", "HIST 2610", "CSCE 2100"].map(course));
    expect(hues(result)).toEqual({ "CSCE 1030": 1, "ENGL 1310": 4, "HIST 2610": 3, "CSCE 2100": 5 });
  });

  test("a new department lands as far as possible from the hues in use", () => {
    const result = assignColors([course("CSCE 1030"), course("ENGL 1310")]);
    expect(result.get("ENGL 1310")).toBe(4); // three steps from moss, the opposite side of the ring
  });

  test("an existing assignment never changes when courses come and go", () => {
    const first = assignColors(["CSCE 2110", "MATH 2700", "PHYS 2220"].map(course));
    const added = assignColors(["CSCE 2110", "MATH 2700", "PHYS 2220", "CSCE 2610"].map(course), first);
    for (const [id, hue] of first) expect(added.get(id)).toBe(hue);

    const kept = ["MATH 2700", "PHYS 2220", "CSCE 2610"];
    const removed = assignColors(kept.map(course), added);
    expect(kept.map((id) => removed.get(id))).toEqual(kept.map((id) => added.get(id)));
  });

  test("the same schedule always gets the same colors", () => {
    const schedule = ["BIOL 1710", "CSCE 2110", "BIOL 1720", "HIST 2610"].map(course);
    expect(hues(assignColors(schedule))).toEqual(hues(assignColors(schedule)));
  });

  test("a seventh course reuses a hue deterministically", () => {
    const six = ["ANTH 1010", "BIOL 1710", "CSCE 2110", "ENGL 1310", "HIST 2610", "MATH 2700"].map(course);
    const base = assignColors(six);
    expect(new Set(base.values()).size).toBe(6);

    // A seventh department takes the least-used hue; all tie, so the first in ring order.
    expect(assignColors([...six, course("PSYC 1630")]).get("PSYC 1630")).toBe(RING[0]);
    // A course from a department already there joins that department's hue.
    expect(assignColors([...six, course("MATH 3680")]).get("MATH 3680")).toBe(base.get("MATH 2700")!);
  });
});
