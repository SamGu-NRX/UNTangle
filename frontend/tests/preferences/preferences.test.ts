import { describe, expect, test } from "bun:test";

import { defaultSchedulePreferences, parseSchedulePreferences } from "@/lib/planner";
import { applyIntent, emptyIntent, type PreferenceIntent } from "@/lib/preferences/schema";
import { parseDayGroup, parseIntent, parseTime } from "@/lib/preferences/parse";

// Strict tests for the redesigned preference contract: the typed intent, the
// deterministic parser, and what is honestly reported as not understood.
// Corpus-wide metrics live in eval.ts; these tests pin the behaviors.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

function parse(text: string) {
  return parseIntent(text);
}

function blockedOf(intent: PreferenceIntent) {
  return intent.hard.blockedTimes.map((b) => `${b.day} ${b.start}-${b.end}${b.label ? ` ${b.label}` : ""}`);
}

function notUnderstoodOf(result: ReturnType<typeof parse>) {
  return result.notUnderstood;
}

describe("schema: emptyIntent", () => {
  test("all hard fields unset, soft empty", () => {
    const intent = emptyIntent();
    expect(intent.hard.earliestStart).toBeNull();
    expect(intent.hard.latestEnd).toBeNull();
    expect(intent.hard.daysOff).toEqual([]);
    expect(intent.hard.blockedTimes).toEqual([]);
    expect(intent.hard.creditMin).toBeNull();
    expect(intent.hard.creditMax).toBeNull();
    expect(intent.hard.openSeatsOnly).toBeNull();
    expect(intent.hard.campusScope).toBeNull();
    expect(intent.hard.mode).toBeNull();
    expect(intent.soft).toEqual([]);
  });
});

describe("parser: time bounds", () => {
  test("earliest start from 'nothing before'", () => {
    const { intent } = parse("nothing before 9am");
    expect(intent.hard.earliestStart).toBe(540);
  });

  test("latest end from 'after' with explicit pm", () => {
    const { intent } = parse("No classes after 3pm");
    expect(intent.hard.latestEnd).toBe(900);
  });

  test("bare afternoon hour stays ambiguous under precision-first rules", () => {
    const { intent, notUnderstood } = parse("nothing after 5");
    expect(intent.hard.latestEnd).toBeNull();
    expect(notUnderstood.map((n) => n.tag)).toEqual(["ambiguousTime"]);
  });

  test("last mention wins on repeated singleton bounds", () => {
    const { intent } = parse("nothing before 9am, actually nothing before 10am");
    expect(intent.hard.earliestStart).toBe(600);
  });

  test("a scheduling verb may sit between the negation and the bound", () => {
    const { intent } = parse("I can't take classes before 11am");
    expect(intent.hard.earliestStart).toBe(660);
  });
});

describe("parser: days off", () => {
  test("or-listed days all captured", () => {
    const { intent } = parse("no Monday or Wednesday classes");
    expect(intent.hard.daysOff).toEqual(["Mon", "Wed"]);
  });

  test("and-listed days all captured", () => {
    const { intent } = parse("skip Tuesdays and Thursdays");
    expect(intent.hard.daysOff).toEqual(["Tue", "Thu"]);
  });

  test("MW only complements to the remaining weekdays", () => {
    const { intent } = parse("MW only");
    expect(intent.hard.daysOff).toEqual(["Tue", "Thu", "Fri"]);
  });

  test("'don't schedule anything on' negation", () => {
    const { intent } = parse("don't schedule anything on Tuesdays");
    expect(intent.hard.daysOff).toEqual(["Tue"]);
  });
});

describe("parser: blocked times", () => {
  test("kept-free range with no days applies to the five weekdays", () => {
    const { intent } = parse("keep 12-1 free");
    expect(blockedOf(intent)).toEqual(WEEKDAYS.map((d) => `${d} 720-780`));
  });

  test("a weekend commitment is tagged unsupported, not a blocked time", () => {
    const { intent, notUnderstood } = parse("I train Saturdays 10-2");
    expect(intent.hard.blockedTimes).toEqual([]);
    expect(notUnderstood.map((n) => n.tag)).toContain("weekend");
  });

  test("times-before-days order keeps the weekend tag", () => {
    const { intent, notUnderstood } = parse("I train 10-2 on Saturdays");
    expect(intent.hard.blockedTimes).toEqual([]);
    expect(notUnderstood.map((n) => n.tag)).toContain("weekend");
  });

  test("noon-labeled block parses without eating the label", () => {
    const { intent } = parse("set aside noon to 2 for lunch");
    expect(blockedOf(intent)).toEqual(WEEKDAYS.map((d) => `${d} 720-840 lunch`));
  });

  test("a bare-bare range stays ambiguous even with an explicit hour ban in the same sentence", () => {
    // Overlap resolution works on text spans: the hour ban (explicit 8am) and
    // the work range (bare 8-12, cross-noon-guessable but never guessed) are
    // separate claims. Only the explicit one lands in the intent; the bare
    // range is reported as ambiguous.
    const { intent, notUnderstood } = parse("I work 8-12, no 8am classes");
    expect(blockedOf(intent)).toEqual(WEEKDAYS.map((d) => `${d} 480-540`));
    expect(notUnderstood.map((n) => n.tag)).toEqual(["ambiguousTime"]);
  });
});

