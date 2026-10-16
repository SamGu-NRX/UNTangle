import { describe, expect, test } from "bun:test";
import { optimize } from "@/lib/optimizer/optimize";
import { costTerms, neutralRatingTenths, UNKNOWN_WALK_SECONDS, type CostTerms } from "@/lib/optimizer/score";
import type { OptimizeRequest, OptWalkingTime, OptWeights, RankedSchedule } from "@/lib/optimizer/types";
import { normalizeCourse } from "@/lib/grades-history/normalize";
import type { CourseHistory, GradeCounts } from "@/lib/grades-history/types";
import type { Section } from "@/lib/sections/model";
import { scheduleReasons } from "@/lib/reasons";
import type { Reason, ScheduleReasonsInput, StatedPreference } from "@/lib/reasons/types";

/** How Week names options; the engine takes names from its caller. */
const optionName = (index: number) => `option ${index + 1}`;
import { FIRST_HALF, SECOND_HALF } from "../optimizer/generator";

type Course = OptimizeRequest["courses"][number];
type Meeting = Course["sections"][number]["meetings"][number];
type Day = Meeting["day"];

const zeroWeights: OptWeights = { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 };
const noConstraints = { earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null, walking: null };

function section(id: string, courseCode: string, meetings: Meeting[], rating: number | null = 4, label?: string): Course["sections"][number] {
  return { id, courseCode, rating, meetings, ...(label ? { label } : {}) };
}

function course(code: string, sections: Course["sections"]): Course {
  return { code, credits: 3, sections };
}

function request(courses: Course[], weights: Partial<OptWeights>, overrides: Partial<OptimizeRequest> = {}): OptimizeRequest {
  return {
    courses,
    locks: {},
    excluded: [],
    constraints: noConstraints,
    weights: { ...zeroWeights, ...weights },
    walkingTime: () => ({ seconds: 960, source: "campus-network" }),
    ...overrides,
  };
}

function at(day: Day, start: number, end: number, buildingId: string | null = "LANG"): Meeting {
  return { day, start, end, buildingId };
}

function dated(day: Day, start: number, end: number, dates: { start: string; end: string }): Meeting {
  return { ...at(day, start, end), dates };
}

/** Known legs by "FROM>TO"; every other pair is unknown. */
function legs(known: Record<string, number>): (from: string, to: string) => OptWalkingTime {
  return (from, to) => {
    const seconds = known[`${from}>${to}`];
    return seconds === undefined ? { seconds: null, source: "unknown" } : { seconds, source: "campus-network" };
  };
}

function optimal(req: OptimizeRequest): RankedSchedule[] {
  const result = optimize(req);
  if (result.status !== "optimal") throw new Error(`expected optimal, got ${result.status}`);
  return result.schedules;
}

function termsOf(req: OptimizeRequest, schedule: RankedSchedule): CostTerms {
  const sections = req.courses.map((c) => c.sections.find((s) => s.id === schedule.byCourse[c.code])!);
  return costTerms({
    sections,
    term: req.term,
    creditsByCourse: Object.fromEntries(req.courses.map((c) => [c.code, c.credits])),
    neutralRatingByCourse: Object.fromEntries(req.courses.map((c) => [c.code, neutralRatingTenths(c.sections)])),
    weights: req.weights,
    walkingTime: req.walkingTime,
  });
}

/** The optimizer's cost term per preference: lower is better for all of them. */
const COST_TERM: Record<StatedPreference, (t: CostTerms) => number> = {
  fewerDays: (t) => t.daysOnCampus,
  compact: (t) => t.gapMinutes,
  mornings: (t) => t.morningLeanMinutes,
  evenings: (t) => t.eveningLeanMinutes,
  walking: (t) => t.knownTravelSeconds + UNKNOWN_WALK_SECONDS * t.unknownWalks,
  rating: (t) => t.ratingShortfallTenths,
};

