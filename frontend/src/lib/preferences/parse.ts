/**
 * Plain-language schedule preferences, parsed into a `PreferenceIntent`.
 *
 * A student writes "no classes before 10, Fridays off if possible, I work
 * Tue/Thu 3-5". The parser returns the intent and two lists of spans over
 * the original text, what it understood and what it did not, so a UI can
 * show both and the student can correct either.
 *
 * Precision comes first. A wrong fact silently builds the wrong schedule; a
 * missed one stays visible. So an ambiguous request becomes a tagged
 * not-understood span, never a guessed fact:
 *
 * - a bare hour with no am/pm ("nothing after 5") is `ambiguousTime`;
 * - a day with a time ("no Monday classes before 10") is `dayWithTime`,
 *   because the planner has no per-day start or end;
 * - a hard constraint the student hedged ("Fridays off if possible") is
 *   `hedgedConstraint`, carrying the field and value so the UI can ask
 *   whether it is a must;
 * - Saturday and Sunday are `weekend`: the planner schedules Monday to Friday.
 *
 * Two readings are assumed rather than asked, and the span says so with
 * `assumed`: a bare range whose start is at or after its end reads AM to PM
 * ("I work 7-1" is 7am to 1pm, "9-5" is 9am to 5pm), and the bare side of a
 * range takes the opposite meridiem when copying the written one would
 * invert it ("11-1pm" is 11am to 1pm). A bare range starting at 12 ("12-1")
 * stays ambiguous, since 12 can be noon or midnight.
 *
 * How it works:
 *
 * 1. `normalize` lowercases and folds punctuation without changing length,
 *    so every offset indexes the original text.
 * 2. `tokenize` finds day groups with `parseDayGroup` and times with
 *    `parseTime`; `mask` then writes each token as "D___" or "T___" in a copy
 *    of the text. Rows match a token by its kind, so no row describes what a
 *    day or a time looks like.
 * 3. `splitClauses` splits on punctuation and on "and"/"but", never inside a
 *    token, a credit phrase or a course list.
 * 4. Each row is a pattern and a reader. Readers decide polarity with
 *    `governor`, the one negation rule: a negating word ("no", "don't",
 *    "avoid", "hate", "anyone but") reaches back across a closed set of
 *    function words and scheduling verbs to the phrase it governs.
 * 5. `hedges` decides, in one place, which clauses are hedged.
 * 6. Overlapping candidates resolve longest first; the rest apply in text
 *    order, so a repeated bound keeps its last mention.
 *
 * No network, no model, no clock: the same input always gives the same
 * result. Field contracts live in `schema.ts`.
 */

import { weekDays, type WeekDay } from "../types";
import {
  emptyIntent,
  type CampusScope,
  type ClassMode,
  type PrefBlockedTime,
  type PreferenceIntent,
  type SoftKey,
  type Strength,
} from "./schema";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** A quoted slice of the input. `start` is inclusive, `end` exclusive. */
export type Span = { start: number; end: number; text: string };

/** Input the parser used. */
export type UnderstoodSpan = Span & {
  /** `hard.<field>` or `soft.<key>`; `hard.credits` when one phrase set both credit bounds. */
  field: string;
  /** The value set: minutes, days, blocks, a credit count or `{ min, max }`, or `{ strength, positive }` for a soft key. */
  value: unknown;
  /** True when the parser chose a reading the student did not write, such as 7am-1pm for "7-1". */
  assumed: boolean;
};

/** Input the parser did not turn into a fact, and why. */
export type NotUnderstoodSpan = Span &
  (
    | { reason: "unparseable" }
    | {
        reason: "unsupported";
        /** The family of request, such as `ambiguousTime`, `weekend` or `hedgedConstraint`. */
        tag: string;
        /** Set on `hedgedConstraint` only: the fact the parser would apply if the student confirms it is a must. */
        field?: string;
        value?: unknown;
      }
  );

export type ParseResult = {
  intent: PreferenceIntent;
  understood: UnderstoodSpan[];
  notUnderstood: NotUnderstoodSpan[];
};

type Interval = { start: number; end: number };

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end;

function normalize(text: string): string {
  return text
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/a\.m\./g, "am  ")
    .replace(/p\.m\./g, "pm  ")
    // The period in "Dr. Lee" is not a clause boundary.
    .replace(/\bdr\./g, "dr ")
    .replace(/\bprof\./g, "prof ");
}

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

type Meridiem = "am" | "pm";

export type ParsedTime = {
  /** Minutes after midnight. A bare hour holds its am reading (5 is 300) until a range resolves it. */
  minutes: number;
  /** As written; null for a bare hour or a 24-hour time. */
  meridiem: Meridiem | null;
  /** False only for a bare 1 to 12 with no am/pm, which is never read as one or the other. */
  explicit: boolean;
};

/**
 * Parse one time: "9am", "9:30 pm", "9.30", "noon", "midnight", "12 AM",
 * "13:30", "9 o'clock", and plurals such as "8ams".
 */
export function parseTime(raw: string): ParsedTime | null {
  const t = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/ ?o'?clock$/, "");
  if (t === "noon") return { minutes: 720, meridiem: "pm", explicit: true };
  if (t === "midnight") return { minutes: 0, meridiem: "am", explicit: true };
  const m = /^(\d{1,2})(?:[:.](\d{2}))?(?: ?([ap]m)s?)?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  const meridiem = m[3] === "am" || m[3] === "pm" ? m[3] : null;
  if (min > 59) return null;
  if (meridiem) {
    if (h < 1 || h > 12) return null;
    return { minutes: (h % 12) * 60 + min + (meridiem === "pm" ? 720 : 0), meridiem, explicit: true };
  }
  if (h > 24 || (h === 24 && min > 0)) return null;
  // 0 and 13 to 24 can only be 24-hour times.
  return { minutes: h * 60 + min, meridiem: null, explicit: h === 0 || h > 12 };
}

type Range = { start: number; end: number; assumed: boolean };

function atMeridiem(bare: ParsedTime, meridiem: Meridiem): number {
  return (bare.minutes % 720) + (meridiem === "pm" ? 720 : 0);
}

/**
 * Resolve a range [a, b), or null when it cannot be resolved.
 *
 * - Both explicit: as written; midnight as the end means 24:00.
 * - One bare: it copies the other side's meridiem ("8-10pm" is 8pm-10pm).
 *   When that would invert the range it takes the opposite one ("11-1pm"),
 *   flagged assumed.
 * - Both bare: AM to PM only when the start is at or after the end ("7-1"),
 *   flagged assumed. A start of 12 could be noon or midnight, and a start
 *   before the end ("1-3", "10-12") has two sane readings: both stay null.
 */
