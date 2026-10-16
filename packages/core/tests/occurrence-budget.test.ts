/** The piece budget on feed expansion is exact, however many DST changes a span crosses. */
import { describe, expect, test } from "bun:test";
import { feedOccurrences, OccurrenceBudgetError, type ParsedFeed } from "../src/occurrences";

// One timed event from 2026-03-01 to 2028-12-01 in America/Chicago: about a thousand local days and six DST changes,
// each of which splits a day into two pieces.
const feed: ParsedFeed = {
  events: [{ id: 0, isAllDay: false, transparent: false }],
  occurrences: [{ eventId: 0, start: "2026-03-01T06:00:00.000Z", end: "2028-12-01T06:00:00.000Z", status: "confirmed" }],
};
const range = { first: "2026-01-01", last: "2028-12-31" };

describe("the feed expansion budget", () => {
  const all = feedOccurrences(feed, range, "America/Chicago");

  test("the span really does cross DST changes, so it has more pieces than days", () => {
    const days = new Set(all.map((piece) => piece.date)).size;
    expect(all.length).toBeGreaterThan(days);
  });

  test("a budget of exactly the piece count passes, and one fewer is refused", () => {
    expect(feedOccurrences(feed, range, "America/Chicago", { maxPieces: all.length })).toHaveLength(all.length);
    expect(() => feedOccurrences(feed, range, "America/Chicago", { maxPieces: all.length - 1 })).toThrow(OccurrenceBudgetError);
  });

  test("the budget counts across occurrences", () => {
    const twice: ParsedFeed = { ...feed, occurrences: [...feed.occurrences, ...feed.occurrences] };
    expect(() => feedOccurrences(twice, range, "America/Chicago", { maxPieces: 2 * all.length - 1 })).toThrow(OccurrenceBudgetError);
    expect(feedOccurrences(twice, range, "America/Chicago", { maxPieces: 2 * all.length })).toHaveLength(2 * all.length);
  });
});
