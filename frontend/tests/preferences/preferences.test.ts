import { describe, expect, test } from "bun:test";

import { choicesFromWeights } from "@/components/schedule/constraint-logic";
import type { OptimizationKey, WeekDay } from "@/lib/types";
import { defaultSchedulePreferences, parseSchedulePreferences } from "@/lib/planner";
import { parseDayGroup, parseIntent, parseTime, type AnyDay, type ParsedTime, type ParseResult } from "@/lib/preferences/parse";
import { applyIntent, emptyIntent, type PreferenceIntent, type SoftKey } from "@/lib/preferences/schema";

// Behavior tests for the preference parser and applyIntent. Corpus-wide
// numbers live in eval.ts.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** `defaultSchedulePreferences` shares one constraints object across calls; a test that edits it must own a copy. */
const preset = (goal: OptimizationKey) => structuredClone(defaultSchedulePreferences(goal));

const blocks = (intent: PreferenceIntent) =>
  intent.hard.blockedTimes.map((b) => `${b.day} ${b.start}-${b.end}${b.label ? ` ${b.label}` : ""}`);

const tags = (r: ParseResult) => r.notUnderstood.flatMap((n) => (n.reason === "unsupported" ? [n.tag] : []));

const hedged = (r: ParseResult) =>
  r.notUnderstood.flatMap((n) =>
    n.reason === "unsupported" && n.tag === "hedgedConstraint" ? [{ field: n.field, value: n.value }] : [],
  );

describe("time bounds", () => {
  test.each([
    ["nothing before 9am", "earliestStart", 540],
    ["I can't take classes before 11am", "earliestStart", 660],
    ["don't start until 11am", "earliestStart", 660],
    ["8am is too early", "earliestStart", 481],
    ["No classes after 3pm", "latestEnd", 900],
    ["don't let classes run past 6pm", "latestEnd", 1080],
    ["I need to be done by 2pm on weekdays", "latestEnd", 840],
  ] as const)("%s sets %s to %i", (text, field, minutes) => {
    expect(parseIntent(text).intent.hard[field]).toBe(minutes);
  });

  test("one negation covers both bounds of a coordinated pair", () => {
    const { intent } = parseIntent("no classes after 4pm or before 9am");
    expect([intent.hard.earliestStart, intent.hard.latestEnd]).toEqual([540, 960]);
  });

  test("a bare hour is tagged, never read as am or pm", () => {
    const r = parseIntent("nothing after 5");
    expect(r.intent.hard.latestEnd).toBeNull();
    expect(tags(r)).toEqual(["ambiguousTime"]);
  });

  test("a bound scoped to one day is tagged dayWithTime over the whole clause", () => {
    const r = parseIntent("no classes after 5pm on Thursdays");
    expect(r.intent.hard.latestEnd).toBeNull();
    expect(r.notUnderstood).toEqual([
      { start: 0, end: 33, text: "no classes after 5pm on Thursdays", reason: "unsupported", tag: "dayWithTime" },
    ]);
  });

  test("the last mention of a bound wins", () => {
    expect(parseIntent("nothing before 9am, actually nothing before 10am").intent.hard.earliestStart).toBe(600);
  });
});

describe("days off", () => {
  test.each<[string, WeekDay[]]>([
    ["no Monday or Wednesday classes", ["Mon", "Wed"]],
    ["skip Tuesdays and Thursdays", ["Tue", "Thu"]],
    ["don't schedule anything on Tuesdays", ["Tue"]],
    ["I can't make it to campus on Fridays", ["Fri"]],
    ["Mondays are off", ["Mon"]],
    ["MW only", ["Tue", "Thu", "Fri"]],
  ])("%s", (text, days) => {
    expect(parseIntent(text).intent.hard.daysOff).toEqual(days);
  });

  test("a negation does not reach past a content word", () => {
    for (const text of ["I don't work Fridays", "I don't care about Fridays", "I don't mind Fridays"]) {
      expect(parseIntent(text).intent.hard.daysOff).toEqual([]);
    }
  });

  test("a day with a time is not a whole day off", () => {
    const r = parseIntent("no Friday classes before 10am");
    expect(r.intent.hard.daysOff).toEqual([]);
    expect(tags(r)).toEqual(["dayWithTime"]);
  });
});

