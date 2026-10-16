/**
 * Tests for the exact building matching: a building id is assigned only when
 * the location text matches the catalogue exactly; everything else keeps the
 * raw text with a null building id.
 */

import { expect, test } from "bun:test";

import { resolveEventBuilding } from "@/lib/campus-events/buildings";

test("matches a building name exactly", () => {
  expect(resolveEventBuilding("Art Building")).toBe("art");
  expect(resolveEventBuilding("University Union")).toBe("uu");
});

test("matches the segment before a comma: room qualifiers ride along without guessing", () => {
  // Real Localist format: "Business Leadership Building, 070".
  const id = resolveEventBuilding("Business Leadership Building, 070");
  expect(id).toBe("blb");
  expect(resolveEventBuilding("University Union, Room 226")).toBe("uu");
});

test("matches case-insensitively and with collapsed whitespace", () => {
  expect(resolveEventBuilding("  art   building ")).toBe("art");
});

test("a location with a room appended without a comma is not a match", () => {
  // "Building 070" style text is a guess; the raw text must survive instead.
  expect(resolveEventBuilding("Business Leadership Building 070")).toBeNull();
});

test("a venue the catalogue does not list stays raw text, never a guessed building", () => {
  // Real Localist venue that is not in the campus building catalogue.
  expect(resolveEventBuilding("Pohl Recreation Center")).toBeNull();
  expect(resolveEventBuilding("Pohl Recreation Center, Soccer Gym")).toBeNull();
});

test("a location that is not any building is null", () => {
  expect(resolveEventBuilding("Somewhere off campus")).toBeNull();
  expect(resolveEventBuilding("")).toBeNull();
  expect(resolveEventBuilding("Virtual Event")).toBeNull();
});
