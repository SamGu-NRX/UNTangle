import { describe, expect, expectTypeOf, test } from "bun:test";
import type { z } from "zod";
import type { SectionFilter } from "../../core/src/filters";
import { SectionFilterSchema, SectionFiltersSchema } from "../src/filters";
import { decoded, rejections } from "./helpers";

const filters: SectionFilter[] = [
  { kind: "open-seats", minimum: 1 },
  { kind: "modality", allowed: ["in-person", "online-timed"] },
  { kind: "site", allowed: ["unt-denton"] },
  { kind: "days", allowed: ["Mon", "Wed", "Fri"] },
  { kind: "time-window", earliestStart: 600, latestEnd: null },
  { kind: "instructor", match: "not", names: ["Allen Mann"] },
  { kind: "credit-hours", min: 3, max: 4 },
];

describe("SectionFilterSchema", () => {
  test.each(filters.map((filter) => [filter.kind, filter] as const))("a %s filter round-trips", (_kind, filter) => {
    expect(decoded(SectionFilterSchema, filter)).toEqual(filter);
  });

  test("a list of every kind round-trips", () => {
    expect(decoded(SectionFiltersSchema, filters)).toEqual(filters);
  });

  test.each([
    ["an unknown kind", { kind: "attendance-optional" }],
    ["an unknown field", { kind: "open-seats", minimum: 1, waitlistOk: true }],
    ["a minimum below one seat", { kind: "open-seats", minimum: 0 }],
    ["an empty list of choices", { kind: "days", allowed: [] }],
    ["a day named twice", { kind: "days", allowed: ["Mon", "Mon"] }],
    ["a day the app doesn't write", { kind: "days", allowed: ["Monday"] }],
    ["a site id that isn't a slug", { kind: "site", allowed: ["UNT Denton"] }],
    ["a window with neither side", { kind: "time-window", earliestStart: null, latestEnd: null }],
    ["a window that ends before it starts", { kind: "time-window", earliestStart: 600, latestEnd: 600 }],
    ["a window past midnight", { kind: "time-window", earliestStart: null, latestEnd: 1441 }],
    ["an instructor name with stray spaces", { kind: "instructor", match: "only", names: [" Allen Mann"] }],
    ["credit hours with neither side", { kind: "credit-hours", min: null, max: null }],
    ["credit hours with the most below the fewest", { kind: "credit-hours", min: 4, max: 3 }],
  ])("rejects %s", (_why, filter) => {
    expect(rejections(SectionFilterSchema, filter)).not.toEqual([]);
  });

  test("a list rejects a second filter of the same kind", () => {
    expect(rejections(SectionFiltersSchema, [filters[0], { kind: "open-seats", minimum: 5 }])).toEqual(['1.kind: A second "open-seats" filter.']);
  });

  test("decodes to core's SectionFilter, so a stored filter goes straight to evaluateFilter", () => {
    expectTypeOf<z.output<typeof SectionFilterSchema>>().toEqualTypeOf<SectionFilter>();
  });
});
