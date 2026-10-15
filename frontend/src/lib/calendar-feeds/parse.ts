/**
 * The public calendar parser: turns raw iCalendar text into an event table,
 * occurrences, weekly busy blocks, and skipped entries over a half-open
 * range. One bad event or series never aborts the parse; only a document that
 * is not a calendar at all, or an unusable range, throws.
 */

import {
  addDaysToDate,
  calendarDateOfInstant,
  calendarDateToUtcMs,
  compareDates,
  daysBetween,
  FLOATING_TIME_ZONE,
  formatInstant,
  minutesFromWall,
  parseIcsDateTime,
  parseRangeInstant,
  resolveZonedWallTime,
  weekdayOfDate,
  zoneWallTime,
  type CalendarDate,
  type ResolvedDateTime,
} from "./datetime";
import { CalendarParseError } from "./errors";
import { parseContentLine, stripByteOrderMark, unescapeText, unfoldLines, type ContentLine } from "./ics-text";
import {
  expandRuleDates,
  MAX_EXPANSION_ITERATIONS,
  parseRrule,
  type ExpansionBudget,
  type Rrule,
} from "./rrule";
import type {
  CalendarEvent,
  CalendarOccurrence,
  CalendarParseResult,
  ParseRange,
  SkippedEntry,
  WeeklyBusyBlock,
} from "./types";

type TimedStart = Extract<ResolvedDateTime, { kind: "timed" }>;
type DateStart = Extract<ResolvedDateTime, { kind: "date" }>;

/** Cap on materialized occurrences per parse, so a wide range cannot exhaust memory. */
export const MAX_PARSE_OCCURRENCES = 20_000;

/**
 * Longest description kept per event, in UTF-16 code units. A starting value,
 * not a measured one: long enough for a club's meeting notes and links, short
 * enough that descriptions cannot dominate the preview response.
 */
export const MAX_DESCRIPTION_CHARS = 2_000;

/**
 * Events whose DTSTART, DTEND, or RECURRENCE-ID year falls outside this span
 * are skipped with a warning. A real club or class calendar never schedules
 * there; such years are typos (`00261014`) or hostile input. UNTIL is not
 * checked, because far-future UNTIL values such as 99991231 are a common way
 * to write "forever".
 */
export const MIN_EVENT_YEAR = 1900;
export const MAX_EVENT_YEAR = 2200;

export function parseCalendarFeed(raw: string, range: ParseRange): CalendarParseResult {
  const rangeStartMs = requireRangeInstant(range.start);
  const rangeEndMs = requireRangeInstant(range.end);
  if (rangeEndMs <= rangeStartMs) {
    throw new CalendarParseError("range.end must be after range.start");
  }

  const lines = unfoldLines(stripByteOrderMark(raw));
  if (!lines.some(isBeginVcalendar)) {
    throw new CalendarParseError("the feed has no BEGIN:VCALENDAR block");
  }

  const events: CalendarEvent[] = [];
  const eventIds = new Map<EventDraft, number>();
  const idFor = (draft: EventDraft): number => {
    let id = eventIds.get(draft);
    if (id === undefined) {
      id = events.length;
      eventIds.set(draft, id);
      events.push({ id, ...draft });
    }
    return id;
  };

  const occurrences: CalendarOccurrence[] = [];
  const weeklyBusyBlocks: WeeklyBusyBlock[] = [];
  const skipped: SkippedEntry[] = [];
  // One shared work budget across the whole feed: no single event owns the
  // expansion allowance, so no feed can spend unbounded work per event.
  const budget: ExpansionBudget = { workRemaining: MAX_EXPANSION_ITERATIONS, exhausted: false };
  for (const unit of groupSeries(collectRawEvents(lines))) {
    if (unit.kind === "skip") {
      skipped.push(unit.entry);
      continue;
    }
    if (budget.exhausted) {
      skipped.push(skipEntry(unit.master, "recurrence expansion budget exceeded"));
      continue;
    }
    if (occurrences.length >= MAX_PARSE_OCCURRENCES) {
      skipped.push(skipEntry(unit.master, "occurrence budget exceeded"));
      continue;
    }
    const outcome = expandSeries(unit, rangeStartMs, rangeEndMs, budget, MAX_PARSE_OCCURRENCES - occurrences.length);
    if (!outcome.ok) {
      skipped.push(skipEntry(unit.master, outcome.reason));
      continue;
    }
    for (const occurrence of outcome.occurrences) {
      occurrences.push({
        eventId: idFor(occurrence.draft),
        start: formatInstant(occurrence.startMs),
        end: formatInstant(occurrence.endMs),
        status: occurrence.status,
      });
    }
    for (const block of outcome.busyBlocks) {
      weeklyBusyBlocks.push({ eventId: idFor(block.draft), weekday: block.weekday, startMinutes: block.startMinutes, endMinutes: block.endMinutes });
    }
  }
  occurrences.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end) || a.eventId - b.eventId);
  weeklyBusyBlocks.sort((a, b) => a.weekday - b.weekday || a.startMinutes - b.startMinutes || a.eventId - b.eventId);
  return { events, occurrences, weeklyBusyBlocks, skipped };
}