describe("parser: credits", () => {
  test("range sets both bounds", () => {
    const { intent } = parse("12-15 credits");
    expect(intent.hard.creditMin).toBe(12);
    expect(intent.hard.creditMax).toBe(15);
  });

  test("'no more than' is a max", () => {
    const { intent } = parse("no more than 12 credit hours");
    expect(intent.hard.creditMax).toBe(12);
    expect(intent.hard.creditMin).toBeNull();
  });

  test("bare hours are never credits: '12hrs' alone is unparseable", () => {
    const { intent } = parse("no more than 12hrs");
    expect(intent.hard.creditMax).toBeNull();
    expect(intent.hard.creditMin).toBeNull();
    expect(notUnderstoodOf(parse("no more than 12hrs")).every((n) => n.reason === "unparseable")).toBe(true);
  });

  test("'N or more credits' is a min", () => {
    const { intent } = parse("16 or more credits");
    expect(intent.hard.creditMin).toBe(16);
  });

  test("'N or fewer credits' is a max", () => {
    const { intent } = parse("12 or fewer credits");
    expect(intent.hard.creditMax).toBe(12);
  });

  test("'N credits minimum' is a min", () => {
    const { intent } = parse("9 credits minimum");
    expect(intent.hard.creditMin).toBe(9);
  });
});

describe("parser: seats, campus, mode", () => {
  test("open seats", () => {
    const { intent } = parse("don't show me closed classes");
    expect(intent.hard.openSeatsOnly).toBe(true);
  });

  test("denton-only phrasings", () => {
    const { intent } = parse("don't send me to Frisco");
    expect(intent.hard.campusScope).toBe("dentonOnly");
  });

  test("online mode", () => {
    const { intent } = parse("all online");
    expect(intent.hard.mode).toBe("online");
  });
});

describe("parser: soft preferences", () => {
  test("intensifier reads as strong", () => {
    const { intent } = parse("I really want my classes spread out");
    expect(intent.soft).toContainEqual({ key: "spreadOut", strength: "strong", positive: true });
  });

  test("plain phrasing reads as mild", () => {
    const { intent } = parse("I'd prefer gaps between classes");
    expect(intent.soft).toContainEqual({ key: "spreadOut", strength: "mild", positive: true });
  });

  test("negated directional preference flips to its opposite", () => {
    const { intent } = parse("no gaps between classes");
    expect(intent.soft).toEqual([{ key: "compact", strength: "strong", positive: true }]);
  });

  test("not a morning person leans away with strong strength", () => {
    const { intent } = parse("I'm not a morning person");
    expect(intent.soft).toContainEqual({ key: "mornings", strength: "strong", positive: false });
  });
});

describe("parser: unsupported preference tags", () => {
  test("a wanted course list is tagged, not stored as planner data", () => {
    const { intent, notUnderstood } = parse("I need to take CSCE 4110 and MATH 1710");
    expect(intent.hard.daysOff).toEqual([]);
    expect(notUnderstood.filter((n) => n.tag).map((n) => n.tag)).toEqual(["wantedCourse", "wantedCourse"]);
  });

  test("an avoided course list carries the avoid cue across the conjunction", () => {
    const { notUnderstood } = parse("avoid BIOL 2041 and CHEM 2370");
    expect(notUnderstood.filter((n) => n.tag).map((n) => n.tag)).toEqual(["avoidedCourse", "avoidedCourse"]);
  });

  test("preferring a professor is reported, not mapped", () => {
    const { intent, notUnderstood } = parse("prefer professor Smith");
    expect(intent.soft).toEqual([]);
    expect(notUnderstood.filter((n) => n.tag).map((n) => n.tag)).toContain("instructor");
  });

  test("avoiding a professor is an avoidance tag", () => {
    const { intent, notUnderstood } = parse("avoid professor Boyd");
    expect(intent.soft).toEqual([]);
    expect(notUnderstood.map((n) => n.tag)).toEqual(["avoidInstructor"]);
  });
});

describe("parser: not-understood spans", () => {
  test("unsupported families are tagged with exact spans", () => {
    const { intent, notUnderstood } = parse("no 3-hour classes for me");
    expect(intent.hard.blockedTimes).toEqual([]);
    expect(notUnderstood).toHaveLength(1);
    expect(notUnderstood[0].reason).toBe("unsupported");
    expect(notUnderstood[0].tag).toBe("classDuration");
    expect(notUnderstood[0].text.toLowerCase()).toContain("3-hour");
  });

  test("preference-sounding text no rule claims is flagged unparseable with its span", () => {
    const { intent, notUnderstood } = parse("I want about 15 credits");
    expect(intent.hard.creditMin).toBeNull();
    expect(intent.hard.creditMax).toBeNull();
    expect(notUnderstood).toEqual([{ start: 7, end: 23, text: "about 15 credits", reason: "unparseable" }]);
  });

  test("chatter produces neither intent fields nor complaints", () => {
    const { intent, notUnderstood } = parse("hey there");
    expect(intent).toEqual(emptyIntent());
    expect(notUnderstood).toEqual([]);
  });
});