describe("day and time tokens end to end", () => {
  test.each<[string, WeekDay[]]>([
    ["no classes on Tu/Th", ["Tue", "Thu"]],
    ["no classes on T/Th", ["Tue", "Thu"]],
    ["no classes on TR", ["Tue", "Thu"]],
    ["no classes on Th", ["Thu"]],
    ["no classes on R", ["Thu"]],
    ["no classes on M/W/F", ["Mon", "Wed", "Fri"]],
    ["skip Tues and Thurs", ["Tue", "Thu"]],
  ])("%s", (text, days) => {
    expect(parseIntent(text).intent.hard.daysOff).toEqual(days);
  });

  test("an abbreviated commitment lands on its days", () => {
    expect(blocks(parseIntent("I work Tu/Th 3pm-5pm").intent)).toEqual(["Tue 900-1020 work", "Thu 900-1020 work"]);
  });

  test("'w/' is 'with', not Wednesday", () => {
    const r = parseIntent("no classes w/ Dr. Lee");
    expect(r.intent.hard.daysOff).toEqual([]);
    expect(tags(r)).toEqual(["avoidInstructor"]);
  });

  test("'sat' and 'sun' as English words are not days", () => {
    expect(tags(parseIntent("I sat in on a class and the sun was out"))).toEqual([]);
  });
});

describe("blocked times", () => {
  test("'no Monday 8ams' blocks Monday 8am, it is not Monday off", () => {
    const { intent } = parseIntent("no Monday 8ams");
    expect(intent.hard.daysOff).toEqual([]);
    expect(blocks(intent)).toEqual(["Mon 480-540"]);
  });

  test("a plural hour with no day blocks every weekday", () => {
    expect(blocks(parseIntent("no 8ams").intent)).toEqual(WEEKDAYS.map((d) => `${d} 480-540`));
  });

  test("a weekend commitment is tagged, not blocked", () => {
    const r = parseIntent("I train Saturdays 10-2");
    expect(r.intent.hard.blockedTimes).toEqual([]);
    expect(tags(r)).toEqual(["weekend"]);
  });

  test("the label comes from 'for X' after the range", () => {
    expect(blocks(parseIntent("keep 12pm-1pm free on weekdays for lunch").intent)).toEqual(
      WEEKDAYS.map((d) => `${d} 720-780 lunch`),
    );
  });

  test("a negated range is a block", () => {
    expect(blocks(parseIntent("no classes between 12pm and 1pm").intent)).toEqual(WEEKDAYS.map((d) => `${d} 720-780`));
  });
});

describe("range readings", () => {
  const read = (text: string) => {
    const r = parseIntent(text);
    const span = r.understood.find((u) => u.field === "hard.blockedTimes");
    const first = r.intent.hard.blockedTimes[0];
    return first && span ? { start: first.start, end: first.end, assumed: span.assumed } : tags(r);
  };

  test.each([
    ["I work 7-1", 420, 780, true],
    ["I work 9-5", 540, 1020, true],
    ["I work 11 to 1", 660, 780, true],
    ["I work 11-1pm", 660, 780, true],
    ["I work 8-10pm", 1200, 1320, false],
    ["I work 8am-4pm", 480, 960, false],
    ["I work 12pm-1pm", 720, 780, false],
    ["I work 10pm to midnight", 1320, 1440, false],
  ] as const)("%s is %i-%i (assumed: %p)", (text, start, end, assumed) => {
    expect(read(text)).toEqual({ start, end, assumed });
  });

  test.each(["I work 12-1", "I work 1-3", "I work 10 to 12"])("%s stays ambiguous", (text) => {
    expect(read(text)).toEqual(["ambiguousTime"]);
  });
});

