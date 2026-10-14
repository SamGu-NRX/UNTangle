/**
 * Labeled phrase corpus for the schedule-preferences parser.
 *
 * Every entry is one phrase a student might type, paired with the exact
 * intent the parser must return: hard fields (all unspecified fields must
 * stay at their defaults — the no-invention rule), soft preferences (exact
 * set), unsupported tags (exact multiset), and, where the phrase leaves a
 * residual it cannot use, the exact number of unparseable spans.
 *
 * This corpus was developed alongside the parser: passing it demonstrates
 * coverage of the documented behaviors, not independence from them. The
 * held-out scoring mode in `eval.ts` (`--file=`) exists for phrases the
 * parser has not seen.
 */

import type { HardConstraints, SoftPreference } from "../../src/lib/preferences/schema";
import type { WeekDay } from "../../src/lib/types";
import { weekDays } from "../../src/lib/types";

/** What one corpus entry asserts about the parser's output. */
export type CorpusExpectation = {
  /** Hard fields with expected values. Every hard field NOT listed here must equal its default. */
  hard?: Partial<HardConstraints>;
  /** Soft preferences, compared as an exact set (key, strength, polarity). */
  soft?: SoftPreference[];
  /** Exact multiset of `reason: "unsupported"` tags in notUnderstood. */
  unsupportedTags?: string[];
  /** Exact number of `reason: "unparseable"` spans. Omit to leave the residual unconstrained. */
  unparseable?: number;
};

export type CorpusEntry = { id: string; input: string; expect: CorpusExpectation };

// ---------------------------------------------------------------------------
// Expectation helpers
// ---------------------------------------------------------------------------

/** Merge an extra expectation into a base one without dropping the base hard fields. */
const withExtra = (
  base: Partial<HardConstraints>,
  extra?: CorpusExpectation,
): CorpusExpectation => {
  if (!extra) return { hard: base };
  const { hard, ...rest } = extra;
  return { ...rest, hard: { ...base, ...(hard ?? {}) } };
};

const bt = (day: WeekDay, start: number, end: number, label?: string) => ({
  day,
  start,
  end,
  ...(label ? { label } : {}),
});

/** The same block on every planner weekday. */
const wd = (start: number, end: number, label?: string) => weekDays.map((d) => bt(d, start, end, label));

const onDays = (days: WeekDay[], start: number, end: number, label?: string) =>
  days.map((d) => bt(d, start, end, label));

const s = (key: SoftPreference["key"], strength: SoftPreference["strength"], positive = true): SoftPreference => ({
  key,
  strength,
  positive,
});

const e = (id: string, input: string, expect: CorpusExpectation): CorpusEntry => ({ id, input, expect });

// ---------------------------------------------------------------------------
// Family helpers — each pins the phrasings one behavior must accept
// ---------------------------------------------------------------------------

/** A weekly commitment block: exact blockedTimes, everything else default. */
const block = (input: string, items: ReturnType<typeof bt>[], extra?: CorpusExpectation): CorpusEntry =>
  e(`blocked/${items[0]?.start ?? 0}-${items.length}`, input, withExtra({ blockedTimes: items }, extra));

/** A day-off phrase: exact daysOff, everything else default. */
const dayOff = (input: string, days: readonly WeekDay[], extra?: CorpusExpectation): CorpusEntry =>
  e(`daysOff/${days.join("")}`, input, withExtra({ daysOff: [...days] }, extra));

/** An earliest-start bound. */
const earliest = (input: string, minutes: number | null, extra?: CorpusExpectation): CorpusEntry =>
  e(`earliest/${minutes}`, input, withExtra({ earliestStart: minutes }, extra));

/** A latest-end bound. */
const latest = (input: string, minutes: number | null, extra?: CorpusExpectation): CorpusEntry =>
  e(`latest/${minutes}`, input, withExtra({ latestEnd: minutes }, extra));

/** A phrase recognized as unsupported, tagged with its family. */
const tagged = (input: string, tags: string[], extra?: CorpusExpectation): CorpusEntry =>
  e(`tag/${tags.join("+")}`, input, withExtra({}, { unsupportedTags: tags, ...extra }));

/** A phrase recognized as a soft preference. */
const soft = (input: string, softs: SoftPreference[], extra?: CorpusExpectation): CorpusEntry =>
  e(`soft/${softs.map((x) => x.key).join("+")}`, input, withExtra({}, { soft: softs, ...extra }));

/** A phrase the parser cannot use at all: defaults in, residual out. */
const unparseable = (input: string, count = 1): CorpusEntry =>
  e("unparseable", input, { unparseable: count });

// ---------------------------------------------------------------------------
// 1. Weekly commitments (hard.blockedTimes)
// ---------------------------------------------------------------------------

