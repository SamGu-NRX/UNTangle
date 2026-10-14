/**
 * The public calendar parser: turns raw iCalendar text into occurrences,
 * weekly busy blocks, and skipped entries over a half-open range. One bad
 * event never aborts the parse; only a document that is not a calendar at all
 * throws.
 */

import {
  addDaysToDate,
  calendarDateOfInstant,
  calendarDateToUtcMs,
  compareDates,
  formatInstant,
  minutesFromWall,
  parseIcsDateTime,
  resolveZonedWallTime,
  weekdayOfDate,
  zoneWallTime,
  type CalendarDate,
  type ResolvedDateTime,
} from "./datetime";
import { CalendarParseError } from "./errors";
import { parseContentLine, stripByteOrderMark, unescapeText, unfoldLines, type ContentLine } from "./ics-text";
import { expandRuleDates, parseRrule, type Rrule } from "./rrule";
import type {
  CalendarOccurrence,
  CalendarParseResult,
  ParseRange,
  SkippedEntry,
  WeeklyBusyBlock,
} from "./types";

type TimedStart = Extract<ResolvedDateTime, { kind: "timed" }>;
type DateStart = Extract<ResolvedDateTime, { kind: "date" }>;

export function parseCalendarFeed(raw: string, range: ParseRange): CalendarParseResult {
  const rangeStartMs = parseRangeInstant(range.start);
  const rangeEndMs = parseRangeInstant(range.end);
  if (rangeEndMs <= rangeStartMs) {
    throw new CalendarParseError("range.end must be after range.start");
  }

  const lines = unfoldLines(stripByteOrderMark(raw));
  if (!lines.some(isBeginVcalendar)) {
    throw new CalendarParseError("the feed has no BEGIN:VCALENDAR block");
  }

  const occurrences: CalendarOccurrence[] = [];
  const weeklyBusyBlocks: WeeklyBusyBlock[] = [];
  const skipped: SkippedEntry[] = [];
  for (const event of collectRawEvents(lines)) {
    const outcome = expandEvent(event, rangeStartMs, rangeEndMs);
    if (outcome.ok) {
      occurrences.push(...outcome.occurrences);
      weeklyBusyBlocks.push(...outcome.busyBlocks);
    } else {
      skipped.push({ uid: outcome.uid, reason: outcome.reason });
    }
  }
  occurrences.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  weeklyBusyBlocks.sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes);
  return { occurrences, weeklyBusyBlocks, skipped };
}

function parseRangeInstant(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new CalendarParseError(`range value is not an ISO 8601 instant: ${value}`);
  return ms;
}

function isBeginVcalendar(line: string): boolean {
  const parsed = parseContentLine(line);
  return parsed !== null && parsed.name === "BEGIN" && parsed.value.trim().toUpperCase() === "VCALENDAR";
}

/** One collected VEVENT, before any interpretation. */
type RawProperty = { value: string; params: Record<string, string> };

type RawEvent = {
  uid: string | null;
  summary: string | null;
  location: string | null;
  description: string | null;
  dtstart: RawProperty | null;
  dtend: RawProperty | null;
  rrule: string | null;
  exdates: RawProperty[];
};

function emptyRawEvent(): RawEvent {
  return {
    uid: null,
    summary: null,
    location: null,
    description: null,
    dtstart: null,
    dtend: null,
    rrule: null,
    exdates: [],
  };
}

/** Walks the component stack and collects VEVENTs at VEVENT depth. Nested components (VALARM, VTIMEZONE) are tolerated and ignored. */
function collectRawEvents(lines: string[]): RawEvent[] {
  const events: RawEvent[] = [];
  const stack: string[] = [];
  let current: RawEvent | null = null;
  for (const line of lines) {
    const parsed = parseContentLine(line);
    if (parsed === null) continue;
    if (parsed.name === "BEGIN") {
      const component = parsed.value.trim().toUpperCase();
      stack.push(component);
      if (component === "VEVENT" && stack.includes("VCALENDAR")) current = emptyRawEvent();
      continue;
    }
    if (parsed.name === "END") {
      const component = parsed.value.trim().toUpperCase();
      if (component === "VEVENT" && current !== null) {
        events.push(current);
        current = null;
      }
      const open = stack.lastIndexOf(component);
      if (open >= 0) stack.length = open;
      continue;
    }
    if (current !== null && stack[stack.length - 1] === "VEVENT") {
      collectProperty(parsed, current);
    }
  }
  return events;
}