describe("credits", () => {
  test.each([
    ["12-15 credits", 12, 15],
    ["no more than 12 credit hours", null, 12],
    ["don't let me go over 15 credits", null, 15],
    ["no fewer than 12 credits", 12, null],
    ["fewer than 15 credits", null, 14],
    ["16 or more credits", 16, null],
    ["9 credits minimum", 9, null],
  ])("%s", (text, min, max) => {
    const { hard } = parseIntent(text).intent;
    expect([hard.creditMin, hard.creditMax]).toEqual([min, max]);
  });

  test("bare hours are never credits", () => {
    const r = parseIntent("no more than 12hrs");
    expect([r.intent.hard.creditMin, r.intent.hard.creditMax]).toEqual([null, null]);
    expect(r.notUnderstood.map((n) => n.reason)).toEqual(["unparseable"]);
  });

  test.each([
    ["at most 15 credits", "hard.creditMax", 15],
    ["at least 12 credits", "hard.creditMin", 12],
    ["12 to 15 credits", "hard.credits", { min: 12, max: 15 }],
    ["exactly 12 credits", "hard.credits", { min: 12, max: 12 }],
  ])("the span for %s names %s", (text, field, value) => {
    expect(parseIntent(text).understood.map((u) => [u.field, u.value])).toEqual([[field, value]]);
  });
});

describe("seats, campus, mode", () => {
  test.each([
    ["don't show me closed classes", "openSeatsOnly", true],
    ["don't send me to Frisco", "campusScope", "dentonOnly"],
    ["I don't mind Frisco", "campusScope", "otherSitesOk"],
    ["all online", "mode", "online"],
    ["no online classes", "mode", "inPerson"],
  ] as const)("%s", (text, field, value) => {
    expect(parseIntent(text).intent.hard[field]).toBe(value);
  });
});

describe("soft preferences and strength", () => {
  test.each([
    ["fewer days on campus", "fewerDays", "mild"],
    ["I'd like fewer days on campus", "fewerDays", "mild"],
    ["I really want fewer days on campus", "fewerDays", "strong"],
    ["I need fewer days on campus", "fewerDays", "strong"],
    ["fewer days on campus is very important", "fewerDays", "strong"],
    ["I really want fewer days on campus, if possible", "fewerDays", "mild"],
  ] as const)("%s is %s %s", (text, key, strength) => {
    expect(parseIntent(text).intent.soft).toEqual([{ key, strength, positive: true }]);
  });

  test("'can't' negates and intensifies", () => {
    expect(parseIntent("I can't do morning classes").intent.soft).toEqual([
      { key: "mornings", strength: "strong", positive: false },
    ]);
  });

  test.each<[string, SoftKey]>([
    ["no gaps between classes", "compact"],
    ["I hate back-to-back classes", "spreadOut"],
    ["I don't want a compact schedule", "spreadOut"],
    ["back-to-back classes are fine", "compact"],
  ])("%s leans %s", (text, key) => {
    expect(parseIntent(text).intent.soft.map((s) => s.key)).toEqual([key]);
  });

  test("a time-of-day word leans toward only with a cue, and away when negated", () => {
    expect(parseIntent("I prefer morning classes").intent.soft).toEqual([{ key: "mornings", strength: "mild", positive: true }]);
    expect(parseIntent("I'm not a night person").intent.soft).toEqual([{ key: "evenings", strength: "mild", positive: false }]);
    expect(parseIntent("I work in the morning").intent.soft).toEqual([]);
  });
});