export const BLOCKED: CorpusEntry[] = [
  block("I have work 8am to 4:30pm on Mondays and Wednesdays", onDays(["Mon", "Wed"], 480, 990, "work")),
  block("I work 9 to 5 on weekdays", wd(540, 1020, "work")),
  block("work Mondays 9 to 5", onDays(["Mon"], 540, 1020, "work")),
  block("I have shift on Friday 6am to 2pm", onDays(["Fri"], 360, 840, "shift")),
  block("shifts on Saturday are out of scope for me", [], { unsupportedTags: ["weekend"] }),
  block("keep 12-1 free on weekdays for lunch", wd(720, 780, "lunch")),
  block("keep 12 to 1 free on weekdays for lunch", wd(720, 780, "lunch")),
  block("keep 12-1 free for lunch on weekdays", wd(720, 780, "lunch")),
  block("block 2pm to 4pm for practice", wd(840, 960, "practice")),
  block("set aside 5pm to 7pm for dinner", wd(1020, 1140, "dinner")),
  block("reserve 10am to 11am for office hours", wd(600, 660, "office")),
  block("I work 7-1", wd(420, 780, "work")),
  block("I work 11 to 1", wd(660, 780, "work")),
  block("no 8am classes", wd(480, 540)),
  block("no 3pm classes", wd(900, 960)),
  block("no 8am classes on Tuesdays", onDays(["Tue"], 480, 540)),
  block("practice Tuesdays and Thursdays 3pm to 5pm", onDays(["Tue", "Thu"], 900, 1020, "practice")),
  block("rehearsal Wednesdays from 6pm to 9pm", onDays(["Wed"], 1080, 1260, "rehearsal")),
  block("I have clinicals Wednesdays 8am to noon", onDays(["Wed"], 480, 720, "clinicals")),
  block("lab rotation Thursdays from 1pm to 4pm", onDays(["Thu"], 780, 960, "lab rotation")),
  block("volunteering Fridays 1 to 4pm", onDays(["Fri"], 780, 960, "volunteering")),
  block("meetings Mondays 2 to 3pm", onDays(["Mon"], 840, 900, "meetings")),
  block("training Tuesdays 7am to 8am", onDays(["Tue"], 420, 480, "training")),
  block("my shift is 10pm to midnight on Fridays", onDays(["Fri"], 1320, 1440, "shift")),
  block("I babysit 3 to 5 on weekdays", [], { unsupportedTags: ["ambiguousTime"] }),
  block("keep 9am to 10am blocked for coffee chat", wd(540, 600, "coffee")),
  block("work from 9am until 1pm on MWF", onDays(["Mon", "Wed", "Fri"], 540, 780, "work")),
  block("practice TR 4pm through 6pm", onDays(["Tue", "Thu"], 960, 1080, "practice")),
  block("I intern 9-5 Mondays", onDays(["Mon"], 540, 1020, "intern")),
  block("my job is 8am to 5pm on Tuesday and Thursday", onDays(["Tue", "Thu"], 480, 1020, "job")),
  block("I volunteer Saturdays, which the planner cannot use", [], { unsupportedTags: ["weekend"] }),
  block("keep 6pm to 8pm free for my study group", wd(1080, 1200, "study")),
  block("no noon classes", wd(720, 780)),
  block("no midnight classes", wd(0, 60)),
  tagged("no 9.30 classes", ["ambiguousTime"]),
  block("I have practice every weekday from 6am to 7am", wd(360, 420, "practice")),
  block("shift 4pm-11pm on Fridays", onDays(["Fri"], 960, 1380, "shift")),
  block("work Sunday morning", [], { unsupportedTags: ["weekend"] }),
  block("keep Monday 3pm to 6pm free for my lab", onDays(["Mon"], 900, 1080, "lab")),
  block("I work 8:30am to 12:30pm on Mondays and Fridays", onDays(["Mon", "Fri"], 510, 750, "work")),
  block("training Saturday 9 to 11", [], { unsupportedTags: ["ambiguousTime"] }),
  block("block 1pm to 2pm for lunch meetings", wd(780, 840, "lunch")),
  block("I have work 9am to 6pm on Wednesday", onDays(["Wed"], 540, 1080, "work")),
  block("keep my Fridays 12 to 2 free for errands", onDays(["Fri"], 720, 840, "errands")),
  block("set aside Tuesday and Thursday 7pm to 9pm for class rehearsal", onDays(["Tue", "Thu"], 1140, 1260, "class")),
  block("no 10am classes on Fridays", onDays(["Fri"], 600, 660)),
  block("no 9am classes", wd(540, 600)),
];

// ---------------------------------------------------------------------------
// 2. Days off (hard.daysOff)
// ---------------------------------------------------------------------------

