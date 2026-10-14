/**
 * Deterministic, rule-based parsing of plain-language schedule preferences.
 *
 * Architecture, per the #53 review:
 *
 * 1. normalize the input (length-preserving, so spans line up with the
 *    original text a UI would highlight),
 * 2. tokenize day groups and times (`parseDayGroup`, `parseTime` - both
 *    exported and pinned by table-driven tests),
 * 3. split into clauses on punctuation and on "and"/"but" between full
 *    constraints (never inside a day list, time range or credit phrase),
 * 4. extract per clause from a small table of {pattern, field, value} rows
 *    with clause-level negation scope. No single-phrase rules.
 *
 * Precision first: when something is ambiguous the parser emits an
 * unsupported or assumed span, never a guessed fact. The ambiguous cases,
 * pinned by tests:
 *
 * - a bare hour with no am/pm ("nothing after 5", "9 to 5", "I work 7-1")
 *   is tagged `ambiguousTime`, never read as am or pm;
 * - a day with a time qualifier ("no Monday classes before 10") is tagged
 *   `dayWithTime`, never turned into a whole day off - the planner has no
 *   per-day start;
 * - "free on X" is tagged `freeOnDay` (availability, not a day off);
 * - vague "early"/"morning"/"evening" complaints map to the `mornings` and
 *   `evenings` soft weights, not a hard noon;
 * - hours are credits only when the words "credit"/"credit hours" appear,
 *   never bare "hours";
 * - "<time> is too early" is an exclusive boundary the planner cannot hold
 *   exactly: it maps to the next minute (`earliestStart = T + 1`), and the
 *   reverse for "too late" (`latestEnd = T - 1`), so the named time itself
 *   is excluded - the old mapping still allowed it;
 * - in a range, the end's am/pm does apply to a bare start ("8-10pm" is
 *   8pm-10pm); a range with no explicit meridiem anywhere ("I work 7-1")
 *   stays ambiguous and is tagged, never adjusted.
 *
 * Not-understood spans are the clause text no understood span covers, minus
 * filler words, so a UI can highlight exactly what to ask about.
 *
 * No network, no model, no dependencies: every rule is a regular
 * expression plus plain code, and the same input always produces the same
 * result. The contract of every field lives in `schema.ts`.
 */

import { emptyIntent, type PreferenceIntent, type SoftKey, type Strength } from "./schema";
import { weekDays, type WeekDay } from "../types";

/** A quoted slice of the input. `start` is inclusive, `end` exclusive. */
export type Span = { start: number; end: number; text: string };

/** Input the parser used: the field it set and the value it gave it. */
export type UnderstoodSpan = Span & { field: string; value: unknown };

/** Why a slice of input was not used. */
export type NotUnderstoodSpan = Span & {
  reason: "unsupported" | "unparseable";
  /** For "unsupported": which family of unexpressible request this is. */
  tag?: string;
};

export type ParseResult = {
  intent: PreferenceIntent;
  understood: UnderstoodSpan[];
  notUnderstood: NotUnderstoodSpan[];
};

// ---------------------------------------------------------------------------
// Normalization (length-preserving, so spans align with the original text)
// ---------------------------------------------------------------------------

function normalize(text: string): string {
  return text
    .replace(/[A-Z]/g, (c) => c.toLowerCase())
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/a\.m\./g, "am  ")
    .replace(/p\.m\./g, "pm  ")
    // Defuse abbreviations whose period would otherwise split clauses
    // mid-name ("avoid Dr. Lee"). Length-preserving: "." becomes " ".
    .replace(/\bdr\./g, "dr ")
    .replace(/\bprof\./g, "prof ");
}

// ---------------------------------------------------------------------------
// Time tokens
// ---------------------------------------------------------------------------

type ParsedTime = {
  /** Hour as written. */
  h: number;
  min: number;
  /** The meridiem as written, or null when the token did not say one. */
  meridiem: "am" | "pm" | null;
  minutes: number;
  /** True when the token fully specifies the time (am/pm, noon, midnight, or an unambiguous 24-hour hour). */
  explicit: boolean;
};

function parseTimeToken(raw: string): ParsedTime | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/o'?clock/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t === "noon") return { h: 12, min: 0, meridiem: "pm", minutes: 720, explicit: true };
  if (t === "midnight") return { h: 0, min: 0, meridiem: "am", minutes: 0, explicit: true };
  const m = /^(\d{1,2})(?::(\d{2})|\.(\d{2}))?(?:\s*(am|pm))?$/.exec(t);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2] ?? m[3] ?? 0);
  if (h > 24 || min > 59) return null;
  if (h === 24 && min !== 0) return null;
  const mer = (m[4] ?? null) as "am" | "pm" | null;
  let minutes: number;
  let explicit: boolean;
  if (mer === "am") {
    minutes = (h % 12) * 60 + min;
    explicit = true;
  } else if (mer === "pm") {
    minutes = ((h % 12) + 12) * 60 + min;
    explicit = true;
  } else if (h > 12) {
    // An hour above 12 can only be a 24-hour time.
    minutes = h * 60 + min;
    explicit = true;
  } else {
    // Bare hour: genuinely ambiguous, never guessed.
    minutes = h * 60 + min;
    explicit = false;
  }
  if (minutes > 24 * 60) return null;
  return { h, min, meridiem: mer, minutes, explicit };
}

/**
 * Parse one time token: am/pm, noon, midnight, 12 AM/PM, 24-hour, 9.30 and
 * 9:30 forms. Returns minutes after midnight and whether the token fully
 * specified the time. A bare hour is returned with `explicit: false` and is
 * never promoted to am or pm by this function.
 */
export function parseTime(raw: string): { minutes: number; explicit: boolean } | null {
  const p = parseTimeToken(raw);
  return p ? { minutes: p.minutes, explicit: p.explicit } : null;
}

function withMeridiem(t: ParsedTime, mer: "am" | "pm"): number {
  return (t.h % 12) * 60 + (mer === "pm" ? 720 : 0) + t.min;
}

function inferredMeridiem(t: ParsedTime): "am" | "pm" {
  return t.h % 12 === 0 || t.h >= 12 ? "pm" : "am";
}

/**
 * Resolve a range [a, b). The end's explicit meridiem applies to a bare
 * start; the start's applies to a bare end. Two bare times stay ambiguous.
 * Returns null when the range cannot be resolved or is inverted.
 */