function collectProperty(line: ContentLine, event: RawEvent): void {
  switch (line.name) {
    case "DTSTART":
      if (event.dtstart === null) event.dtstart = { value: line.value, params: line.params };
      break;
    case "DTEND":
      if (event.dtend === null) event.dtend = { value: line.value, params: line.params };
      break;
    case "RRULE":
      if (event.rrule === null) event.rrule = line.value;
      break;
    case "EXDATE":
      event.exdates.push({ value: line.value, params: line.params });
      break;
    case "UID":
      if (event.uid === null) event.uid = line.value.trim();
      break;
    case "SUMMARY":
      if (event.summary === null) event.summary = unescapeText(line.value);
      break;
    case "LOCATION":
      if (event.location === null) event.location = unescapeText(line.value);
      break;
    case "DESCRIPTION":
      if (event.description === null) event.description = unescapeText(line.value);
      break;
    default:
      break; // DTSTAMP, ATTENDEE, and everything else this library does not model.
  }
}

type EventOutcome =
  | { ok: true; occurrences: CalendarOccurrence[]; busyBlocks: WeeklyBusyBlock[] }
  | { ok: false; uid: string | null; reason: string };

function skipEvent(uid: string | null, reason: string): EventOutcome {
  return { ok: false, uid, reason };
}

/** Expands one raw event into occurrences (and busy blocks for WEEKLY rules), or a skip reason. */
function expandEvent(event: RawEvent, rangeStartMs: number, rangeEndMs: number): EventOutcome {
  if (event.dtstart === null) return skipEvent(event.uid, "event has no DTSTART");
  const start = parseIcsDateTime(event.dtstart.value, event.dtstart.params, undefined);
  if (start.kind === "invalid") return skipEvent(event.uid, start.reason);
  const isAllDay = start.kind === "date";

  let durationMs: number;
  if (event.dtend !== null) {
    // A floating DTEND shares the event's zone; an all-day event has no zone to share.
    const zoneForFloating = start.kind === "timed" ? start.zone : undefined;
    const end = parseIcsDateTime(event.dtend.value, event.dtend.params, zoneForFloating);
    if (end.kind === "invalid") return skipEvent(event.uid, `malformed DTEND: ${end.reason}`);
    durationMs = occurrenceDurationMs(start, end);
  } else {
    // All-day without DTEND is one day (DTEND is exclusive); timed without DTEND is zero length.
    durationMs = isAllDay ? 86_400_000 : 0;
  }

  const rule = event.rrule === null ? null : parseRrule(event.rrule);
  if (event.rrule !== null && rule === null) {
    return skipEvent(event.uid, "unsupported or malformed RRULE");
  }

  const busyBlocks =
    rule !== null && rule.freq === "WEEKLY" ? weeklyBusyBlocksFor(event, start, durationMs, rule) : [];

  const exclusions = resolveExdates(event, start);
  const outcome =
    rule === null
      ? singleOccurrences(event, start, durationMs, isAllDay, exclusions, rangeStartMs, rangeEndMs)
      : expandOccurrences(event, start, durationMs, rule, exclusions, rangeStartMs, rangeEndMs);
  if (!outcome.ok) return outcome;
  return { ok: true, occurrences: outcome.occurrences, busyBlocks };
}