export const DAYS_OFF: CorpusEntry[] = [
  dayOff("no classes on Fridays", ["Fri"]),
  dayOff("no classes Monday", ["Mon"]),
  dayOff("no classes on Tuesdays and Thursdays", ["Tue", "Thu"]),
  dayOff("don't schedule anything on Mondays", ["Mon"]),
  dayOff("don't schedule classes on Wednesdays", ["Wed"]),
  dayOff("keep my Wednesdays free", ["Wed"]),
  dayOff("keep Fridays free", ["Fri"]),
  dayOff("nothing on Thursdays", ["Thu"]),
  dayOff("nothing during Fridays", ["Fri"]),
  dayOff("Mondays are off", ["Mon"]),
  dayOff("Monday off", ["Mon"]),
  dayOff("Fridays are off for me", ["Fri"]),
  dayOff("I need Fridays off", ["Fri"]),
  dayOff("I want Tuesdays off", ["Tue"]),
  dayOff("skip Thursdays", ["Thu"]),
  dayOff("skip Mondays and Wednesdays", ["Mon", "Wed"]),
  dayOff("no classes on MWF", ["Mon", "Wed", "Fri"]),
  dayOff("no classes on TR", ["Tue", "Thu"]),
  dayOff("no Tuesday or Thursday classes", ["Tue", "Thu"]),
  dayOff("I don't want Friday classes", ["Fri"]),
  dayOff("avoid Wednesday classes", ["Wed"]),
  dayOff("no class on Monday, Tuesday, or Wednesday", ["Mon", "Tue", "Wed"]),
  dayOff("keep Monday free", ["Mon"]),
  tagged("keep my Thursday afternoons free", ["dayWithTime"]),
  tagged("no classes on Tuesday mornings", ["dayWithTime"]),
  tagged("no Friday classes before 10am", ["dayWithTime"]),
  dayOff("Mondays and Wednesdays are off", ["Mon", "Wed"]),
  tagged("I'd like to keep Tuesdays free", ["softDayOff"]),
  tagged("I would rather keep Thursdays free", ["softDayOff"]),
  dayOff("no Thursday classes", ["Thu"]),
  dayOff("I can't do classes on Mondays", ["Mon"]),
  dayOff("leave Fridays open", ["Fri"]),
  dayOff("leaving Wednesdays open", ["Wed"]),
  dayOff("no classes on weekdays", weekDays),
  dayOff("nothing on M T W R F", weekDays),
  dayOff("no classes Monday through Wednesday", ["Mon", "Tue", "Wed"]),
  dayOff("no classes Monday thru Friday", weekDays),
  dayOff("avoid Monday and Friday classes", ["Mon", "Fri"]),
  dayOff("I don't want classes on Tuesday", ["Tue"]),
  dayOff("no Wednesday sections", ["Wed"]),
  dayOff("no courses on Thursdays", ["Thu"]),
  dayOff("don't book anything on Fridays", ["Fri"]),
  dayOff("keep my Mondays completely free", ["Mon"]),
  dayOff("no Tuesday classes and no Thursday classes", ["Tue", "Thu"]),
];

// ---------------------------------------------------------------------------
// 3. Only-days (complement to daysOff)
// ---------------------------------------------------------------------------

export const ONLY_DAYS: CorpusEntry[] = [
  dayOff("only Tuesdays and Thursdays", ["Mon", "Wed", "Fri"]),
  dayOff("only on Mondays and Wednesdays", ["Tue", "Thu", "Fri"]),
  dayOff("only Fridays", ["Mon", "Tue", "Wed", "Thu"]),
  dayOff("MWF only", ["Tue", "Thu"]),
  dayOff("TR only", ["Mon", "Wed", "Fri"]),
  dayOff("only weekdays", []),
  dayOff("only show me Tuesday and Thursday classes", ["Mon", "Wed", "Fri"]),
  dayOff("only Wednesdays and Fridays", ["Mon", "Tue", "Thu"]),
  dayOff("only on TR", ["Mon", "Wed", "Fri"]),
  dayOff("only Monday/Wednesday/Friday", ["Tue", "Thu"]),
];

// ---------------------------------------------------------------------------
// 4. Earliest start (hard.earliestStart)
// ---------------------------------------------------------------------------