function resolveRange(a: ParsedTime, b: ParsedTime): { start: number; end: number } | null {
  if (a.explicit && b.explicit) {
    // "10pm to midnight": midnight written as an end means 24:00, not 00:00.
    const end = b.h === 0 && b.min === 0 && a.minutes > 0 ? 24 * 60 : b.minutes;
    return a.minutes < end ? { start: a.minutes, end } : null;
  }
  if (!a.explicit && b.explicit) {
    const first = b.meridiem ?? inferredMeridiem(b);
    // Annotated: an unannotated array literal widens union literals to string[].
    const mers: Array<"am" | "pm"> = [first, first === "am" ? "pm" : "am"];
    for (const mer of mers) {
      const start = withMeridiem(a, mer);
      if (start < b.minutes) return { start, end: b.minutes };
    }
    return null;
  }
  if (a.explicit && !b.explicit) {
    const first = a.meridiem ?? inferredMeridiem(a);
    const mers: Array<"am" | "pm"> = [first, first === "am" ? "pm" : "am"];
    for (const mer of mers) {
      const end = withMeridiem(b, mer);
      if (a.minutes < end) return { start: a.minutes, end };
    }
    return null;
  }
  // Both bare: resolve only through the cross-noon arithmetic ("11 to 1" →
  // 11am-1pm, "12-1" → noon-1pm, "9-5" → 9am-5pm). A bare pair where the
  // start hour is below the end hour ("1-3") has several sane readings, so
  // it stays ambiguous - never guessed.
  if (!a.explicit && !b.explicit && a.minutes >= b.minutes && b.minutes + 720 > a.minutes) {
    return { start: a.minutes, end: b.minutes + 720 };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Day tokens
// ---------------------------------------------------------------------------

/** Any day name the parser understands, including weekend days it must tag. */
type AnyDay = WeekDay | "Sat" | "Sun";

const ALL_DAYS: readonly AnyDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_DAYS: readonly WeekDay[] = weekDays;

const DAY_WORD = String.raw`(?:mon(?:day)?|tues?(?:day)?|weds?(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?`;

function dayFromWord(word: string): AnyDay | null {
  const s = word.toLowerCase();
  if (/^m/.test(s)) return "Mon";
  if (/^tu/.test(s)) return "Tue";
  if (/^th/.test(s)) return "Thu";
  if (/^w/.test(s)) return "Wed";
  if (/^f/.test(s)) return "Fri";
  if (/^sa/.test(s)) return "Sat";
  if (/^su/.test(s)) return "Sun";
  return null;
}

function daysFromAtom(atom: string): AnyDay[] | null {
  const a = atom.toLowerCase();
  if (/^mwf$/.test(a)) return ["Mon", "Wed", "Fri"];
  if (/^mw$/.test(a)) return ["Mon", "Wed"];
  if (/^tth$|^tt$|^tr$/.test(a)) return ["Tue", "Thu"];
  if (/^tu$/.test(a)) return ["Tue"];
  if (/^th$/.test(a)) return ["Thu"];
  if (/^[mtwrfs]$/.test(a)) {
    // Single-letter atoms ("M T W R F" lists): M/T/W/R/F are unambiguous
    // course-schedule letters. A lone "S" is left unparsed on purpose -
    // Saturday vs Sunday is a guess, and guessing contradicts the contract.
    const letter = a === "r" ? "thu" : { m: "mon", t: "tue", w: "wed", f: "fri" }[a];
    const d = letter ? dayFromWord(letter) : null;
    return d ? [d] : null;
  }
  if (new RegExp(`^${DAY_WORD}$`).test(a)) {
    const d = dayFromWord(a);
    return d ? [d] : null;
  }
  return null;
}

function sortDays<D extends AnyDay>(days: D[]): D[] {
  return [...days].sort((a, b) => ALL_DAYS.indexOf(a) - ALL_DAYS.indexOf(b));
}

/**
 * Parse a day-group fragment into days: full names, abbreviations
 * (Mon/Tue/Tues/Wed/Thu/Thur/Thurs/...), letter codes and lists (M T W R F,
 * M/W/F, T/Th, TR, MWF), "weekdays", "weekends", and ranges ("Monday
 * through Wednesday"). Returns null when the fragment is not a day group.
 */
export function parseDayGroup(fragment: string): AnyDay[] | null {
  const s = fragment
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^ (?:the )?/, "")
    .replace(/^(?:every|each)\s+/, "")
    .trim();
  if (!s) return null;
  if (/^week ?days?$/.test(s)) return [...WEEKDAY_DAYS];
  if (/^weekends?$/.test(s)) return ["Sat", "Sun"];
  if (/^(?:daily|every day|each day)$/.test(s)) return [...WEEKDAY_DAYS];
  const range = new RegExp(`^(?:every |each )?(${DAY_WORD})\\s*(?:-|to|until|till|through|thru)\\s*(${DAY_WORD})$`).exec(s);
  if (range) {
    const a = dayFromWord(range[1]);
    const b = dayFromWord(range[2]);
    if (!a || !b) return null;
    const out: AnyDay[] = [];
    for (let i = ALL_DAYS.indexOf(a); ; i = (i + 1) % ALL_DAYS.length) {
      out.push(ALL_DAYS[i]);
      if (ALL_DAYS[i] === b || out.length > 7) break;
    }
    return out;
  }
  const parts = s.split(/\s*(?:\/|,|&|\band\b|\bor\b)\s*|\s+/).filter((p) => p.length > 0);
  const out: AnyDay[] = [];
  for (const part of parts) {
    const days = daysFromAtom(part);
    if (!days) return null;
    for (const d of days) if (!out.includes(d)) out.push(d);
  }
  return out.length > 0 ? sortDays(out) : null;
}

/** The day-group pattern used inside row patterns. */
const DAYGROUP = String.raw`(?:\b(?:every|each)\s+)?\b(?:week ?days?|weekends?|daily|every day|each day|${DAY_WORD}(?:(?:\s*,\s*(?:and\s+|or\s+)?|\s*(?:,|and|&|or|/|to|until|till|through|thru)\s*|\s+)${DAY_WORD})*|[mtwrfs](?:\s*[/,]?\s*[mtwrfs])+)\b`;

// ---------------------------------------------------------------------------
// Clause splitting
// ---------------------------------------------------------------------------

const TIME_TOKEN_RE =
  /\b(?:noon|midnight)\b|\b\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:am|pm))?\b|\b\d{1,2}\.\d{2}(?:\s*(?:am|pm))?\b|\b\d{1,2}\s*(?:am|pm)\b|\b\d{1,2}\b/g;
const CREDIT_PHRASE_RE = /\b\d{1,2}(?:\s*(?:-|to|and)\s*\d{1,2})?\s*(?:credit\s*hours?|credit\s*hrs?|credits?)\b/g;

type Interval = { start: number; end: number };

