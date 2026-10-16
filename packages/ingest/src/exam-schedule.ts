/**
 * UNT's final-exam schedule, parsed from a saved registrar page.
 *
 * Source: https://registrar.unt.edu/exams/final-exam-schedule/ publishes one
 * page per term (fall.html, spring.html, summer.html). The Fall 2026 page,
 * the newest when this was written, is a set of accordion panels:
 *
 * - "Classes Meeting on the Main Denton Campus" and "Classes Meeting at
 *   Discovery Park": one table per first meeting day ("First Class Meeting
 *   on Monday (Mo, Mo/We, Mo/We/Fr, etc.)"), each row a range of class start
 *   times and the exam ("8:00 a.m. and 8:59 a.m." | "Saturday, Dec. 5 from
 *   8 – 10 a.m.").
 * - "Classes Meeting in First Eight–Week Session": one exam day in the
 *   panel's sentence and a table of subjects and times.
 * - "Classes Meeting in Second Eight–Week Session": a "Main Campus" and a
 *   "Discovery Park" table keyed by earliest meeting day (Mo/We/Fr or Tu/Th)
 *   and start range.
 * - "Accounting Departmental Exams": one sentence per course.
 *
 * Frisco and online classes have no rule on the page, so their panels are
 * listed in `ignored`. A row the parser can't read is never dropped quietly:
 * it goes to `invalid` with its text and the reason, so a release job can
 * refuse the page and a reviewer can see what UNT printed.
 *
 * The parser reads saved text and never fetches, so tests run without a
 * network. Captures follow the "unt-registrar-exams" source policy in
 * source-policies.ts; the saved pages and their capture notes are in
 * tests/fixtures/unt-exams/.
 */
import {
  EXAM_DAYS,
  examDayOf,
  type ExamCampus,
  type ExamCourseListing,
  type ExamDay,
  type ExamGridRow,
  type ExamSchedule,
  type ExamSlot,
  type ExamSubjectRow,
  type StartWindow,
} from "@untangle/core/final-exams";

export type ExamPageMeta = {
  /** The public URL the page was captured from. */
  sourceUrl: string;
  /** The capture date, ISO, when the bytes were true upstream. */
  capturedAt: string;
};

/** A row or sentence the page printed that the parser could not read. */
export type InvalidExamRow = {
  /** The accordion panel it sits in. */
  panel: string;
  /** The table caption, or "" outside a table. */
  table: string;
  text: string;
  reason: string;
};

export type ParsedExamPage = {
  schedule: ExamSchedule;
  invalid: InvalidExamRow[];
  /** Panels with no rule to read, by heading ("Classes Meeting at UNT at Frisco"). */
  ignored: string[];
};

/** Strips tags and decodes the entities the registrar's pages use, collapsing whitespace. */
function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_all, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/\s+/g, " ")
    .trim();
}

/** "a.m." and "A.M." to "am"; en and em dashes to "–". */
function normalizeTimes(text: string): string {
  return text
    .replace(/\b([ap])\.?\s?m\.?(?=\s|$|[,;)–-])/gi, (_all, letter: string) => `${letter.toLowerCase()}m`)
    .replace(/\s*[–—-]\s*/g, " – ");
}

/** "8:00 am" -> 480. Null when it isn't a clock time. */
function clock(text: string): number | null {
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2] ?? "0");
  if (hour < 1 || hour > 12 || minute > 59) return null;
  return ((hour % 12) + (match[3] === "pm" ? 12 : 0)) * 60 + minute;
}

/**
 * "8 – 10 am", "10:30 am – 12:30 pm", "1 pm – 3 pm". A start without am or
 * pm takes the end's, unless that would put it after the end ("11 – 1 pm"
 * starts at 11 am).
 */
function timeRange(text: string): { start: number; end: number } | null {
  const match = /^(\d{1,2}(?::\d{2})?)\s*(am|pm)?\s*–\s*(\d{1,2}(?::\d{2})?)\s*(am|pm)$/.exec(normalizeTimes(text).trim());
  if (!match) return null;
  const end = clock(`${match[3]} ${match[4]}`);
  if (end === null) return null;
  let start = clock(`${match[1]} ${match[2] ?? match[4]}`);
  if (start !== null && !match[2] && start >= end) start = clock(`${match[1]} ${match[4] === "pm" ? "am" : "pm"}`);
  if (start === null || start >= end) return null;
  return { start, end };
}

