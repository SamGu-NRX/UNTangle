import { describe, expect, test } from "bun:test";

import { emptyIntent, toPlannerPreferences } from "@/lib/preferences/schema";
import { parseIntent } from "@/lib/preferences/parse";
import type { PreferenceIntent } from "@/lib/preferences/schema";

// Strict tests for the preference schema, the deterministic parser, and the
// pure planner mapping. These pin documented behavior: what parses, what is
// honestly reported as not understood, and where values land in the planner's
// inputs. Corpus-wide metrics live in eval.ts; these tests pin the behaviors.

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function parse(text: string) {
  return parseIntent(text);
}

function blockedOf(intent: PreferenceIntent) {
  return intent.hard.blockedTimes.map((b) => `${b.day} ${b.start}-${b.end}${b.label ? ` ${b.label}` : ""}`);
}

describe("schema: emptyIntent", () => {
  test("all hard fields empty, soft empty, instructor null", () => {
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
    expect(intent.hard.wantedCourses).toEqual([]);
    expect(intent.hard.avoidedCourses).toEqual([]);
    expect(intent.soft).toEqual([]);
    expect(intent.instructor).toBeNull();
  });

  test("empty intent maps to empty planner preferences", () => {
    const prefs = toPlannerPreferences(emptyIntent());
    expect(prefs.constraints.earliestStart).toBeNull();
    expect(prefs.constraints.latestEnd).toBeNull();
    expect(prefs.constraints.daysOff).toEqual([]);
    expect(prefs.constraints.blocked).toEqual([]);
    expect(prefs.constraints.maxCredits).toBeNull();
    expect(prefs.constraints.openSeatsOnly).toBe(false);
    expect(prefs.constraints.otherSites).toBe(false);
    expect(prefs.weights.fewerDays).toBe(0);
    expect(prefs.weights.compact).toBe(0);
    expect(prefs.weights.walking).toBe(0);
    expect(prefs.weights.mornings).toBe(0);
    expect(prefs.weights.evenings).toBe(0);
    expect(prefs.weights.rating).toBe(0);
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

  test("bare afternoon hour reads as pm when plausible", () => {
    const { intent } = parse("nothing after 5");
    expect(intent.hard.latestEnd).toBe(1020);
  });

  test("last mention wins on repeated singleton bounds", () => {
    const { intent } = parse("nothing before 9am, actually nothing before 10am");
    expect(intent.hard.earliestStart).toBe(600);
  });

  test("'can't take classes before' parses with the verb", () => {
    const { intent } = parse("I can't take classes before 11");
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

  test("MW only complements to the rest of the week", () => {
    const { intent } = parse("MW only");
    expect(intent.hard.daysOff).toEqual(["Tue", "Thu", "Fri", "Sat", "Sun"]);
  });

  test("'don't schedule anything on' negation", () => {
    const { intent } = parse("don't schedule anything on Tuesdays");
    expect(intent.hard.daysOff).toEqual(["Tue"]);
  });
});

describe("parser: blocked times", () => {
  test("kept-free range with no days applies to all seven", () => {
    const { intent } = parse("keep 12-1 free");
    // The free-word is part of the match, not the label; no "for" phrase means no label.
    expect(blockedOf(intent)).toEqual(DAYS.map((d) => `${d} 720-780`));
  });

  test("commitment verb + days + range keeps the verb as label", () => {
    const { intent } = parse("I train Saturdays 10-2");
    expect(blockedOf(intent)).toEqual(["Sat 600-840 train"]);
  });

  test("times-before-days order keeps the day scope", () => {
    const { intent } = parse("I train 10-2 on Saturdays");
    expect(blockedOf(intent)).toEqual(["Sat 600-840 train"]);
  });

  test(" noon-labeled block parses without eating the label", () => {
    const { intent } = parse("set aside noon to 2 for lunch");
    expect(blockedOf(intent)).toEqual(DAYS.map((d) => `${d} 720-840 lunch`));
  });

  test("stated redundancies are preserved, not merged by interval algebra", () => {
    // Overlap resolution works on text spans, not on the resulting blocked
    // intervals: both clauses are distinct statements, so both land in the
    // intent. The one-hour exclusion is redundant with the range but harmless
    // to the planner, and dropping it would silently discard what was said.
    const { intent } = parse("I work 8-12, no 8am classes");
    const entries = blockedOf(intent);
    expect(entries).toContain("Mon 480-720 work");
    expect(entries).toContain("Mon 480-540");
  });

  test("duplicate phrasing does not duplicate entries", () => {
    const { intent } = parse("keep 12-1 free. keep 12-1 free");
    expect(blockedOf(intent)).toEqual(DAYS.map((d) => `${d} 720-780`));
  });
});

describe("parser: credits", () => {
  test("range sets both bounds", () => {
    const { intent } = parse("12-15 credits");
    expect(intent.hard.creditMin).toBe(12);
    expect(intent.hard.creditMax).toBe(15);
  });

  test("'no more than' is a max", () => {
    const { intent } = parse("no more than 12hrs");
    expect(intent.hard.creditMax).toBe(12);
    expect(intent.hard.creditMin).toBeNull();
  });

  test("'N or more credits' is a min", () => {
    const { intent } = parse("16 or more credits");
    expect(intent.hard.creditMin).toBe(16);
  });

  test("'N or fewer credits' is a max", () => {
    const { intent } = parse("12 or fewer credits");
    expect(intent.hard.creditMax).toBe(12);
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

describe("parser: courses", () => {
  test("wanted list with cue carry-over", () => {
    const { intent } = parse("I need to take CSCE 4110 and MATH 1710");
    expect(intent.hard.wantedCourses).toEqual(["CSCE 4110", "MATH 1710"]);
  });

  test("avoided list with cue carry-over", () => {
    const { intent } = parse("avoid BIOL 2041 and CHEM 2370");
    expect(intent.hard.avoidedCourses).toEqual(["BIOL 2041", "CHEM 2370"]);
  });

  test("a course code with no cue is neither wanted nor avoided", () => {
    const { intent } = parse("CSCE 4110");
    expect(intent.hard.wantedCourses).toEqual([]);
    expect(intent.hard.avoidedCourses).toEqual([]);
  });
});

describe("parser: instructor", () => {
  test("named instructor keeps name and strength", () => {
    const { intent, notUnderstood } = parse("prefer professor Smith");
    expect(intent.instructor).toEqual({ kind: "named", name: "Smith", strength: "mild" });
    expect(notUnderstood).toEqual([]);
  });

  test("avoiding a professor is tagged unsupported, not a named preference", () => {
    const { intent, notUnderstood } = parse("avoid professor Boyd");
    expect(intent.instructor).toBeNull();
    expect(notUnderstood.map((n) => n.tag)).toEqual(["avoidInstructor"]);
  });

  test("'no class with professor Boyd' is also an avoidance", () => {
    const { intent, notUnderstood } = parse("no class with professor Boyd");
    expect(intent.instructor).toBeNull();
    expect(notUnderstood.map((n) => n.tag)).toContain("avoidInstructor");
  });
});

describe("parser: soft preferences", () => {
  test("intensifier reads as strong", () => {
    const { intent } = parse("I really want my classes spread out");
    expect(intent.soft).toContainEqual({ key: "spreadOut", strength: "strong" });
  });

  test("plain phrasing reads as mild", () => {
    const { intent } = parse("minimal walking please");
    expect(intent.soft).toContainEqual({ key: "minimalWalking", strength: "mild" });
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
    expect(notUnderstood).toEqual([
      { start: 0, end: 6, text: "I want", reason: "unparseable" },
    ]);
  });

  test("chatter produces neither intent fields nor complaints", () => {
    const { intent, notUnderstood } = parse("hey there");
    expect(intent).toEqual(emptyIntent());
    expect(notUnderstood).toEqual([]);
  });
});

describe("mapping: toPlannerPreferences", () => {
  test("weekday constraints land; weekend constraints are dropped with a note-worthy absence", () => {
    const intent = emptyIntent();
    intent.hard.daysOff = ["Mon", "Sun"];
    intent.hard.blockedTimes = [
      { day: "Fri", start: 720, end: 780, label: "lunch" },
      { day: "Sat", start: 720, end: 780, label: "lunch" },
    ];
    const prefs = toPlannerPreferences(intent);
    expect(prefs.constraints.daysOff).toEqual(["Mon"]);
    expect(prefs.constraints.blocked).toEqual([
      { id: "blocked-1", label: "lunch", day: "Fri", start: 720, end: 780 },
    ]);
  });

  test("unlabeled blocked times get the default label", () => {
    const intent = emptyIntent();
    intent.hard.blockedTimes = [{ day: "Tue", start: 600, end: 660 }];
    const prefs = toPlannerPreferences(intent);
    expect(prefs.constraints.blocked[0].label).toBe("kept free");
  });

  test("creditMax maps to maxCredits; creditMin has no planner home", () => {
    const intent = emptyIntent();
    intent.hard.creditMin = 12;
    intent.hard.creditMax = 18;
    const prefs = toPlannerPreferences(intent);
    expect(prefs.constraints.maxCredits).toBe(18);
    expect(Object.hasOwn(prefs.constraints, "creditMin")).toBe(false);
  });

  test("openSeatsOnly defaults to false when unset", () => {
    const prefs = toPlannerPreferences(emptyIntent());
    expect(prefs.constraints.openSeatsOnly).toBe(false);
  });

  test("campus scope maps onto otherSites", () => {
    const intent = emptyIntent();
    intent.hard.campusScope = "otherSitesOk";
    expect(toPlannerPreferences(intent).constraints.otherSites).toBe(true);
    intent.hard.campusScope = "dentonOnly";
    expect(toPlannerPreferences(intent).constraints.otherSites).toBe(false);
  });

  test("soft strength maps to the documented weights", () => {
    const intent = emptyIntent();
    intent.soft = [
      { key: "compact", strength: "strong" },
      { key: "minimalWalking", strength: "mild" },
    ];
    const prefs = toPlannerPreferences(intent);
    expect(prefs.weights.compact).toBe(4);
    expect(prefs.weights.walking).toBe(2);
    expect(prefs.weights.fewerDays).toBe(0);
  });

  test("spreadOut has no planner term and maps to nothing", () => {
    const intent = emptyIntent();
    intent.soft = [{ key: "spreadOut", strength: "strong" }];
    const prefs = toPlannerPreferences(intent);
    expect(prefs.weights).toEqual(toPlannerPreferences(emptyIntent()).weights);
  });

  test("unmapped hard fields (mode, creditMin, wantedCourses) change nothing", () => {
    const intent = emptyIntent();
    intent.hard.mode = "online";
    intent.hard.creditMin = 12;
    intent.hard.wantedCourses = ["CSCE 4110"];
    expect(toPlannerPreferences(intent)).toEqual(toPlannerPreferences(emptyIntent()));
  });

  test("mapping is pure: same intent in, same preferences out", () => {
    const intent = emptyIntent();
    intent.hard.latestEnd = 900;
    intent.hard.blockedTimes = [{ day: "Mon", start: 600, end: 660, label: "work" }];
    const a = toPlannerPreferences(intent);
    const b = toPlannerPreferences(intent);
    expect(a).toEqual(b);
    // The input intent is not mutated by mapping.
    expect(intent.hard.blockedTimes[0]).toEqual({ day: "Mon", start: 600, end: 660, label: "work" });
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