function collectMatches(text: string, re: RegExp): Interval[] {
  const out: Interval[] = [];
  for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * Split into clauses on punctuation and on "and"/"but" between full
 * constraints. Day lists ("Tuesday and Thursday"), time tokens ("9:30",
 * "9.30") and credit phrases ("12 and 15 credits") are protected, so their
 * internal conjunctions and separators never split a clause.
 */
function splitClauses(text: string): Interval[] {
  const prot: Interval[] = [
    ...collectMatches(text, TIME_TOKEN_RE),
    ...collectMatches(text, CREDIT_PHRASE_RE),
    ...collectMatches(text, new RegExp(DAYGROUP, "g")),
    // Decimal numbers ("a 3.0 GPA"): the period inside a decimal is a digit
    // separator, never a clause boundary.
    ...collectMatches(text, /\b\d+\.\d+\b/g),
  ];
  const straddles = (i: number) => prot.some((p) => p.start < i && i < p.end);
  const SPLIT = /[.,;:!?]|\band\b|\bbut\b/g;
  const bounds: number[] = [0];
  for (const m of text.matchAll(SPLIT)) {
    if (straddles(m.index)) continue;
    // A course list is one statement: "avoid BIOL 2041 and CHEM 2370" keeps
    // its cue scope instead of splitting off a clause with no cue.
    if (m[0] === "and" && /\b[a-z]{2,4}\s?\d{4}\s*$/.test(text.slice(0, m.index))) continue;
    bounds.push(m.index);
  }
  bounds.push(text.length);
  const clauses: Interval[] = [];
  for (let k = 0; k < bounds.length - 1; k++) {
    let s = bounds[k];
    let e = bounds[k + 1];
    // Skip the conjunction itself and trim whitespace at the edges.
    const lead = /^(?:and|but)\b\s*/.exec(text.slice(s, e));
    if (lead) s += lead[0].length;
    while (s < e && /\s/.test(text[s])) s += 1;
    while (e > s && /\s/.test(text[e - 1])) e -= 1;
    if (s < e) clauses.push({ start: s, end: e });
  }
  return clauses;
}

// ---------------------------------------------------------------------------
// Candidates and extraction rows
// ---------------------------------------------------------------------------

type Cand =
  | {
      kind: "match";
      priority: number;
      start: number;
      end: number;
      field: string;
      value: unknown;
      apply: (intent: PreferenceIntent) => void;
    }
  | { kind: "unsupported"; priority: number; start: number; end: number; tag: string }
  | { kind: "unparseable"; priority: number; start: number; end: number };

type MatchContext = {
  /** Clause text. */
  text: string;
  /** Absolute offset of the clause in the input. */
  offset: number;
  m: RegExpExecArray;
};

function mkMatch(
  priority: number,
  ctx: MatchContext,
  field: string,
  value: unknown,
  apply: (intent: PreferenceIntent) => void,
): Cand {
  return {
    kind: "match",
    priority,
    start: ctx.offset + ctx.m.index,
    end: ctx.offset + ctx.m.index + ctx.m[0].length,
    field,
    value,
    apply,
  };
}

function mkUnsupported(priority: number, ctx: MatchContext, tag: string): Cand {
  return {
    kind: "unsupported",
    priority,
    start: ctx.offset + ctx.m.index,
    end: ctx.offset + ctx.m.index + ctx.m[0].length,
    tag,
  };
}

function mkUnparseable(priority: number, ctx: MatchContext): Cand {
  return {
    kind: "unparseable",
    priority,
    start: ctx.offset + ctx.m.index,
    end: ctx.offset + ctx.m.index + ctx.m[0].length,
  };
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function setSoft(intent: PreferenceIntent, key: SoftKey, strength: Strength, positive = true): void {
  const existing = intent.soft.find((s) => s.key === key);
  if (existing) {
    existing.strength = strength;
    existing.positive = positive;
  } else intent.soft.push({ key, strength, positive });
}

/** Words that soften an ask to mild strength. */
const SOFTENER =
  /\b(?:if possible|if you can|if you'?re able|when possible|i'?d prefer|do prefer|prefer|prefers|preferably|i'?d rather|would rather|i'?d like|hopefully|ideally|somewhat|kinda|sorta|maybe|slightly|if need be)\b/i;

/** How strongly the student asked, from the words before the match and the phrase itself. */
function strengthFor(ctx: MatchContext, phrase: string): Strength {
  if (/\bas\s+possible\b/i.test(phrase)) return "strong";
  // Softeners count before the match ("I prefer smaller classes"), inside
  // it ("prefer morning classes"), or trailing it ("skip mornings if you
  // can").
  const before = ctx.text.slice(Math.max(0, ctx.m.index - 60), ctx.m.index);
  const after = ctx.text.slice(ctx.m.index + ctx.m[0].length, ctx.m.index + ctx.m[0].length + 40);
  return SOFTENER.test(before) || SOFTENER.test(phrase) || SOFTENER.test(after) ? "mild" : "strong";
}

const NEG_WORDS = String.raw`(?:no|not|never|don'?t|do\s+not|can'?t|cannot|can\s?not|without|avoid|avoiding|skip|skipping|nothing)`;

/**
 * A negative marker in the few tokens before `idx`? Scans the window from
 * the end: a negation within three tokens of the course/instructor wins
 * ("I'm not taking CSCE 3110" is avoided, despite the positive "taking").
 */
function negatedBefore(text: string, idx: number): boolean {
  const window = text.slice(Math.max(0, idx - 60), idx).trim();
  if (!window) return false;
  const tokens = window.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0 && tokens.length - 1 - i <= 3; i--) {
    const tok = tokens[i].replace(/[^a-z']/g, "");
    if (
      /^(?:no|not|never|don'?t|cannot|can'?t|without|avoid|avoiding|skip|skipping|nothing)$/.test(
        tok,
      )
    ) {
      return true;
    }
  }
  return false;
}

/** Weekend days inside a parsed group are tagged, never silently dropped. */
function splitWeekend(days: AnyDay[], ctx: MatchContext): { weekdays: WeekDay[]; weekendTag: Cand | null } {
  const weekdays = days.filter((d): d is WeekDay => (WEEKDAY_DAYS as readonly string[]).includes(d));
  const hasWeekend = days.length > weekdays.length;
  return { weekdays, weekendTag: hasWeekend ? mkUnsupported(2, ctx, "weekend") : null };
}

// ---------------------------------------------------------------------------
// Row table
// ---------------------------------------------------------------------------

const T = String.raw`(?:noon|midnight|\d{1,2}:\d{2}(?:\s*(?:am|pm))?|\d{1,2}\.\d{2}(?:\s*(?:am|pm))?|\d{1,2}\s*(?:am|pm)|\d{1,2})`;
const SEP = String.raw`(?:-|to|until|till|through|thru)`;
const VERB = String.raw`(?:work|works|shift|shifts|practice|practices|training|train|rehearsal|rehearse|rehearsals|volunteer|volunteering|volunteers|babysit|babysits|babysitting|intern|interning|interns|job|jobs|clinical|clinicals|lab\s+rotation|lab|labs|meeting|meetings)`;
const CREDITS = String.raw`(?:credit\s*hours?|credit\s*hrs?|credits?)`;
const NOUNS = String.raw`(?:classes|sections|courses|class|anything|anything else)`;

/**
 * Scheduling verbs that may sit between a negation and its time word
 * ("can't take classes before 8am", "don't start classes before 9:30am",
 * "don't let classes run past 6pm"). One shared closed class used by both
 * bound rows; adding a verb here is a mechanism change, not a per-phrase rule.
 */
const NEG_BOUND_VERBS = String.raw`(?:(?:want|wants|need|needs|take|taking|start|starting|begin|beginning|run|runs|running|let|lets|end|ends|ending|go|goes|get|getting|have|has)\s+(?:to\s+)?|wanna\s+)?`;

function parseGroup(m: RegExpExecArray, g: number): { days: AnyDay[]; fragment: string } | null {
  const fragment = m[g];
  if (!fragment) return null;
  const days = parseDayGroup(fragment);
  return days ? { days, fragment } : null;
}

type Row = {
  name: string;
  priority: number;
  re: RegExp;
  handle: (ctx: MatchContext) => Cand | Cand[] | null;
};

// Blocked-time rows: a commitment range the student must keep free.
const BLOCKED_ROWS: Row[] = [
  {
    name: "keep-range",
    priority: 1,
    re: new RegExp(
      String.raw`\b(?:keep|block|set aside|reserve)\s+(${T})\s*(?:${SEP})\s*(${T})(?:\s*(?:free|open|clear|blocked))?(?:\s+for\s+(?:my\s+|our\s+|the\s+)?([a-z]+))?(?:\s+(?:on\s+)?(${DAYGROUP}))?(?:\s+for\s+(?:my\s+|our\s+|the\s+)?([a-z]+))?\b`,
      "gi",
    ),
    handle: (ctx) => blockedFromGroups(ctx, 1, 2, 4, [3, 5], null),
  },
  {
    name: "days-verb-range",
    priority: 1,
    re: new RegExp(
      String.raw`\b(?:on\s+)?(${DAYGROUP})\b[^.,;!?]{0,40}?\b(?:i\s+)?(${VERB})\b[^.,;!?]{0,40}?\b(${T})\s*(?:${SEP})\s*(${T})\b`,
      "gi",
    ),
    handle: (ctx) => blockedFromGroups(ctx, 3, 4, 1, [], 2),
  },
  {
    name: "verb-days-range",
    priority: 1,
    re: new RegExp(
      String.raw`\b(?:i\s+)?(${VERB})\b[^.,;!?]{0,40}?\b(?:on\s+)?(${DAYGROUP})\b[^.,;!?]{0,40}?\b(${T})\s*(?:${SEP})\s*(${T})\b`,
      "gi",
    ),
    handle: (ctx) => blockedFromGroups(ctx, 3, 4, 2, [], 1),
  },
  {
    name: "days-range",
    priority: 1,
    re: new RegExp(
      String.raw`\b(?:on\s+)?(${DAYGROUP})\b(?:\s+from\s+|\s+)?(${T})\s*(?:${SEP})\s*(${T})(?:\s*(?:free|open|clear|blocked))?(?:\s+for\s+(?:my\s+|our\s+|the\s+)?([a-z]+))?\b`,
      "gi",
    ),
    handle: (ctx) => blockedFromGroups(ctx, 2, 3, 1, [4], null),
  },
  {
    name: "verb-range",
    priority: 1,
    re: new RegExp(
      // The verb-to-time gap must not cross a day-group token: "I train
      // Saturdays 10-2" is a day-scoped range, not a weekday-default range
      // with "saturdays" eaten as filler.
      String.raw`\b(?:i\s+)?(${VERB})\b(?:(?!\b(?:on\s+)?(?:${DAYGROUP})\b)[^.,;!?]){0,30}?\b(${T})\s*(?:${SEP})\s*(${T})\b(?:\s+(?:on\s+)?(${DAYGROUP})\b)?`,
      "gi",
    ),
    handle: (ctx) => blockedFromGroups(ctx, 2, 3, 4, [], 1),
  },
  {
    name: "hour-ban",
    priority: 1,
    re: new RegExp(String.raw`\bno\s+(${T})(s)?\s+(?:classes|sections|courses)\b(?:\s+(?:on\s+)?(${DAYGROUP}))?`, "gi"),
    handle: (ctx) => {
      const t = parseTimeToken(ctx.m[1]);
      if (!t) return null;
      if (!t.explicit) return mkUnsupported(2, ctx, "ambiguousTime");
      // A single-hour ban, not a range: group 2 is the plural "s", never a time.
      const daysGroup = ctx.m[3] ? 3 : null;
      const days = daysGroup != null ? parseGroup(ctx.m, daysGroup) : null;
      if (daysGroup != null && !days) return null;
      const { weekdays, weekendTag } = splitWeekend(days ? days.days : [...WEEKDAY_DAYS], ctx);
      const cands: Cand[] = [];
      if (weekendTag) cands.push(weekendTag);
      if (weekdays.length > 0) {
        cands.push(blockedMatch(ctx, weekdays, t.minutes, t.minutes + 60, undefined));
      }
      return cands;
    },
  },
];

/**
 * Build the blocked-time candidate (or its honest tags) from a matched
 * row. `t1`/`t2` are the range group numbers, `daysGroup` the day group (or
 * null for every weekday), `labelGroup` a "for X" label, `verbGroup` a
 * capture whose text is used as the label when no explicit one exists.
 */
function blockedFromGroups(
  ctx: MatchContext,
  t1g: number,
  t2g: number,
  daysGroup: number | null,
  labelGroups: number[],
  verbGroup: number | null,
): Cand | Cand[] | null {
  const a = parseTimeToken(ctx.m[t1g]);
  const b = parseTimeToken(ctx.m[t2g]);
  if (!a || !b) return null;
  const range = resolveRange(a, b);
  if (!range) {
    return a.explicit && b.explicit ? mkUnparseable(1, ctx) : mkUnsupported(2, ctx, "ambiguousTime");
  }
  const days = daysGroup != null ? parseGroup(ctx.m, daysGroup) : null;
  // Bail only when a day group participated but did not parse; an optional
  // group that is simply absent (no trailing days) means "every weekday".
  if (daysGroup != null && ctx.m[daysGroup] && !days) return null;
  const all = days ? days.days : [...WEEKDAY_DAYS];
  const { weekdays, weekendTag } = splitWeekend(all, ctx);
  const labelWord = labelGroups.map((g) => ctx.m[g]).find((s) => s) ?? null;
  const verbWord = verbGroup != null ? ctx.m[verbGroup] : null;
  const label = (labelWord ?? verbWord)?.toLowerCase().replace(/^i\s+/, "") || undefined;
  const cands: Cand[] = [];
  if (weekendTag) cands.push(weekendTag);
  if (weekdays.length > 0) {
    cands.push(blockedMatch(ctx, weekdays, range.start, range.end, label));
  }
  return cands;
}

function blockedMatch(
  ctx: MatchContext,
  days: readonly WeekDay[],
  start: number,
  end: number,
  label: string | undefined,
): Cand {
  const items = days.map((day) => ({ day, start, end, ...(label ? { label } : {}) }));
  return mkMatch(1, ctx, "hard.blockedTimes", items, (intent) => {
    for (const item of items) {
      const dup = intent.hard.blockedTimes.some(
        (b) => b.day === item.day && b.start === item.start && b.end === item.end,
      );
      if (!dup) intent.hard.blockedTimes.push(item);
    }
  });
}

// Days-off rows.
const DAY_OFF_ROWS: Row[] = [
  {
    name: "neg-day",
    priority: 2,
    re: new RegExp(
      String.raw`\b${NEG_WORDS}\s+(?:(?:want\s+|wanting\s+|do\s+|want\s+to\s+|wanna\s+|have\s+|schedule\s+|book\s+|take\s+|taking\s+|attend\s+|attending\s+)\s*)?(?:${NOUNS}\s*)?(?:on|during|over|in)?\s*(${DAYGROUP})(?:\s+${NOUNS}\b)?`,
      "gi",
    ),
    handle: (ctx) => dayOffCandidate(ctx),
  },
  {
    name: "day-off",
    priority: 2,
    re: new RegExp(String.raw`\b(${DAYGROUP})(?:\s+(?:are|is))?\s+off\b`, "gi"),
    handle: (ctx) => dayOffCandidate(ctx),
  },
  {
    name: "keep-free",
    priority: 2,
    re: new RegExp(String.raw`\b(?:keep|keeping|leave|leaving)\s+(?:my\s+)?(${DAYGROUP})(?:\s+(?:completely|totally|entirely|fully))?\s+(?:free|open)\b`, "gi"),
    handle: (ctx) => dayOffCandidate(ctx),
  },
  {
    name: "nothing-on",
    priority: 2,
    re: new RegExp(String.raw`\bnothing\s+(?:on|during)\s+(${DAYGROUP})\b`, "gi"),
    handle: (ctx) => dayOffCandidate(ctx),
  },
  {
    name: "only-days",
    priority: 6,
    re: new RegExp(String.raw`\bonly\s+(?:show\s+|give\s+|pick\s+|suggest\s+)?(?:me\s+)?(?:on\s+)?(${DAYGROUP})\b|\b(${DAYGROUP})\s+only\b`, "gi"),
    handle: (ctx) => {
      const fragment = ctx.m[1] ?? ctx.m[2] ?? "";
      const named = parseDayGroup(fragment);
      if (!named) return null;
      // "only show classes with open seats" is a seat filter, not days off;
      // seat/mode rows run first and claim the span, so reaching here means
      // no other row wanted it. Weekend-only attendance is not expressible.
      const { weekdays, weekendTag } = splitWeekend(named, ctx);
      if (weekdays.length === 0) return weekendTag;
      const complement = WEEKDAY_DAYS.filter((d) => !weekdays.includes(d));
      if (complement.length === 0) return weekendTag;
      const cands: Cand[] = [];
      if (weekendTag) cands.push(weekendTag);
      cands.push(
        mkMatch(6, ctx, "hard.daysOff", complement, (intent) => {
          for (const d of complement) if (!intent.hard.daysOff.includes(d)) intent.hard.daysOff.push(d);
          intent.hard.daysOff = sortDays(intent.hard.daysOff);
        }),
      );
      return cands;
    },
  },
];

/**
 * Shared days-off builder. A day with a time qualifier ("no Monday classes
 * before 10") is not a day off - the planner has no per-day start - so a
 * time-ish word right after the match skips the row (the clause is tagged
 * `dayWithTime` later). A softened ask ("Friday off if possible") is tagged
 * `softDayOff`, never turned into a hard day off.
 */
function dayOffCandidate(ctx: MatchContext): Cand | Cand[] | null {
  const after = ctx.text.slice(ctx.m.index + ctx.m[0].length, ctx.m.index + ctx.m[0].length + 40);
  // TIME_TOKEN_RE rather than a bare \d{1,2}\b: "10am" has no word boundary
  // between the digits and the meridiem, so the digit alternative must be
  // meridiem-aware or "no Friday classes before 10am" reads as a whole day off.
  if (new RegExp(`${TIME_TOKEN_RE.source}|\\b(?:morning|afternoon|evening|early|late)s?\\b`, "i").test(after)) return null;
  const clauseWindow = ctx.text.slice(0, ctx.m.index) + ctx.text.slice(ctx.m.index + ctx.m[0].length);
  if (SOFTENER.test(clauseWindow)) return mkUnsupported(2, ctx, "softDayOff");
  const group = parseGroup(ctx.m, 1);
  if (!group) return null;
  const { weekdays, weekendTag } = splitWeekend(group.days, ctx);
  const cands: Cand[] = [];
  if (weekendTag) cands.push(weekendTag);
  if (weekdays.length > 0) {
    cands.push(
      mkMatch(2, ctx, "hard.daysOff", weekdays, (intent) => {
        for (const d of weekdays) if (!intent.hard.daysOff.includes(d)) intent.hard.daysOff.push(d);
        intent.hard.daysOff = sortDays(intent.hard.daysOff);
      }),
    );
  }
  return cands.length > 0 ? cands : null;
}

// Earliest-start rows.
const EARLIEST_ROWS: Row[] = [
  {
    name: "es-neg-before",
    priority: 3,
    re: new RegExp(
      String.raw`\b${NEG_WORDS}\s+${NEG_BOUND_VERBS}(?:${NOUNS}\s*)?(?:that\s+|which\s+)?(?:start|starts|starting|begin|begins|beginning)?\s*(?:any\s+)?(?:earlier\s+than|before)\s+(${T})\b`,
      "gi",
    ),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
  {
    name: "es-not-until",
    priority: 3,
    re: new RegExp(String.raw`\b(?:don'?t|do\s+not|can'?t|cannot|can\s?not)\s+(?:start|begin)\s+(?:until|till)\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
  {
    name: "es-first-class",
    priority: 3,
    re: new RegExp(
      String.raw`\b(?:first|earliest)\s+(?:class|course|section)\s+(?:can'?t|cannot|can\s?not|shouldn'?t|should\s+not|won'?t)\s+(?:be\s+|start\s+|begin\s+)?(?:until|till|before)\s+(${T})\b`,
      "gi",
    ),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
  {
    name: "es-earliest-can",
    priority: 3,
    re: new RegExp(String.raw`\bearliest\s+(?:i\s+)?(?:can|could)?\s*(?:start|begin)\s+(?:is\s+|at\s+)?(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
  {
    name: "es-too-early",
    priority: 3,
    re: new RegExp(String.raw`\b(${T})(s)?\s+(?:are|is)\s+too\s+early\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart", 1),
  },
  {
    name: "es-or-before",
    priority: 3,
    re: new RegExp(String.raw`\bor\s+before\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
  {
    name: "es-t-or-before",
    priority: 3,
    re: new RegExp(String.raw`\b(${T})\s+or\s+(?:before|earlier)\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
];

// Latest-end rows.
const LATEST_ROWS: Row[] = [
  {
    name: "lat-neg-after",
    priority: 3,
    re: new RegExp(
      String.raw`\b${NEG_WORDS}\s+${NEG_BOUND_VERBS}(?:${NOUNS}|me|them|it\s*)?\s*(?:that\s+|which\s+)?(?:end|ends|ending|run|runs|running|go|goes|going|last|lasting|let|lets|stay|stays|staying|get|getting)?\s*(?:out\s+)?(?:any\s+)?(?:later\s+than|after|past)\s+(${T})\b`,
      "gi",
    ),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-not-later",
    priority: 3,
    re: new RegExp(String.raw`\bnot\s+(?:any\s+)?later\s+than\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-done-by",
    priority: 3,
    re: new RegExp(
      String.raw`\b(?:done|finished|over|out)\s+(?:with\s+(?:class|classes|courses|sections)\s+)?(?:by|before)\s+(${T})\b`,
      "gi",
    ),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-end-by",
    priority: 3,
    re: new RegExp(String.raw`\b(?:end|ends|ending|let\s+out|lets\s+out)\s+by\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-need-done",
    priority: 3,
    re: new RegExp(
      String.raw`\b(?:i\s+)?(?:need|have)\s+to\s+(?:be\s+)?(?:done|out|gone|off|leave|leaving)\s+(?:by|at|before)\s+(${T})\b`,
      "gi",
    ),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-latest-end",
    priority: 3,
    re: new RegExp(String.raw`\blatest\s+(?:class|course|section)?\s*(?:can\s+|should\s+)?(?:end|ends|go|let\s+out)\s+(?:at|by|till|until)?\s*(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-too-late",
    priority: 3,
    re: new RegExp(String.raw`\b(${T})(s)?\s+(?:are|is)\s+too\s+late\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd", -1),
  },
  {
    name: "lat-or-after",
    priority: 3,
    re: new RegExp(String.raw`\bor\s+after\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-t-or-after",
    priority: 3,
    re: new RegExp(String.raw`\b(${T})\s+or\s+(?:after|later)\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "lat-home-by",
    priority: 3,
    re: new RegExp(String.raw`\b(?:be\s+)?home\s+by\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  // Elliptical coordinate bounds: "done by noon, or by 3" - the second clause
  // carries the bound verb over from the first. A bare coordinate time is
  // ambiguous and is tagged, never guessed.
  {
    name: "lat-or-by",
    priority: 3,
    re: new RegExp(String.raw`\bor\s+by\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "latestEnd"),
  },
  {
    name: "es-or-before",
    priority: 3,
    re: new RegExp(String.raw`\bor\s+before\s+(${T})\b`, "gi"),
    handle: (ctx) => boundCandidate(ctx, 1, "earliestStart"),
  },
];

/**
 * Build a time-bound candidate. A bare hour is tagged `ambiguousTime`,
 * never read as am or pm. An explicit "too early"/"too late" boundary is
 * exclusive: the named minute itself must also be excluded, so the bound
 * moves by `delta` (earliest start gets T+1, latest end gets T-1).
 */
function boundCandidate(
  ctx: MatchContext,
  g: number,
  field: "earliestStart" | "latestEnd",
  delta = 0,
): Cand | Cand[] | null {
  // The planner holds these bounds globally. A bound scoped to a subset of
  // days ("no classes after 5pm on Thursdays") is not expressible: tag the
  // clause instead of inventing a global bound. An all-weekdays scope ("on
  // weekdays") is the whole planner week, so the bound still applies.
  for (const dm of ctx.text.matchAll(new RegExp(DAYGROUP, "gi"))) {
    const scoped = parseDayGroup(dm[0]);
    if (scoped && (scoped.length !== WEEKDAY_DAYS.length || !scoped.every((d) => (WEEKDAY_DAYS as readonly string[]).includes(d)))) {
      return mkUnsupported(2, ctx, "dayWithTime");
    }
  }
  const t = parseTimeToken(ctx.m[g]);
  if (!t) return null;
  if (!t.explicit) return mkUnsupported(2, ctx, "ambiguousTime");
  const value = t.minutes + delta;
  const applied = (intent: PreferenceIntent) => {
    intent.hard[field] = value;
  };
  // A coordinate alternative with a bare time ("done by noon, or by 3")
  // keeps the resolved bound but reports the ambiguity: the user gave two
  // bounds and one of them cannot be resolved.
  const afterMatch = ctx.text.slice(ctx.m.index + ctx.m[0].length);
  const alt = new RegExp(`^\\s*,\\s*or\\s+(?:by\\s+)?(${T})\\b`, "i").exec(afterMatch);
  if (alt) {
    const altTime = parseTimeToken(alt[1]);
    if (altTime && !altTime.explicit) {
      const matchStart = ctx.offset + ctx.m.index;
      const matchEnd = matchStart + ctx.m[0].length;
      const tagStart = matchEnd + (alt.index ?? 0);
      const tag: Cand = {
        kind: "unsupported",
        priority: 2,
        start: tagStart,
        end: tagStart + alt[0].length,
        tag: "ambiguousTime",
      };
      return [mkMatch(3, ctx, `hard.${field}`, value, applied), tag];
    }
  }
  return mkMatch(3, ctx, `hard.${field}`, value, applied);
}

// Credit rows: "credit"/"credit hours" wording is required, bare "hours"
// never count as credits.
const CREDIT_ROWS: Row[] = [
  {
    name: "cr-max",
    priority: 3,
    re: new RegExp(
      String.raw`\b(?:no\s+more\s+than|don'?t\s+let\s+me\s+go\s+over|do\s+not\s+let\s+me\s+go\s+over|not\s+go\s+over|max(?:imum)?(?:\s+of)?|at\s+most|up\s+to|cap(?:ped)?\s+(?:it\s+)?at)\s+(\d{1,2})\s*${CREDITS}\b`,
      "gi",
    ),
    handle: (ctx) => creditCandidate(ctx, 1, "max"),
  },
  {
    name: "cr-max-strict",
    priority: 3,
    re: new RegExp(String.raw`\b(?:fewer\s+than|less\s+than|under)\s+(\d{1,2})\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => {
      // "no fewer than 12 credits" is a minimum, not a maximum.
      if (negatedBefore(ctx.text, ctx.m.index)) return creditCandidate(ctx, 1, "min");
      return creditCandidate(ctx, 1, "maxStrict");
    },
  },
  {
    name: "cr-min",
    priority: 3,
    re: new RegExp(String.raw`\b(?:at\s+least|minimum(?:\s+of)?|min\s+of|no\s+fewer\s+than)\s+(\d{1,2})\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "min"),
  },
  {
    name: "cr-min-strict",
    priority: 3,
    re: new RegExp(String.raw`\b(?:more\s+than|over)\s+(\d{1,2})\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => {
      // "don't want more than 15 credits" is a maximum, not a minimum.
      if (negatedBefore(ctx.text, ctx.m.index)) return creditCandidate(ctx, 1, "max");
      return creditCandidate(ctx, 1, "minStrict");
    },
  },
  {
    name: "cr-exact",
    priority: 3,
    re: new RegExp(String.raw`\bexactly\s+(\d{1,2})\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "exact"),
  },
  {
    name: "cr-range",
    priority: 3,
    re: new RegExp(String.raw`\b(?:between\s+)?(\d{1,2})\s*(?:-|to|and)\s*(\d{1,2})\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "range", 2),
  },
  {
    name: "cr-suffix-max",
    priority: 3,
    re: new RegExp(String.raw`\b(\d{1,2})\s*${CREDITS}\s+(?:max|or\s+(?:fewer|less))\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "max"),
  },
  {
    name: "cr-suffix-min",
    priority: 3,
    re: new RegExp(String.raw`\b(\d{1,2})\s*${CREDITS}\s+(?:or\s+more|minimum)\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "min"),
  },
  {
    name: "cr-or-fewer",
    priority: 3,
    re: new RegExp(String.raw`\b(\d{1,2})\s+or\s+(?:fewer|less)\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "max"),
  },
  {
    name: "cr-or-more",
    priority: 3,
    re: new RegExp(String.raw`\b(\d{1,2})\s+or\s+more\s*${CREDITS}\b`, "gi"),
    handle: (ctx) => creditCandidate(ctx, 1, "min"),
  },
  {
    name: "cr-need",
    priority: 3,
    re: new RegExp(
      String.raw`\b(?:i\s+)?(?:need|needs|must\s+take|have\s+to\s+(?:take|have)|taking|take)\s+(\d{1,2})\s*${CREDITS}\b`,
      "gi",
    ),
    handle: (ctx) => {
      if (negatedBefore(ctx.text, ctx.m.index)) return null;
      return creditCandidate(ctx, 1, "min");
    },
  },
];

function creditCandidate(
  ctx: MatchContext,
  g: number,
  shape: "max" | "maxStrict" | "min" | "minStrict" | "exact" | "range",
  g2?: number,
): Cand | null {
  const v = Number.parseInt(ctx.m[g], 10);
  if (Number.isNaN(v)) return null;
  let creditMin: number | null = null;
  let creditMax: number | null = null;
  if (shape === "max") creditMax = v;
  if (shape === "maxStrict") creditMax = v - 1;
  if (shape === "min") creditMin = v;
  if (shape === "minStrict") creditMin = v + 1;
  if (shape === "exact") {
    creditMin = v;
    creditMax = v;
  }
  if (shape === "range" && g2 != null) {
    const hi = Number.parseInt(ctx.m[g2], 10);
    if (Number.isNaN(hi) || v > hi) return mkUnparseable(3, ctx);
    creditMin = v;
    creditMax = hi;
  }
  return mkMatch(3, ctx, "hard.creditMin", creditMin, (intent) => {
    if (creditMin !== null) intent.hard.creditMin = creditMin;
    if (creditMax !== null) intent.hard.creditMax = creditMax;
  });
}

// Seat-filter rows: a filter on suggestions, not a builder requirement.
const SEAT_ROWS: Row[] = [
  {
    name: "seat-only-show",
    priority: 4,
    re: /\bonly\s+(?:show|pick|suggest|list|give)(?:\s+me)?\b[^.,;!?]{0,40}?\bseats?\b/gi,
    handle: (ctx) => seatMatch(ctx),
  },
  {
    name: "seat-open-only",
    priority: 4,
    re: /\bopen\s+seats?\s+only\b|\bonly\s+(?:the\s+)?(?:ones|classes|sections|courses)?\s*(?:with|that\s+have|that\s+still\s+have)\s+open\s+seats?\b/gi,
    handle: (ctx) => seatMatch(ctx),
  },
  {
    name: "seat-no-full",
    priority: 4,
    re: /\bno\s+(?:closed|full|waitlisted|wait-listed)\s+(?:classes|sections|courses)\b|\bdon'?t\s+(?:pick|choose|suggest|show|use|give)\s+(?:me\s+)?(?:any\s+)?(?:closed|full|waitlisted|wait-listed)\b|\bnothing\s+(?:that\s+is\s+)?(?:closed|full|waitlisted|wait-listed)\b|\bmake\s+sure\s+(?:they|it)\s+(?:have|has)\s+open\s+seats?\b/gi,
    handle: (ctx) => seatMatch(ctx),
  },
];

function seatMatch(ctx: MatchContext): Cand {
  return mkMatch(4, ctx, "hard.openSeatsOnly", true, (intent) => {
    intent.hard.openSeatsOnly = true;
  });
}

// Campus rows: a filter on suggestions, not a builder requirement.
const CAMPUS_ROWS: Row[] = [
  {
    name: "campus-denton",
    priority: 4,
    re: /\b(?:denton|main)\s+campus\s+only\b|\bonly\s+(?:the\s+)?(?:denton|main)\s+campus\b|\bdenton\s+only\b|\bno\s+(?:frisco|other\s+(?:campuses|sites))\b|\bno\s+campuses?\s+outside\b|\bdon'?t\s+(?:send|put|schedule)\s+me\s+(?:in|at|to)\s+frisco\b|\b(?:frisco|other\s+(?:campuses|sites))\s+(?:is|are)\s+too\s+far\b|\bkeep\s+me\s+(?:at|on)\s+(?:the\s+)?(?:main|denton)\s+campus\b|\bkeep\s+me\s+off\s+(?:the\s+)?frisco\b/gi,
    handle: (ctx) =>
      mkMatch(4, ctx, "hard.campusScope", "dentonOnly", (intent) => {
        intent.hard.campusScope = "dentonOnly";
      }),
  },
  {
    name: "campus-other",
    priority: 4,
    re: /\b(?:frisco|other\s+(?:campuses|sites))\s+(?:is|are)\s+(?:fine|ok|okay|alright|good)\b|\b(?:i\s+)?(?:can|could)\s+(?:go|drive)\s+to\s+(?:frisco|other\s+(?:campuses|sites))\b|\bdon'?t\s+mind\b[^.,;!?]{0,20}?\bfrisco\b|\bopen\s+to\s+(?:frisco|other\s+(?:campuses|sites))\b|\bother\s+(?:campuses|sites)\s+work\b|\bfrisco\s+works\b/gi,
    handle: (ctx) =>
      mkMatch(4, ctx, "hard.campusScope", "otherSitesOk", (intent) => {
        intent.hard.campusScope = "otherSitesOk";
      }),
  },
];

// Mode rows.
const MODE_ROWS: Row[] = [
  {
    name: "mode-online",
    priority: 4,
    re: /\b(?:all|everything)\s+online\b|\bonline\s+only\b|\bonly\s+online\s+(?:classes|sections|courses)\b|\bno\s+(?:in[ -]?person|campus)\s+(?:classes|sections|courses)\b|\b(?:every|each)\s+class\s+(?:has|have|must)\s+(?:to\s+)?be\s+online\b|\ball\s+(?:my\s+)?classes?\s+(?:should\s+be\s+|must\s+be\s+)?online\b/gi,
    handle: (ctx) =>
      mkMatch(4, ctx, "hard.mode", "online", (intent) => {
        intent.hard.mode = "online";
      }),
  },
  {
    name: "mode-inperson",
    priority: 4,
    re: /\bin[ -]?person\s+only\b|\bonly\s+in[ -]?person\b|\bno\s+online\s+(?:classes|sections|courses)\b|\bface[ -]to[ -]face\s+only\b|\b(?:want|need)\s+to\s+be\s+in\s+(?:a\s+)?classroom\b|\bevery\s+class\s+(?:has|must)\s+(?:to\s+)?be\s+(?:in\s+(?:a\s+)?classroom|in\s+person)\b|\b(?:all|every)\s+(?:my\s+)?(?:classes|sections|courses)\s+(?:should\s+be\s+|must\s+be\s+)?in[ -]?person\b/gi,
    handle: (ctx) =>
      mkMatch(4, ctx, "hard.mode", "inPerson", (intent) => {
        intent.hard.mode = "inPerson";
      }),
  },
];

// Soft-preference rows: leanings with a strength, mapped by applyIntent.
const SOFT_ROWS: Row[] = [
  {
    name: "soft-spread",
    priority: 5,
    re: /\b(?:don'?t|do\s+not|no|avoid|never)\s+(?:want\s+)?(?:them\s+)?back[ -]to[ -]back\b|\b(?:spread|space)\s+(?:it|them|my\s+classes|everything|out)\b|\bgaps?\s+between\b|\bbreaks?\s+between\s+(?:my\s+)?classes\b/gi,
    handle: (ctx) =>
      // Directional soft preferences flip under negation: "no gaps between
      // classes" is a compact ask, not a spread-out one.
      negatedBefore(ctx.text, ctx.m.index) ? softMatch(ctx, "compact") : softMatch(ctx, "spreadOut"),
  },
  {
    name: "soft-compact",
    priority: 4,
    re: /\bcompact\b|\bback[ -]to[ -]back\b|\btight\s+schedule\b|\bclump(?:ed)?\b|\bno\s+(?:long\s+)?gaps\b|\bfewer\s+gaps\b|\bminimal\s+gaps\b|\bget\s+(?:(?:it|them|everything|this|these|all|classes|courses|my\s+classes|my\s+courses)\s+)?(?:all\s+)?over\s+with\b|\bknock(?:ed)?\s+(?:it|them)\s+out\b/gi,
    handle: (ctx) => softMatch(ctx, "compact"),
  },
  {
    name: "soft-fewer-days",
    priority: 5,
    re: /\bfewer\s+(?:days(?:\s+on\s+campus)?|trips(?:\s+to\s+campus)?)\b|\bless\s+days\b|\bfewest\s+days\b|\bas\s+few\s+(?:days(?:\s+on\s+campus)?|trips(?:\s+to\s+campus)?)\s+as\s+possible\b|\bminimi[sz]e\s+(?:my\s+)?days\s+on\s+campus\b/gi,
    handle: (ctx) => softMatch(ctx, "fewerDays"),
  },
  {
    name: "soft-walking",
    priority: 5,
    re: /\bminimal\s+walking\b|\b(?:as\s+little\s+walking|walk\s+as\s+little)\s+as\s+possible\b|\bshort\s+walks?\s+between\b|\bdon'?t\s+want\s+to\s+walk\s+(?:far|a\s+lot|much|across\s+campus)\b|\bdon'?t\s+make\s+me\s+walk\s+(?:far|a\s+lot|much|across\s+campus)\b|\bno\s+long\s+walks\b|\bless\s+walking\b/gi,
    handle: (ctx) => softMatch(ctx, "minimalWalking"),
  },
  {
    name: "soft-morning-person",
    priority: 5,
    re: /\b(?:i'?m|am|i\s+am)\s+a\s+morning\s+person\b/gi,
    handle: (ctx) => softMatch(ctx, "mornings", true),
  },
  {
    name: "soft-not-morning-person",
    priority: 5,
    re: /\bnot\s+a\s+morning\s+person\b/gi,
    handle: (ctx) => softMatch(ctx, "mornings", false),
  },
  {
    name: "soft-night-person-pos",
    priority: 5,
    re: /\b(?:i'?m|am|i\s+am)\s+an?\s+(?:night|evening)\s+person\b/gi,
    handle: (ctx) => softMatch(ctx, "evenings", true),
  },
  {
    name: "soft-mornings-neg",
    priority: 5,
    // A negation within two words of a vague time-of-day word ("no morning
    // classes", "no weekday morning classes", "hate early classes", "not
    // have morning classes").
    re: /\b(?:no|not|avoid|skip|without|hate|dislike|dread)\s+(?:\w+\s+){0,2}?(?:early|morning)(?:\s+(?:classes|sections|courses))?\b/gi,
    handle: (ctx) => softMatch(ctx, "mornings", false),
  },
  {
    name: "soft-mornings-pos",
    priority: 5,
    re: /\b(?:prefer|like|love)\s+(?:early|morning)(?:\s+(?:classes|sections|courses))?\b/gi,
    handle: (ctx) => softMatch(ctx, "mornings", true),
  },
  {
    name: "soft-night-person-neg",
    priority: 5,
    re: /\bnot\s+a\s+(?:night|evening)\s+person\b/gi,
    handle: (ctx) => softMatch(ctx, "evenings", false),
  },
  {
    name: "soft-evenings-neg",
    priority: 5,
    re: /\b(?:no|not|avoid|skip|without|hate|dislike|dread)\s+(?:\w+\s+){0,2}?(?:evening|late|night)(?:\s+(?:classes|sections|courses))?\b/gi,
    handle: (ctx) => softMatch(ctx, "evenings", false),
  },
  {
    name: "soft-evenings-pos",
    priority: 5,
    re: /\b(?:prefer|like|love)\s+(?:evening|late|night)(?:\s+(?:classes|sections|courses))?\b/gi,
    handle: (ctx) => softMatch(ctx, "evenings", true),
  },
  {
    name: "soft-graders",
    priority: 5,
    re: /\beas(?:y|ier)\s+graders?\b|\beasy\s+(?:a'?s?|grading|professors?)\b|\blenient\s+grad(?:ers?|ing)\b|\bgrades?\s+easily\b/gi,
    handle: (ctx) => softMatch(ctx, "easierGraders"),
  },
];

function softMatch(ctx: MatchContext, key: SoftKey, positive = true): Cand {
  const strength = strengthFor(ctx, ctx.m[0]);
  return mkMatch(5, ctx, `soft.${key}`, strength, (intent) => {
    setSoft(intent, key, strength, positive);
  });
}

// Recognized-but-unexpressible families, tagged with exact spans.
const UNSUPPORTED_ROWS: Row[] = [
  {
    name: "tag-avoid-instructor",
    priority: 2,
    re: /\b(?:avoid|skipping|skip|not|no|don'?t\s+want)\s+(?:any\s+|a\s+|the\s+)?(?:class(?:es)?\s+(?:(?:with|from|by|taught\s+by)\s+))?(?:professor|prof\.?|dr\.?)\s+[a-z][a-z'-]*/gi,
    handle: (ctx) => mkUnsupported(2, ctx, "avoidInstructor"),
  },
  {
    name: "tag-max-classes",
    priority: 2,
    re: /\b(?:no\s+more\s+than\s+|at\s+most\s+|max(?:imum)?\s+of\s+)?\d+\s*(?:classes|courses|sections)\s*(?:a|per)\s+day\b|\b\d+\s*(?:classes|courses)\s*(?:a|per)\s+day\s+max\b/gi,
    handle: (ctx) => mkUnsupported(2, ctx, "maxClassesPerDay"),
  },
  {
    name: "tag-days-per-week",
    priority: 2,
    re: /\b(?:only\s+)?(?:come|be)\s+(?:(?:on|to)\s+(?:the\s+)?campus\s+)?(?:once|twice|three\s+times|four\s+times|five\s+times|\d+|one|two|three|four|five)\s*(?:days?)?\s*(?:a|per)\s+week\b|\b\d+\s+days\s+(?:a|per)\s+week\b/gi,
    handle: (ctx) => mkUnsupported(2, ctx, "exactDaysPerWeek"),
  },
  {
    name: "tag-afternoon",
    priority: 5,
    re: /\bno\s+afternoon\s+(?:classes|sections|courses)\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "timeOfDayBan"),
  },
  {
    name: "tag-free-on-day",
    priority: 6,
    re: new RegExp(String.raw`\b(?:i'?m|am|i\s+am)?\s*free\s+(?:on\s+)?(${DAYGROUP})\b`, "gi"),
    handle: (ctx) => mkUnsupported(6, ctx, "freeOnDay"),
  },
  {
    name: "tag-same-instructor",
    priority: 4,
    // Claim the whole scope phrase ("same instructor across sections",
    // "same professor twice") so the bare instructor row cannot win the span.
    re: /\bsame\s+(?:professor|instructor|teacher)\b(?:\s+(?:across|in|for)\s+(?:all\s+|both\s+|my\s+)?(?:sections?|classes|courses?)|\s+twice|\s+two\s+times)?/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "sameInstructor"),
  },
  {
    name: "tag-parking",
    priority: 5,
    re: /\bparking\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "parking"),
  },
  {
    name: "tag-course-level",
    priority: 2,
    re: /\b(?:only\s+)?(?:1000|2000|3000|4000)[ -]?level(?:\s+(?:courses|classes|sections))?\b|\bupper[ -]?level\b|\blower[ -]?level\b/gi,
    handle: (ctx) => mkUnsupported(2, ctx, "courseLevel"),
  },
  {
    name: "tag-meetings-per-week",
    priority: 5,
    re: /\b(?:meet|meets)\s+(?:only\s+)?once\s+(?:a|per)\s+week\b|\bonly\s+once\s+a\s+week\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "meetingsPerWeek"),
  },
  {
    name: "tag-duration",
    priority: 5,
    re: /\bno\s+(?:long\s+)?(?:2|3|two|three)[ -]?hour\s+(?:classes|blocks|labs)\b|\b(?:2|3)[ -]?hour\s+(?:classes|labs)\s+are\s+too\s+long\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "classDuration"),
  },
  {
    name: "tag-discovery-park",
    priority: 5,
    re: /\b(?:no|skip|avoid)\s+(?:discovery\s+park)\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "discoveryPark"),
  },
  {
    name: "tag-hybrid",
    priority: 5,
    re: /\bhybrid\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "hybridMode"),
  },
  {
    name: "tag-class-size",
    priority: 5,
    re: /\bsmall\s+(?:classes|sections)\b|\bclass\s+size\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "classSize"),
  },
  {
    name: "tag-gpa",
    priority: 5,
    re: /\b(?:minimum|at\s+least|above|over)\s+(?:a\s+)?\d(?:\.\d)?\s*(?:average\s+)?gpa\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "gpaThreshold"),
  },
  {
    name: "tag-online-preference",
    priority: 5,
    re: /\bas\s+much\s+online\s+as\s+possible\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "onlinePreference"),
  },
  {
    name: "tag-weekend",
    priority: 5,
    // Weekend asks the planner cannot hold: either an acceptance ("weekend
    // classes are fine") or a weekend commitment ("work Sunday morning").
    re: /\b(?:weekend|saturday|sunday)s?\s+(?:classes?|sections?|courses?|work|shifts?|training|practice|clinicals?|volunteering)\b|\b(?:work|works|working|shift|shifts|training|practice|volunteer|volunteering|clinicals?)\b[^.,;!?]{0,30}?\b(?:on\s+)?(?:weekends?|saturday|sunday)s?\b/gi,
    handle: (ctx) => mkUnsupported(5, ctx, "weekend"),
  },
  {
    name: "tag-instructor",
    priority: 5,
    re: /\b(?:professor|prof\.?|dr\.?|instructor)\s+([a-z][a-z'-]*)/gi,
    handle: (ctx) => mkUnsupported(5, ctx, negatedBefore(ctx.text, ctx.m.index) ? "avoidInstructor" : "instructor"),
  },
  {
    name: "tag-course-code",
    priority: 5,
    re: /\b([a-z]{2,4})\s?(\d{4})\b/gi,
    handle: (ctx) =>
      mkUnsupported(5, ctx, negatedBefore(ctx.text, ctx.m.index) ? "avoidedCourse" : "wantedCourse"),
  },
];

const ALL_ROWS: Row[] = [...BLOCKED_ROWS, ...DAY_OFF_ROWS, ...EARLIEST_ROWS, ...LATEST_ROWS, ...CREDIT_ROWS, ...SEAT_ROWS, ...CAMPUS_ROWS, ...MODE_ROWS, ...SOFT_ROWS, ...UNSUPPORTED_ROWS];

/** Words with no semantic content, trimmed from not-understood run edges. */
const FILLER =
  /^(?:hey|hi|hello|yo|thanks|thank|please|pls|so|well|ok|okay|um|uh|oh|i|me|my|we|our|you|your|it|its|it's|this|that|these|those|there|just|really|also|too|very|and|or|but|the|a|an|to|of|for|on|in|at|by|with|as|is|are|am|was|were|be|been|being|do|does|did|have|has|had|want|wanted|wants|need|needs|needed|like|would|could|can|should|will|i'd|i'll|if|possible|ideally|preferably|prefer|scheduling|make|sure|things|stuff|something|everything|them|they|though|tho|kinda|sorta|take|taking|get|got)$/;

/** Trim filler words from both ends of a text run. */
function trimFiller(text: string): { start: number; end: number } {
  let start = 0;
  let end = text.length;
  for (;;) {
    const m = /^\s*\S+\s*/.exec(text.slice(start, end));
    const tok = m?.[0].trim();
    if (m && tok && FILLER.test(tok)) start += m[0].length;
    else break;
  }
  for (;;) {
    const m = /\s*\S+\s*$/.exec(text.slice(start, end));
    const tok = m?.[0].trim();
    if (m && tok && FILLER.test(tok)) end -= m[0].length;
    else break;
  }
  return { start, end };
}

// ---------------------------------------------------------------------------
// parseIntent
// ---------------------------------------------------------------------------

/**
 * Parse one sentence of plain-language schedule preferences.
 * Pure and deterministic: no network, no model, no clock, no randomness.
 */
export function parseIntent(text: string): ParseResult {
  const norm = normalize(text);
  const intent = emptyIntent();
  const clauses = splitClauses(norm);

  const cands: Cand[] = [];
  for (const clause of clauses) {
    const clauseText = norm.slice(clause.start, clause.end);
    const ctxBase = { text: clauseText, offset: clause.start };
    for (const row of ALL_ROWS) {
      row.re.lastIndex = 0;
      for (const m of clauseText.matchAll(row.re)) {
        const ctx: MatchContext = { ...ctxBase, m };
        const out = row.handle(ctx);
        if (Array.isArray(out)) cands.push(...out.flat());
        else if (out) cands.push(out);
      }
    }
    // Post-pass: a day bound to a time ("Monday before 10") with no row
    // claiming the clause - the planner has no per-day start, so tag it.
    const hasDay = new RegExp(DAYGROUP, "i").test(clauseText);
    const hasTime =
      new RegExp(`${TIME_TOKEN_RE.source}|\\b(?:mornings?|afternoons?|evenings?)\\b`, "i").test(clauseText);
    if (hasDay && hasTime && !cands.some((c) => c.kind === "match" && overlaps(c, clause))) {
      cands.push({ kind: "unsupported", priority: 7, start: clause.start, end: clause.end, tag: "dayWithTime" });
    }
  }

  // Longest, highest-priority candidate claims its span first.
  cands.sort(
    (a, b) => a.priority - b.priority || b.end - b.start - (a.end - a.start) || a.start - b.start,
  );
  const accepted: Cand[] = [];
  for (const c of cands) {
    if (accepted.some((a) => overlaps(a, c))) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);

  for (const c of accepted) {
    if (c.kind === "match") c.apply(intent);
  }

  const understood: UnderstoodSpan[] = accepted
    .filter((c): c is Extract<Cand, { kind: "match" }> => c.kind === "match")
    .map((c) => ({
      start: c.start,
      end: c.end,
      text: text.slice(c.start, c.end),
      field: c.field,
      value: c.value,
    }));

  const notUnderstood: NotUnderstoodSpan[] = accepted
    .filter((c) => c.kind !== "match")
    .map((c) =>
      c.kind === "unsupported"
        ? { start: c.start, end: c.end, text: text.slice(c.start, c.end), reason: "unsupported" as const, tag: c.tag }
        : { start: c.start, end: c.end, text: text.slice(c.start, c.end), reason: "unparseable" as const },
    );

  // Not-understood residual: clause text no understood span covers, minus
  // filler words, so a UI can highlight what to ask about.
  for (const clause of clauses) {
    let uncovered: Interval[] = [{ ...clause }];
    for (const c of accepted) {
      if (!overlaps(c, clause)) continue;
      const next: Interval[] = [];
      for (const u of uncovered) {
        if (!overlaps(c, u)) {
          next.push(u);
          continue;
        }
        if (c.start > u.start) next.push({ start: u.start, end: c.start });
        if (c.end < u.end) next.push({ start: c.end, end: u.end });
      }
      uncovered = next;
    }
    for (const u of uncovered) {
      const trimmed = trimFiller(norm.slice(u.start, u.end));
      const residualStart = u.start + trimmed.start;
      const residualEnd = u.start + trimmed.end;
      if (residualEnd - residualStart >= 3) {
        notUnderstood.push({
          start: residualStart,
          end: residualEnd,
          text: text.slice(residualStart, residualEnd),
          reason: "unparseable",
        });
      }
    }
  }

  notUnderstood.sort((a, b) => a.start - b.start);
  return { intent, understood, notUnderstood };
}
