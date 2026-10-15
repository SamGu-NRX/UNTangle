import { describe, expect, test } from "bun:test";
import { classNumbersText, FEW_SEATS, orderClassNumbers, type ClassNumberEntry } from "@/lib/export/class-numbers";

const entry = (courseCode: string, sectionLabel: string, classNumbers: string[], openSeats: number | null): ClassNumberEntry => ({
  courseCode,
  sectionLabel,
  classNumbers,
  openSeats,
});

describe("class numbers for myUNT", () => {
  const rows = orderClassNumbers([
    entry("MATH 2700", "003", ["23310"], 9),
    entry("CSCE 2610", "002", ["21907"], 5),
    entry("TECM 2700", "900", ["26511"], 31),
    entry("PHYS 2220", "002", ["24107", "24111"], 0),
    entry("CSCE 2110", "001", ["21843"], null),
    entry("BIOL 1710", "001", [], 2),
    entry("ANTH 1010", "001", ["20001"], 9),
  ]);

  test("fewest open seats first, unknown seats last, ties by course", () => {
    expect(rows.map((row) => row.courseCode)).toEqual(["PHYS 2220", "CSCE 2610", "ANTH 1010", "MATH 2700", "TECM 2700", "CSCE 2110"]);
  });

  test("a section's numbers stay together, primary first", () => {
    expect(classNumbersText(rows).split("\n")).toEqual(["24107", "24111", "21907", "20001", "23310", "26511", "21843"]);
  });

  test("sections without class numbers are left out", () => {
    expect(rows.some((row) => row.courseCode === "BIOL 1710")).toBe(false);
  });

  test(`"Few seats" at ${FEW_SEATS} open or fewer, never for unknown seats`, () => {
    expect(rows.filter((row) => row.fewSeats).map((row) => row.courseCode)).toEqual(["PHYS 2220", "CSCE 2610"]);
  });

  test("nothing in, nothing out", () => {
    expect(orderClassNumbers([])).toEqual([]);
    expect(classNumbersText([])).toBe("");
  });
});