/** A value read from the page, or why it couldn't be. */
type Read<T> = { value: T } | { error: string };

/** "8:00 a.m. and 8:59 a.m.", "6:00 p.m. and later", "Starts at 2:25 p.m.". */
function startWindow(text: string): Read<StartWindow> {
  const t = normalizeTimes(text);
  const at = /^Starts at (.+)$/i.exec(t);
  if (at) {
    const minute = clock(at[1]);
    return minute === null ? { error: `"${at[1]}" is not a time` } : { value: { kind: "at", minute } };
  }
  const later = /^(.+?) and later$/i.exec(t);
  if (later) {
    const from = clock(later[1]);
    return from === null ? { error: `"${later[1]}" is not a time` } : { value: { kind: "between", from, to: 24 * 60 - 1 } };
  }
  const between = /^(.+?) and (.+)$/i.exec(t);
  if (!between) return { error: "not a start-time range" };
  const from = clock(between[1]);
  const to = clock(between[2]);
  if (from === null || to === null) return { error: `"${t}" has a part that is not a time` };
  if (to < from) return { error: `the range ends (${between[2]}) before it starts (${between[1]})` };
  return { value: { kind: "between", from, to } };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WEEKDAY_PREFIX: Record<string, ExamDay> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };

/** An ISO date from a month word and day in `year`, checked against the printed weekday when it reads as one. */
function isoDate(weekday: string, month: string, day: string, year: number): Read<string> {
  const monthIndex = MONTHS.indexOf(month.slice(0, 3).toLowerCase());
  if (monthIndex < 0) return { error: `"${month}" is not a month` };
  const iso = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(Number(day)).padStart(2, "0")}`;
  let actual: ExamDay;
  try {
    actual = examDayOf(iso);
  } catch {
    return { error: `${iso} is not a real date` };
  }
  // The page misspells weekdays ("Wedneday"); the first three letters still name it.
  const printed = WEEKDAY_PREFIX[weekday.slice(0, 3).toLowerCase()];
  if (!printed) return { error: `"${weekday}" is not a weekday` };
  if (printed !== actual) return { error: `${weekday} doesn't match ${iso}, a ${actual}` };
  return { value: iso };
}

/** "Saturday, Dec. 5 from 8 – 10 a.m." */
function examCell(text: string, year: number): Read<ExamSlot> {
  const match = /^([A-Za-z]+),?\s+([A-Za-z]+)\.?\s+(\d{1,2}),?\s+from\s+(?:from\s+)?(.+)$/.exec(text);
  if (!match) return { error: "not a weekday, date and time" };
  const date = isoDate(match[1], match[2], match[3], year);
  if ("error" in date) return date;
  const range = timeRange(match[4]);
  if (!range) return { error: `"${match[4]}" is not a time range` };
  return { value: { date: date.value, ...range } };
}

const DAY_NAMES: Record<string, ExamDay[]> = {
  monday: ["Mon"],
  tuesday: ["Tue"],
  wednesday: ["Wed"],
  thursday: ["Thu"],
  friday: ["Fri"],
  "saturday or sunday": ["Sat", "Sun"],
};

/** "First Class Meeting on Tuesday (Tu, Tu/Th, etc.)" -> ["Tue"]. */
function firstDaysOf(caption: string): ExamDay[] | null {
  const match = /^First Class (?:Meeting|Meets) on (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday or Sunday)\b/i.exec(caption);
  return match ? DAY_NAMES[match[1].toLowerCase()] : null;
}

const TWO_LETTER: Record<string, ExamDay> = { mo: "Mon", tu: "Tue", we: "Wed", th: "Thu", fr: "Fri", sa: "Sat", su: "Sun" };

/** "Mo/We/Fr" -> ["Mon", "Wed", "Fri"]. */
function dayList(text: string): ExamDay[] | null {
  const days = text.split("/").map((part) => TWO_LETTER[part.trim().toLowerCase()]);
  if (days.length === 0 || days.some((day) => day === undefined)) return null;
  return EXAM_DAYS.filter((day) => days.includes(day));
}

/** A table's caption, its data rows' cell texts, and the text of any row that mixes header and data cells. */
type Table = { caption: string; rows: string[][]; mixed: string[] };