/** The word a sentence must use when this option's term is lower (better), then higher (worse). */
const DIRECTION: Record<StatedPreference, [string, string]> = {
  fewerDays: ["fewer", "more"],
  compact: ["shorter", "longer"],
  mornings: ["earlier", "later"],
  evenings: ["later", "earlier"],
  walking: ["less", "more"],
  rating: ["higher", "lower"],
};

/** Numbers in a sentence, ignoring course codes like "MATH 1650" and option names like "option 2" (identifiers, not quantities). */
function numericTokens(text: string): number[] {
  return [...text.replace(/[A-Z]{2,4}\s\d+[A-Z]?/g, " ").replace(/option \d+/gi, " ").matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));
}

function check(req: OptimizeRequest, alternatives: RankedSchedule[], index: number, reason: Reason): void {
  const { sentence } = reason;
  expect(sentence).toMatch(/^[A-Z0-9].*\.$/);
  expect(sentence).not.toMatch(/[;·•|()]/);
  expect(reason.evidence.numbers.length).toBeGreaterThan(0);
  const allowed = new Set(reason.evidence.numbers.flatMap((entry) => (typeof entry.value === "number" ? [entry.value] : numericTokens(entry.value))));
  for (const token of numericTokens(sentence)) {
    expect(allowed.has(token), `${token} is not in the evidence of: ${sentence}`).toBe(true);
  }
  if (reason.kind !== "comparison" && reason.kind !== "trade-off") return;
  // Direction: the sentence must point the way the optimizer's own term does.
  const other = Number(/option (\d+)/.exec(sentence)![1]) - 1;
  const preference = reason.preference!;
  const mine = COST_TERM[preference](termsOf(req, alternatives[index]));
  const theirs = COST_TERM[preference](termsOf(req, alternatives[other]));
  expect(mine, `no difference behind: ${sentence}`).not.toBe(theirs);
  const [right, wrong] = mine < theirs ? DIRECTION[preference] : [...DIRECTION[preference]].reverse();
  expect(reason.kind).toBe(mine < theirs ? "comparison" : "trade-off");
  expect(sentence, `wrong direction in: ${sentence}`).toContain(` ${right} `);
  expect(sentence).not.toContain(` ${wrong} `);
}

/** Reasons for every option, each checked. */
function reasonsFor(req: OptimizeRequest, extra: Omit<ScheduleReasonsInput, "alternatives" | "request" | "index" | "optionName"> = {}): Reason[][] {
  const alternatives = optimal(req);
  return alternatives.map((_, index) => {
    const reasons = scheduleReasons({ alternatives, request: req, index, optionName, ...extra });
    for (const reason of reasons) check(req, alternatives, index, reason);
    return reasons;
  });
}

const sentences = (reasons: Reason[]) => reasons.map((reason) => reason.sentence);
const about = (reasons: Reason[], preference: StatedPreference) => reasons.filter((reason) => reason.preference === preference);

// {s1, c1} has no gap and no travel (both LANG); {s0, c0} is back to back
// across buildings (LANG to LAB, 960 s); the other pairs leave gaps.
const walkingRequest = () =>
  request(
    [
      course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600)]), section("s1", "MATH 1650", [at("Mon", 780, 840)])]),
      course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")]), section("c1", "CHEM 2370", [at("Mon", 840, 900)])]),
    ],
    { compact: 1, walking: 2 },
    { walkingTime: legs({ "LANG>LANG": 0, "LANG>LAB": 960 }) },
  );

// The winner is one day on campus with a 2-hour gap; the runner-up is two
// days with no gap.
const rankedFirstRequest = (weights: Partial<OptWeights>) =>
  request(
    [
      course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600)])]),
      course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 720, 780)]), section("c1", "CHEM 2370", [at("Tue", 540, 600)])]),
    ],
    weights,
  );

// One section, four stated preferences: four facts.
const fourFactsRequest = () =>
  request([course("MATH 1650", [section("s0", "MATH 1650", [at("Tue", 480, 540), at("Thu", 480, 540)], 4, "002")])], {
    fewerDays: 1,
    compact: 1,
    mornings: 1,
    rating: 1,
  });