function resolveRange(a: ParsedTime, b: ParsedTime): Range | null {
  if (a.explicit && b.explicit) {
    const end = b.minutes === 0 && a.minutes > 0 ? 1440 : b.minutes;
    return a.minutes < end ? { start: a.minutes, end, assumed: false } : null;
  }
  if (a.explicit || b.explicit) {
    const known = a.explicit ? a : b;
    const bare = a.explicit ? b : a;
    const same: Meridiem = known.meridiem ?? (known.minutes >= 720 ? "pm" : "am");
    const flipped: Meridiem = same === "am" ? "pm" : "am";
    for (const meridiem of [same, flipped]) {
      const v = atMeridiem(bare, meridiem);
      const [start, end] = a.explicit ? [a.minutes, v] : [v, b.minutes];
      if (start < end) return { start, end, assumed: meridiem !== known.meridiem };
    }
    return null;
  }
  if (a.minutes >= b.minutes && a.minutes < 720) return { start: a.minutes, end: b.minutes + 720, assumed: true };
  return null;
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

/** Any day a student can name, including the weekend days the planner does not schedule. */
export type AnyDay = WeekDay | "Sat" | "Sun";

const ALL_DAYS: readonly AnyDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const isWeekday = (d: AnyDay): d is WeekDay => d !== "Sat" && d !== "Sun";

/**
 * One written day: a name or abbreviation, or a course-schedule letter code.
 * A lone "S" is not a day, because Saturday or Sunday would be a guess, and
 * "sat" and "sun" are not either: in "I sat in on a class" they are English.
 */
const DAY_ATOMS: ReadonlyArray<readonly [RegExp, readonly AnyDay[]]> = [
  [/^mon(?:day)?s?$/, ["Mon"]],
  [/^tu(?:e|es|esday)?s?$/, ["Tue"]],
  [/^wed(?:s|nesday)?s?$/, ["Wed"]],
  [/^th(?:u|ur|urs|ursday)?s?$/, ["Thu"]],
  [/^fri(?:day)?s?$/, ["Fri"]],
  [/^saturdays?$/, ["Sat"]],
  [/^sundays?$/, ["Sun"]],
  [/^mwf$/, ["Mon", "Wed", "Fri"]],
  [/^mw$/, ["Mon", "Wed"]],
  [/^(?:tth|tr|tt)$/, ["Tue", "Thu"]],
  [/^m$/, ["Mon"]],
  [/^t$/, ["Tue"]],
  [/^w$/, ["Wed"]],
  [/^r$/, ["Thu"]],
  [/^f$/, ["Fri"]],
];

function atomDays(atom: string): readonly AnyDay[] | null {
  return DAY_ATOMS.find(([re]) => re.test(atom))?.[1] ?? null;
}

/**
 * Parse a day group: names and abbreviations (Tu, Tue, Tues, Th, Thur,
 * Thurs, ...), letter codes and lists (M T W R F, M/W/F, T/Th, TR, MWF),
 * "weekdays", "weekends", "every day", and ranges ("Monday through
 * Wednesday"). Null when the fragment is not a day group.
 */
export function parseDayGroup(fragment: string): AnyDay[] | null {
  const s = fragment.toLowerCase().trim().replace(/\s+/g, " ");
  if (/^(?:(?:every|each) )?week ?days?$|^daily$|^(?:every|each) day$/.test(s)) return [...weekDays];
  if (/^weekends?$/.test(s)) return ["Sat", "Sun"];
  const body = s.replace(/^(?:every|each) /, "");
  const range = /^([a-z]+) ?(?:-|to|until|till|through|thru) ?([a-z]+)$/.exec(body);
  if (range) {
    const from = atomDays(range[1]);
    const to = atomDays(range[2]);
    if (from?.length !== 1 || to?.length !== 1) return null;
    const out: AnyDay[] = [];
    for (let i = ALL_DAYS.indexOf(from[0]); ; i = (i + 1) % ALL_DAYS.length) {
      out.push(ALL_DAYS[i]);
      if (ALL_DAYS[i] === to[0]) return out;
    }
  }
  // A list never starts or ends on a joiner: "Monday and" is not a group.
  if (/^(?:[/,&]|(?:and|or)\b)|(?:[/,&]|\b(?:and|or))$/.test(body)) return null;
  const days = new Set<AnyDay>();
  for (const part of body.split(/ ?(?:[/,&]|\band\b|\bor\b) ?| /)) {
    if (!part) continue;
    const found = atomDays(part);
    if (!found) return null;
    for (const d of found) days.add(d);
  }
  return days.size > 0 ? ALL_DAYS.filter((d) => days.has(d)) : null;
}

// ---------------------------------------------------------------------------
// Tokens
// ---------------------------------------------------------------------------

type DayToken = Interval & { kind: "day"; days: AnyDay[] };
type TimeToken = Interval & { kind: "time"; time: ParsedTime; plural: boolean };
type Token = DayToken | TimeToken;

/** Where a time may be. `parseTime` decides whether it is one; "3.0" is a number, not 3 o'clock. */
const TIME_SHAPE = /\b(?:noon|midnight|\d{1,2}(?:[:.]\d{2})?(?: ?[ap]ms?)?(?: ?o'?clock)?)\b(?![.:]\d)/g;

/** After a bare number, words that make it a count rather than a time: credits, hours, a level, a per-day or per-week count. */
const COUNT_AFTER =
  /^(?:\s*(?:-|to|and|or)\s*(?:\d{1,2}|more|fewer|less))?\s*-?\s*(?:credit|hours?\b|hrs?\b|level\b|gpa\b|(?:classes|courses|sections)\s+(?:a|per)\s+day|days?\b|times?\b)/;

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(TIME_SHAPE)) {
    const time = parseTime(m[0]);
    const end = m.index + m[0].length;
    if (!time || (/^\d{1,2}$/.test(m[0]) && COUNT_AFTER.test(text.slice(end)))) continue;
    tokens.push({ kind: "time", start: m.index, end, time, plural: /[ap]ms$/.test(m[0]) });
  }
  const words = [...text.matchAll(/[a-z0-9']+/g)]
    .map((w) => ({ start: w.index, end: w.index + w[0].length, word: w[0] }))
    .filter((w) => !tokens.some((t) => overlaps(t, w)));
  for (let i = 0; i < words.length; ) {
    let best: DayToken | null = null;
    for (let j = i; j < Math.min(words.length, i + 8); j++) {
      if (j > i && !/^[\s,/&-]*$/.test(text.slice(words[j - 1].end, words[j].start))) break;
      const days = parseDayGroup(text.slice(words[i].start, words[j].end));
      if (days) best = { kind: "day", start: words[i].start, end: words[j].end, days };
    }
    // "w/" means "with": a lone letter before a slash is not a day.
    const lone = best && best.end === words[i].end && words[i].word.length === 1 && text[best.end] === "/";
    if (best && !lone) {
      tokens.push(best);
      while (i < words.length && words[i].start < best.end) i++;
    } else i++;
  }
  return tokens.sort((a, b) => a.start - b.start);
}

/** The text with each token written as its kind ("D___", "T___"), same length, so row patterns match tokens by kind. */
function mask(text: string, tokens: readonly Token[]): string {
  let out = "";
  let at = 0;
  for (const t of tokens) {
    out += text.slice(at, t.start) + (t.kind === "day" ? "D" : "T").padEnd(t.end - t.start, "_");
    at = t.end;
  }
  return out + text.slice(at);
}

const DAY = String.raw`D_*`;
const TIME = String.raw`T_*`;
const NOUN = String.raw`(?:classes|class|sections|section|courses|course)`;

const isDay = (t: Token): t is DayToken => t.kind === "day";
const isTime = (t: Token): t is TimeToken => t.kind === "time";
const hasWeekend = (d: DayToken): boolean => !d.days.every(isWeekday);
const isWholeWeek = (d: DayToken): boolean => d.days.length === weekDays.length && d.days.every(isWeekday);

// ---------------------------------------------------------------------------
// Clauses
// ---------------------------------------------------------------------------

type Clause = Interval & {
  /** Masked clause text. */
  text: string;
  tokens: Token[];
  /** The clause opened with "but", as in "no classes before 10, but 9 is okay". */
  afterBut: boolean;
  /**
   * The clause carries on the one before it: joined only by "and" or a
   * comma, with no subject of its own ("I really want X and Y").
   */
  continues: boolean;
};

const CREDIT = String.raw`(?:credit\s*hours?|credit\s*hrs?|credits?)`;

/**
 * Split on punctuation and on "and"/"but". Masked tokens hold no
 * punctuation or conjunctions, so a day list or "9:30" never splits; credit
 * phrases ("12 and 15 credits"), decimals and course lists are protected
 * explicitly.
 */
function splitClauses(masked: string, tokens: readonly Token[]): Clause[] {
  const protect = [
    ...masked.matchAll(new RegExp(String.raw`\b\d{1,2}(?:\s*(?:-|to|and)\s*\d{1,2})?\s*${CREDIT}\b`, "g")),
    ...masked.matchAll(new RegExp(String.raw`\bbetween\s+${TIME}\s+and\s+${TIME}`, "g")),
    ...masked.matchAll(/\b\d+\.\d+\b/g),
  ].map((m) => ({ start: m.index, end: m.index + m[0].length }));
  const cuts: Array<{ at: number; word: string }> = [];
  for (const m of masked.matchAll(/[.,;:!?]|\band\b|\bbut\b/g)) {
    if (protect.some((p) => p.start < m.index && m.index < p.end)) continue;
    const before = masked.slice(0, m.index);
    const after = masked.slice(m.index + m[0].length);
    // A course or instructor list is one request ("avoid Professor Lee and Dr Kim").
    const joins = (item: string) => new RegExp(`${item}\\s*$`).test(before) && new RegExp(`^\\s*${item}`).test(after);
    if (/^(?:,|and|or)$/.test(m[0]) && (joins(COURSE) || joins(INSTRUCTOR))) continue;
    // "anyone but Dr. Lee" names who to avoid; it is not a second clause.
    if (m[0] === "but" && /\b(?:any|every)(?:one|body|thing)\s*$/.test(before)) continue;
    cuts.push({ at: m.index, word: m[0] });
  }
  cuts.push({ at: masked.length, word: "" });
  const clauses: Clause[] = [];
  let from = 0;
  let opener: string[] = [];
  for (const cut of cuts) {
    let start = from;
    let end = cut.at;
    while (start < end && /\s/.test(masked[start])) start++;
    while (end > start && /\s/.test(masked[end - 1])) end--;
    if (start < end) {
      const text = masked.slice(start, end);
      const continues =
        clauses.length > 0 &&
        opener.every((w) => w === "," || w === "and") &&
        !/^(?:i|i'm|i'd|i'll|we|my|it|it's|this|that|they|also)\b/.test(text);
      const inside = tokens.filter((t) => t.start >= start && t.end <= end);
      clauses.push({ start, end, text, tokens: inside, afterBut: opener.includes("but"), continues });
      opener = [];
    }
    from = cut.at + cut.word.length;
    if (cut.word) opener.push(cut.word);
  }
  return clauses;
}

// ---------------------------------------------------------------------------
// Polarity: the one negation rule
// ---------------------------------------------------------------------------

const NEGATORS = new Set(
  "no not never don't dont can't cant cannot won't wont shouldn't without avoid avoiding skip skipping nothing none hate dislike dread except unavailable".split(
    " ",
  ),
);

/** Words that say the student wants what follows ("I prefer morning classes"). */
const CUES = new Set("want wants like love prefer prefers enjoy".split(" "));

/**
 * Words a negation or a cue reaches across: "don't [let me go] over 15
 * credits", "no [classes on] Fridays", "no [classes after 4pm or] before
 * 9am". Any other word ends the reach, so "I don't mind Fridays" and "I
 * don't work Fridays" negate nothing.
 */
const REACH = new Set(
  (
    "a an the any my me them it i i'm that which to be is are have has having get getting let lets make need needs " +
    "take taking do doing schedule book attend attending start starts starting begin begins beginning end ends ending " +
    "run runs running go goes going last stay staying show pick suggest choose use give send put class classes course " +
    "courses section sections anything on during in at with w from by taught or long really even ever out of early " +
    "campus come coming there free available " +
    "morning mornings evening evenings night late before after past earlier later than until till would should will"
  ).split(" "),
);

type Governor = { negated: boolean; cue: boolean; at: number };

/**
 * What governs the phrase starting at `at` in a masked clause: read back at
 * most six words, across `REACH` words and tokens, to a negator or the first
 * word outside the reach. A cue on the way is noted and passed over.
 * `at` comes back as where the governing phrase starts.
 */
function governor(text: string, at: number): Governor {
  const words = [...text.slice(0, at).matchAll(/[\w']+/g)];
  let cue: number | null = null;
  for (let i = words.length - 1; i >= Math.max(0, words.length - 6); i--) {
    const w = words[i][0];
    if (NEGATORS.has(w)) return { negated: true, cue: cue !== null, at: words[i].index };
    const anyone = /^(?:any|every)(?:one|body|thing)$/.test(words[i - 1]?.[0] ?? "");
    if (w === "but" && anyone) return { negated: true, cue: cue !== null, at: words[i - 1].index };
    if (CUES.has(w)) cue = words[i].index;
    else if (!REACH.has(w) && !/^[DT]_*$/.test(w)) break;
  }
  return { negated: false, cue: cue !== null, at: cue ?? at };
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

/** One hard fact, typed by the field it sets. */
type HardFact =
  | { field: "earliestStart" | "latestEnd" | "creditMin" | "creditMax"; value: number }
  | { field: "credits"; value: { min: number; max: number } }
  | { field: "daysOff"; value: WeekDay[] }
  | { field: "blockedTimes"; value: PrefBlockedTime[] }
  | { field: "openSeatsOnly"; value: true }
  | { field: "campusScope"; value: CampusScope }
  | { field: "mode"; value: ClassMode };

type Body =
  | { kind: "hard"; fact: HardFact; assumed: boolean }
  | { kind: "soft"; key: SoftKey; positive: boolean }
  | { kind: "tag"; tag: string; fact?: HardFact }
  | { kind: "unparseable" };

/** A reading of part of a clause. Overlap is judged on [start, end); [reach, end) is reported. */
type Found = Interval & { reach: number } & Body;

type Match = Interval & {
  clause: Clause;
  m: RegExpExecArray;
  gov: Governor;
  reach: number;
  days: DayToken[];
  times: TimeToken[];
};

function matchOf(clause: Clause, m: RegExpExecArray): Match {
  const start = clause.start + m.index;
  const end = start + m[0].length;
  const gov = governor(clause.text, m.index);
  const inside = clause.tokens.filter((t) => t.start >= start && t.end <= end);
  return {
    start,
    end,
    clause,
    m,
    gov,
    reach: gov.negated || gov.cue ? clause.start + gov.at : start,
    days: inside.filter(isDay),
    times: inside.filter(isTime),
  };
}

const found = (x: Interval & { reach: number }, body: Body): Found => ({
  start: x.start,
  end: x.end,
  reach: x.reach,
  ...body,
});
const hard = (x: Match, fact: HardFact, assumed = false): Found => found(x, { kind: "hard", fact, assumed });
const soft = (x: Match, key: SoftKey, positive = true): Found => found(x, { kind: "soft", key, positive });
const tag = (x: Interval & { reach: number }, name: string): Found => found(x, { kind: "tag", tag: name });
const wholeClause = (c: Clause, name: string): Found => tag({ ...c, reach: c.start }, name);

const TIME_OF_DAY = /\b(?:mornings?|afternoons?|evenings?|nights?|early|late)\b/;
const hasTime = (c: Clause): boolean => c.tokens.some(isTime) || TIME_OF_DAY.test(c.text);
/** A day the planner cannot scope a time to: any group but the whole week. */
const hasScopedDay = (c: Clause): boolean => c.tokens.some((t) => isDay(t) && !isWholeWeek(t));

// ---------------------------------------------------------------------------
// Readers
// ---------------------------------------------------------------------------

/** A day off is a whole day: with a time in the clause it is left to the dayWithTime fallback. */
function daysOff(x: Match, days: readonly AnyDay[]): Found | null {
  if (hasTime(x.clause)) return null;
  if (!days.every(isWeekday)) return tag(x, "weekend");
  return days.length > 0 ? hard(x, { field: "daysOff", value: days.filter(isWeekday) }) : null;
}

/** "only Tuesdays and Thursdays": every other weekday is off. */
function onlyDays(x: Match): Found | null {
  const named = x.days[0].days;
  if (!named.every(isWeekday)) return hasTime(x.clause) ? null : tag(x, "weekend");
  return daysOff(x, weekDays.filter((d) => !named.includes(d)));
}

function bound(x: Match, field: "earliestStart" | "latestEnd", delta = 0): Found {
  // The planner holds one start and end for the whole week, so "on weekdays" is part of the bound.
  if (hasScopedDay(x.clause)) return wholeClause(x.clause, "dayWithTime");
  const week = x.clause.tokens.find(isDay);
  const span = week ? { start: Math.min(x.start, week.start), end: Math.max(x.end, week.end), reach: Math.min(x.reach, week.start) } : x;
  const t = x.times[0].time;
  return t.explicit
    ? found(span, { kind: "hard", fact: { field, value: t.minutes + delta }, assumed: false })
    : tag(span, "ambiguousTime");
}

const COMMITMENT =
  /\b(?:lab\s+rotation|work|works|working|shifts?|practices?|training|trains?|rehears(?:e|al|als)|volunteer(?:s|ing)?|babysit(?:s|ting)?|intern(?:s|ing)?|jobs?|clinicals?|labs?|meetings?)\b/;
const KEEP = /\b(?:keep|block|set\s+aside|reserve)\b/;

/**
 * A weekly block from a time range. The clause must say it is a commitment
 * ("I work 9-5"), a keep ("keep 12pm-1pm free"), a ban ("no classes
 * between 12pm and 1pm"), or name its days; a range alone ("9-5") is not a
 * block.
 */
function blockedRange(x: Match): Found | null {
  const c = x.clause;
  const at = (m: RegExpExecArray | null): Interval[] =>
    m ? [{ start: c.start + m.index, end: c.start + m.index + m[0].length }] : [];
  const commitment = COMMITMENT.exec(c.text);
  const keep = KEEP.exec(c.text);
  const kept = /\s(?:free|open|clear|blocked)\b/.test(x.m[0]);
  const day = c.tokens
    .filter(isDay)
    .sort((a, b) => Math.abs(a.start - x.start) - Math.abs(b.start - x.start))[0];
  if (!commitment && !keep && !day && !kept && !x.gov.negated) return null;
  const parts: Interval[] = [x, ...at(commitment), ...at(keep), ...(day ? [day] : [])];
  const start = Math.min(x.reach, ...parts.map((p) => p.start));
  const span = { start, end: Math.max(...parts.map((p) => p.end)), reach: start };
  const [a, b] = x.times;
  const range = resolveRange(a.time, b.time);
  if (!range) return a.time.explicit && b.time.explicit ? found(span, { kind: "unparseable" }) : tag(span, "ambiguousTime");
  if (day && hasWeekend(day)) return tag(span, "weekend");
  const purpose = /\bfor\s+(?:my\s+|our\s+|the\s+)?(?!(?:me|us|now)\b)([a-z]+)/.exec(c.text.slice(x.end - c.start));
  const label = purpose?.[1] ?? commitment?.[0].replace(/\s+/g, " ");
  const value = (day?.days ?? weekDays).filter(isWeekday).map((d) => ({
    day: d,
    start: range.start,
    end: range.end,
    ...(label ? { label } : {}),
  }));
  return found(span, { kind: "hard", fact: { field: "blockedTimes", value }, assumed: range.assumed });
}

/** "no 8am classes", "no Monday 8ams": the hour after that time is blocked. */
function hourBan(x: Match): Found | null {
  const time = x.times[0];
  const afterBoundWord = /\b(?:before|after|past|than|until|till|by|at|from|to)\s*$|-\s*$/.test(
    x.clause.text.slice(0, x.m.index),
  );
  if (!x.gov.negated || afterBoundWord || !(x.m[1] || time.plural)) return null;
  if (!time.time.explicit) return tag(x, "ambiguousTime");
  const day = x.days[0];
  if (day && hasWeekend(day)) return tag(x, "weekend");
  const start = time.time.minutes;
  const value = (day?.days ?? weekDays).filter(isWeekday).map((d) => ({ day: d, start, end: Math.min(start + 60, 1440) }));
  return hard(x, { field: "blockedTimes", value });
}

/** Credit comparators, by what they make the number: a floor, a ceiling, both, or a strict bound. */
function creditShape(words: string): "min" | "max" | "exact" | "above" | "below" | null {
  const w = words.replace(/\s+/g, " ");
  if (/^exactly/.test(w)) return "exact";
  if (/^(?:more than|over|above)/.test(w)) return "above";
  if (/^(?:fewer than|less than|under|below)/.test(w)) return "below";
  if (/^(?:at least|min|need|must|have|taking|take|more|or more)/.test(w)) return "min";
  if (/^(?:at most|max|up to|cap|fewer|less|or fewer|or less)/.test(w)) return "max";
  return null;
}

/**
 * Credits need the word "credit": bare "hours" never count. A number with
 * no comparator ("about 15 credits") sets nothing.
 */
function credits(x: Match): Found | null {
  const [, before, lo, hi, orAfter, suffix] = x.m;
  const n = Number(lo);
  if (hi !== undefined) {
    const top = Number(hi);
    return n <= top ? hard(x, { field: "credits", value: { min: n, max: top } }) : found(x, { kind: "unparseable" });
  }
  const shape = creditShape(before ?? orAfter ?? suffix ?? "");
  if (x.gov.negated) {
    // "no more than 15" is at most 15; "no fewer than 12" is at least 12.
    if (shape === "above") return hard(x, { field: "creditMax", value: n });
    if (shape === "below") return hard(x, { field: "creditMin", value: n });
    return null;
  }
  if (shape === "exact") return hard(x, { field: "credits", value: { min: n, max: n } });
  if (shape === "above") return hard(x, { field: "creditMin", value: n + 1 });
  if (shape === "below") return hard(x, { field: "creditMax", value: n - 1 });
  if (shape === "min") return hard(x, { field: "creditMin", value: n });
  if (shape === "max") return hard(x, { field: "creditMax", value: n });
  return null;
}

/** Frisco and other sites: refused, too far, or accepted. A bare mention sets nothing. */
function otherSites(x: Match): Found | null {
  const before = x.clause.text.slice(0, x.m.index);
  if (x.gov.negated || /too\s+far$/.test(x.m[0])) return hard(x, { field: "campusScope", value: "dentonOnly" });
  const accepted =
    /(?:fine|ok|okay|alright|good|works?)$/.test(x.m[0]) ||
    /\b(?:(?:can|could)\s+(?:go|drive|commute)\s+to|open\s+to|don'?t\s+mind)\s+$/.test(before);
  return accepted ? hard(x, { field: "campusScope", value: "otherSitesOk" }) : null;
}

const modeOf = (word: string): ClassMode => (word === "online" ? "online" : "inPerson");

/** Morning or evening leanings: away when negated, toward only with a cue. A day right before ("Tuesday mornings") is dayWithTime. */
function lean(key: "mornings" | "evenings") {
  return (x: Match): Found | null => {
    const prior = x.clause.tokens.filter((t) => t.end <= x.start).at(-1);
    const gap = prior ? x.clause.text.slice(prior.end - x.clause.start, x.m.index) : "";
    if (prior && isDay(prior) && !isWholeWeek(prior) && /^\s*$/.test(gap)) return null;
    if (x.gov.negated) return soft(x, key, false);
    return x.gov.cue ? soft(x, key, true) : null;
  };
}

const COURSE = String.raw`\b[a-z]{2,4}\s?\d{4}\b(?!-?\s*level)`;
const INSTRUCTOR = String.raw`\b(?:professor|prof|dr|instructor)\s+(?!(?:for|across|in|to|and|or|but|except|who|that|with|is|are|was|twice)\b)[a-z][a-z'-]*`;
/** "BIOL 2041 and CHEM 2370", "Professor Lee and Dr Kim": one request, so the list does not split into clauses. */
const listOf = (item: string): string => String.raw`${item}(?:\s*(?:,|and|or)\s*${item})*`;

/** Each item of a list is its own tag, all taking the list's polarity. */
function listTags(item: string, avoided: string, wanted: string) {
  return (x: Match): Found[] =>
    [...x.m[0].matchAll(new RegExp(item, "g"))].map((m, i) => {
      const start = x.start + m.index;
      return tag({ start, end: start + m[0].length, reach: i === 0 ? x.reach : start }, x.gov.negated ? avoided : wanted);
    });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

type Row = { re: RegExp; read: (x: Match) => Found | Found[] | null };

const row = (pattern: string | RegExp, read: Row["read"]): Row => ({
  re: typeof pattern === "string" ? new RegExp(pattern, "g") : pattern,
  read,
});

const IN_PERSON = String.raw`in[ -]?person|face[ -]to[ -]face|in\s+(?:a\s+)?classroom`;

const ROWS: Row[] = [
  // Blocked times.
  row(
    String.raw`(?:\bbetween\s+${TIME}\s+and|\b${TIME}\s*(?:-|to|until|till|through|thru))\s*${TIME}(?:\s+(?:free|open|clear|blocked))?`,
    blockedRange,
  ),
  row(String.raw`(?:\b${DAY}\s+)?\b${TIME}(\s+${NOUN})?(?:\s+(?:on\s+)?${DAY})?`, hourBan),

  // Days off.
  row(String.raw`\b${DAY}(?:\s+${NOUN})?`, (x) => (x.gov.negated ? daysOff(x, x.days[0].days) : null)),
  row(String.raw`\b${DAY}\s+(?:(?:are|is)\s+)?off\b`, (x) => daysOff(x, x.days[0].days)),
  row(
    String.raw`\b(?:keep|keeping|leave|leaving)\s+(?:my\s+)?${DAY}(?:\s+(?:completely|totally|entirely|fully))?\s+(?:free|open|clear)\b`,
    (x) => daysOff(x, x.days[0].days),
  ),
  row(
    String.raw`\bonly\s+(?:(?:show|give|pick|suggest|come|be|do|have|take)\s+)?(?:me\s+)?(?:${NOUN}\s+)?(?:on\s+)?${DAY}|\b${DAY}\s+only\b`,
    onlyDays,
  ),

  // Earliest start and latest end.
  row(String.raw`\b(?:before|earlier\s+than)\s+${TIME}`, (x) => (x.gov.negated ? bound(x, "earliestStart") : null)),
  row(String.raw`\b(?:until|till)\s+${TIME}`, (x) =>
    // "can't start until 10am" is a start; "can't stay until 5pm" is not.
    x.gov.negated && /\b(?:start|starts|begin|begins|first)\b/.test(x.clause.text.slice(0, x.m.index))
      ? bound(x, "earliestStart")
      : null,
  ),
  row(
    String.raw`\bearliest\b(?:\s+(?:i|i'd|can|could|would|want|like|to|be|on|campus|start|begin|time|class|is|at))*\s+${TIME}`,
    (x) => bound(x, "earliestStart"),
  ),
  // "8am is too early" excludes 8am itself, so the bound is the next minute.
  row(String.raw`\b${TIME}\s+(?:is|are)\s+too\s+early\b`, (x) => bound(x, "earliestStart", 1)),
  row(String.raw`\b(?:after|past|later\s+than)\s+${TIME}`, (x) => (x.gov.negated ? bound(x, "latestEnd") : null)),
  row(
    String.raw`\b(?:done|finish(?:ed)?|out|over|gone|leave|leaving|end|ends|ending|lets?\s+out)(?:\s+with\s+${NOUN})?\s+(?:by|before)\s+${TIME}`,
    (x) => (x.gov.negated ? null : bound(x, "latestEnd")),
  ),
  row(
    String.raw`\blatest\b(?:\s+(?:i|can|could|class|course|section|should|end|ends|go|let|out|is|at|by|till|until|time))*\s+${TIME}`,
    (x) => bound(x, "latestEnd"),
  ),
  row(String.raw`\b${TIME}\s+(?:is|are)\s+too\s+late\b`, (x) => bound(x, "latestEnd", -1)),

  // Credits.
  row(
    String.raw`(?:\b(at\s+least|minimum(?:\s+of)?|min(?:\s+of)?|at\s+most|max(?:imum)?(?:\s+of)?|up\s+to|cap(?:ped)?\s+(?:it\s+)?at|exactly|more\s+than|over|above|fewer\s+than|less\s+than|under|below|needs?|must\s+take|have\s+to\s+(?:take|have)|taking|take)\s+)?\b(?:between\s+)?(\d{1,2})(?:\s*(?:-|to|and)\s*(\d{1,2}))?(?:\s+or\s+(more|fewer|less))?\s*${CREDIT}\b(?:\s+(max(?:imum)?|min(?:imum)?|or\s+(?:more|fewer|less)))?`,
    credits,
  ),

  // Seat filter.
  row(/\bopen\s+seats?\b|\bonly\b[^,;]{0,40}?\bseats?\b/g, (x) =>
    x.gov.negated ? null : hard(x, { field: "openSeatsOnly", value: true }),
  ),
  row(String.raw`\b(?:closed|full)\s+${NOUN}\b|\b(?:waitlisted|wait-listed)\b`, (x) =>
    x.gov.negated ? hard(x, { field: "openSeatsOnly", value: true }) : null,
  ),

  // Campus.
  row(
    /\b(?:denton|main)\s+campus(?:es)?\s+only\b|\bonly\s+(?:the\s+)?(?:denton|main)\s+campus\b|\bdenton\s+only\b|\b(?:keep|stay)\s+(?:me\s+)?(?:at|on)\s+(?:the\s+)?(?:main|denton)\s+campus\b/g,
    (x) => hard(x, { field: "campusScope", value: "dentonOnly" }),
  ),
  row(
    /\b(?:frisco|other\s+(?:campuses|sites)|campuses\s+outside\s+denton)\b(?:\s+(?:is|are)\s+(?:too\s+far|fine|ok|okay|alright|good)|\s+works?)?/g,
    otherSites,
  ),

  // Mode.
  row(
    String.raw`\b(online|${IN_PERSON})(?:\s+${NOUN})?\s+only\b|\bonly\s+(online|${IN_PERSON})\b|\b(?:all|every|each|everything)\b[^,;]{0,30}?\b(online|${IN_PERSON})\b`,
    (x) => (x.gov.negated ? null : hard(x, { field: "mode", value: modeOf(x.m[1] ?? x.m[2] ?? x.m[3]) })),
  ),
  row(String.raw`\b(online|${IN_PERSON})\s+${NOUN}`, (x) =>
    // "no online classes" means in person, and the reverse.
    x.gov.negated ? hard(x, { field: "mode", value: modeOf(x.m[1]) === "online" ? "inPerson" : "online" }) : null,
  ),

  // Soft preferences. Negating one of a pair gives the other.
  row(/\bcompact\b|\bback[ -]to[ -]back\b|\btight\s+schedule\b|\bclump(?:ed)?\b|\b(?:pack|packed|bunch|bunched)\s+(?:\w+\s+){0,2}together\b|\b(?:fewer|minimal|minimi[sz]e|short|shorter|small|smaller|less)\s+(?:gaps|breaks)\b/g, (x) =>
    soft(x, x.gov.negated ? "spreadOut" : "compact"),
  ),
  row(
    /\b(?:spread|space)\s+(?:it\s+|them\s+|my\s+classes\s+|everything\s+)?out\b|\b(?:gaps?|breaks?)\s+between\b|\b(?:(?:long|longer|big|bigger|more)\s+)?(?:gaps|breaks)\b/g,
    (x) => soft(x, x.gov.negated ? "compact" : "spreadOut"),
  ),
  row(
    /\bfewer\s+(?:days(?:\s+on\s+campus)?|trips(?:\s+to\s+campus)?)\b|\b(?:less|fewer|fewest)\s+(?:campus\s+)?days\b|\bas\s+few\s+(?:days|trips)(?:\s+(?:on|to)\s+campus)?\s+as\s+possible\b|\bminimi[sz]e\s+(?:my\s+)?days\s+on\s+campus\b/g,
    (x) => (x.gov.negated ? null : soft(x, "fewerDays")),
  ),
  row(
    /(?:\bas\s+little\s+walking\s+as\s+possible|\bwalk\s+as\s+little\s+as\s+possible|\b(?:minimal|less|little)\s+walking|\bwalking\s+to\s+a\s+minimum|\bminimi[sz]e\s+walking|\b(?:short|shorter|shortest|fewer|less|brief)\s+walks?)\b(?:\s+between(?:\s+(?:my\s+)?(?:classes|buildings))?)?/g,
    (x) => (x.gov.negated ? null : soft(x, "minimalWalking")),
  ),
  row(/\bwalk(?:ing)?\s+(?:far|a\s+lot|much|across\s+campus)\b|\blong\s+walks?\b/g, (x) =>
    x.gov.negated ? soft(x, "minimalWalking") : null,
  ),
  row(String.raw`\b(?:early|mornings?)\b(?:\s+${NOUN})?`, lean("mornings")),
  row(String.raw`\b(?:evenings?|nights?|late)\b(?:\s+${NOUN})?`, lean("evenings")),
  row(/\beas(?:y|ier)\s+graders?\b|\beasy\s+(?:a'?s|grading|professors?)\b|\blenient\s+grad(?:ers?|ing)\b|\bgrades?\s+easily\b/g, (x) =>
    x.gov.negated ? null : soft(x, "easierGraders"),
  ),

  // Requests the planner cannot hold, tagged so the UI can say so.
  row(String.raw`\bafternoons?\b(?:\s+${NOUN})?`, (x) => (x.gov.negated && !hasScopedDay(x.clause) ? tag(x, "timeOfDayBan") : null)),
  row(listOf(INSTRUCTOR), listTags(INSTRUCTOR, "avoidInstructor", "instructor")),
  row(
    /\bsame\s+(?:professor|instructor|teacher)\b(?:\s+(?:across|in|for)\s+(?:all\s+|both\s+)?(?:my\s+)?(?:sections?|classes|courses?)|\s+twice|\s+two\s+times)?/g,
    (x) => tag(x, "sameInstructor"),
  ),
  row(listOf(COURSE), listTags(COURSE, "avoidedCourse", "wantedCourse")),
  // "free on Fridays" says when the student can come, not a day off; "not free on Fridays" is one.
  row(String.raw`\b(?:i'?m\s+|i\s+am\s+)?free\s+(?:on\s+)?${DAY}`, (x) =>
    x.gov.negated ? daysOff(x, x.days[0].days) : tag(x, "freeOnDay"),
  ),
  row(
    /\b(?:no\s+more\s+than\s+|at\s+most\s+|max(?:imum)?\s+of\s+)?\d+\s*(?:classes|courses|sections)\s*(?:a|per)\s+day\b(?:\s+max\b)?/g,
    (x) => tag(x, "maxClassesPerDay"),
  ),
  row(
    /\b(?:only\s+)?(?:come|be)\s+(?:(?:on|to)\s+(?:the\s+)?campus\s+)?(?:once|twice|three\s+times|four\s+times|five\s+times|\d+|one|two|three|four|five)\s*(?:days?)?\s*(?:a|per)\s+week\b|\b\d+\s+days\s+(?:a|per)\s+week\b/g,
    (x) => tag(x, "exactDaysPerWeek"),
  ),
  row(/\b(?:only\s+)?(?:1000|2000|3000|4000)[ -]?level(?:\s+(?:courses|classes|sections))?\b|\b(?:upper|lower)[ -]?level\b/g, (x) =>
    tag(x, "courseLevel"),
  ),
  row(/\b(?:meet|meets)\s+(?:only\s+)?once\s+(?:a|per)\s+week\b|\bonly\s+once\s+a\s+week\b/g, (x) => tag(x, "meetingsPerWeek")),
  row(/\b(?:2|3|two|three)[ -]?hours?\s+(?:classes|blocks|labs)\b(?:\s+are\s+too\s+long\b)?/g, (x) => tag(x, "classDuration")),
  row(/\bdiscovery\s+park\b/g, (x) => tag(x, "discoveryPark")),
  row(/\bhybrid\b/g, (x) => tag(x, "hybridMode")),
  row(/\bsmall\s+(?:classes|sections)\b|\bclass\s+size\b/g, (x) => tag(x, "classSize")),
  row(/\b(?:minimum|at\s+least|above|over)\s+(?:a\s+)?\d(?:\.\d)?\s*(?:average\s+)?gpa\b/g, (x) => tag(x, "gpaThreshold")),
  row(/\bas\s+much\s+online\s+as\s+possible\b/g, (x) => tag(x, "onlinePreference")),
  row(/\bparking\b/g, (x) => tag(x, "parking")),
];

/**
 * What a clause says when no row read it: a weekend day, a day with a time,
 * or a bare hour after a time word ("or by 3"). Each covers the clause.
 */
function fallback(c: Clause): Found | null {
  if (c.tokens.some((t) => isDay(t) && hasWeekend(t))) return wholeClause(c, "weekend");
  if (hasScopedDay(c) && hasTime(c)) return wholeClause(c, "dayWithTime");
  const bareAfterTimeWord = c.tokens.some(
    (t) =>
      isTime(t) &&
      !t.time.explicit &&
      /\b(?:by|before|after|at|until|till|past|from)\s+$/.test(c.text.slice(0, t.start - c.start)),
  );
  return bareAfterTimeWord ? wholeClause(c, "ambiguousTime") : null;
}

function readClause(c: Clause): Found[] {
  const out: Found[] = [];
  for (const { re, read } of ROWS) {
    for (const m of c.text.matchAll(re)) {
      const got = read(matchOf(c, m));
      if (Array.isArray(got)) out.push(...got);
      else if (got) out.push(got);
    }
  }
  const rest = out.length === 0 ? fallback(c) : null;
  return rest ? [rest] : out;
}

// ---------------------------------------------------------------------------
// Hedges and strength
// ---------------------------------------------------------------------------

const HEDGE_SOURCE = String.raw`\b(?:if\s+(?:at\s+all\s+)?possible|if\s+you\s+can|if\s+i\s+can(?:\s+help\s+it)?|when(?:ever)?\s+possible|ideally|preferabl[ey]|i'?d\s+prefer|prefer(?:red|s)?|i'?d\s+rather|(?:i\s+)?would\s+rather|i'?d\s+like|i\s+would\s+like|i'?d\s+love|i\s+would\s+love|would\s+be\s+(?:nice|great|ideal)|(?:not\s+a|no)\s+big\s+deal|(?:if|unless)\s+(?:really\s+|absolutely\s+)?necessary|if\s+need(?:\s+be|ed)|try\s+to|hopefully|maybe|kinda|sorta|kind\s+of|sort\s+of|somewhat|slightly)\b`;
const HEDGES = new RegExp(HEDGE_SOURCE, "g");
/**
 * Words that make a leaning strong, before it ("really", "strongly prefer",
 * "would much rather") or after it ("matters a lot to me", "is important",
 * "is a must", "is a big deal").
 */
const INTENSIFIER_SOURCE = String.raw`\b(?:really|truly|definitely|strongly|absolutely|must|needs?|ha(?:ve|s)\s+to|can'?t|cannot|can\s+not|much\s+(?:prefer|rather)|very\s+important|(?:matters?|counts?)\s+(?:a\s+lot|so\s+much|a\s+great\s+deal|(?:the\s+)?most)|(?:is|are|'s|'re)\s+(?:really\s+|very\s+|super\s+|so\s+|extremely\s+)?(?:important|essential|crucial|critical|key|a\s+must|a\s+(?:top\s+)?priority|a\s+(?:big|huge)\s+deal|non-?negotiable))\b`;
const INTENSIFIERS = new RegExp(INTENSIFIER_SOURCE, "g");
/** A concession after "but": "no classes before 10, but 9am is okay". */
const OKAY = /\b(?:is|are|'s|would\s+be)\s+(?:ok(?:ay)?|fine|alright|acceptable)\b/;
const NECESSARY = /\b(?:if|unless)\s+(?:really\s+|absolutely\s+)?necessary\b/;

/** Words with no content, trimmed from the edges of what was not understood. Hedge words are not here: the hedge pass reads them. */
const FILLER =
  /^(?:hey|hi|thanks|thank|please|pls|so|well|ok|okay|um|uh|oh|i|i'm|me|my|we|our|you|your|it|its|it's|this|that|these|those|there|just|really|also|too|very|and|or|but|the|a|an|to|of|for|on|in|at|by|with|as|is|are|am|was|were|be|been|being|do|does|did|don't|have|has|had|want|wanted|wants|need|needs|needed|like|would|could|can|should|will|i'd|i'll|make|sure|things|stuff|something|everything|all|them|they|though|tho|take|taking|get|got|classes|class|courses|sections|basically|actually|scheduling)$/;

const has = (phrases: RegExp, text: string): boolean => new RegExp(phrases.source).test(text);

const phrasesIn = (phrases: RegExp, c: Clause): Interval[] =>
  [...c.text.matchAll(phrases)].map((m) => ({ start: c.start + m.index, end: c.start + m.index + m[0].length }));

/** Only these phrases and filler. A masked token ("T___" in "9am if necessary") is content, so that clause is not. */
const isOnly = (phrases: RegExp, text: string): boolean =>
  has(phrases, text) &&
  text
    .replace(phrases, " ")
    .split(/[^\w']+/)
    .every((w) => w === "" || FILLER.test(w));

/** The nearest clause from `from`, stepping by `step`, that is not in `skip`; -1 when there is none. */
function nearest(skip: readonly boolean[], from: number, step: number): number {
  let i = from;
  while (i >= 0 && i < skip.length && skip[i]) i += step;
  return i >= 0 && i < skip.length ? i : -1;
}

/**
 * Which clauses are hedged, decided in one place:
 *
 * - a clause with a hedge word is hedged ("Fridays off if possible");
 * - a clause that is only a hedge ("if possible", "ideally", "but not a big
 *   deal") hedges the clause before it, or the one after when it opens the
 *   sentence ("Ideally, no classes before 10am");
 * - a concession that states nothing itself ("but 9am is okay", "9am if
 *   necessary") hedges the clause before it.
 *
 * Also returns the hedge words that were read, so they are not reported as
 * not understood.
 */
function hedges(clauses: readonly Clause[], read: readonly Found[][]): { hedged: boolean[]; used: Interval[] } {
  const hedged = clauses.map((c) => has(HEDGES, c.text));
  const only = clauses.map((c) => isOnly(HEDGES, c.text));
  const used: Interval[] = [];
  clauses.forEach((c, i) => {
    const concession =
      read[i].length === 0 && ((c.afterBut && OKAY.test(c.text)) || NECESSARY.test(c.text));
    if (!only[i] && !concession) return;
    let target = nearest(only, i - 1, -1);
    if (target < 0 && only[i]) target = nearest(only, i + 1, 1);
    if (target < 0) return;
    hedged[target] = true;
    used.push(...(only[i] ? [c] : phrasesIn(HEDGES, c)));
  });
  clauses.forEach((c, i) => {
    if (read[i].length > 0) used.push(...phrasesIn(HEDGES, c));
  });
  return { hedged, used };
}

/**
 * How strongly each clause's leanings were stated. Plain statements are
 * mild. A clause's own intensifier makes it strong, even over a hedge in the
 * same clause ("strongly prefer"); a clause that is only an intensifier
 * ("that matters a lot to me") lends it to the clause before. A clause that
 * carries on the one before ("I really want X and Y") inherits its
 * intensifier, unless it has a hedge of its own ("... and Y if possible").
 *
 * Also returns the intensifier phrases that were read.
 */
function strengths(
  clauses: readonly Clause[],
  read: readonly Found[][],
  hedged: readonly boolean[],
): { strength: Strength[]; used: Interval[] } {
  const own = clauses.map((c) => has(INTENSIFIERS, c.text));
  const only = clauses.map((c) => isOnly(INTENSIFIERS, c.text));
  const used: Interval[] = [];
  clauses.forEach((c, i) => {
    if (!only[i]) return;
    const target = nearest(only, i - 1, -1);
    if (target < 0) return;
    own[target] = true;
    used.push(c);
  });
  clauses.forEach((c, i) => {
    if (read[i].length > 0) used.push(...phrasesIn(INTENSIFIERS, c));
  });
  let inherited = false;
  const strength = clauses.map((c, i): Strength => {
    inherited = c.continues && (inherited || own[i - 1]);
    return own[i] || (inherited && !hedged[i]) ? "strong" : "mild";
  });
  return { strength, used };
}

// ---------------------------------------------------------------------------
// Applying facts
// ---------------------------------------------------------------------------

function applyFact(intent: PreferenceIntent, fact: HardFact): void {
  const h = intent.hard;
  switch (fact.field) {
    case "daysOff":
      h.daysOff = weekDays.filter((d) => h.daysOff.includes(d) || fact.value.includes(d));
      return;
    case "blockedTimes":
      for (const b of fact.value) {
        if (!h.blockedTimes.some((x) => x.day === b.day && x.start === b.start && x.end === b.end)) h.blockedTimes.push(b);
      }
      return;
    case "credits":
      h.creditMin = fact.value.min;
      h.creditMax = fact.value.max;
      return;
    case "openSeatsOnly":
      h.openSeatsOnly = fact.value;
      return;
    case "campusScope":
      h.campusScope = fact.value;
      return;
    case "mode":
      h.mode = fact.value;
      return;
    default:
      h[fact.field] = fact.value;
  }
}

/** The last mention of a soft key wins, and moves it last, so later leanings override earlier ones. */
function setSoft(intent: PreferenceIntent, key: SoftKey, strength: Strength, positive: boolean): void {
  intent.soft = [...intent.soft.filter((s) => s.key !== key), { key, strength, positive }];
}

function uncovered(span: Interval, covered: readonly Interval[]): Interval[] {
  let parts = [span];
  for (const c of covered) {
    parts = parts.flatMap((p) =>
      overlaps(p, c)
        ? [
            { start: p.start, end: c.start },
            { start: c.end, end: p.end },
          ].filter((q) => q.end > q.start)
        : [p],
    );
  }
  return parts;
}

/** The part of `span` left after trimming filler words from both ends, or null when only filler remains. */
function trimFiller(text: string, span: Interval): Interval | null {
  const words = [...text.slice(span.start, span.end).matchAll(/[a-z0-9']+/g)];
  let i = 0;
  let j = words.length;
  while (i < j && FILLER.test(words[i][0])) i++;
  while (j > i && FILLER.test(words[j - 1][0])) j--;
  if (i >= j) return null;
  const last = words[j - 1];
  return { start: span.start + words[i].index, end: span.start + last.index + last[0].length };
}

// ---------------------------------------------------------------------------
// parseIntent
// ---------------------------------------------------------------------------

/**
 * Parse one message of plain-language schedule preferences.
 * Pure and deterministic: no network, no model, no clock, no randomness.
 */
export function parseIntent(text: string): ParseResult {
  const norm = normalize(text);
  const tokens = tokenize(norm);
  const clauses = splitClauses(mask(norm, tokens), tokens);
  const read = clauses.map(readClause);
  const { hedged, used: hedgeWords } = hedges(clauses, read);
  const { strength, used: intensifierWords } = strengths(clauses, read, hedged);
  const cands = read.flatMap((fs, i) =>
    fs.map((f) => ({
      clause: i,
      ...(hedged[i] && f.kind === "hard"
        ? { start: f.start, end: f.end, reach: f.reach, kind: "tag" as const, tag: "hedgedConstraint", fact: f.fact }
        : f),
    })),
  );

  const accepted: typeof cands = [];
  for (const c of [...cands].sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start)) {
    if (!accepted.some((a) => overlaps(a, c))) accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);
  // A negation belongs to the first phrase it governs: in "no classes after
  // 4pm or before 9am", "no" is reported with the first bound only.
  let previousEnd = 0;
  for (const c of accepted) {
    c.reach = Math.max(c.reach, previousEnd);
    while (c.reach < c.start && /[\s,]/.test(norm[c.reach])) c.reach++;
    previousEnd = c.end;
  }

  const intent = emptyIntent();
  const understood: UnderstoodSpan[] = [];
  const notUnderstood: NotUnderstoodSpan[] = [];
  for (const c of accepted) {
    const span = { start: c.reach, end: c.end, text: text.slice(c.reach, c.end) };
    if (c.kind === "hard") {
      applyFact(intent, c.fact);
      understood.push({ ...span, field: `hard.${c.fact.field}`, value: c.fact.value, assumed: c.assumed });
    } else if (c.kind === "soft") {
      setSoft(intent, c.key, strength[c.clause], c.positive);
      const value = { strength: strength[c.clause], positive: c.positive };
      understood.push({ ...span, field: `soft.${c.key}`, value, assumed: false });
    } else if (c.kind === "tag") {
      const fact = c.fact ? { field: `hard.${c.fact.field}`, value: c.fact.value } : {};
      notUnderstood.push({ ...span, reason: "unsupported", tag: c.tag, ...fact });
    } else {
      notUnderstood.push({ ...span, reason: "unparseable" });
    }
  }

  // Report what nothing read, minus filler. A single leftover word is noise
  // ("don't", "classes") unless it is a day or a time, which carry facts.
  const covered = [...accepted.map((c) => ({ start: c.reach, end: c.end })), ...hedgeWords, ...intensifierWords];
  for (const clause of clauses) {
    for (const part of uncovered(clause, covered)) {
      const r = trimFiller(norm, part);
      if (!r) continue;
      const oneWord = !/[^a-z0-9']/.test(norm.slice(r.start, r.end));
      if (oneWord && !tokens.some((t) => t.start === r.start && t.end === r.end)) continue;
      notUnderstood.push({ ...r, text: text.slice(r.start, r.end), reason: "unparseable" });
    }
  }

  notUnderstood.sort((a, b) => a.start - b.start);
  return { intent, understood, notUnderstood };
}