export const EARLIEST: CorpusEntry[] = [
  earliest("no classes before 10am", 600),
  earliest("nothing before 9am", 540),
  earliest("no classes before noon", 720),
  earliest("don't start before 8am", 480),
  earliest("don't start classes before 9:30am", 570),
  earliest("I can't start before 9am", 540),
  earliest("my first class can't be until noon", 720),
  earliest("first class can't start until 11am", 660),
  earliest("first class can't be before 10am", 600),
  earliest("earliest I can start is 9am", 540),
  earliest("earliest I can begin is 10am", 600),
  earliest("8am is too early", 481),
  earliest("9am is too early for me", 541),
  earliest("10am or before", 600),
  earliest("no classes before 10:30am", 630),
  earliest("nothing before 11am on weekdays", 660),
  earliest("can't take classes before 8am", 480),
  earliest("no classes earlier than 9am", 540),
  earliest("no classes earlier than noon", 720),
  earliest("can't begin before 1pm", 780),
  earliest("I can't start until 10am", 600),
  earliest("don't start until 11am", 660),
  earliest("my first class can't start until 2pm", 840),
  earliest("no classes before 8am, please", 480),
  earliest("nothing starts before 9am", 540),
  earliest("first class should not be until noon", 720),
  earliest("earliest start 9am", 540),
  earliest("8:00am is too early", 481),
  earliest("no classes before 9am or after 5pm", 540, { hard: { latestEnd: 1020 } }),
];

// ---------------------------------------------------------------------------
// 5. Latest end (hard.latestEnd)
// ---------------------------------------------------------------------------

export const LATEST: CorpusEntry[] = [
  latest("nothing after 3pm", 900),
  latest("no classes after 5pm", 1020),
  latest("no classes after 2:30pm", 870),
  latest("can't take classes past 4pm", 960),
  latest("not any later than 6pm", 1080),
  latest("I need to be done by 2pm", 840),
  latest("I have to be done by 3pm", 900),
  latest("I need to leave by 5pm", 1020),
  latest("done with class by 1pm", 780),
  latest("finished by 4pm", 960),
  latest("my last class must end by 4pm", 960),
  latest("classes must end by 6pm", 1080),
  latest("last class can't end later than 5pm", 1020),
  latest("4pm is too late", 959),
  latest("5pm is too late for me", 1019),
  latest("nothing later than 3pm", 900),
  latest("no classes after 4pm, please", 960),
  latest("I need to be out by 6pm", 1080),
  latest("I have to be gone by 5pm", 1020),
  latest("be home by 6pm", 1080),
  latest("home by 5pm", 1020),
  latest("nothing past noon", 720),
  latest("can't stay past 3pm", 900),
  latest("no classes after 4pm or before 9am", 960, { hard: { earliestStart: 540 } }),
  latest("I need to be done by noon", 720),
  latest("classes should end by 2pm", 840),
  latest("last class should end by 7pm", 1140),
  latest("my last class can't go past 5pm", 1020),
  latest("don't let classes run past 6pm", 1080),
  latest("nothing after 3:30pm", 930),
  latest("no classes later than 10am", 600),
  latest("I need to be done by 2pm on weekdays", 840),
  tagged("no classes after 5pm on Thursdays", ["dayWithTime"]),
  latest("6pm is too late", 1079),
];

// ---------------------------------------------------------------------------
// 6. Credit load (hard.creditMin / hard.creditMax)
// ---------------------------------------------------------------------------

const credits = (input: string, min: number | null, max: number | null, extra?: CorpusExpectation): CorpusEntry =>
  e(`credits/${min}-${max}`, input, { hard: { creditMin: min, creditMax: max }, ...extra });

export const CREDITS_CASES: CorpusEntry[] = [
  credits("I need 12 credit hours this semester", 12, null),
  credits("I need 12 credits", 12, null),
  credits("I need to take 15 credits", 15, null),
  credits("I must take 12 credit hours", 12, null),
  credits("I have to take 15 credits", 15, null),
  credits("taking 15 credits", 15, null),
  credits("at least 12 credits", 12, null),
  credits("no more than 15 credits", null, 15),
  credits("no more than 12 credit hours", null, 12),
  credits("at most 15 credits", null, 15),
  credits("15 credits max", null, 15),
  credits("15 credits or fewer", null, 15),
  credits("15 or fewer credits", null, 15),
  credits("12 or more credits", 12, null),
  credits("12 credits or more", 12, null),
  credits("exactly 15 credit hours", 15, 15),
  credits("between 12 and 15 credits", 12, 15),
  credits("12 to 15 credits", 12, 15),
  credits("12-15 credits", 12, 15),
  credits("fewer than 15 credits", null, 14),
  credits("less than 12 credits", null, 11),
  credits("more than 12 credits", 13, null),
  credits("15 credit hours max", null, 15),
  credits("9 credits minimum", 9, null),
  credits("up to 18 credits", null, 18),
  credits("I want exactly 12 credits", 12, 12),
  credits("12 credit hours or fewer", null, 12),
  credits("a minimum of 12 credits", 12, null),
  credits("a maximum of 15 credits", null, 15),
  credits("no more than 15 credits this semester", null, 15),
  credits("I don't want more than 15 credits", null, 15),
  credits("at least 12 credits and at most 18 credits", 12, 18),
  credits("I need 6 credit hours", 6, null),
  credits("exactly 12 credits, no more and no fewer", 12, 12),
  credits("12-15 credit hours", 12, 15),
  credits("between 12 and 15 credit hours", 12, 15),
];