describe("scheduleReasons", () => {
  test("a comparison is relative to the next actual option, named as the UI names it", () => {
    const [first] = reasonsFor(walkingRequest());
    const walking = about(first, "walking");
    expect(walking.length).toBe(1);
    expect(walking[0].sentence).toBe("Travel between back-to-back classes takes 16 minutes less than in option 2.");
    expect(walking[0].kind).toBe("comparison");
    expect(about(first, "compact").map((reason) => reason.kind)).toEqual(["preference-met"]);
  });

  test("options are named by the caller, in the sentence and its evidence", () => {
    const req = walkingRequest();
    const alternatives = optimal(req);
    const named = (index: number) => ["the first week", "the second week", "the third week"][index];
    const [walking] = scheduleReasons({ alternatives, request: req, index: 0, optionName: named }).filter((reason) => reason.preference === "walking");
    expect(walking.sentence).toBe("Travel between back-to-back classes takes 16 minutes less than in the second week.");
    expect(walking.evidence.numbers.map((entry) => entry.label)).toEqual([
      "The first week: known travel seconds",
      "The second week: known travel seconds",
      "difference as quoted",
    ]);
    expect(walking.sentence).not.toMatch(/Option [A-Z]/);
  });

  test("a ranked-first schedule still names what it gives up", () => {
    const [first] = reasonsFor(rankedFirstRequest({ fewerDays: 3, compact: 1 }));
    expect(sentences(first)).toEqual(["Your classes fall on 1 fewer weekday than in option 2.", "Time between classes is 120 minutes longer than in option 2."]);
    expect(first.map((reason) => reason.kind)).toEqual(["comparison", "trade-off"]);
  });

  test("without the next option, the same schedule gets facts about itself on each stated preference, strongest first", () => {
    // Week's Details: the student sees option 1 beside their own week, maybe never option 2.
    const [first] = reasonsFor(rankedFirstRequest({ fewerDays: 3, compact: 1 }), { compareWithNext: false });
    expect(sentences(first)).toEqual(["Your classes fall on Monday.", "Time between classes adds up to 120 minutes."]);
    expect(first.some((reason) => reason.kind === "comparison" || reason.kind === "trade-off")).toBe(false);
    expect(sentences(first).join(" ")).not.toContain("option");
  });

  test("reasons rank by weight times the optimizer's cost per unit times the difference", () => {
    // 3 x 3600 for a day beats 1 x 60 x 120 for the gap; flipped weights flip the order.
    expect(reasonsFor(rankedFirstRequest({ fewerDays: 3, compact: 1 }))[0].map((reason) => reason.preference)).toEqual(["fewerDays", "compact"]);
    expect(reasonsFor(rankedFirstRequest({ fewerDays: 1, compact: 4 }))[0].map((reason) => reason.preference)).toEqual(["compact", "fewerDays"]);
  });

  test("days on campus are named", () => {
    const [only] = reasonsFor(fourFactsRequest());
    expect(sentences(only)).toContain("Your classes fall on Tuesday and Thursday.");
  });

  test("dated sessions: days are named, and no reason claims a week", () => {
    const req = request(
      [
        course("MATH 1650", [section("s0", "MATH 1650", [dated("Mon", 540, 600, FIRST_HALF)])]),
        course("CHEM 2370", [section("c0", "CHEM 2370", [dated("Wed", 540, 600, SECOND_HALF)])]),
      ],
      { fewerDays: 1 },
      { term: { start: "2027-01-11", end: "2027-05-07" } },
    );
    const [only] = reasonsFor(req);
    expect(sentences(only)).toEqual(["Your classes fall on Monday and Wednesday."]);
  });

  test("weekdays are not compared across different sessions", () => {
    // option 2 meets Monday in the first half and Wednesday in the second:
    // two weekdays, but one day a week, like option 1's Monday all term.
    const req = request(
      [
        course("MATH 1650", [
          section("s0", "MATH 1650", [dated("Mon", 540, 600, FIRST_HALF), dated("Wed", 540, 600, SECOND_HALF)]),
          section("s1", "MATH 1650", [at("Mon", 600, 660)]),
        ]),
      ],
      { fewerDays: 1 },
      { term: { start: "2027-01-11", end: "2027-05-07" } },
    );
    const [first] = reasonsFor(req);
    expect(first.map((reason) => [reason.sentence, reason.kind])).toEqual([["Your classes fall on Monday.", "fact"]]);
  });

  test("at most three reasons by default, and maxReasons is honored or rejected", () => {
    const req = fourFactsRequest();
    const base = { alternatives: optimal(req), request: req, index: 0, optionName };
    expect(scheduleReasons(base).length).toBe(3);
    expect(scheduleReasons({ ...base, maxReasons: 4 }).length).toBe(4);
    expect(scheduleReasons({ ...base, maxReasons: 0 })).toEqual([]);
    expect(() => scheduleReasons({ ...base, maxReasons: -1 })).toThrow("reasons: maxReasons must be a non-negative integer");
    expect(() => scheduleReasons({ ...base, maxReasons: Number.NaN })).toThrow("reasons: maxReasons must be a non-negative integer");
  });

  test("with no stated preferences and nothing supplied, there is nothing to say", () => {
    const req = request([course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 480, 540)])])], {});
    expect(reasonsFor(req)).toEqual([[]]);
  });

  test("an index outside the alternatives is a programming error", () => {
    const req = walkingRequest();
    const base = { alternatives: optimal(req), request: req, optionName };
    expect(() => scheduleReasons({ ...base, index: -1 })).toThrow("reasons: index must point at one of the alternatives");
    expect(() => scheduleReasons({ ...base, index: base.alternatives.length })).toThrow("reasons: index must point at one of the alternatives");
  });

  describe("unknown travel", () => {
    test("an unroutable same-building transfer remains unknown in both cost and reasons", () => {
      const req = request([
        course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600, "ntdp")])]),
        course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 600, 660, "ntdp")])]),
      ], { walking: 1 }, { walkingTime: legs({}) });
      expect(optimal(req)[0]).toMatchObject({ cost: 600, breakdown: { unknownWalks: 1, walkSeconds: 0 } });
      expect(sentences(reasonsFor(req)[0])).toEqual(["1 walk between back-to-back classes has no known time."]);

      const routable = { ...req, walkingTime: legs({ "ntdp>ntdp": 0 }) };
      expect(optimal(routable)[0]).toMatchObject({ cost: 0, breakdown: { unknownWalks: 0, walkSeconds: 0 } });
      expect(sentences(reasonsFor(routable)[0])).toEqual(["There is no travel between back-to-back classes."]);
    });

    // MATH meets Mon to Wed in LANG; CHEM's c0 follows it in SCI (300 s),
    // c1 follows it in LAB (960 s) and in a building with no route.
    const atLeastRequest = (c1: Meeting[], c0: Meeting[] = [at("Mon", 600, 660, "SCI")], weights: Partial<OptWeights> = { walking: 2 }) =>
      request(
        [
          course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600), at("Tue", 540, 600), at("Wed", 540, 600)])]),
          course("CHEM 2370", [section("c0", "CHEM 2370", c0), section("c1", "CHEM 2370", c1)]),
        ],
        weights,
        { walkingTime: legs({ "LANG>SCI": 300, "LANG>LAB": 960 }) },
      );

    test("at least is bounded by the other option's known travel", () => {
      const [first, second] = reasonsFor(atLeastRequest([at("Tue", 600, 660, "LAB"), at("Wed", 600, 660, "GHOST")]));
      // 960 known seconds against 300: at least 11 minutes, whatever the unknown walk takes.
      expect(sentences(about(first, "walking"))).toEqual(["Travel between back-to-back classes takes at least 11 minutes less than in option 2."]);
      // option 2 quotes only what is known, and says what is not.
      expect(about(second, "walking").map((reason) => [reason.sentence, reason.kind])).toEqual([
        ["Travel between back-to-back classes adds up to 16 minutes, not counting 1 walk with no known time.", "fact"],
      ]);
    });

    test("no comparison when the other option's unknown walk could be shorter", () => {
      const [first, second] = reasonsFor(atLeastRequest([at("Tue", 600, 660, "GHOST")]));
      expect(about(first, "walking").map((reason) => [reason.sentence, reason.kind])).toEqual([["Travel between back-to-back classes adds up to 5 minutes.", "fact"]]);
      expect(sentences(about(second, "walking"))).toEqual(["1 walk between back-to-back classes has no known time."]);
    });

    test("no claim when both options have unknown walks", () => {
      const [first, second] = reasonsFor(atLeastRequest([at("Tue", 600, 660, "LAB"), at("Wed", 600, 660, "GHOST")], [at("Mon", 600, 660, "GHOST")]));
      expect(about(first, "walking").map((reason) => [reason.sentence, reason.kind])).toEqual([["1 walk between back-to-back classes has no known time.", "fact"]]);
      expect(about(second, "walking").map((reason) => reason.kind)).toEqual(["fact"]);
    });

    test("this option's known travel above the other's exact travel is at least that much more", () => {
      // option 1 wins on weekdays (3 against option 2's 4, which adds
      // Thursday). Its 960 known seconds plus an unknown walk, against Option
      // B's 300, is at least 11 minutes more.
      const req = atLeastRequest([at("Mon", 600, 660, "SCI"), at("Thu", 600, 660)], [at("Mon", 600, 660, "LAB"), at("Tue", 600, 660, "GHOST")], { fewerDays: 4, walking: 1 });
      const [first] = reasonsFor(req);
      expect(about(first, "walking").map((reason) => [reason.sentence, reason.kind])).toEqual([
        ["Travel between back-to-back classes takes at least 11 minutes more than in option 2.", "trade-off"],
      ]);
    });

    test("an option with only unknown walks is never the best for walking", () => {
      const req = request(
        [course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600)])]), course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 600, 660, "LAB")])])],
        { walking: 2 },
        { walkingTime: legs({}) },
      );
      const [only] = reasonsFor(req);
      expect(only.map((reason) => [reason.sentence, reason.kind])).toEqual([["1 walk between back-to-back classes has no known time.", "fact"]]);
    });
  });

  describe("evenings", () => {
    test("a later-ending option is described as ending later", () => {
      // Lean before 10 PM: s0 ends 7 PM (180 minutes), s1 ends 11 AM (660).
      const req = request([course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 1080, 1140)]), section("s1", "MATH 1650", [at("Tue", 600, 660)])])], {
        evenings: 2,
      });
      const [first, second] = reasonsFor(req);
      expect(first.map((reason) => [reason.sentence, reason.kind])).toEqual([["On average its classes end 480 minutes later than option 2's.", "comparison"]]);
      expect(sentences(second)).toEqual(["Your latest class ends at 11 AM."]);
    });

    test("an earlier-ending option ranked first for fewer days names the trade-off, averaged per class", () => {
      // MATH ends 11 AM against 7 PM; CHEM is the same in both: 480 minutes over 2 classes.
      const req = request(
        [
          course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 600, 660)]), section("s1", "MATH 1650", [at("Tue", 1080, 1140)])]),
          course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 540, 600)])]),
        ],
        { fewerDays: 4, evenings: 1 },
      );
      const [first] = reasonsFor(req);
      expect(first.map((reason) => [reason.sentence, reason.kind])).toEqual([
        ["Your classes fall on 1 fewer weekday than in option 2.", "comparison"],
        ["On average its classes end 240 minutes earlier than option 2's.", "trade-off"],
      ]);
    });
  });

  test("mornings compare the optimizer's mean-start lean, not the earliest start", () => {
    // Earliest starts differ by 60 minutes; mean starts (8 AM and noon,
    // against 9 AM and 12:30 PM) by 45, which is what the optimizer scores.
    const req = request(
      [
        course("MATH 1650", [
          section("s0", "MATH 1650", [dated("Mon", 480, 540, FIRST_HALF), dated("Wed", 720, 780, SECOND_HALF)]),
          section("s1", "MATH 1650", [dated("Mon", 540, 600, FIRST_HALF), dated("Wed", 750, 810, SECOND_HALF)]),
        ]),
      ],
      { mornings: 4 },
      { term: { start: "2027-01-11", end: "2027-05-07" } },
    );
    const [first] = reasonsFor(req);
    expect(sentences(first)).toEqual(["On average its classes start 45 minutes earlier than option 2's."]);
  });

  test("no time-of-day comparison when 7 AM or 10 PM cuts a class's value to 0", () => {
    // The optimizer counts a 6 AM start as 0 minutes after 7 AM, so the
    // difference it scores (180) is not the one a student would count (240).
    const lean = (weights: Partial<OptWeights>, s0: Meeting, s1: Meeting) =>
      reasonsFor(request([course("MATH 1650", [section("s0", "MATH 1650", [s0]), section("s1", "MATH 1650", [s1])])], weights))[0];
    expect(lean({ mornings: 1 }, at("Mon", 360, 420), at("Tue", 600, 660)).map((reason) => [reason.sentence, reason.kind])).toEqual([
      ["Your earliest class starts at 6 AM.", "fact"],
    ]);
    expect(lean({ evenings: 1 }, at("Mon", 1320, 1380), at("Tue", 1080, 1140)).map((reason) => [reason.sentence, reason.kind])).toEqual([
      ["Your latest class ends at 11 PM.", "fact"],
    ]);
  });

  describe("rating", () => {
    // Two courses that both vary, so the options differ in both.
    const ratingRequest = (chemRating: number | null) =>
      request(
        [
          course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600)], 5), section("s1", "MATH 1650", [at("Tue", 540, 600)], 4)]),
          course("CHEM 2370", [section("c0", "CHEM 2370", [at("Mon", 660, 720)], chemRating), section("c1", "CHEM 2370", [at("Tue", 660, 720)], 4)]),
        ],
        { rating: 4 },
      );

    test("the comparison is the average per course", () => {
      // 5 and 5 against 4 and 4: a sum of 2 points over 2 courses.
      const [first, second] = reasonsFor(ratingRequest(5));
      expect(sentences(first)).toEqual(["Its instructors' ratings average 1 point higher than option 2's."]);
      expect(sentences(second)).toEqual(["Its instructors average a rating of 4 across 2 rated sections."]);
    });

    test("nothing about ratings when no option has one", () => {
      const req = request([course("MATH 1650", [section("s0", "MATH 1650", [at("Mon", 540, 600)], null), section("s1", "MATH 1650", [at("Tue", 540, 600)], null)])], {
        rating: 1,
      });
      expect(reasonsFor(req)).toEqual([[], []]);
    });

    test("no comparison against an option that relies on a fill-in rating", () => {
      // c0 is unrated; the course mean (4) fills in for it in the optimizer.
      const [first, second] = reasonsFor(ratingRequest(null));
      expect(first.map((reason) => [reason.sentence, reason.kind])).toEqual([["Its instructors average a rating of 5 across 1 rated section.", "fact"]]);
      expect(second.map((reason) => reason.kind)).toEqual(["fact"]);
    });
  });

  describe("seat warnings", () => {
    const catalog = (status: Section["status"], open: number | null, total: number | null): Pick<Section, "status" | "components"> => ({
      status,
      components: [{ id: "x", classNumber: null, sectionCode: "002", role: "primary", instructor: { display: null, raw: "" }, seats: { open, total }, meetings: [] }],
    });
    const warn = (seat: Pick<Section, "status" | "components">, maxReasons?: number) => {
      const req = fourFactsRequest();
      const alternatives = optimal(req);
      const reasons = scheduleReasons({ alternatives, request: req, index: 0, optionName, seats: { s0: seat }, maxReasons });
      for (const reason of reasons) check(req, alternatives, 0, reason);
      return reasons;
    };

    test("closed, wait-listed, cancelled and full sections always appear, outside the top three", () => {
      expect(sentences(warn(catalog("closed", null, null)))[0]).toBe("Section 002 of MATH 1650 is closed.");
      expect(sentences(warn(catalog("cancelled", null, null)))[0]).toBe("Section 002 of MATH 1650 is cancelled.");
      expect(sentences(warn(catalog("waitlist", 0, 30)))[0]).toBe("Section 002 of MATH 1650 is wait-listed.");
      const full = warn(catalog("open", 0, 30));
      expect(full[0].sentence).toBe("Section 002 of MATH 1650 has no open seats.");
      expect(full.length).toBe(4);
      expect(sentences(warn(catalog("open", 0, 30), 0))).toEqual(["Section 002 of MATH 1650 has no open seats."]);
    });

    test("open seats and unknown seats say nothing", () => {
      expect(warn(catalog("open", 1, 30)).some((reason) => reason.kind === "seats")).toBe(false);
      expect(warn(catalog("unknown", null, null)).some((reason) => reason.kind === "seats")).toBe(false);
    });
  });

  describe("grade history", () => {
    const instructor = { id: "x", firstName: "Ada", lastName: "Byron", name: "Ada Byron" };
    const history = (sections: GradeCounts[], number = "2040"): CourseHistory =>
      normalizeCourse(
        { subject: "BIOL", number, title: "Genetics" },
        sections.map((counts, i) => ({ sectionNumber: String(i + 1).padStart(3, "0"), instructor, year: "2025", term: "Fall", counts })),
      );
    const req = () => request([course("BIOL 2040", [section("b0", "BIOL 2040", [at("Mon", 540, 600)], 4, "001")])], {});
    const gradeReasons = (h: CourseHistory) => {
      const alternatives = optimal(req());
      const reasons = scheduleReasons({ alternatives, request: req(), index: 0, optionName, instructorGradeHistory: { b0: h } });
      for (const reason of reasons) check(req(), alternatives, 0, reason);
      return reasons;
    };

    test("three sections graded A through F describe the past, on an A through F denominator", () => {
      const reasons = gradeReasons(history([{ A: 30, B: 10, C: 5, D: 3, F: 2, W: 20 }, { A: 20, B: 12, C: 10, D: 4, F: 4 }, { A: 1, B: 0, C: 0, D: 0, F: 0 }]));
      // (51 A + 22 B) of 101 graded A through F; the 20 withdrawals are not in it.
      expect(sentences(reasons)).toEqual(["Section 001's instructor gave an A or B to 72% of graded students in 3 past sections of BIOL 2040."]);
    });

    test("fewer than three sections graded A through F say nothing, however many students", () => {
      expect(gradeReasons(history([{ A: 300, B: 100, C: 50, D: 0, F: 0 }, { A: 200, B: 100, C: 0, D: 0, F: 0 }, { A: 0, B: 0, C: 0, D: 0, F: 0, W: 30 }]))).toEqual([]);
    });

    test("history for another course is a programming error", () => {
      expect(() => gradeReasons(history([{ A: 1 }], "2050"))).toThrow("reasons: grade history for BIOL 2050 was given for section b0 of BIOL 2040");
    });
  });
});