describe("parser: multi-intent sentences", () => {
  test("bounds, credits, and days off from one sentence", () => {
    const { intent } = parse("no classes before 10am, 12 to 15 credits, no Friday classes");
    expect(intent.hard.earliestStart).toBe(600);
    expect(intent.hard.creditMin).toBe(12);
    expect(intent.hard.creditMax).toBe(15);
    expect(intent.hard.daysOff).toEqual(["Fri"]);
  });

  test("mixed supported and unsupported clauses both report honestly", () => {
    const { intent, notUnderstood } = parse("nothing before 9am and at most 2 classes a day");
    expect(intent.hard.earliestStart).toBe(540);
    expect(notUnderstood.map((n) => n.tag)).toEqual(["maxClassesPerDay"]);
  });
});

describe("mapping: applyIntent round-trips through planner validation", () => {
  const base = () => defaultSchedulePreferences("compact");

  test.each([
    "no classes before 10am",
    "I can't take anything on Tuesdays",
    "I work 7-1 on weekdays",
    "don't let me go over 15 credits",
    "every class has to be online",
    "Denton campuses only",
    "I prefer mornings",
    "no morning classes",
    "keep my schedule compact",
  ])("%s produces a SchedulePreferences the planner accepts", (text) => {
    const next = applyIntent(base(), parse(text).intent);
    expect(parseSchedulePreferences(next)).not.toBeNull();
  });

  test("an empty intent is a validated no-op", () => {
    const before = base();
    const next = applyIntent(before, emptyIntent());
    expect(parseSchedulePreferences(next)).not.toBeNull();
    expect(next).toEqual(before);
  });
});

describe("mapping: untouched fields are preserved byte-identically", () => {
  test("one mentioned field; everything else exactly as saved", () => {
    const before = defaultSchedulePreferences("minimizeDistance");
    before.constraints.earliestStart = 600;
    before.constraints.latestEnd = 900;
    before.constraints.otherSites = true;
    before.constraints.blocked = [
      { id: "saved-1", label: "work", day: "Mon", start: 540, end: 1020 },
    ];
    before.constraints.walkingBufferMinutes = 12;
    before.constraints.excludedSections = ["CSCE 4110"];
    before.weights.compact = 3;
    before.weights.walking = 1;

    const next = applyIntent(before, parse("no Friday classes").intent);

    expect(next.constraints.daysOff).toEqual(["Fri"]);
    expect(next.constraints.earliestStart).toBe(600);
    expect(next.constraints.latestEnd).toBe(900);
    expect(next.constraints.otherSites).toBe(true);
    expect(next.constraints.maxCredits).toBe(before.constraints.maxCredits);
    expect(next.constraints.walkingBufferMinutes).toBe(12);
    expect(next.constraints.excludedSections).toEqual(["CSCE 4110"]);
    expect(next.weights.compact).toBe(3);
    expect(next.weights.walking).toBe(1);
    expect(next.constraints.blocked.filter((b) => b.id === "saved-1")).toHaveLength(1);
  });

  test("appended block ids never collide with existing ids", () => {
    const before = defaultSchedulePreferences("compact");
    before.constraints.blocked = [
      { id: "pref-block-1", label: "kept free", day: "Mon", start: 540, end: 600 },
    ];
    const next = applyIntent(before, parse("keep 12-1 free on Mondays").intent);
    const ids = next.constraints.blocked.map((b) => b.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("parser: parseTime strict table", () => {
  test.each([
    ["12 AM", 0, true],
    ["12 pm", 720, true],
    ["noon", 720, true],
    ["midnight", 0, true],
    ["13:30", 810, true],
    ["9:30", 570, false],
    ["9.30", 570, false],
  ])("%s -> %i minutes (explicit: %p)", (raw, minutes, explicit) => {
    expect(parseTime(raw)).toEqual({ minutes, explicit });
  });

  test("a bare hour is a value but never explicit", () => {
    expect(parseTime("7")).toEqual({ minutes: 420, explicit: false });
  });

  test("a range ending in pm applies its meridiem to the bare start", () => {
    const { intent } = parse("I work 8-10pm on Monday");
    const blocks = intent.hard.blockedTimes.filter((b) => b.day === "Mon");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].start).toBe(1200);
    expect(blocks[0].end).toBe(1320);
  });
});

describe("parser: day tokenizer strict table", () => {
  test.each([
    ["Tu/Th", ["Tue", "Thu"]],
    ["TR", ["Tue", "Thu"]],
    ["R", ["Thu"]],
    ["M/W/F", ["Mon", "Wed", "Fri"]],
    ["M T W R F", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
    ["weekdays", ["Mon", "Tue", "Wed", "Thu", "Fri"]],
    ["weekends", ["Sat", "Sun"]],
    ["Monday through Wednesday", ["Mon", "Tue", "Wed"]],
  ])("%s -> %j", (fragment, days) => {
    expect(parseDayGroup(fragment) as unknown).toEqual(days);
  });
});