// ---------------------------------------------------------------------------
// 7. Seat, campus and mode filters (hard.openSeatsOnly / campusScope / mode)
// ---------------------------------------------------------------------------

const seat = (input: string, extra?: CorpusExpectation): CorpusEntry =>
  e("seats", input, withExtra({ openSeatsOnly: true }, extra));

const campus = (input: string, value: "dentonOnly" | "otherSitesOk", extra?: CorpusExpectation): CorpusEntry =>
  e(`campus/${value}`, input, withExtra({ campusScope: value }, extra));

const mode = (input: string, value: "online" | "inPerson", extra?: CorpusExpectation): CorpusEntry =>
  e(`mode/${value}`, input, withExtra({ mode: value }, extra));

export const FILTERS: CorpusEntry[] = [
  seat("only show classes with open seats"),
  seat("only show classes I can actually get a seat in"),
  seat("open seats only"),
  seat("only classes with open seats"),
  seat("no full classes"),
  seat("no closed sections"),
  seat("no waitlisted courses"),
  seat("don't pick waitlisted sections"),
  seat("don't suggest full classes"),
  seat("make sure they have open seats"),
  seat("make sure it has open seats"),
  seat("nothing that is waitlisted"),
  seat("only the ones with open seats"),
  seat("only sections that still have open seats"),
  campus("Denton campus only", "dentonOnly"),
  campus("main campus only", "dentonOnly"),
  campus("only the Denton campus", "dentonOnly"),
  campus("Denton only", "dentonOnly"),
  campus("keep me at the main campus", "dentonOnly"),
  campus("keep me on Denton campus", "dentonOnly"),
  campus("no Frisco", "dentonOnly"),
  campus("Frisco is too far", "dentonOnly"),
  campus("don't schedule me in Frisco", "dentonOnly"),
  campus("no campuses outside Denton", "dentonOnly"),
  campus("Frisco is fine", "otherSitesOk"),
  campus("other campuses are fine", "otherSitesOk"),
  campus("I can drive to Frisco", "otherSitesOk"),
  campus("open to other campuses", "otherSitesOk"),
  campus("other sites work", "otherSitesOk"),
  mode("online only", "online"),
  mode("all my classes online", "online"),
  mode("everything online", "online"),
  mode("all classes should be online", "online"),
  mode("only online sections", "online"),
  mode("in-person only", "inPerson"),
  mode("in person only", "inPerson"),
  mode("only in-person classes", "inPerson"),
  mode("no online classes", "inPerson"),
  mode("face to face only", "inPerson"),
  mode("face-to-face only", "inPerson"),
  mode("I want to be in a classroom", "inPerson"),
  mode("every class has to be in person", "inPerson"),
  mode("every class must be in a classroom", "inPerson"),
  mode("all sections in person", "inPerson"),
];

// ---------------------------------------------------------------------------
// 8. Soft preferences (intent.soft)
// ---------------------------------------------------------------------------