describe("instructor evidence tie-break", () => {
  const evidenceSection = (id: string, courseCode: string, meetings: Meeting[], gpa: number | null | undefined): Course["sections"][number] => ({
    id,
    courseCode,
    rating: null,
    meetings,
    ...(gpa === undefined ? {} : { instructorGpa: gpa }),
  });

  // The engine's tie grid: both cheap plans cost 200 (10 lean minutes at
  // weight 1), and the winner's ECON instructor averaged 3.9 against 2.9
  // for the runner-up's. Sections at different times are never twins.
  // mathGpa fills math-001; math-002 stays without evidence, so with the
  // default null the MATH course is omitted from the evidence tier for
  // every plan and ECON decides the tie alone.
  const tied = (mathGpa: number | null | undefined = null, mathGpa2: number | null | undefined = null) =>
    request(
      [
        course("ECON 1110", [evidenceSection("econ-a", "ECON 1110", [at("Mon", 480, 530)], 3.9), evidenceSection("econ-b", "ECON 1110", [at("Mon", 610, 660)], 2.9)]),
        course("MATH 1650", [evidenceSection("math-001", "MATH 1650", [at("Mon", 540, 590)], mathGpa), evidenceSection("math-002", "MATH 1650", [at("Mon", 670, 720)], mathGpa2)]),
      ],
      { compact: 1 },
    );

  test("an equal-cost tie won on grade history says so in plain words", () => {
    const req = tied();
    const alternatives = optimal(req);
    const reasons = scheduleReasons({ alternatives, request: req, index: 0, optionName });
    const tie = reasons.find((reason) => reason.kind === "grade-history" && reason.preference === null);
    expect(tie?.sentence).toBe("Students in this instructor's sections averaged a 3.9.");
    expect(tie?.evidence.numbers).toContainEqual({ label: "average grade points of sections with grade history", value: 3.9 });
    expect(tie?.evidence.numbers).toContainEqual({ label: "sections with grade history", value: 1 });
    for (const reason of reasons) check(req, alternatives, 0, reason);
  });

  test("two sections with grade history say these instructors' sections", () => {
    // Both MATH options need a gpa for the course to be evidence-eligible;
    // then the winner quotes the mean over both of its known sections.
    const req = tied(3.5, 3.5);
    const alternatives = optimal(req);
    const reasons = scheduleReasons({ alternatives, request: req, index: 0, optionName });
    const tie = reasons.find((reason) => reason.kind === "grade-history" && reason.preference === null);
    // (3.9 + 3.5) / 2 over the two known sections.
    expect(tie?.sentence).toBe("Students in these instructors' sections averaged a 3.7.");
    expect(tie?.evidence.numbers).toContainEqual({ label: "sections with grade history", value: 2 });
    for (const reason of reasons) check(req, alternatives, 0, reason);
  });

  test("no tie sentence when the winner has no known evidence", () => {
    // Every section's gpa is null or absent: no plan has any known
    // evidence, so there is nothing real to quote and the sentence stays
    // silent. Both spellings of "missing" are covered.
    const req = request(
      [
        course("ECON 1110", [evidenceSection("econ-a", "ECON 1110", [at("Mon", 480, 530)], null), evidenceSection("econ-b", "ECON 1110", [at("Mon", 610, 660)], undefined)]),
        course("MATH 1650", [evidenceSection("math-001", "MATH 1650", [at("Mon", 540, 590)], undefined), evidenceSection("math-002", "MATH 1650", [at("Mon", 670, 720)], null)]),
      ],
      { compact: 1 },
    );
    const alternatives = optimal(req);
    for (const schedule of alternatives.slice(0, 2)) {
      for (const entry of req.courses) {
        const picked = entry.sections.find((s) => s.id === schedule.byCourse[entry.code]);
        expect(picked?.instructorGpa === undefined || picked?.instructorGpa === null).toBe(true);
      }
    }
    const reasons = scheduleReasons({ alternatives, request: req, index: 0, optionName });
    expect(reasons.some((reason) => reason.kind === "grade-history" && reason.preference === null)).toBe(false);
  });

  test("no tie sentence when the costs differ", () => {
    const req = request(
      [
        course("ECON 1110", [evidenceSection("econ-a", "ECON 1110", [at("Mon", 480, 530)], 3.9), evidenceSection("econ-b", "ECON 1110", [at("Mon", 610, 660)], 2.9)]),
        course("MATH 1650", [evidenceSection("math-001", "MATH 1650", [at("Mon", 540, 590)], null), evidenceSection("math-002", "MATH 1650", [at("Mon", 690, 740)], null)]),
      ],
      { compact: 1 },
    );
    const alternatives = optimal(req);
    expect(alternatives[0]!.cost).not.toBe(alternatives[1]!.cost);
    const reasons = scheduleReasons({ alternatives, request: req, index: 0, optionName });
    expect(reasons.some((reason) => reason.kind === "grade-history" && reason.preference === null)).toBe(false);
  });
});
