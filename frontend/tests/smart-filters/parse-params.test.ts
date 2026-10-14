import { describe, expect, test } from "bun:test";
import { parseFilters } from "@/lib/smart-filters/handlers";

function params(query: string): URLSearchParams {
  return new URLSearchParams(query);
}

describe("parseFilters", () => {
  test("no parameters mean no filters", () => {
    expect(parseFilters(params(""))).toEqual({ filters: [] });
  });

  test("minSeats is a nonnegative integer", () => {
    expect(parseFilters(params("minSeats=5"))).toEqual({ filters: [{ kind: "open-seats", minimum: 5 }] });
    expect(parseFilters(params("minSeats=0"))).toEqual({ filters: [{ kind: "open-seats", minimum: 0 }] });
    expect(parseFilters(params("minSeats=-1"))).toEqual({ error: expect.stringContaining("minSeats") });
    expect(parseFilters(params("minSeats=1.5"))).toEqual({ error: expect.stringContaining("minSeats") });
  });

  test("days is a comma-separated list of meeting days", () => {
    expect(parseFilters(params("days=Mon,Wed"))).toEqual({ filters: [{ kind: "meeting-days", days: ["Mon", "Wed"] }] });
    expect(parseFilters(params("days=Monday"))).toEqual({ error: expect.stringContaining("days") });
    // An empty selection imposes no constraint.
    expect(parseFilters(params("days="))).toEqual({ filters: [] });
  });

  test("windowStart and windowEnd go together and in order", () => {
    expect(parseFilters(params("windowStart=600&windowEnd=780"))).toEqual({
      filters: [{ kind: "time-window", startMinutes: 600, endMinutes: 780 }],
    });
    expect(parseFilters(params("windowStart=600"))).toEqual({ error: expect.stringContaining("windowStart") });
    expect(parseFilters(params("windowStart=780&windowEnd=600"))).toEqual({ error: expect.stringContaining("earlier") });
    expect(parseFilters(params("windowStart=abc&windowEnd=600"))).toEqual({ error: expect.stringContaining("windowStart") });
  });

  test("modality is online or in-person", () => {
    expect(parseFilters(params("modality=online"))).toEqual({ filters: [{ kind: "modality", modality: "online" }] });
    expect(parseFilters(params("modality=hybrid"))).toEqual({ error: expect.stringContaining("modality") });
  });

  test("campus is denton, off-campus or online", () => {
    expect(parseFilters(params("campus=off-campus"))).toEqual({ filters: [{ kind: "campus", campus: "off-campus" }] });
    expect(parseFilters(params("campus=frisco"))).toEqual({ error: expect.stringContaining("campus") });
  });

  test("several filters parse together", () => {
    const parsed = parseFilters(params("minSeats=1&days=Mon,Wed&windowStart=600&windowEnd=780&modality=in-person&campus=denton"));
    expect(parsed).toEqual({
      filters: [
        { kind: "open-seats", minimum: 1 },
        { kind: "meeting-days", days: ["Mon", "Wed"] },
        { kind: "time-window", startMinutes: 600, endMinutes: 780 },
        { kind: "modality", modality: "in-person" },
        { kind: "campus", campus: "denton" },
      ],
    });
  });
});