export const SOFT_CASES: CorpusEntry[] = [
  soft("I don't want back-to-back classes", [s("spreadOut", "strong")]),
  soft("don't want back to back classes", [s("spreadOut", "strong")]),
  soft("no back-to-back classes", [s("spreadOut", "strong")]),
  soft("avoid back-to-back sections", [s("spreadOut", "strong")]),
  soft("never back-to-back classes", [s("spreadOut", "strong")]),
  soft("space my classes out", [s("spreadOut", "strong")]),
  soft("space them out", [s("spreadOut", "strong")]),
  soft("spread my classes out", [s("spreadOut", "strong")]),
  soft("I'd prefer gaps between classes", [s("spreadOut", "mild")]),
  soft("gaps between my classes please", [s("spreadOut", "strong")]),
  soft("breaks between my classes", [s("spreadOut", "strong")]),
  soft("compact schedule please", [s("compact", "strong")]),
  soft("a compact schedule", [s("compact", "strong")]),
  soft("back-to-back classes are fine", [s("compact", "strong")]),
  soft("I like a tight schedule", [s("compact", "strong")]),
  soft("no gaps between classes", [s("compact", "strong")]),
  soft("fewer gaps please", [s("compact", "strong")]),
  soft("minimal gaps", [s("compact", "strong")]),
  soft("get it all over with", [s("compact", "strong")]),
  soft("get them over with", [s("compact", "strong")]),
  soft("get everything over with", [s("compact", "strong")]),
  soft("knock them out", [s("compact", "strong")]),
  soft("knock it out", [s("compact", "strong")]),
  soft("clump my classes together", [s("compact", "strong")]),
  soft("clumped classes", [s("compact", "strong")]),
  soft("I'd like gaps between classes if possible", [s("spreadOut", "mild")]),
  soft("fewer days on campus", [s("fewerDays", "strong")]),
  soft("fewer days on campus please", [s("fewerDays", "strong")]),
  soft("fewer trips to campus", [s("fewerDays", "strong")]),
  soft("less days on campus", [s("fewerDays", "strong")]),
  soft("as few days on campus as possible", [s("fewerDays", "strong")]),
  soft("as few trips as possible", [s("fewerDays", "strong")]),
  soft("fewest days on campus", [s("fewerDays", "strong")]),
  soft("minimize my days on campus", [s("fewerDays", "strong")]),
  soft("I'd rather have fewer days on campus", [s("fewerDays", "mild")]),
  soft("minimal walking", [s("minimalWalking", "strong")]),
  soft("as little walking as possible", [s("minimalWalking", "strong")]),
  soft("I want to walk as little as possible", [s("minimalWalking", "strong")]),
  soft("short walks between classes", [s("minimalWalking", "strong")]),
  soft("I don't want to walk across campus", [s("minimalWalking", "strong")]),
  soft("no long walks", [s("minimalWalking", "strong")]),
  soft("less walking please", [s("minimalWalking", "strong")]),
  soft("don't make me walk a lot", [s("minimalWalking", "strong")]),
  soft("easy graders", [s("easierGraders", "strong")]),
  soft("easy grading", [s("easierGraders", "strong")]),
  soft("lenient graders", [s("easierGraders", "strong")]),
  soft("lenient grading", [s("easierGraders", "strong")]),
  soft("I'm a morning person", [s("mornings", "strong")]),
  soft("I am a morning person", [s("mornings", "strong")]),
  soft("I love morning classes", [s("mornings", "strong")]),
  soft("I like early classes", [s("mornings", "strong")]),
  soft("I prefer morning classes", [s("mornings", "mild")]),
  soft("I prefer early classes if possible", [s("mornings", "mild")]),
  soft("I'm not a morning person", [s("mornings", "strong", false)]),
  soft("no morning classes", [s("mornings", "strong", false)]),
  soft("no early classes", [s("mornings", "strong", false)]),
  soft("avoid morning classes", [s("mornings", "strong", false)]),
  soft("avoid early classes", [s("mornings", "strong", false)]),
  soft("no weekday morning classes", [s("mornings", "strong", false)]),
  soft("I hate morning classes", [s("mornings", "strong", false)]),
  soft("I hate early classes", [s("mornings", "strong", false)]),
  soft("I dislike early classes", [s("mornings", "strong", false)]),
  soft("I'd rather avoid morning classes", [s("mornings", "mild", false)]),
  soft("skip morning classes if you can", [s("mornings", "mild", false)]),
  soft("I'm a night person", [s("evenings", "strong")]),
  soft("I'm an evening person", [s("evenings", "strong")]),
  soft("I love evening classes", [s("evenings", "strong")]),
  soft("I prefer evening classes", [s("evenings", "mild")]),
  soft("I prefer late classes", [s("evenings", "mild")]),
  soft("I'm not a night person", [s("evenings", "strong", false)]),
  soft("I'm not an evening person", [s("evenings", "strong", false)]),
  soft("no evening classes", [s("evenings", "strong", false)]),
  soft("no late classes", [s("evenings", "strong", false)]),
  soft("no night classes", [s("evenings", "strong", false)]),
  soft("avoid evening classes", [s("evenings", "strong", false)]),
  soft("I hate late classes", [s("evenings", "strong", false)]),
  soft("I'd rather avoid evening classes", [s("evenings", "mild", false)]),
  soft("I'd rather not have evening classes if possible", [s("evenings", "mild", false)]),
];

// ---------------------------------------------------------------------------
// 9. Recognized-but-unexpressible requests (unsupported tags)
// ---------------------------------------------------------------------------