/** DTEND is exclusive for all-day events; timed lengths clamp negative spans to zero. */
function occurrenceDurationMs(start: TimedStart | DateStart, end: ResolvedDateTime): number {
  if (start.kind === "timed" && end.kind === "timed") return Math.max(0, end.epochMs - start.epochMs);
  if (start.kind === "date" && end.kind === "date") {
    return Math.max(0, calendarDateToUtcMs(end.date) - calendarDateToUtcMs(start.date));
  }
  if (start.kind === "timed" && end.kind === "date") {
    // Mixed-form DTEND is RFC-invalid; place midnight of the end date in the event's zone.
    const endMs = resolveZonedWallTime({ ...end.date, hour: 0, minute: 0, second: 0 }, start.zone);
    return Math.max(0, endMs - start.epochMs);
  }
  // Date start, timed end: judge the end instant against the start date's midnight.
  if (start.kind === "date" && end.kind === "timed") {
    return Math.max(0, end.epochMs - calendarDateToUtcMs(start.date));
  }
  return 0;
}

function singleOccurrences(
  event: RawEvent,
  start: TimedStart | DateStart,
  durationMs: number,
  isAllDay: boolean,
  exclusions: Exclusion[],
  rangeStartMs: number,
  rangeEndMs: number,
): EventOutcome {
  const startMs = start.kind === "date" ? calendarDateToUtcMs(start.date) : start.epochMs;
  const endMs = startMs + durationMs;
  const candidateDate = start.kind === "date" ? start.date : calendarDateOfInstant(startMs, start.zone);
  if (isExcluded(exclusions, startMs, candidateDate, isAllDay)) return { ok: true, occurrences: [], busyBlocks: [] };
  if (!overlapsRange(startMs, endMs, rangeStartMs, rangeEndMs)) return { ok: true, occurrences: [], busyBlocks: [] };
  return { ok: true, occurrences: [makeOccurrence(event, startMs, endMs, isAllDay)], busyBlocks: [] };
}

/**
 * Expands a parsed rule into occurrences over the range. Candidates are
 * calendar dates carrying the event's original wall clock; each resolves in
 * the event's zone so wall times survive DST shifts. UNTIL is an inclusive
 * suffix break, EXDATEs drop individual occurrences, and the range keeps the
 * half-open overlap rule.
 */
function expandOccurrences(
  event: RawEvent,
  start: TimedStart | DateStart,
  durationMs: number,
  rule: Rrule,
  exclusions: Exclusion[],
  rangeStartMs: number,
  rangeEndMs: number,
): EventOutcome {
  const isAllDay = start.kind === "date";
  const zone = start.kind === "timed" ? start.zone : undefined;
  const dtstartDate: CalendarDate =
    start.kind === "timed"
      ? { year: start.wall.year, month: start.wall.month, day: start.wall.day }
      : start.date;

  let untilMs: number | null = null;
  let untilDate: CalendarDate | null = null;
  if (rule.until !== null) {
    const until = parseIcsDateTime(rule.until, {}, isAllDay ? undefined : zone);
    if (until.kind === "invalid") return skipEvent(event.uid, `malformed UNTIL: ${until.reason}`);
    if (until.kind === "timed") untilMs = until.epochMs;
    else untilDate = until.date;
  }

  // Stop once a candidate's wall date is past the range end plus the event's
  // length in days plus two days of zone slack; no such occurrence can overlap.
  const rangeEndDate = calendarDateOfInstant(rangeEndMs, "UTC");
  const slackDays = Math.floor(durationMs / 86_400_000) + 2;
  const stopDate = addDaysToDate(rangeEndDate, slackDays);
  const candidates = expandRuleDates(rule, dtstartDate, (candidate) => compareDates(candidate, stopDate) > 0);

  const occurrences: CalendarOccurrence[] = [];
  for (const candidateDate of candidates) {
    const candidateMs = isAllDay
      ? calendarDateToUtcMs(candidateDate)
      : resolveZonedWallTime(
          { ...candidateDate, hour: start.wall.hour, minute: start.wall.minute, second: start.wall.second },
          zone,
        );
    if (untilMs !== null && candidateMs > untilMs) break; // UNTIL is inclusive
    if (untilDate !== null && compareDates(candidateDate, untilDate) > 0) break;
    if (candidateMs >= rangeEndMs) break; // later candidates start even further out
    if (isExcluded(exclusions, candidateMs, candidateDate, isAllDay)) continue;
    if (!overlapsRange(candidateMs, candidateMs + durationMs, rangeStartMs, rangeEndMs)) continue;
    occurrences.push(makeOccurrence(event, candidateMs, candidateMs + durationMs, isAllDay));
  }
  return { ok: true, occurrences, busyBlocks: [] };
}