/**
 * Each table's caption and its rows. A row of header cells only (th) is the
 * table's heading and skipped. A row with both is kept apart in `mixed`, so
 * the caller reports it: it could be a data row UNT marked up with a row
 * header, and dropping it would lose an exam time quietly.
 */
function tables(html: string): Table[] {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)].map((table) => {
    const caption = /<caption>([\s\S]*?)<\/caption>/.exec(table[0]);
    const rows: string[][] = [];
    const mixed: string[] = [];
    for (const row of table[0].matchAll(/<tr[\s\S]*?<\/tr>/g)) {
      const cells = [...row[0].matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/\1>/g)];
      const headers = cells.filter((cell) => cell[1] === "th").length;
      if (headers === cells.length) continue;
      const texts = cells.map((cell) => decode(cell[2]));
      if (headers > 0) mixed.push(texts.join(" | "));
      else rows.push(texts);
    }
    return { caption: caption ? decode(caption[1]) : "", rows, mixed };
  });
}

/** Accordion panels as [heading, html], in page order. */
function panels(html: string): Array<[string, string]> {
  const headers = [...html.matchAll(/<div class="js-accordion__header">([\s\S]*?)<\/div>/g)];
  return headers.map((header, index) => {
    const from = header.index! + header[0].length;
    const to = index + 1 < headers.length ? headers[index + 1].index! : html.length;
    return [decode(header[1]), html.slice(from, to)];
  });
}

const CAMPUS_TABLES: Record<string, ExamCampus> = { "main campus": "main", "discovery park": "discovery-park" };