export const TAGS: CorpusEntry[] = [
  tagged("avoid classes with Dr. Lee", ["avoidInstructor"]),
  tagged("skip any class taught by Professor Smith", ["avoidInstructor"]),
  tagged("no classes with Professor Miller", ["avoidInstructor"]),
  tagged("avoid Professor Okafor", ["avoidInstructor"]),
  tagged("don't want classes from Dr. Patel", ["avoidInstructor"]),
  tagged("I'm not taking CSCE 3110", ["avoidedCourse"]),
  tagged("I don't want to take CSCE 2110", ["avoidedCourse"]),
  tagged("avoid CSCE 4110", ["avoidedCourse"]),
  tagged("no HIST 2100 for me", ["avoidedCourse"]),
  tagged("I want to take CSCE 3110", ["wantedCourse"]),
  tagged("I need CSCE 4110", ["wantedCourse"]),
  tagged("make sure I get MATH 1720", ["wantedCourse"]),
  tagged("sign me up for BIOL 2042", ["wantedCourse"]),
  tagged("only 3000-level courses", ["courseLevel"]),
  tagged("only upper-level classes", ["courseLevel"]),
  tagged("avoid 1000-level classes", ["courseLevel"]),
  tagged("no lower-level sections", ["courseLevel"]),
  tagged("no more than 3 classes a day", ["maxClassesPerDay"]),
  tagged("at most 2 classes per day", ["maxClassesPerDay"]),
  tagged("3 classes a day max", ["maxClassesPerDay"]),
  tagged("only come to campus twice a week", ["exactDaysPerWeek"]),
  tagged("I want to be on campus 3 days a week", ["exactDaysPerWeek"]),
  tagged("no afternoon classes", ["timeOfDayBan"]),
  tagged("no morning classes before 8am", []),
  tagged("I'm free on Fridays", ["freeOnDay"]),
  tagged("I'm free Wednesdays", ["freeOnDay"]),
  tagged("same professor for all my classes", ["sameInstructor"]),
  tagged("same instructor across sections", ["sameInstructor"]),
  tagged("parking is a nightmare", ["parking"]),
  tagged("I need easy parking", ["parking"]),
  tagged("classes that meet only once a week", ["meetingsPerWeek"]),
  tagged("no 3-hour classes", ["classDuration"]),
  tagged("2-hour classes are too long", ["classDuration"]),
  tagged("avoid Discovery Park", ["discoveryPark"]),
  tagged("skip Discovery Park", ["discoveryPark"]),
  tagged("hybrid sections would be ideal", ["hybridMode"]),
  tagged("small classes", ["classSize"]),
  tagged("small sections if possible", ["classSize"]),
  tagged("class size matters to me", ["classSize"]),
  tagged("at least a 3.0 GPA", ["gpaThreshold"]),
  tagged("minimum 2.5 GPA", ["gpaThreshold"]),
  tagged("as much online as possible", ["onlinePreference"]),
  tagged("Professor Kim if possible", ["instructor"]),
  tagged("instructor Wang would be great", ["instructor"]),
  tagged("weekend classes are fine for me", ["weekend"]),
  tagged("Saturday classes work", ["weekend"]),
  tagged("Sunday sections are okay", ["weekend"]),
];

// ---------------------------------------------------------------------------
// 10. Ambiguity honesty (bare hours never guessed)
// ---------------------------------------------------------------------------

export const AMBIGUOUS: CorpusEntry[] = [
  tagged("nothing before 9", ["ambiguousTime"]),
  tagged("no classes before 9", ["ambiguousTime"]),
  tagged("don't start before 8", ["ambiguousTime"]),
  tagged("nothing after 5", ["ambiguousTime"]),
  tagged("no classes after 6", ["ambiguousTime"]),
  tagged("I need to be done by 3", ["ambiguousTime"]),
  latest("done by noon, or by 3", 720, { unsupportedTags: ["ambiguousTime"] }),
  tagged("no 9 classes", ["ambiguousTime"]),
  tagged("keep 2-4 free", ["ambiguousTime"]),
  tagged("I work 1-3", ["ambiguousTime"]),
  tagged("I work 10 to 12", ["ambiguousTime"]),
  tagged("my first class can't be until 10", ["ambiguousTime"]),
  e(
    "ambiguous/mixed",
    "nothing before 10am and nothing after 5",
    { hard: { earliestStart: 600 }, unsupportedTags: ["ambiguousTime"] },
  ),
];

// ---------------------------------------------------------------------------
// 11. Unparseable input stays unparseable
// ---------------------------------------------------------------------------

export const NOISE: CorpusEntry[] = [
  unparseable("gibberish xyzzy qwerty"),
  unparseable("asdf jkl"),
  unparseable("hello world"),
  unparseable("purple elephant socks"),
  unparseable("the quick brown fox"),
  unparseable("hmm idk tbh", 1),
  unparseable("lorem ipsum dolor sit amet"),
  unparseable("x y z"),
];

// ---------------------------------------------------------------------------
// 12. Multi-clause sentences (each clause lands in its own field)
// ---------------------------------------------------------------------------