describe("hedges", () => {
  test.each(["Fridays off if possible", "Fridays off, if possible", "If possible, Fridays off", "Fridays off. Ideally."])(
    "%s is a hedged day off, not a fact",
    (text) => {
      const r = parseIntent(text);
      expect(r.intent.hard.daysOff).toEqual([]);
      expect(hedged(r)).toEqual([{ field: "hard.daysOff", value: ["Fri"] }]);
    },
  );

  test.each([
    ["ideally no classes before 10am", "hard.earliestStart", 600],
    ["preferably nothing after 5pm", "hard.latestEnd", 1020],
    ["I'd prefer 12 to 15 credits", "hard.credits", { min: 12, max: 15 }],
    ["no more than 15 credits if I can help it", "hard.creditMax", 15],
    ["open seats only if you can", "hard.openSeatsOnly", true],
    ["Denton only if possible", "hard.campusScope", "dentonOnly"],
    ["online only, preferably", "hard.mode", "online"],
    ["no 8am classes, not a big deal", "hard.blockedTimes", WEEKDAYS.map((day) => ({ day, start: 480, end: 540 }))],
  ])("%s carries %s without setting it", (text, field, value) => {
    const r = parseIntent(text);
    expect(r.intent).toEqual(emptyIntent());
    expect(hedged(r)).toEqual([{ field, value }]);
  });

  test("a hedge reaches its own clause, not the one before it", () => {
    const r = parseIntent("no Friday classes, and ideally nothing before 10am");
    expect(r.intent.hard.daysOff).toEqual(["Fri"]);
    expect(r.intent.hard.earliestStart).toBeNull();
    expect(hedged(r)).toEqual([{ field: "hard.earliestStart", value: 600 }]);
  });

  test.each(["no classes before 10am, but 9am is okay", "no classes before 10am, 9am if necessary"])(
    "the concession in %s hedges the clause before it",
    (text) => {
      const r = parseIntent(text);
      expect(r.intent.hard.earliestStart).toBeNull();
      expect(hedged(r)).toEqual([{ field: "hard.earliestStart", value: 600 }]);
    },
  );

  test("a 'but' clause with its own fact hedges nothing", () => {
    const { hard } = parseIntent("no classes on Fridays, but Frisco is fine").intent;
    expect([hard.daysOff, hard.campusScope]).toEqual([["Fri"], "otherSitesOk"]);
  });

  test("a hedge with nothing to hedge is reported, not dropped as filler", () => {
    expect(parseIntent("if possible").notUnderstood.map((n) => n.text)).toEqual(["if possible"]);
  });
});

describe("tags", () => {
  test("course lists keep their polarity across the conjunction", () => {
    expect(tags(parseIntent("I need to take CSCE 4110 and MATH 1710"))).toEqual(["wantedCourse", "wantedCourse"]);
    expect(tags(parseIntent("avoid BIOL 2041 and CHEM 2370"))).toEqual(["avoidedCourse", "avoidedCourse"]);
  });

  test.each([
    ["prefer professor Smith", ["instructor"]],
    ["avoid professor Boyd", ["avoidInstructor"]],
    ["anyone but Dr. Lee", ["avoidInstructor"]],
    ["avoid Professor Lee and Dr Kim", ["avoidInstructor", "avoidInstructor"]],
  ])("%s", (text, expected) => {
    const r = parseIntent(text);
    expect(r.intent).toEqual(emptyIntent());
    expect(tags(r)).toEqual(expected);
  });
});

describe("not-understood spans", () => {
  test("text no row reads is reported with its exact span", () => {
    expect(parseIntent("I want about 15 credits").notUnderstood).toEqual([
      { start: 7, end: 23, text: "about 15 credits", reason: "unparseable" },
    ]);
  });

  test("a lone leftover word is noise, unless it is a day or a time", () => {
    expect(parseIntent("hmm, classes").notUnderstood).toEqual([]);
    expect(parseIntent("I'm free on Fridays").notUnderstood.map((n) => n.text)).toEqual(["I'm free on Fridays"]);
    expect(parseIntent("no classes before 10am, Fridays").notUnderstood.map((n) => n.text)).toEqual(["Fridays"]);
  });

  test("a whole-week scope is part of its bound, not a leftover", () => {
    expect(parseIntent("nothing past 5 on weekdays").notUnderstood.map((n) => n.text)).toEqual(["nothing past 5 on weekdays"]);
  });

  test("chatter produces neither facts nor complaints", () => {
    const r = parseIntent("hey there");
    expect([r.intent, r.notUnderstood]).toEqual([emptyIntent(), []]);
  });
});