function requireRangeInstant(value: string): number {
  const ms = parseRangeInstant(value);
  if (ms === null) throw new CalendarParseError(`range value is not an ISO 8601 date-time: ${value}`);
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
  status: string | null;
  transp: string | null;
  duration: string | null;
  hasRdate: boolean;
  recurrenceId: RawProperty | null;
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
    status: null,
    transp: null,
    duration: null,
    hasRdate: false,
    recurrenceId: null,
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
    case "STATUS":
      if (event.status === null) event.status = line.value.trim().toUpperCase();
      break;
    case "TRANSP":
      if (event.transp === null) event.transp = line.value.trim().toUpperCase();
      break;
    case "DURATION":
      if (event.duration === null) event.duration = line.value.trim();
      break;
    case "RDATE":
      event.hasRdate = true;
      break;
    case "RECURRENCE-ID":
      if (event.recurrenceId === null) event.recurrenceId = { value: line.value, params: line.params };
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
      if (event.description === null) event.description = capDescription(unescapeText(line.value));
      break;
    default:
      break; // DTSTAMP, ATTENDEE, and everything else this library does not model.
  }
}

/** Cuts a description to MAX_DESCRIPTION_CHARS, ending a cut one with an ellipsis and never splitting a surrogate pair. */
function capDescription(text: string): string {
  if (text.length <= MAX_DESCRIPTION_CHARS) return text;
  let cut = text.slice(0, MAX_DESCRIPTION_CHARS - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/**
 * A recurring series and its RECURRENCE-ID overrides, or a series refused
 * before expansion. A plain event is a series with no overrides.
 */
type SeriesUnit =
  | { kind: "series"; master: RawEvent; overrides: RawEvent[] }
  | { kind: "skip"; entry: SkippedEntry };

/**
 * Pairs each RECURRENCE-ID override with the event that shares its UID, in
 * feed order. Overrides with no such event, and UIDs carried by several
 * events plus overrides (no way to tell which series an override belongs
 * to), skip the whole series with one entry naming it.
 */
function groupSeries(events: RawEvent[]): SeriesUnit[] {
  const mastersByUid = new Map<string, RawEvent[]>();
  const overridesByUid = new Map<string, RawEvent[]>();
  for (const event of events) {
    if (event.uid === null) continue;
    const byUid = event.recurrenceId === null ? mastersByUid : overridesByUid;
    const list = byUid.get(event.uid);
    if (list === undefined) byUid.set(event.uid, [event]);
    else list.push(event);
  }

  const units: SeriesUnit[] = [];
  const grouped = new Set<string>();
  for (const event of events) {
    const overrides = event.uid === null ? [] : (overridesByUid.get(event.uid) ?? []);
    if (event.recurrenceId === null && overrides.length === 0) {
      units.push({ kind: "series", master: event, overrides: [] });
      continue;
    }
    // Only overrides and masters with overrides reach here; both have a UID
    // unless the event is an override without one.
    if (event.uid === null) {
      units.push({ kind: "skip", entry: skipEntry(event, "RECURRENCE-ID override has no matching recurring event") });
      continue;
    }
    if (grouped.has(event.uid)) continue;
    grouped.add(event.uid);
    const masters = mastersByUid.get(event.uid) ?? [];
    const named = masters[0] ?? event;
    if (masters.length === 0) {
      units.push({ kind: "skip", entry: skipEntry(named, "RECURRENCE-ID override has no matching recurring event") });
    } else if (masters.length > 1) {
      units.push({ kind: "skip", entry: skipEntry(named, "several events share this UID and it has RECURRENCE-ID overrides") });
    } else {
      units.push({ kind: "series", master: named, overrides });
    }
  }
  return units;
}

function skipEntry(event: RawEvent, reason: string): SkippedEntry {
  return { uid: event.uid, summary: event.summary, reason };
}

/** An event's entry in the result's event table, before it gets an id. */
type EventDraft = Omit<CalendarEvent, "id">;

type OccurrenceStatus = CalendarOccurrence["status"];

type PendingOccurrence = { draft: EventDraft; startMs: number; endMs: number; status: OccurrenceStatus };
type PendingBlock = { draft: EventDraft; weekday: number; startMinutes: number; endMinutes: number };
type Span = { startMs: number; endMs: number };
type BlockShape = { weekday: number; startMinutes: number; endMinutes: number };

type SeriesOutcome =
  | { ok: true; occurrences: PendingOccurrence[]; busyBlocks: PendingBlock[] }
  | { ok: false; reason: string };

type SpanOutcome = { ok: true; spans: Span[] } | { ok: false; reason: string };

const EMPTY_SERIES: SeriesOutcome = { ok: true, occurrences: [], busyBlocks: [] };

function fail(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

function draftFor(event: RawEvent, isAllDay: boolean, fallback: RawEvent | null): EventDraft {
  return {
    uid: event.uid,
    summary: event.summary ?? fallback?.summary ?? "",
    location: event.location ?? fallback?.location ?? "",
    description: event.description ?? fallback?.description ?? "",
    isAllDay,
    transparent: event.transp === "TRANSPARENT",
  };
}

function statusOf(event: RawEvent): OccurrenceStatus {
  return event.status === "TENTATIVE" ? "tentative" : "confirmed";
}

function yearOf(value: TimedStart | DateStart): number {
  return value.kind === "timed" ? value.wall.year : value.date.year;
}

function outsideEventYears(value: TimedStart | DateStart): boolean {
  const year = yearOf(value);
  return year < MIN_EVENT_YEAR || year > MAX_EVENT_YEAR;
}

const YEAR_BOUNDS_REASON = `event dates fall outside the years ${MIN_EVENT_YEAR} to ${MAX_EVENT_YEAR}`;

/** An event's start, its length, and where its floating values resolve. */
type ResolvedTiming = { start: TimedStart | DateStart; durationMs: number; zone: string };

/**
 * Resolves DTSTART and DTEND. A missing DTEND means one day for all-day
 * events (DTEND is exclusive) and the fallback length otherwise.
 */
function resolveTiming(event: RawEvent, floatingZone: string, fallbackDurationMs: number | null): ResolvedTiming | { reason: string } {
  if (event.duration !== null) return { reason: "DURATION is not supported; express the length with DTEND" };
  if (event.dtstart === null) return { reason: "event has no DTSTART" };
  const start = parseIcsDateTime(event.dtstart.value, event.dtstart.params, floatingZone);
  if (start.kind === "invalid") return { reason: start.reason };
  if (outsideEventYears(start)) return { reason: YEAR_BOUNDS_REASON };
  const zone = start.kind === "timed" ? start.zone : floatingZone;
  let durationMs: number;
  if (event.dtend !== null) {
    // A floating DTEND shares the event's zone.
    const end = parseIcsDateTime(event.dtend.value, event.dtend.params, zone);
    if (end.kind === "invalid") return { reason: `malformed DTEND: ${end.reason}` };
    if (outsideEventYears(end)) return { reason: YEAR_BOUNDS_REASON };
    durationMs = occurrenceDurationMs(start, end);
  } else if (start.kind === "date") {
    durationMs = 86_400_000;
  } else {
    durationMs = fallbackDurationMs ?? 0;
  }
  return { start, durationMs, zone };
}

/**
 * Expands one series: the master's occurrences minus every instance an
 * override names (canceled or moved), plus each non-canceled override as
 * its own occurrence, and the master's weekly busy blocks. Anything this
 * library cannot apply exactly skips the whole series, so the result never
 * carries a stale instance.
 */
function expandSeries(
  series: { master: RawEvent; overrides: RawEvent[] },
  rangeStartMs: number,
  rangeEndMs: number,
  budget: ExpansionBudget,
  occurrenceAllowance: number,
): SeriesOutcome {
  const { master, overrides } = series;
  if (master.status === "CANCELLED") {
    // A canceled event or series produces no occurrences and no busy time;
    // omission is the correct reading, so it is not reported as a skip.
    return EMPTY_SERIES;
  }
  if (master.hasRdate) return fail("RDATE is not supported");
  const timing = resolveTiming(master, FLOATING_TIME_ZONE, null);
  if ("reason" in timing) return fail(timing.reason);
  const { start, durationMs, zone } = timing;
  const isAllDay = start.kind === "date";

  const rule = master.rrule === null ? null : parseRrule(master.rrule);
  if (master.rrule !== null && rule === null) return fail("unsupported or malformed RRULE");

  const masterDraft = draftFor(master, isAllDay, null);
  const exclusions = resolveExdates(master, zone);
  const replacements: PendingOccurrence[] = [];
  for (const override of overrides) {
    const recurrenceId = override.recurrenceId;
    if (recurrenceId === null) continue; // groupSeries only attaches overrides
    if (recurrenceId.params["RANGE"] !== undefined) {
      return fail(`RECURRENCE-ID with RANGE=${recurrenceId.params["RANGE"]} is not supported`);
    }
    const original = parseIcsDateTime(recurrenceId.value, recurrenceId.params, zone);
    if (original.kind === "invalid") return fail(`malformed RECURRENCE-ID: ${original.reason}`);
    if (outsideEventYears(original)) return fail(YEAR_BOUNDS_REASON);
    exclusions.push(original.kind === "timed" ? { kind: "timed", ms: original.epochMs } : { kind: "date", date: original.date });
    if (override.status === "CANCELLED") continue;
    if (override.rrule !== null || override.hasRdate) return fail("a RECURRENCE-ID override with its own RRULE or RDATE is not supported");
    const moved = resolveTiming(override, zone, durationMs);
    if ("reason" in moved) return fail(`RECURRENCE-ID override: ${moved.reason}`);
    const movedStartMs = instantOf(moved.start);
    const movedEndMs = movedStartMs + moved.durationMs;
    if (!overlapsRange(movedStartMs, movedEndMs, rangeStartMs, rangeEndMs)) continue;
    replacements.push({
      draft: draftFor(override, moved.start.kind === "date", master),
      startMs: movedStartMs,
      endMs: movedEndMs,
      status: statusOf(override),
    });
  }

  // Weekly blocks carry only weekday and minutes, so only a rule that meets
  // every week (INTERVAL=1) can be one. Transparent events never block time.
  const busyShapes =
    rule !== null && rule.freq === "WEEKLY" && rule.interval === 1 && !masterDraft.transparent
      ? weeklyBusyBlocksFor(start, durationMs, rule, budget)
      : [];
  if (budget.exhausted) return fail("recurrence expansion budget exceeded");

  const outcome =
    rule === null
      ? singleSpan(start, durationMs, exclusions, rangeStartMs, rangeEndMs)
      : expandSpans(start, durationMs, zone, rule, exclusions, rangeStartMs, rangeEndMs, budget, occurrenceAllowance);
  if (!outcome.ok) return outcome;
  if (outcome.spans.length + replacements.length > occurrenceAllowance) return fail("occurrence budget exceeded");
  const status = statusOf(master);
  return {
    ok: true,
    occurrences: [
      ...outcome.spans.map((span) => ({ draft: masterDraft, startMs: span.startMs, endMs: span.endMs, status })),
      ...replacements,
    ],
    busyBlocks: busyShapes.map((shape) => ({ draft: masterDraft, ...shape })),
  };
}

function instantOf(start: TimedStart | DateStart): number {
  return start.kind === "date" ? calendarDateToUtcMs(start.date) : start.epochMs;
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

function singleSpan(
  start: TimedStart | DateStart,
  durationMs: number,
  exclusions: Exclusion[],
  rangeStartMs: number,
  rangeEndMs: number,
): SpanOutcome {
  const startMs = instantOf(start);
  const endMs = startMs + durationMs;
  const isAllDay = start.kind === "date";
  const candidateDate = start.kind === "date" ? start.date : calendarDateOfInstant(startMs, start.zone);
  if (isExcluded(exclusions, startMs, candidateDate, isAllDay)) return { ok: true, spans: [] };
  if (!overlapsRange(startMs, endMs, rangeStartMs, rangeEndMs)) return { ok: true, spans: [] };
  return { ok: true, spans: [{ startMs, endMs }] };
}

/**
 * Expands a parsed rule into occurrence spans over the range. Candidates are
 * calendar dates carrying the event's original wall clock; each resolves in
 * the event's zone so wall times survive DST shifts. UNTIL is an inclusive
 * suffix break, exclusions (EXDATEs and overridden instances) drop
 * individual occurrences, and the range keeps the half-open overlap rule.
 */
function expandSpans(
  start: TimedStart | DateStart,
  durationMs: number,
  zone: string,
  rule: Rrule,
  exclusions: Exclusion[],
  rangeStartMs: number,
  rangeEndMs: number,
  budget: ExpansionBudget,
  occurrenceAllowance: number,
): SpanOutcome {
  const dtstartDate: CalendarDate =
    start.kind === "timed"
      ? { year: start.wall.year, month: start.wall.month, day: start.wall.day }
      : start.date;

  let untilMs: number | null = null;
  let untilDate: CalendarDate | null = null;
  if (rule.until !== null) {
    const until = parseIcsDateTime(rule.until, {}, zone);
    if (until.kind === "invalid") return fail(`malformed UNTIL: ${until.reason}`);
    if (until.kind === "timed") untilMs = until.epochMs;
    else untilDate = until.date;
  }

  // Stop once a candidate's wall date is past the range end plus the event's
  // length in days plus two days of zone slack; no such occurrence can overlap.
  // The walk also starts near the range (skipToDate): occurrences that end
  // before the range starts are never materialized, and the rule expansion
  // bridges their COUNT contribution with integer arithmetic.
  const rangeEndDate = calendarDateOfInstant(rangeEndMs, "UTC");
  const slackDays = Math.floor(durationMs / 86_400_000) + 2;
  const stopDate = addDaysToDate(rangeEndDate, slackDays);
  const skipToDate = addDaysToDate(calendarDateOfInstant(rangeStartMs, "UTC"), -(slackDays + 1));
  const candidates = expandRuleDates(rule, dtstartDate, (candidate) => compareDates(candidate, stopDate) > 0, skipToDate, budget);
  if (budget.exhausted) return fail("recurrence expansion budget exceeded");

  const spans: Span[] = [];
  for (const candidateDate of candidates) {
    const candidateMs =
      start.kind === "date"
        ? calendarDateToUtcMs(candidateDate)
        : resolveZonedWallTime(
            { ...candidateDate, hour: start.wall.hour, minute: start.wall.minute, second: start.wall.second },
            start.zone,
          );
    if (untilMs !== null && candidateMs > untilMs) break; // UNTIL is inclusive
    if (untilDate !== null && compareDates(candidateDate, untilDate) > 0) break;
    if (candidateMs >= rangeEndMs) break; // later candidates start even further out
    if (isExcluded(exclusions, candidateMs, candidateDate, start.kind === "date")) continue;
    if (!overlapsRange(candidateMs, candidateMs + durationMs, rangeStartMs, rangeEndMs)) continue;
    if (spans.length >= occurrenceAllowance) return fail("occurrence budget exceeded");
    spans.push({ startMs: candidateMs, endMs: candidateMs + durationMs });
  }
  return { ok: true, spans };
}

type Exclusion = { kind: "timed"; ms: number } | { kind: "date"; date: CalendarDate };

/**
 * Resolves every EXDATE value once per event. A floating EXDATE shares the
 * event's zone so it can match zoned occurrences; an unresolvable EXDATE
 * matches nothing.
 */
function resolveExdates(event: RawEvent, zone: string): Exclusion[] {
  const exclusions: Exclusion[] = [];
  for (const exdate of event.exdates) {
    for (const value of exdate.value.split(",")) {
      const resolved = parseIcsDateTime(value, exdate.params, zone);
      if (resolved.kind === "timed") exclusions.push({ kind: "timed", ms: resolved.epochMs });
      else if (resolved.kind === "date") exclusions.push({ kind: "date", date: resolved.date });
    }
  }
  return exclusions;
}

/** Timed occurrences drop on an exact instant match, or a whole-day match for date-form exclusions; all-day occurrences drop on a calendar-date match. */
function isExcluded(exclusions: Exclusion[], candidateMs: number, candidateDate: CalendarDate, isAllDay: boolean): boolean {
  for (const exclusion of exclusions) {
    if (isAllDay) {
      const date = exclusion.kind === "date" ? exclusion.date : calendarDateOfInstant(exclusion.ms, "UTC");
      if (compareDates(date, candidateDate) === 0) return true;
    } else if (exclusion.kind === "timed") {
      if (exclusion.ms === candidateMs) return true;
    } else if (compareDates(exclusion.date, candidateDate) === 0) {
      return true; // date-form exclusion covers the whole local day
    }
  }
  return false;
}

/** Half-open range overlap; a zero-length occurrence counts when its instant is inside. */
function overlapsRange(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number): boolean {
  return startMs < rangeEndMs && (endMs > rangeStartMs || (endMs === startMs && startMs >= rangeStartMs));
}

/**
 * Busy blocks for a weekly rule: the DTSTART wall span, split per local day,
 * anchored at each BYDAY weekday (or the DTSTART weekday when BYDAY is
 * absent). An overnight or multi-day span yields one block per covered day,
 * clamped to that day (end exclusive at 1440), so endMinutes never reads as a
 * reversed span. Floating times read as America/Chicago. UTC-timed weekly
 * events get no block (their occurrences still appear), and all-day weekly
 * events block the whole day. Blocks ignore COUNT and UNTIL on purpose. The
 * caller decides which rules may produce blocks at all.
 */
function weeklyBusyBlocksFor(
  start: TimedStart | DateStart,
  durationMs: number,
  rule: Rrule,
  budget: ExpansionBudget,
): BlockShape[] {
  const byDays = [...new Set(rule.byDay ?? [])].sort((a, b) => a - b);
  if (start.kind === "date") {
    const anchors = byDays.length > 0 ? byDays : [weekdayOfDate(start.date)];
    const days = new Set<number>();
    // DTEND is exclusive. Beyond seven days the same weekdays repeat.
    const span = Math.min(7, Math.ceil(durationMs / 86_400_000));
    for (const anchor of anchors) {
      for (let offset = 0; offset < span; offset += 1) days.add((anchor + offset) % 7);
    }
    return [...days].map((weekday) => ({ weekday, startMinutes: 0, endMinutes: 1440 }));
  }
  if (start.zone === "UTC") return [];
  const startWall = zoneWallTime(start.epochMs, start.zone);
  const endWall = zoneWallTime(start.epochMs + durationMs, start.zone);
  const startMinutes = minutesFromWall(startWall);
  const endMinutes = durationMs === 0 ? startMinutes : minutesFromWall(endWall);
  const startDay = { year: startWall.year, month: startWall.month, day: startWall.day };
  const endDay = { year: endWall.year, month: endWall.month, day: endWall.day };
  const anchorDays = byDays.length > 0 ? byDays : [weekdayOfDate(startDay)];
  if (durationMs === 0) {
    return anchorDays.map((weekday) => ({ weekday, startMinutes, endMinutes }));
  }
  const spanDays = Math.max(0, daysBetween(startDay, endDay));
  const blocks: BlockShape[] = [];
  const seen = new Set<string>();
  for (const anchorWeekday of anchorDays) {
    for (let offset = 0; offset <= spanDays; offset += 1) {
      // Busy-block generation spends the same per-parse allowance as recurrence expansion.
      if (budget.workRemaining <= 0) {
        budget.exhausted = true;
        return [];
      }
      budget.workRemaining -= 1;
      const segmentStart = offset === 0 ? startMinutes : 0;
      const segmentEnd = offset === spanDays ? endMinutes : 1440;
      if (segmentEnd <= segmentStart) continue; // an end exactly at midnight leaves no empty segment
      const weekday = (anchorWeekday + offset) % 7;
      const key = `${weekday}:${segmentStart}:${segmentEnd}`;
      if (seen.has(key)) continue;
      seen.add(key);
      blocks.push({ weekday, startMinutes: segmentStart, endMinutes: segmentEnd });
    }
  }
  return blocks;
}
