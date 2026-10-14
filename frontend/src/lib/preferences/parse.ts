/**
 * Deterministic, rule-based parsing of plain-language schedule preferences.
 *
 * `parseIntent` turns one student sentence into a `PreferenceIntent` plus a
 * record of what it understood and what it did not:
 *
 * - understood spans quote the exact slice of input behind every field
 *   they set, so a UI can highlight "before 10am" and show what it became.
 * - not-understood spans carry a reason: "unsupported" when the request is
 *   recognized but the schema has no way to hold it (tagged, for example
 *   `maxClassesPerDay`), or "unparseable" when text looks like a preference
 *   but no rule could read it.
 *
 * No network, no model, no dependencies: every rule is a regular
 * expression plus plain code, and the same input always produces the same
 * result. The contract of every field lives in `schema.ts`.
 *
 * Documented approximations (pinned by tests):
 * - A bare hour without am/pm is read by class-time plausibility: 1-7 is
 *   pm, 8-11 is am, 12 is noon, 0 is midnight. "9 to 1" is 9am to 1pm.
 * - "<time> is too early" becomes `earliestStart` at that time ("9am is
 *   too early" reads as "nothing before 9am"), which technically still
 *   allows a start exactly at that minute.
 * - A blocked range whose end is earlier than its start gets the pm
 *   reading for the end only when the end had no explicit am/pm.
 */

import {
  PREF_DAYS,
  emptyIntent,
  type PrefBlockedTime,
  type PrefDay,
  type PreferenceIntent,
  type SoftKey,
  type Strength,
  type InstructorPreference,
} from "./schema";

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
// Tokens
// ---------------------------------------------------------------------------

const TIME_TOKEN = String.raw`(?:noon|midnight|\d{1,2}(?::\d{2})?(?:\s*(?:a\.?m\.?|p\.?m\.?))?)`;
const DAY_WORD = String.raw`(?:mon(?:day)?|tues?(?:day)?|weds?(?:nesday)?|thur?s?(?:day)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)s?`;
const DAY_LIST = `${DAY_WORD}(?:\\s*(?:,|and|&|/)\\s*${DAY_WORD})*`;
const DAY_ATOM = String.raw`(?:(?:every\s+|each\s+)?(?:${DAY_LIST})|mwf|mw|tth|tt|week ?days?|weekends?|daily|every\s+day|each\s+day)`;
const RANGE_SEP = String.raw`(?:-|–|—|to|until|till|through|thru)`;
const CREDITS = String.raw`(?:credit\s*hours?|credit\s*hrs?|credits?|hrs?|hours?)`;

