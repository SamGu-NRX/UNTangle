/**
 * Deduplication tests: same normalized title, start within five minutes,
 * same place (building when both resolve, else normalized location text).
 */

import { expect, test } from "bun:test";

import { DEDUPE_START_WINDOW_MS, dedupeEvents, normalizeEventTitle, placeKey } from "@/lib/campus-events/dedupe";
import type { NormalizedEvent } from "@/lib/campus-events/types";

function event(overrides: Partial<NormalizedEvent>): NormalizedEvent {
  return {
    sourceId: "unt-events-all",
    url: "https://calendar.unt.edu/event/x",
    title: "Same Event",
    start: "2026-10-20T23:30:00.000Z",
    end: "2026-10-21T00:30:00.000Z",
    isAllDay: false,
    location: "University Union, Room 226",
    buildingId: "uu",
    tags: ["recreation"],
    ...overrides,
  };
}

test("normalizeEventTitle collapses case, punctuation and whitespace", () => {
  expect(normalizeEventTitle("  Club  Meeting (rescheduled)! ")).toBe(normalizeEventTitle("club meeting rescheduled"));
});

test("dedupes the same event from two sources, keeping the representative and unioning tags", () => {
  const first = event({ sourceId: "unt-events-all", tags: ["university-events"], url: null });
  const second = event({ sourceId: "group-recreational_sports", tags: ["recreation"], url: "https://calendar.unt.edu/event/x" });
  const result = dedupeEvents([first, second]);
  expect(result.length).toBe(1);
  // The representative prefers the one with a URL, and tags are the union.
  expect(result[0]!.sourceId).toBe("group-recreational_sports");
  expect(result[0]!.url).not.toBeNull();
  expect([...result[0]!.tags].sort()).toEqual(["recreation", "university-events"]);
});

test("keeps two events whose starts are more than five minutes apart", () => {
  const a = event({});
  const b = event({ start: "2026-10-20T23:36:00.000Z", end: "2026-10-21T00:36:00.000Z" });
  const result = dedupeEvents([a, b]);
  expect(result.length).toBe(2);
});

test("keeps two events within five minutes but at different places", () => {
  const a = event({});
  const b = event({ buildingId: null, location: "Pohl Recreation Center, Soccer Gym" });
  expect(placeKey(a)).not.toBe(placeKey(b));
  const result = dedupeEvents([a, b]);
  expect(result.length).toBe(2);
});

test("dedupes across building resolution: raw text and resolved id of the same place collapse", () => {
  const a = event({ buildingId: "uu", location: "University Union, Room 226" });
  const b = event({ buildingId: "uu", location: "university union   room 226" });
  const result = dedupeEvents([a, b]);
  expect(result.length).toBe(1);
});

test("two different titles at the same time and place stay separate", () => {
  const a = event({ title: "Club Meeting" });
  const b = event({ title: "Club Social" });
  const result = dedupeEvents([a, b]);
  expect(result.length).toBe(2);
});

test("a pair just outside the window stays; a chain inside the window collapses", () => {
  const t0 = "2026-10-20T23:30:00.000Z";
  const edge = new Date(Date.parse(t0) + DEDUPE_START_WINDOW_MS).toISOString();
  const beyond = new Date(Date.parse(t0) + DEDUPE_START_WINDOW_MS + 1000).toISOString();
  expect(dedupeEvents([event({ start: t0 }), event({ start: edge })]).length).toBe(1);
  expect(dedupeEvents([event({ start: t0 }), event({ start: beyond })]).length).toBe(2);
});

test("empty input yields empty output and a single event passes through unchanged", () => {
  expect(dedupeEvents([])).toEqual([]);
  const one = event({});
  expect(dedupeEvents([one])).toEqual([one]);
});

test("titles in non-Latin scripts stay distinct", () => {
  expect(normalizeEventTitle("日本語")).not.toBe(normalizeEventTitle("中文"));
  expect(dedupeEvents([event({ title: "日本語" }), event({ title: "中文" })]).length).toBe(2);
});

test("a chain whose ends are more than the window apart collapses through its middle", () => {
  const at = (minutes: number) => new Date(Date.parse("2026-10-20T23:30:00.000Z") + minutes * 60_000).toISOString();
  expect(dedupeEvents([event({ start: at(0) }), event({ start: at(4) }), event({ start: at(8) })]).length).toBe(1);
  // The middle event arriving last still joins the two ends.
  expect(dedupeEvents([event({ start: at(0) }), event({ start: at(8) }), event({ start: at(4) })]).length).toBe(1);
});