type Exclusion = { kind: "timed"; ms: number } | { kind: "date"; date: CalendarDate };

/**
 * Resolves every EXDATE value once per event. A floating EXDATE shares the
 * event's zone so it can match zoned occurrences; an unresolvable EXDATE
 * matches nothing.
 */
function resolveExdates(event: RawEvent, start: TimedStart | DateStart): Exclusion[] {
  const zoneForFloating = start.kind === "timed" ? start.zone : undefined;
  const exclusions: Exclusion[] = [];
  for (const exdate of event.exdates) {
    for (const value of exdate.value.split(",")) {
      const resolved = parseIcsDateTime(value, exdate.params, zoneForFloating);
      if (resolved.kind === "timed") exclusions.push({ kind: "timed", ms: resolved.epochMs });
      else if (resolved.kind === "date") exclusions.push({ kind: "date", date: resolved.date });
    }
  }
  return exclusions;
}

/** Timed occurrences drop on an exact instant match, or a whole-day match for date-form EXDATEs; all-day occurrences drop on a calendar-date match. */
function isExcluded(exclusions: Exclusion[], candidateMs: number, candidateDate: CalendarDate, isAllDay: boolean): boolean {
  for (const exclusion of exclusions) {
    if (isAllDay) {
      const date = exclusion.kind === "date" ? exclusion.date : calendarDateOfInstant(exclusion.ms, "UTC");
      if (compareDates(date, candidateDate) === 0) return true;
    } else if (exclusion.kind === "timed") {
      if (exclusion.ms === candidateMs) return true;
    } else if (compareDates(exclusion.date, candidateDate) === 0) {
      return true; // date-form EXDATE excludes the whole local day
    }
  }
  return false;
}

/** Half-open range overlap; a zero-length occurrence counts when its instant is inside. */
function overlapsRange(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number): boolean {
  return startMs < rangeEndMs && (endMs > rangeStartMs || (endMs === startMs && startMs >= rangeStartMs));
}

function makeOccurrence(event: RawEvent, startMs: number, endMs: number, isAllDay: boolean): CalendarOccurrence {
  return {
    uid: event.uid ?? "",
    summary: event.summary ?? "",
    start: formatInstant(startMs),
    end: formatInstant(endMs),
    isAllDay,
    location: event.location ?? "",
    description: event.description ?? "",
  };
}

/**
 * One busy block per distinct BYDAY weekday (or the DTSTART weekday when BYDAY
 * is absent), with wall-clock minutes in the event's zone. Floating times count
 * as local. UTC-timed weekly events get no block (their occurrences still
 * appear), and all-day weekly events block the whole day. Blocks ignore COUNT
 * and UNTIL on purpose.
 */
function weeklyBusyBlocksFor(
  event: RawEvent,
  start: TimedStart | DateStart,
  durationMs: number,
  rule: Rrule,
): WeeklyBusyBlock[] {
  const summary = event.summary ?? "";
  const uid = event.uid ?? "";
  const distinctDays = (weekday: number) => [...new Set(rule.byDay ?? [weekday])].sort((a, b) => a - b);
  if (start.kind === "date") {
    return distinctDays(weekdayOfDate(start.date)).map((weekday) => ({
      uid,
      summary,
      weekday,
      startMinutes: 0,
      endMinutes: 1440,
    }));
  }
  if (start.zone === "UTC") return [];
  const startWall = zoneWallTime(start.epochMs, start.zone);
  const endWall = zoneWallTime(start.epochMs + durationMs, start.zone);
  const startMinutes = minutesFromWall(startWall);
  const endMinutes = durationMs === 0 ? startMinutes : minutesFromWall(endWall);
  const dtstartWeekday = weekdayOfDate({ year: startWall.year, month: startWall.month, day: startWall.day });
  return distinctDays(dtstartWeekday).map((weekday) => ({ uid, summary, weekday, startMinutes, endMinutes }));
}