const ALL_DAYS: PrefDay[] = [...PREF_DAYS];
const WEEKDAYS: PrefDay[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const WEEKENDS: PrefDay[] = ["Sat", "Sun"];

function dayFromWord(word: string): PrefDay | null {
  const s = word.toLowerCase();
  if (s.startsWith("m")) return "Mon";
  if (s.startsWith("tu")) return "Tue";
  if (s.startsWith("th")) return "Thu";
  if (s.startsWith("w")) return "Wed";
  if (s.startsWith("f")) return "Fri";
  if (s.startsWith("sa")) return "Sat";
  if (s.startsWith("su")) return "Sun";
  return null;
}

/** Every day word inside a matched fragment, in canonical order. */
function daysFromFragment(fragment: string): PrefDay[] {
  const lower = fragment.toLowerCase();
  if (/week ?days?/.test(lower)) return [...WEEKDAYS];
  if (/weekends?/.test(lower)) return [...WEEKENDS];
  if (/daily|every\s+day|each\s+day/.test(lower)) return [...ALL_DAYS];
  const found: PrefDay[] = [];
  const re = new RegExp(`\\b${DAY_WORD}\\b|mwf|mw|tth|tt`, "gi");
  for (const m of lower.matchAll(re)) {
    const tok = m[0];
    if (/^mwf$/i.test(tok)) {
      for (const d of ["Mon", "Wed", "Fri"] as PrefDay[]) if (!found.includes(d)) found.push(d);
      continue;
    }
    if (/^tth$|^tt$/i.test(tok)) {
      for (const d of ["Tue", "Thu"] as PrefDay[]) if (!found.includes(d)) found.push(d);
      continue;
    }
    if (/^mw$/i.test(tok)) {
      for (const d of ["Mon", "Wed"] as PrefDay[]) if (!found.includes(d)) found.push(d);
      continue;
    }
    const day = dayFromWord(tok);
    if (day && !found.includes(day)) found.push(day);
  }
  return sortDays(found);
}

function sortDays(days: PrefDay[]): PrefDay[] {
  return [...days].sort((a, b) => PREF_DAYS.indexOf(a) - PREF_DAYS.indexOf(b));
}

/**
 * Parse one time token. Returns minutes after midnight and whether the
 * token said am/pm explicitly. Bare hours follow the documented
 * plausibility rule (1-7 pm, 8-11 am, 12 noon, 0 midnight).
 */
function parseTime(raw: string): { minutes: number; explicit: boolean } | null {
  const t = raw
    .trim()
    .toLowerCase()
    .replace(/o'?clock/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t === "noon") return { minutes: 720, explicit: true };
  if (t === "midnight") return { minutes: 0, explicit: true };
  const m = /^(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/.exec(t);
  if (!m) return null;
  const h = Number.parseInt(m[1], 10);
  const min = m[2] ? Number.parseInt(m[2], 10) : 0;
  const mer = m[3] ? m[3].replace(/\./g, "") : null;
  if (h > 12 || min > 59) return null;
  if (mer === "am") return { minutes: (h % 12) * 60 + min, explicit: true };
  if (mer === "pm") return { minutes: ((h % 12) + 12) * 60 + min, explicit: true };
  if (h === 0) return { minutes: 0, explicit: false };
  if (h >= 1 && h <= 7) return { minutes: (h + 12) * 60 + min, explicit: false };
  if (h >= 8 && h <= 11) return { minutes: h * 60 + min, explicit: false };
  return { minutes: 720 + min, explicit: false };
}

/** How strongly the student asked, judging from the words just before. */
function strengthBefore(text: string, idx: number): Strength {
  const window = text.slice(Math.max(0, idx - 30), idx).toLowerCase();
  if (/\b(?:really|definitely|must|please|strongly|desperately|absolutely|hate|need)\b/.test(window)) {
    return "strong";
  }
  return "mild";
}

// ---------------------------------------------------------------------------
// Candidate matches, overlap resolution and application
// ---------------------------------------------------------------------------

type Candidate =
  | {
      kind: "match";
      priority: number;
      start: number;
      end: number;
      field: string;
      value: unknown;
      apply: (intent: PreferenceIntent) => void;
    }
  | {
      kind: "unsupported";
      priority: number;
      start: number;
      end: number;
      tag: string;
    }
  | { kind: "unparseable"; priority: number; start: number; end: number };

function match(
  priority: number,
  text: string,
  m: RegExpExecArray,
  field: string,
  value: unknown,
  apply: (intent: PreferenceIntent) => void,
): Candidate {
  return { kind: "match", priority, start: m.index, end: m.index + m[0].length, field, value, apply };
}

function unsupported(priority: number, text: string, m: RegExpExecArray, tag: string): Candidate {
  return { kind: "unsupported", priority, start: m.index, end: m.index + m[0].length, tag };
}

function overlaps(a: { start: number; end: number }, b: { start: number; end: number }): boolean {
  return a.start < b.end && b.start < a.end;
}

function setSoft(intent: PreferenceIntent, key: SoftKey, strength: Strength): void {
  const existing = intent.soft.find((s) => s.key === key);
  if (existing) existing.strength = strength;
  else intent.soft.push({ key, strength });
}

// ---------------------------------------------------------------------------
// Matcher families, in priority order (lower priority number wins overlaps)
// ---------------------------------------------------------------------------

const VERB = String.raw`(?:work|shift|practice|training|train|rehearsal|rehearse|babysit|volunteer|clinical|lab rotation|lab|meeting)`;

function findBlocked(text: string): Candidate[] {
  const out: Candidate[] = [];
  const time = TIME_TOKEN;
  const sep = RANGE_SEP;
  const atom = DAY_ATOM;

  // A: "Mondays I work 9 to 2" - days, then a commitment verb, then a range.
  const reA = new RegExp(
    String.raw`\b(?:on\s+)?(${atom})\b[^.,;!?]{0,40}?\b(?:i\s+)?(${VERB})\b[^.,;!?]{0,40}?\b(${time})\s*(?:${sep})\s*(${time})\b`,
    "gi",
  );
  // A2: "I work Mondays 9 to 2" - verb, then days, then a range.
  const reA2 = new RegExp(
    String.raw`\b(?:i\s+)?(${VERB})\b[^.,;!?]{0,40}?\b(?:on\s+)?(${atom})\b[^.,;!?]{0,40}?\b(${time})\s*(?:${sep})\s*(${time})\b`,
    "gi",
  );
  // B: "keep 12-1 free", "keep 12 to 1 free on weekdays for lunch".
  const reB = new RegExp(
    String.raw`\b(?:keep|block|set aside|reserve)\s+(${time})\s*(?:${sep})\s*(${time})\b(?:\s*(?:free|open|clear|blocked))?(?:\s+for\s+([a-z]+))?(?:\s+(?:on\s+)?(${atom})\b)?`,
    "gi",
  );
  // C: "Tuesday and Thursday 2-5pm", "daily 9 to 5".
  const reC = new RegExp(
    String.raw`\b(?:on\s+)?(${atom})\b(?:\s+from\s+|\s+)?(${time})\s*(?:${sep})\s*(${time})\b`,
    "gi",
  );
  // E: "I work 9-2" - a commitment verb and a range, no days: every day.
  const reE = new RegExp(
    String.raw`\b(?:i\s+)?(${VERB})\b[^.,;!?]{0,30}?\b(${time})\s*(?:${sep})\s*(${time})\b(?:\s+(?:on\s+)?(${atom})\b)?`,
    "gi",
  );
  // F: "no 8am classes", "no 9ams", "can't do 8ams" - the hour itself is
  // blocked, one hour wide.
  const reF = new RegExp(
    String.raw`\bno\s+(${time})\s*(?:a\.?m\.?|p\.?m\.?)?s?\s+(?:classes|sections|courses)\b`,
    "gi",
  );
  const reF2 = new RegExp(
    String.raw`\bcan'?t\s+do\s+(${time})\s*(?:a\.?m\.?|p\.?m\.?)?s?\b`,
    "gi",
  );
  // "no 8ams" - the plural hour alone, no noun needed.
  const reF3 = new RegExp(
    String.raw`\bno\s+(${time})\s*(?:a\.?m\.?|p\.?m\.?)?s\b`,
    "gi",
  );

  const shapes: Array<{
    re: RegExp;
    daysGroup: number | null;
    timeA: number;
    timeB: number | null;
    labelGroup: number | null;
  }> = [
    { re: reA, daysGroup: 1, timeA: 3, timeB: 4, labelGroup: 2 },
    { re: reA2, daysGroup: 2, timeA: 3, timeB: 4, labelGroup: 1 },
    { re: reB, daysGroup: 4, timeA: 1, timeB: 2, labelGroup: 3 },
    { re: reC, daysGroup: 1, timeA: 2, timeB: 3, labelGroup: null },
    { re: reE, daysGroup: 4, timeA: 2, timeB: 3, labelGroup: 1 },
    { re: reF, daysGroup: null, timeA: 1, timeB: null, labelGroup: null },
    { re: reF2, daysGroup: null, timeA: 1, timeB: null, labelGroup: null },
    { re: reF3, daysGroup: null, timeA: 1, timeB: null, labelGroup: null },
  ];

  for (const shape of shapes) {
    shape.re.lastIndex = 0;
    for (const m of text.matchAll(shape.re)) {
      const a = parseTime(m[shape.timeA]);
      if (!a) continue;
      const b = shape.timeB ? parseTime(m[shape.timeB]) : { minutes: a.minutes + 60, explicit: true };
      if (!b) continue;
      let end = b.minutes;
      if (end <= a.minutes && !b.explicit) end += 720;
      if (end <= a.minutes) {
        out.push({ kind: "unparseable", priority: 1, start: m.index, end: m.index + m[0].length });
        continue;
      }
      const frag = shape.daysGroup != null ? m[shape.daysGroup] : null;
      const days = frag ? daysFromFragment(frag) : [...ALL_DAYS];
      const labelWord = shape.labelGroup ? m[shape.labelGroup] : null;
      const label = labelWord ? labelWord.toLowerCase() : undefined;
      const items: PrefBlockedTime[] = days.map((day) => ({ day, start: a.minutes, end, label }));
      out.push(
        match(1, text, m, "hard.blockedTimes", items, (intent) => {
          for (const item of items) {
            const dup = intent.hard.blockedTimes.some(
              (b0) => b0.day === item.day && b0.start === item.start && b0.end === item.end,
            );
            if (!dup) intent.hard.blockedTimes.push(item);
          }
        }),
      );
    }
  }
  return out;
}

function findDaysOff(text: string): Candidate[] {
  const out: Candidate[] = [];
  const atom = DAY_ATOM;
  const push = (m: RegExpExecArray, fragment: string) => {
    const days = daysFromFragment(fragment);
    if (days.length === 0) return;
    out.push(
      match(2, text, m, "hard.daysOff", days, (intent) => {
        for (const d of days) if (!intent.hard.daysOff.includes(d)) intent.hard.daysOff.push(d);
        intent.hard.daysOff = sortDays(intent.hard.daysOff);
      }),
    );
  };

  // "no classes on Friday", "don't want Friday classes", "skip Mondays and Tuesdays"
  const DAY_LIST_FULL = `((${atom})(?:\\s*(?:,|or|and|&)\\s*${atom})*)`;
  const reN1 = new RegExp(
    String.raw`\b(?:no|skip|skipping|avoid|avoiding|don'?t|do not|not)\s+(?:want\s+(?:to\s+)?|wanna\s+|have\s+|schedule\s+|book\s+)?(?:classes|sections|courses|class|anything)?\s*(?:on|during|over|in)?\s*` +
      DAY_LIST_FULL +
      String.raw`\b`,
    "gi",
  );
  // "Fridays off", "weekends are off"
  const reN2 = new RegExp(String.raw`\b(${atom})\s+(?:are\s+|is\s+)?off\b`, "gi");
  // "keep Fridays free", "leave my Fridays open"
  const reN3 = new RegExp(String.raw`\b(?:keep|keeping|leave|leaving)\s+(?:my\s+)?(${atom})\s+(?:free|open)\b`, "gi");
  // "free on Wednesdays", "I'm free Wednesdays"
  const reN4 = new RegExp(String.raw`\bfree\s+(?:on\s+)?(${atom})\b`, "gi");
  // "nothing on Mondays"
  const reN6 = new RegExp(String.raw`\bnothing\s+(?:on|during)\s+(${atom})\b`, "gi");
  // "I go home Fridays"
  const reN7 = new RegExp(String.raw`\b(?:i\s+)?(?:go|going|went)\s+(?:back\s+)?home\s+(?:on\s+)?(${atom})\b`, "gi");
  // "only MWF" - attendance days named, the rest are days off.
  const reN8 = /\b(?:only\s+(?:on\s+)?(mwf|mw|tth|tt)|(mwf|mw|tth|tt)\s+only)\b/gi;
  // "I have church on Sundays"
  const reN10 = new RegExp(String.raw`\b(?:church|temple|mass)\s+on\s+(${atom})\b`, "gi");
  // "Fridays are free"
  const reN11 = new RegExp(String.raw`\b(${atom})\s+(?:are|is)\s+free\b`, "gi");

  for (const m of text.matchAll(reN1)) push(m, m[1]);
  for (const m of text.matchAll(reN2)) push(m, m[1]);
  for (const m of text.matchAll(reN3)) push(m, m[1]);
  for (const m of text.matchAll(reN4)) push(m, m[1]);
  for (const m of text.matchAll(reN6)) push(m, m[1]);
  for (const m of text.matchAll(reN7)) push(m, m[1]);
  for (const m of text.matchAll(reN10)) push(m, m[1]);
  for (const m of text.matchAll(reN11)) push(m, m[1]);
  for (const m of text.matchAll(reN8)) {
    const attending = daysFromFragment((m[1] ?? m[2] ?? "").replace(/^mwf$/i, "mon wed fri").replace(/^mw$/i, "mon wed").replace(/^tth$|^tt$/i, "tue thu"));
    const days = sortDays(ALL_DAYS.filter((d) => !attending.includes(d)));
    if (days.length === 0) continue;
    out.push(
      match(2, text, m, "hard.daysOff", days, (intent) => {
        for (const d of days) if (!intent.hard.daysOff.includes(d)) intent.hard.daysOff.push(d);
        intent.hard.daysOff = sortDays(intent.hard.daysOff);
      }),
    );
  }
  return out;
}

function findEarliestStart(text: string): Candidate[] {
  const out: Candidate[] = [];
  const time = TIME_TOKEN;
  const pushTime = (m: RegExpExecArray, g: number) => {
    const parsed = parseTime(m[g]);
    if (!parsed) return;
    out.push(
      match(3, text, m, "hard.earliestStart", parsed.minutes, (intent) => {
        intent.hard.earliestStart = parsed.minutes;
      }),
    );
  };

  const reE1 = new RegExp(
    String.raw`\b(?:no|nothing|don'?t|do not|can'?t|cannot|can not)\s+(?:want\s+to\s+|want\s+|wanna\s+|to\s+|have\s+|do\s+|take\s+|taking\s+)?(?:classes|sections|courses|class|anything)?\s*(?:that\s+|which\s+)?(?:start|starts|starting|begin|begins|beginning)?\s*(?:any\s+)?(?:earlier\s+than|before)\s+(${time})\b`,
    "gi",
  );
  const reE2 = new RegExp(String.raw`\bnot\s+(?:any\s+)?(?:earlier\s+than|before)\s+(${time})\b`, "gi");
  const reE3 = new RegExp(String.raw`\b(?:don'?t|do not|can'?t|cannot)\s+(?:start|begin)\s+(?:until|till)\s+(${time})\b`, "gi");
  const reE4 = new RegExp(
    String.raw`\b(?:first|earliest)\s+(?:class|course|section)\s+(?:can'?t|cannot|can not|shouldn'?t|should not|won'?t)\s+(?:start|begin)\s+(?:before|until|till)\s+(${time})\b`,
    "gi",
  );
  const reE5 = new RegExp(String.raw`\bearliest\s+(?:i\s+)?(?:can|could)?\s*(?:start|begin)\s+(?:is\s+|at\s+)?(${time})\b`, "gi");
  const reE6 = /\bno\s+(?:morning|early\s+morning|early)\s+(?:classes|sections|courses)\b/gi;
  const reE7 = new RegExp(String.raw`\b(${time})\s*(?:a\.?m\.?|p\.?m\.?)?s?\s+(?:are|is)\s+too\s+early\b`, "gi");

  for (const m of text.matchAll(reE1)) pushTime(m, 1);
  for (const m of text.matchAll(reE2)) pushTime(m, 1);
  for (const m of text.matchAll(reE3)) pushTime(m, 1);
  for (const m of text.matchAll(reE4)) pushTime(m, 1);
  for (const m of text.matchAll(reE5)) pushTime(m, 1);
  for (const m of text.matchAll(reE6)) {
    out.push(
      match(3, text, m, "hard.earliestStart", 720, (intent) => {
        intent.hard.earliestStart = 720;
      }),
    );
  }
  for (const m of text.matchAll(reE7)) pushTime(m, 1);
  return out;
}

function findLatestEnd(text: string): Candidate[] {
  const out: Candidate[] = [];
  const time = TIME_TOKEN;
  const pushTime = (m: RegExpExecArray, g: number) => {
    const parsed = parseTime(m[g]);
    if (!parsed) return;
    out.push(
      match(3, text, m, "hard.latestEnd", parsed.minutes, (intent) => {
        intent.hard.latestEnd = parsed.minutes;
      }),
    );
  };

  const reL1 = new RegExp(
    String.raw`\b(?:no|nothing|don'?t|do not|can'?t|cannot)\s+(?:want\s+to\s+|want\s+|wanna\s+|to\s+|have\s+|do\s+|take\s+|taking\s+)?(?:classes|sections|courses|class|anything)?\s*(?:that\s+|which\s+)?(?:end|ends|ending|run|runs|running|go|goes|going|last|lasting|let|lets|stay|stays|staying)?\s*(?:out\s+)?(?:any\s+)?(?:later\s+than|after|past)\s+(${time})\b`,
    "gi",
  );
  const reL2 = new RegExp(String.raw`\bnot\s+(?:any\s+)?later\s+than\s+(${time})\b`, "gi");
  const reL3 = new RegExp(String.raw`\b(?:done|out|finished|over|finish)\s+(?:by|before)\s+(${time})\b`, "gi");
  const reL4 = new RegExp(String.raw`\b(?:end|ends|ending|let\s+out|lets\s+out)\s+by\s+(${time})\b`, "gi");
  const reL5 = new RegExp(
    String.raw`\b(?:i\s+)?(?:need|have)\s+to\s+(?:be\s+)?(?:done|out|gone|off|leave|leaving)\s+(?:by|at|before)\s+(${time})\b`,
    "gi",
  );
  const reL6 = new RegExp(String.raw`\blatest\s+(?:class|course|section)?\s*(?:can\s+|should\s+)?(?:end|ends|go|let\s+out)\s+(?:at|by|till|until)?\s*(${time})\b`, "gi");
  const reL7 = new RegExp(String.raw`\b(${time})\s*(?:a\.?m\.?|p\.?m\.?)?s?\s+(?:are|is)\s+too\s+late\b`, "gi");
  // "nothing before 10am or after 6pm" - the tail, once the head is claimed.
  const reL8 = new RegExp(String.raw`\bor\s+after\s+(${time})\b`, "gi");
  // "I want to be home by 5"
  const reL9 = new RegExp(String.raw`\bhome\s+by\s+(${time})\b`, "gi");

  for (const m of text.matchAll(reL1)) pushTime(m, 1);
  for (const m of text.matchAll(reL2)) pushTime(m, 1);
  for (const m of text.matchAll(reL3)) pushTime(m, 1);
  for (const m of text.matchAll(reL4)) pushTime(m, 1);
  for (const m of text.matchAll(reL5)) pushTime(m, 1);
  for (const m of text.matchAll(reL6)) pushTime(m, 1);
  for (const m of text.matchAll(reL7)) pushTime(m, 1);
  for (const m of text.matchAll(reL8)) pushTime(m, 1);
  for (const m of text.matchAll(reL9)) pushTime(m, 1);
  return out;
}

function findCredits(text: string): Candidate[] {
  const out: Candidate[] = [];
  const c = CREDITS;

  const reMax = new RegExp(String.raw`\b(?:no\s+more\s+than|max(?:imum)?(?:\s+of)?|at\s+most|up\s+to)\s+(\d{1,2})\s*${c}\b`, "gi");
  const reMaxStrict = new RegExp(String.raw`\b(?:fewer\s+than|less\s+than|under)\s+(\d{1,2})\s*${c}\b`, "gi");
  const reMin = new RegExp(String.raw`\b(?:at\s+least|minimum(?:\s+of)?|min\s+of|no\s+fewer\s+than)\s+(\d{1,2})\s*${c}\b`, "gi");
  const reMinStrict = new RegExp(String.raw`\b(?:more\s+than|over)\s+(\d{1,2})\s*${c}\b`, "gi");
  const reExact = new RegExp(String.raw`\bexactly\s+(\d{1,2})\s*${c}\b`, "gi");
  const reRange = new RegExp(String.raw`\b(?:between\s+)?(\d{1,2})\s*(?:-|–|to|and)\s*(\d{1,2})\s*${c}\b`, "gi");
  // "15 hours max", "15 credits or fewer", "16 or more credits", "I need 12 credits"
  // Reversed order: "12 or fewer credits", "16 or more credits".
  const reFewerCredits = new RegExp(String.raw`\b(\d{1,2})\s+or\s+(?:fewer|less)\s*${c}\b`, "gi");
  const reMoreCredits = new RegExp(String.raw`\b(\d{1,2})\s+or\s+more\s*${c}\b`, "gi");
  const reMaxSuffix = new RegExp(String.raw`\b(\d{1,2})\s*${c}\s+max\b`, "gi");
  const reMaxOrFewer = new RegExp(String.raw`\b(\d{1,2})\s*${c}\s+or\s+(?:fewer|less)\b`, "gi");
  const reMinOrMore = new RegExp(String.raw`\b(\d{1,2})\s*${c}\s+or\s+more\b`, "gi");
  const reMinNeed = new RegExp(String.raw`\b(?:i\s+)?(?:need|needs|must\s+take|have\s+to\s+have)\s+(\d{1,2})\s*${c}\b`, "gi");

  for (const m of text.matchAll(reMax)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMax", v, (i) => (i.hard.creditMax = v)));
  }
  for (const m of text.matchAll(reMaxStrict)) {
    const v = Number.parseInt(m[1], 10) - 1;
    out.push(match(3, text, m, "hard.creditMax", v, (i) => (i.hard.creditMax = v)));
  }
  for (const m of text.matchAll(reMin)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMin", v, (i) => (i.hard.creditMin = v)));
  }
  for (const m of text.matchAll(reMinStrict)) {
    const v = Number.parseInt(m[1], 10) + 1;
    out.push(match(3, text, m, "hard.creditMin", v, (i) => (i.hard.creditMin = v)));
  }
  for (const m of text.matchAll(reExact)) {
    const v = Number.parseInt(m[1], 10);
    out.push(
      match(3, text, m, "hard.creditMin", v, (i) => {
        i.hard.creditMin = v;
        i.hard.creditMax = v;
      }),
    );
  }
  for (const m of text.matchAll(reRange)) {
    const lo = Number.parseInt(m[1], 10);
    const hi = Number.parseInt(m[2], 10);
    if (lo > hi) continue;
    out.push(
      match(3, text, m, "hard.creditMin", lo, (i) => {
        i.hard.creditMin = lo;
        i.hard.creditMax = hi;
      }),
    );
  }
  for (const m of text.matchAll(reMaxSuffix)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMax", v, (i) => (i.hard.creditMax = v)));
  }
  for (const m of text.matchAll(reMaxOrFewer)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMax", v, (i) => (i.hard.creditMax = v)));
  }
  for (const m of text.matchAll(reMinOrMore)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMin", v, (i) => (i.hard.creditMin = v)));
  }
  for (const m of text.matchAll(reMoreCredits)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMin", v, (i) => (i.hard.creditMin = v)));
  }
  for (const m of text.matchAll(reFewerCredits)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMax", v, (i) => (i.hard.creditMax = v)));
  }
  for (const m of text.matchAll(reMinNeed)) {
    const v = Number.parseInt(m[1], 10);
    out.push(match(3, text, m, "hard.creditMin", v, (i) => (i.hard.creditMin = v)));
  }
  return out;
}

function findSeats(text: string): Candidate[] {
  const out: Candidate[] = [];
  const patterns = [
    /\bonly\s+(?:classes|sections|courses)?\s*(?:with|that\s+have|that\s+still\s+have)\s+open\s+seats\b/gi,
    /\bopen\s+seats\s+only\b/gi,
    /\bno\s+(?:closed|full|waitlisted|wait-listed)\s+(?:classes|sections|courses)\b/gi,
    /\bdon'?t\s+(?:pick|choose|suggest|show|use)\s+(?:me\s+)?(?:any\s+)?(?:closed|full|waitlisted|wait-listed)\b/gi,
    /\bnothing\s+(?:waitlisted|wait-listed|closed|full)\b/gi,
    /\bmake\s+sure\s+(?:they|it)\s+(?:have|has)\s+open\s+seats\b/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      out.push(match(4, text, m, "hard.openSeatsOnly", true, (i) => (i.hard.openSeatsOnly = true)));
    }
  }
  return out;
}

function findCampus(text: string): Candidate[] {
  const out: Candidate[] = [];
  const denton = [
    /\b(?:denton|main)\s+campus\s+only\b/gi,
    /\bonly\s+(?:the\s+)?(?:denton|main)\s+campus\b/gi,
    /\bdenton\s+only\b/gi,
    /\bno\s+(?:frisco|other\s+(?:campuses|sites))\b/gi,
    /\bdon'?t\s+(?:send|put|schedule)\s+me\s+(?:in|at|to)\s+frisco\b/gi,
    /\b(?:frisco|other\s+(?:campuses|sites))\s+(?:is|are)\s+too\s+far\b/gi,
    /\bkeep\s+me\s+(?:at|on)\s+(?:the\s+)?(?:main|denton)\s+campus\b/gi,
  ];
  const other = [
    /\b(?:frisco|other\s+(?:campuses|sites))\s+(?:is|are)\s+(?:fine|ok|okay|alright|good)\b/gi,
    /\b(?:i\s+)?(?:can|could)\s+(?:go|drive)\s+to\s+(?:frisco|other\s+(?:campuses|sites))\b/gi,
    /\bdon'?t\s+mind\s+(?:going\s+to\s+|driving\s+to\s+)?(?:frisco|other\s+(?:campuses|sites))\b/gi,
    /\bopen\s+to\s+(?:frisco|other\s+(?:campuses|sites))\b/gi,
    /\bother\s+(?:campuses|sites)\s+work\b/gi,
    /\bfrisco\s+works\b/gi,
  ];
  for (const re of denton) {
    for (const m of text.matchAll(re)) {
      out.push(match(4, text, m, "hard.campusScope", "dentonOnly", (i) => (i.hard.campusScope = "dentonOnly")));
    }
  }
  for (const re of other) {
    for (const m of text.matchAll(re)) {
      out.push(match(4, text, m, "hard.campusScope", "otherSitesOk", (i) => (i.hard.campusScope = "otherSitesOk")));
    }
  }
  return out;
}

function findMode(text: string): Candidate[] {
  const out: Candidate[] = [];
  const online = [
    /\b(?:all\s+)?online\s+only\b/gi,
    /\bonly\s+online\s+(?:classes|sections|courses)\b/gi,
    /\beverything\s+online\b/gi,
    /\bno\s+(?:in[ -]?person|campus)\s+(?:classes|sections|courses)\b/gi,
    /\bwant\s+(?:it\s+)?all\s+online\b/gi,
    /\ball\s+online\b/gi,
  ];
  const inPerson = [
    /\bin[ -]?person\s+only\b/gi,
    /\bonly\s+in[ -]?person\b/gi,
    /\bno\s+online\s+(?:classes|sections|courses)\b/gi,
    /\bface[ -]to[ -]face\s+only\b/gi,
    /\b(?:want|need)\s+to\s+be\s+in\s+(?:a\s+)?classroom\b/gi,
  ];
  for (const re of online) {
    for (const m of text.matchAll(re)) {
      out.push(match(4, text, m, "hard.mode", "online", (i) => (i.hard.mode = "online")));
    }
  }
  for (const re of inPerson) {
    for (const m of text.matchAll(re)) {
      out.push(match(4, text, m, "hard.mode", "inPerson", (i) => (i.hard.mode = "inPerson")));
    }
  }
  return out;
}

const COURSE_CODE = /\b([a-z]{2,4})\s?(\d{4})\b/gi;

const WANTED_CUES: Array<{ re: RegExp; kind: "wanted" | "avoided" }> = [
  { re: /\bdon'?t want to (?:take|add)/gi, kind: "avoided" },
  { re: /\bdo not want to (?:take|add)/gi, kind: "avoided" },
  { re: /\bdon'?t want/gi, kind: "avoided" },
  { re: /\bdo not want/gi, kind: "avoided" },
  { re: /\bnot interested in/gi, kind: "avoided" },
  { re: /\banything but/gi, kind: "avoided" },
  { re: /\bavoiding/gi, kind: "avoided" },
  { re: /\bavoid/gi, kind: "avoided" },
  { re: /\bskipping/gi, kind: "avoided" },
  { re: /\bskip/gi, kind: "avoided" },
  { re: /\bsigning up for/gi, kind: "wanted" },
  { re: /\bsign up for/gi, kind: "wanted" },
  { re: /\bhave to take/gi, kind: "wanted" },
  { re: /\bmust take/gi, kind: "wanted" },
  { re: /\bhoping for/gi, kind: "wanted" },
  { re: /\bplanning to take/gi, kind: "wanted" },
  { re: /\bplanning on/gi, kind: "wanted" },
  { re: /\brequire/gi, kind: "wanted" },
  { re: /\btaking/gi, kind: "wanted" },
  { re: /\btake/gi, kind: "wanted" },
  { re: /\bwanted/gi, kind: "wanted" },
  { re: /\bwant/gi, kind: "wanted" },
  { re: /\bneed/gi, kind: "wanted" },
  { re: /\bneeds/gi, kind: "wanted" },
  { re: /\badd/gi, kind: "wanted" },
  { re: /\bno/gi, kind: "avoided" },
  { re: /\bhate/gi, kind: "avoided" },
];

function classifyCourse(text: string, codeStart: number): "wanted" | "avoided" | null {
  const windowStart = Math.max(0, codeStart - 60);
  const window = text.slice(windowStart, codeStart);
  let best: { end: number; len: number; kind: "wanted" | "avoided" } | null = null;
  for (const cue of WANTED_CUES) {
    cue.re.lastIndex = 0;
    for (const m of window.matchAll(cue.re)) {
      const end = m.index + m[0].length;
      const len = m[0].length;
      if (!best || end > best.end || (end === best.end && len > best.len)) {
        best = { end, len, kind: cue.kind };
      }
    }
  }
  return best ? best.kind : null;
}

function normalizeCode(dept: string, num: string): string {
  return `${dept.toUpperCase()} ${num}`;
}

function findCourses(text: string): Candidate[] {
  const out: Candidate[] = [];
  COURSE_CODE.lastIndex = 0;
  let lastEnd: number | null = null;
  let lastKind: "wanted" | "avoided" | null = null;
  for (const m of text.matchAll(COURSE_CODE)) {
    const code = normalizeCode(m[1], m[2]);
    const gap = lastEnd != null ? text.slice(lastEnd, m.index) : null;
    const pureGap = gap != null && /^\s*(?:,|;|&|\band\b|\bor\b|\s)+$/i.test(gap);
    const kind: "wanted" | "avoided" | null = pureGap && lastKind ? lastKind : classifyCourse(text, m.index);
    lastEnd = m.index + m[0].length;
    if (!kind) {
      lastKind = null;
      continue;
    }
    lastKind = kind;
    out.push(
      match(5, text, m, kind === "wanted" ? "hard.wantedCourses" : "hard.avoidedCourses", code, (i) => {
        const list = kind === "wanted" ? i.hard.wantedCourses : i.hard.avoidedCourses;
        if (!list.includes(code)) list.push(code);
      }),
    );
  }
  return out;
}

function findInstructor(text: string): Candidate[] {
  const out: Candidate[] = [];
  const reNamed = /\b(?:professor|prof\.?|dr\.?|instructor)\s+([a-z][a-z'’-]*)/gi;
  for (const m of text.matchAll(reNamed)) {
    // "avoid professor Smith" is recognized as unsupported elsewhere; skip here.
    const before = text.slice(Math.max(0, m.index - 20), m.index).toLowerCase();
    if (/\b(?:avoid|skip|no|not)\s*$/.test(before)) continue;
    const name = m[1][0].toUpperCase() + m[1].slice(1);
    const strength = strengthBefore(text, m.index);
    const pref: InstructorPreference = { kind: "named", name, strength };
    out.push(
      match(5, text, m, "instructor", pref, (i) => {
        i.instructor = pref;
      }),
    );
  }
  const easier = [
    /\beas(?:y|ier)\s+graders?\b/gi,
    /\beasy\s+(?:a'?s?|grading)\b/gi,
    /\blenient\s+grad(?:ers?|ing)\b/gi,
    /\bgrades?\s+easily\b/gi,
  ];
  for (const re of easier) {
    for (const m of text.matchAll(re)) {
      const strength = strengthBefore(text, m.index);
      const pref: InstructorPreference = { kind: "easierGraders", strength };
      out.push(
        match(5, text, m, "instructor", pref, (i) => {
          i.instructor = pref;
        }),
      );
    }
  }
  return out;
}

function findSoft(text: string): Candidate[] {
  const out: Candidate[] = [];
  const pushSoft = (m: RegExpExecArray, key: SoftKey) => {
    // "as possible" inside the phrase itself signals a strong ask.
    const inPhrase = /as\s+possible/i.test(m[0]) ? "strong" : strengthBefore(text, m.index);
    const strength: Strength = inPhrase;
    out.push(
      match(6, text, m, `soft.${key}`, strength, (i) => setSoft(i, key, strength)),
    );
  };

  // spreadOut first so "don't want back-to-back" claims the span.
  const spread = [
    /\b(?:don'?t|do not|no|avoid)\s+(?:want\s+)?(?:them\s+)?back[ -]to[ -]back\b/gi,
    /\bspread\s+(?:it|them|my\s+classes|everything)?\s*out\b/gi,
    /\bgaps?\s+between\s+(?:my\s+)?classes\b/gi,
    /\bbreaks?\s+between\s+(?:my\s+)?classes\b/gi,
    /\bspace\s+(?:it|them)\s+out\b/gi,
  ];
  const compact = [
    /\bcompact\b/gi,
    /\bback[ -]to[ -]back\b/gi,
    /\btight\s+schedule\b/gi,
    /\bclump(?:ed)?\b/gi,
    /\bno\s+(?:long\s+)?gaps\b/gi,
    /\bfewer\s+gaps\b/gi,
    /\bminimal\s+gaps\b/gi,
    /\bget\s+(?:it|them)\s+(?:all\s+)?over\s+with\b/gi,
    /\bknock(?:ed)?\s+(?:it|them)\s+out\b/gi,
  ];
  const fewerDays = [
    /\bfewer\s+days(?:\s+on\s+campus)?\b/gi,
    /\bless\s+days\b/gi,
    /\bfewest\s+days\b/gi,
    /\bas\s+few\s+days\s+(?:on\s+campus\s+)?as\s+possible\b/gi,
    /\bminimi[sz]e\s+(?:my\s+)?days\s+on\s+campus\b/gi,
  ];
  const walking = [
    /\bminimal\s+walking\b/gi,
    /\bas\s+little\s+walking\s+as\s+possible\b/gi,
    /\bwalk\s+as\s+little\s+as\s+possible\b/gi,
    /\bshort\s+walks?\s+between\b/gi,
    /\bdon'?t\s+want\s+to\s+walk\s+(?:far|a\s+lot|much|across\s+campus)\b/gi,
    /\bno\s+long\s+walks\b/gi,
  ];

  for (const re of spread) for (const m of text.matchAll(re)) pushSoft(m, "spreadOut");
  for (const re of compact) for (const m of text.matchAll(re)) pushSoft(m, "compact");
  for (const re of fewerDays) for (const m of text.matchAll(re)) pushSoft(m, "fewerDays");
  for (const re of walking) for (const m of text.matchAll(re)) pushSoft(m, "minimalWalking");
  return out;
}

const UNSUPPORTED_TAG: Array<{ re: RegExp; tag: string }> = [
  { re: /\b(?:no\s+more\s+than|at\s+most|max(?:imum)?\s+of)\s*\d+\s*(?:classes|courses|sections)\s*(?:a|per)\s*day\b/gi, tag: "maxClassesPerDay" },
  { re: /\b\d+\s*(?:classes|courses)\s*(?:a|per)\s*day\s+max\b/gi, tag: "maxClassesPerDay" },
  { re: /\b(?:only\s+)?(?:come|be)\s+(?:on\s+campus\s+)?(?:once|twice|three\s+times|four\s+times|five\s+times|\d|one|two|three|four|five)\s*(?:days?)?\s*(?:a|per)\s*week\b/gi, tag: "exactDaysPerWeek" },
  { re: /\b\d\s+days\s+(?:a|per)\s+week\b/gi, tag: "exactDaysPerWeek" },
  { re: /\bno\s+(?:afternoon|evening)\s+(?:classes|sections|courses)\b/gi, tag: "timeOfDayBan" },
  { re: /\b(?:avoid|skipping|skip|not|no|don'?t\s+want)\s+(?:a\s+)?(?:class\s+(?:with|from|by)\s+)?(?:professor|prof\.?|dr\.?)\s+[a-z][a-z'’-]*/gi, tag: "avoidInstructor" },
  { re: /\bsame\s+(?:professor|instructor|teacher)\b/gi, tag: "sameInstructor" },
  { re: /\bparking\b/gi, tag: "parking" },
  { re: /\b(?:only\s+)?(?:1000|2000|3000|4000)[ -]?level(?:\s+(?:courses|classes|sections))?\b/gi, tag: "courseLevel" },
  { re: /\bupper[ -]?level\b/gi, tag: "courseLevel" },
  { re: /\blower[ -]?level\b/gi, tag: "courseLevel" },
  { re: /\b(?:meet|meets)\s+(?:only\s+)?once\s+(?:a|per)\s+week\b/gi, tag: "meetingsPerWeek" },
  { re: /\bonly\s+once\s+a\s+week\b/gi, tag: "meetingsPerWeek" },
  { re: /\bno\s+(?:long\s+)?(?:2|3|two|three)[ -]?hour\s+(?:classes|blocks|labs)\b/gi, tag: "classDuration" },
  { re: /\b(?:2|3)[ -]?hour\s+(?:classes|labs)\s+are\s+too\s+long\b/gi, tag: "classDuration" },
  { re: /\b(?:no|skip|avoid)\s+discovery\s+park\b/gi, tag: "discoveryPark" },
  { re: /\bhybrid\b/gi, tag: "hybridMode" },
  { re: /\bsmall\s+(?:classes|sections)\b/gi, tag: "classSize" },
  { re: /\bclass\s+size\b/gi, tag: "classSize" },
  { re: /\b(?:minimum|at\s+least|above|over)\s+(?:a\s+)?\d(?:\.\d)?\s*(?:average\s+)?gpa\b/gi, tag: "gpaThreshold" },
  { re: /\bas\s+much\s+online\s+as\s+possible\b/gi, tag: "onlinePreference" },
];

function findUnsupported(text: string): Candidate[] {
  const out: Candidate[] = [];
  for (const rule of UNSUPPORTED_TAG) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      out.push(unsupported(2, text, m, rule.tag));
    }
  }
  return out;
}

/** Preference-sounding cues that no rule claimed: reported as unparseable. */
const CUE_RE = /\b(?:prefer|prefers|rather|would rather|i want|i need|i'?d like|please|ideally|hopefully|kinda|sorta|dunno)\b/gi;

function findLooseCues(text: string, claimed: Array<{ start: number; end: number }>): Candidate[] {
  const out: Candidate[] = [];
  for (const m of text.matchAll(CUE_RE)) {
    const window = { start: Math.max(0, m.index - 40), end: m.index + m[0].length + 40 };
    if (claimed.some((c) => overlaps(window, c))) continue;
    out.push({ kind: "unparseable", priority: 9, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseIntent
// ---------------------------------------------------------------------------

/**
 * Parse one sentence of plain-language schedule preferences.
 * Pure and deterministic: no network, no model, no clock, no randomness.
 */
export function parseIntent(text: string): ParseResult {
  const intent = emptyIntent();
  const candidates: Candidate[] = [
    ...findBlocked(text),
    ...findDaysOff(text),
    ...findUnsupported(text),
    ...findEarliestStart(text),
    ...findLatestEnd(text),
    ...findCredits(text),
    ...findSeats(text),
    ...findCampus(text),
    ...findMode(text),
    ...findCourses(text),
    ...findInstructor(text),
    ...findSoft(text),
  ];

  // Longest, highest-priority candidate claims its span first.
  candidates.sort(
    (a, b) =>
      a.priority - b.priority ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const accepted: Candidate[] = [];
  for (const c of candidates) {
    if (accepted.some((a) => overlaps(a, c))) continue;
    accepted.push(c);
  }
  accepted.sort((a, b) => a.start - b.start);

  for (const c of accepted) {
    if (c.kind === "match") c.apply(intent);
  }

  const understood: UnderstoodSpan[] = accepted
    .filter((c): c is Extract<Candidate, { kind: "match" }> => c.kind === "match")
    .map((c) => ({ start: c.start, end: c.end, text: text.slice(c.start, c.end), field: c.field, value: c.value }));

  const notUnderstood: NotUnderstoodSpan[] = accepted
    .filter((c) => c.kind !== "match")
    .map((c) =>
      c.kind === "unsupported"
        ? { start: c.start, end: c.end, text: text.slice(c.start, c.end), reason: "unsupported" as const, tag: c.tag }
        : { start: c.start, end: c.end, text: text.slice(c.start, c.end), reason: "unparseable" as const },
    );

  const claimed = accepted.map((c) => ({ start: c.start, end: c.end }));
  for (const c of findLooseCues(text, claimed)) {
    notUnderstood.push({
      start: c.start,
      end: c.end,
      text: text.slice(c.start, c.end),
      reason: "unparseable",
    });
  }
  notUnderstood.sort((a, b) => a.start - b.start);

  return { intent, understood, notUnderstood };
}
