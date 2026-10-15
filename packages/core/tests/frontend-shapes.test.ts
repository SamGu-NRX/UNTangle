import { expectTypeOf, test } from "bun:test";
import type { CalendarParseResult } from "../../../frontend/src/lib/calendar-feeds/types";
import type { Meeting, Section } from "../../../frontend/src/lib/sections/model";
import type { FilterableSection } from "../src/filters";
import type { ParsedFeed, WeeklyMeeting } from "../src/occurrences";

// Core's input types are structural subsets of what the app's parsers
// produce, so a parsed section or feed passes in without an adapter. When
// one of these frontend modules moves into core, update the import here.
test("the app's parsed sections, meetings and calendar feeds are core inputs as they are", () => {
  expectTypeOf<Section>().toExtend<FilterableSection>();
  expectTypeOf<Meeting>().toExtend<WeeklyMeeting>();
  expectTypeOf<CalendarParseResult>().toExtend<ParsedFeed>();
});