describe("parseTime and parseDayGroup", () => {
  test.each<[string, number, ParsedTime["meridiem"], boolean]>([
    ["12 AM", 0, "am", true],
    ["12 pm", 720, "pm", true],
    ["noon", 720, "pm", true],
    ["midnight", 0, "am", true],
    ["8ams", 480, "am", true],
    ["13:30", 810, null, true],
    ["9:30", 570, null, false],
    ["9.30", 570, null, false],
    ["7", 420, null, false],
  ])("%s -> %i", (raw, minutes, meridiem, explicit) => {
    expect(parseTime(raw)).toEqual({ minutes, meridiem, explicit });
  });

  test.each(["13pm", "9:75", "25"])("%s is not a time", (raw) => {
    expect(parseTime(raw)).toBeNull();
  });

  test.each<[string, AnyDay[]]>([
    ["Tu/Th", ["Tue", "Thu"]],
    ["T/Th", ["Tue", "Thu"]],
    ["TR", ["Tue", "Thu"]],
    ["R", ["Thu"]],
    ["Thurs", ["Thu"]],
    ["M/W/F", ["Mon", "Wed", "Fri"]],
    ["M T W R F", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
    ["every weekday", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
    ["weekends", ["Sat", "Sun"]],
    ["Monday through Wednesday", ["Mon", "Tue", "Wed"]],
  ])("%s -> %j", (fragment, days) => {
    expect(parseDayGroup(fragment)).toEqual(days);
  });

  test.each(["S", "sat", "day", "Monday and"])("%s is not a day group", (fragment) => {
    expect(parseDayGroup(fragment)).toBeNull();
  });
});

describe("applyIntent", () => {
  const apply = (goal: OptimizationKey, text: string) => applyIntent(preset(goal), parseIntent(text).intent);

  test.each([
    "no classes before 10am",
    "I can't take anything on Tuesdays",
    "I work 7-1 on weekdays",
    "don't let me go over 15 credits",
    "every class has to be online",
    "Denton campuses only",
    "I prefer mornings",
    "no 11:30pm classes",
  ])("%s gives preferences the planner accepts", (text) => {
    expect(parseSchedulePreferences(apply("compact", text))).not.toBeNull();
  });

  test.each([
    ["clusterNight", "I prefer morning classes", 2, 0, "earlier"],
    ["clusterNight", "I really want morning classes", 4, 0, "earlier"],
    ["clusterMorning", "I prefer evening classes", 0, 2, "later"],
  ] as const)("from %s, '%s' leans the other way", (goal, text, mornings, evenings, lean) => {
    const { weights } = apply(goal, text);
    expect([weights.mornings, weights.evenings]).toEqual([mornings, evenings]);
    expect(choicesFromWeights(weights).lean).toBe(lean);
  });

  test("leaning away zeroes only its own weight", () => {
    const { weights } = apply("clusterNight", "no morning classes");
    expect([weights.mornings, weights.evenings]).toEqual([0, 4]);
  });

  test("applying the same sentence twice adds its blocks once", () => {
    const intent = parseIntent("I work 9am-5pm on Mondays").intent;
    const once = applyIntent(preset("compact"), intent);
    expect(applyIntent(once, intent).constraints.blocked).toEqual(once.constraints.blocked);
  });

  test("fields the intent does not set are kept exactly", () => {
    const before = preset("minimizeDistance");
    before.constraints = {
      ...before.constraints,
      earliestStart: 600,
      latestEnd: 900,
      otherSites: true,
      blocked: [{ id: "saved-1", label: "work", day: "Mon", start: 540, end: 1020 }],
      walkingBufferMinutes: 12,
      excludedSections: ["CSCE 4110"],
    };
    before.weights = { ...before.weights, compact: 3, walking: 1 };
    const next = applyIntent(before, parseIntent("no Friday classes").intent);
    expect(next).toEqual({ ...before, constraints: { ...before.constraints, daysOff: ["Fri"] } });
  });

  test("appended block ids never collide with saved ones", () => {
    const before = preset("compact");
    before.constraints.blocked = [{ id: "pref-block", label: "kept free", day: "Mon", start: 540, end: 600 }];
    const ids = applyIntent(before, parseIntent("keep 12pm-1pm free on Mondays").intent).constraints.blocked.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