export const MULTI: CorpusEntry[] = [
  e(
    "multi/work-and-days",
    "I have work 8am to 4:30pm on Mondays and Wednesdays, so no classes on Tuesdays and Thursdays",
    { hard: { blockedTimes: onDays(["Mon", "Wed"], 480, 990, "work"), daysOff: ["Tue", "Thu"] } },
  ),
  e(
    "multi/bounds",
    "no classes before 10am or after 4pm",
    { hard: { earliestStart: 600, latestEnd: 960 } },
  ),
  e(
    "multi/credits-and-days",
    "I need 12 credits and keep Fridays free",
    { hard: { creditMin: 12, daysOff: ["Fri"] } },
  ),
  e(
    "multi/soft-and-hard",
    "compact schedule and no Friday classes",
    { hard: { daysOff: ["Fri"] }, soft: [s("compact", "strong")] },
  ),
  e(
    "multi/soft-and-soft",
    "I'm not a morning person and I'd rather have fewer days on campus",
    { soft: [s("mornings", "strong", false), s("fewerDays", "mild")] },
  ),
  e(
    "multi/mode-and-campus",
    "online only and keep me off the Frisco campus",
    { hard: { mode: "online", campusScope: "dentonOnly" } },
  ),
  e(
    "multi/block-and-dayoff",
    "work 9 to 5 on Mondays, nothing on Tuesdays",
    { hard: { blockedTimes: onDays(["Mon"], 540, 1020, "work"), daysOff: ["Tue"] } },
  ),
  e(
    "multi/tag-and-hard",
    "I want to take CSCE 3110 but no classes on Fridays",
    { hard: { daysOff: ["Fri"] }, unsupportedTags: ["wantedCourse"] },
  ),
  e(
    "multi/three-soft",
    "I'd like gaps between classes, minimal walking, and easy graders",
    { soft: [s("spreadOut", "mild"), s("minimalWalking", "strong"), s("easierGraders", "strong")] },
  ),
  e(
    "multi/fillers",
    "hey so basically I need 12 credit hours this semester and I'd prefer gaps between classes",
    { hard: { creditMin: 12 }, soft: [s("spreadOut", "mild")] },
  ),
  e(
    "multi/seat-and-dayoff",
    "only classes with open seats, and keep my Thursdays free",
    { hard: { openSeatsOnly: true, daysOff: ["Thu"] } },
  ),
  e(
    "multi/ambiguous-and-clean",
    "nothing before 8, and no classes on Fridays",
    { hard: { daysOff: ["Fri"] }, unsupportedTags: ["ambiguousTime"] },
  ),
  e(
    "multi/soft-mornings-and-bounds",
    "I'm not a morning person, no classes before 10am",
    { hard: { earliestStart: 600 }, soft: [s("mornings", "strong", false)] },
  ),
  e(
    "multi/practice-and-latest",
    "practice Tuesdays and Thursdays 3pm to 5pm and I need to be done by 6pm",
    { hard: { blockedTimes: onDays(["Tue", "Thu"], 900, 1020, "practice"), latestEnd: 1080 } },
  ),
  e(
    "multi/dayoff-and-mode",
    "no classes on Mondays and in-person only",
    { hard: { daysOff: ["Mon"], mode: "inPerson" } },
  ),
  e(
    "multi/tag-and-tag",
    "I want to take CSCE 3110 and avoid CSCE 2110",
    { unsupportedTags: ["wantedCourse", "avoidedCourse"] },
  ),
  e(
    "multi/credits-range-and-soft",
    "between 12 and 15 credits, compact schedule please",
    { hard: { creditMin: 12, creditMax: 15 }, soft: [s("compact", "strong")] },
  ),
  e(
    "multi/weekend-and-block",
    "I work 9 to 5 on weekdays but Saturday shifts are impossible",
    { hard: { blockedTimes: wd(540, 1020, "work") }, unsupportedTags: ["weekend"] },
  ),
  e(
    "multi/onlydays-and-bounds",
    "only TR and nothing before 10am",
    { hard: { daysOff: ["Mon", "Wed", "Fri"], earliestStart: 600 } },
  ),
  e(
    "multi/long-story",
    "hey! I have work 8am to 4:30pm on Mondays and Wednesdays, I'm not a morning person, and I'd rather avoid evening classes if possible",
    { hard: { blockedTimes: onDays(["Mon", "Wed"], 480, 990, "work") }, soft: [s("mornings", "strong", false), s("evenings", "mild", false)] },
  ),
];

// ---------------------------------------------------------------------------

/** Every labeled phrase, in family order. */
export const CORPUS: CorpusEntry[] = [
  ...BLOCKED,
  ...DAYS_OFF,
  ...ONLY_DAYS,
  ...EARLIEST,
  ...LATEST,
  ...CREDITS_CASES,
  ...FILTERS,
  ...SOFT_CASES,
  ...TAGS,
  ...AMBIGUOUS,
  ...NOISE,
  ...MULTI,
];