export function parseUntExamPage(html: string, meta: ExamPageMeta): ParsedExamPage {
  // The page keeps old schedules in HTML comments (a Fall 2022 grid); they must not be read.
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/g, "");
  const heading = /<h3>\s*((?:Spring|Summer|Fall) (\d{4})) Final Exam Schedule\s*<\/h3>/.exec(clean);
  if (!heading) throw new Error(`${meta.sourceUrl}: no "<term> Final Exam Schedule" heading; is this a final-exam schedule page?`);
  const term = heading[1];
  const year = Number(heading[2]);

  const grid: ExamGridRow[] = [];
  const bySubject: ExamSubjectRow[] = [];
  const byCourse: ExamCourseListing[] = [];
  const invalid: InvalidExamRow[] = [];
  const ignored: string[] = [];

  for (const [panel, body] of panels(clean)) {
    const bad = (table: string, text: string, reason: string) => invalid.push({ panel, table, text, reason });

    if (/main denton campus|^classes meeting at discovery park$/i.test(panel)) {
      const campus: ExamCampus = /discovery park/i.test(panel) ? "discovery-park" : "main";
      for (const { caption, rows, mixed } of tables(body)) {
        for (const text of mixed) bad(caption, text, "the row mixes header and data cells");
        const firstDays = firstDaysOf(caption);
        if (!firstDays) {
          bad(caption, rows.map((row) => row.join(" | ")).join("; "), "the caption names no first meeting day");
          continue;
        }
        for (const row of rows) {
          const text = row.join(" | ");
          if (row.length !== 2) {
            bad(caption, text, `expected 2 cells, found ${row.length}`);
            continue;
          }
          const starts = startWindow(row[0]);
          const exam = examCell(row[1], year);
          if ("error" in starts) bad(caption, text, starts.error);
          else if ("error" in exam) bad(caption, text, exam.error);
          else grid.push({ campus, session: "full", firstDays, starts: starts.value, exam: exam.value, text });
        }
      }
    } else if (/first eight.week session/i.test(panel)) {
      const sentence = /final exams on ([A-Za-z]+),\s+([A-Za-z]+)\.?\s+(\d{1,2})\b/.exec(decode(body));
      const date: Read<string> = sentence ? isoDate(sentence[1], sentence[2], sentence[3], year) : { error: "the panel names no exam day" };
      for (const { caption, rows, mixed } of tables(body)) {
        for (const text of mixed) bad(caption, text, "the row mixes header and data cells");
        for (const row of rows) {
          const text = row.join(" | ");
          const range = row.length === 2 ? timeRange(row[1]) : null;
          const subjects = row[0]?.split(",").map((subject) => subject.trim()) ?? [];
          if ("error" in date) bad(caption, text, date.error);
          else if (row.length !== 2) bad(caption, text, `expected 2 cells, found ${row.length}`);
          else if (subjects.some((subject) => !/^[A-Z]{3,4}$/.test(subject))) bad(caption, text, `"${row[0]}" is not a list of subject codes`);
          else if (!range) bad(caption, text, `"${row[1]}" is not a time range`);
          else bySubject.push({ session: "8w1", subjects, exam: { date: date.value, ...range }, text });
        }
      }
    } else if (/second eight.week session/i.test(panel)) {
      for (const { caption, rows, mixed } of tables(body)) {
        for (const text of mixed) bad(caption, text, "the row mixes header and data cells");
        const campus = CAMPUS_TABLES[caption.toLowerCase()];
        if (!campus) {
          bad(caption, rows.map((row) => row.join(" | ")).join("; "), "the caption names no campus");
          continue;
        }
        for (const row of rows) {
          const text = row.join(" | ");
          if (row.length !== 3) {
            bad(caption, text, `expected 3 cells, found ${row.length}`);
            continue;
          }
          const firstDays = dayList(row[0]);
          const starts = startWindow(row[1]);
          const exam = examCell(row[2], year);
          if (!firstDays) bad(caption, text, `"${row[0]}" is not a list of days`);
          else if ("error" in starts) bad(caption, text, starts.error);
          else if ("error" in exam) bad(caption, text, exam.error);
          else grid.push({ campus, session: "8w2", firstDays, starts: starts.value, exam: exam.value, text });
        }
      }
    } else if (/departmental/i.test(panel)) {
      for (const paragraph of body.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
        const text = decode(paragraph[1]);
        if (!/final exam for/i.test(text)) {
          // Only a paragraph that names a course could be a listing worded another way; "contact the department" is not.
          if (/\b[A-Z]{3,4} \d{4}/.test(text)) bad("", text, 'names a course, but not as "final exam for"');
          continue;
        }
        const match = /final exam for ([A-Z]{3,4} \d{4}[A-Z]?)\b.*?\b([A-Z][a-z]+day),\s+([A-Za-z]+)\.?\s+(\d{1,2})\s+from\s+(.+?)$/.exec(text);
        if (!match) {
          bad("", text, "not a course, weekday, date and time");
          continue;
        }
        const date = isoDate(match[2], match[3], match[4], year);
        const range = timeRange(match[5]);
        if ("error" in date) bad("", text, date.error);
        else if (!range) bad("", text, `"${match[5]}" is not a time range`);
        else byCourse.push({ courseCode: match[1], exam: { date: date.value, ...range }, text });
      }
    } else {
      ignored.push(panel);
    }
  }

  if (grid.length === 0) throw new Error(`${meta.sourceUrl}: no exam grid rows were read; the page layout may have changed`);
  return { schedule: { term, sourceUrl: meta.sourceUrl, capturedAt: meta.capturedAt, grid, bySubject, byCourse }, invalid, ignored };
}

/**
 * The TypeScript module the web app reads (frontend/src/lib/generated/unt-final-exams.ts).
 * Written by tests/build-exam-module.ts and checked by tests/exam-schedule.test.ts.
 */
export function renderExamModule(schedule: ExamSchedule, fixture: string): string {
  // One row per line, so a recapture's diff shows which rows UNT changed.
  const list = (rows: readonly unknown[]) => (rows.length === 0 ? "[]" : `[\n${rows.map((row) => `    ${JSON.stringify(row)},`).join("\n")}\n  ]`);
  return [
    `// Generated from ${fixture} by \`bun packages/ingest/tests/build-exam-module.ts --write\`.`,
    "// Don't edit by hand: packages/ingest/tests/exam-schedule.test.ts fails when this differs from the parse.",
    'import type { ExamSchedule } from "@untangle/core/final-exams";',
    "",
    "export const UNT_FINAL_EXAMS: ExamSchedule = {",
    `  term: ${JSON.stringify(schedule.term)},`,
    `  sourceUrl: ${JSON.stringify(schedule.sourceUrl)},`,
    `  capturedAt: ${JSON.stringify(schedule.capturedAt)},`,
    `  grid: ${list(schedule.grid)},`,
    `  bySubject: ${list(schedule.bySubject)},`,
    `  byCourse: ${list(schedule.byCourse)},`,
    "};",
    "",
  ].join("\n");
}
