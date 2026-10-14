/**
 * Zone-aware date and time handling for iCalendar values.
 *
 * A wall-clock reading plus a zone determines a UTC instant, but the mapping is
 * not a function: during fall-back one wall time names two instants, and during
 * spring forward some wall times name none. `resolveZonedWallTime` documents and
 * fixes the choices this library makes. All zone work goes through Intl with
 * IANA zone names; there is no bundled tz database.
 */

export type CalendarDate = { year: number; month: number; day: number };

/** A wall-clock reading: what a calendar in a zone prints for an instant. */
export type ZoneWallTime = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** True when Intl recognizes the zone (an IANA name such as America/Chicago). */
export function isValidTimeZone(zone: string): boolean {
  if (zoneFormatters.has(zone)) return true;
  try {
    zoneFormatter(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone's wall-clock reading of an instant. An undefined zone is the process local zone. */
export function zoneWallTime(epochMs: number, timeZone: string | undefined): ZoneWallTime {
  if (timeZone === undefined) {
    const local = new Date(epochMs);
    return {
      year: local.getFullYear(),
      month: local.getMonth() + 1,
      day: local.getDate(),
      hour: local.getHours(),
      minute: local.getMinutes(),
      second: local.getSeconds(),
    };
  }
  const parts = zoneFormatter(timeZone).formatToParts(new Date(epochMs));
  const read = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
    second: read("second"),
  };
}

/** The zone's UTC offset, in milliseconds, at the given instant. */
export function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const wall = zoneWallTime(epochMs, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - epochMs;
}

/**
 * Converts a wall-clock reading in a zone to the UTC instant it names. Normal
 * times converge on the first pass. Ambiguous fall-back times take the earlier
 * offset. Nonexistent spring-forward times resolve to the transition instant
 * itself, just after the gap. An undefined zone is the process local zone.
 *
 * The candidate set method: every instant that prints this wall time differs
 * from the naive reading by some zone offset, so probe the offsets observable
 * around the wall time, map each back to a candidate instant, and keep the
 * candidates that are self-consistent (their own offset matches and they print
 * the requested wall time). Probing the offset at the naive instant alone is
 * not enough: for zones east of UTC that probe can already see the
 * post-transition offset, which silently picks the later fall-back candidate.
 */
export function resolveZonedWallTime(wall: ZoneWallTime, timeZone: string | undefined): number {
  if (timeZone === undefined) {
    return new Date(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second).getTime();
  }
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const probeHours = [-48, -24, 0, 24, 48];
  const offsets = new Set(probeHours.map((hours) => zoneOffsetMs(naive + hours * 3_600_000, timeZone)));
  const candidates: number[] = [];
  for (const offset of offsets) {
    const candidate = naive - offset;
    if (zoneOffsetMs(candidate, timeZone) !== offset) continue;
    const printed = zoneWallTime(candidate, timeZone);
    if (
      printed.year === wall.year &&
      printed.month === wall.month &&
      printed.day === wall.day &&
      printed.hour === wall.hour &&
      printed.minute === wall.minute &&
      printed.second === wall.second
    ) {
      candidates.push(candidate);
    }
  }
  if (candidates.length > 0) return Math.min(...candidates); // ambiguous: the earlier offset
  // The wall time does not exist (spring forward): bisect between the first
  // adjacent probes that disagree on the offset, which bracket the transition.
  for (let index = 1; index < probeHours.length; index += 1) {
    const before = naive + probeHours[index - 1] * 3_600_000;
    const after = naive + probeHours[index] * 3_600_000;
    const offsetBefore = zoneOffsetMs(before, timeZone);
    const offsetAfter = zoneOffsetMs(after, timeZone);
    if (offsetBefore !== offsetAfter) return transitionInstant(before, after, offsetAfter, timeZone);
  }
  return naive; // No offset change anywhere in the bracket: trust the naive reading.
}

/** Smallest instant with the post-transition offset, inside [before, after]. */
function transitionInstant(before: number, after: number, afterOffset: number, timeZone: string): number {
  let low = before;
  let high = after;
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2000) * 1000;
    if (zoneOffsetMs(mid, timeZone) === afterOffset) high = mid;
    else low = mid;
  }
  return high;
}

export function calendarDateToUtcMs(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day);
}

/** Weekday of a calendar date, 0 = Sunday through 6 = Saturday. */
export function weekdayOfDate(date: CalendarDate): number {
  return new Date(calendarDateToUtcMs(date)).getUTCDay();
}

export function addDaysToDate(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date(calendarDateToUtcMs(date) + days * 86_400_000);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() };
}

/** Lexicographic date comparison; negative when a is before b. */
export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a.year * 10000 + a.month * 100 + a.day - (b.year * 10000 + b.month * 100 + b.day);
}

/** Whole days from a to b (b minus a); negative when b is before a. */
export function daysBetween(a: CalendarDate, b: CalendarDate): number {
  return Math.round((calendarDateToUtcMs(b) - calendarDateToUtcMs(a)) / 86_400_000);
}

/** False only for impossible dates such as February 30. */
export function isPlausibleCalendarDate(date: CalendarDate): boolean {
  if (date.month < 1 || date.month > 12 || date.day < 1) return false;
  const back = new Date(calendarDateToUtcMs(date));
  return back.getUTCMonth() + 1 === date.month && back.getUTCDate() === date.day;
}

export function minutesFromWall(wall: { hour: number; minute: number }): number {
  return wall.hour * 60 + wall.minute;
}

export function formatInstant(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

/** One iCalendar DATE or DATE-TIME value resolved against a zone. */
export type ResolvedDateTime =
  | { kind: "timed"; epochMs: number; wall: ZoneWallTime; zone: string | undefined }
  | { kind: "date"; date: CalendarDate }
  | { kind: "invalid"; reason: string };

const DATE_TIME_FORM = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/;
const DATE_FORM = /^(\d{4})(\d{2})(\d{2})$/;

/**
 * Resolves one iCalendar DATE or DATE-TIME value. A Z suffix is UTC; a TZID
 * parameter names the zone; a floating value (neither) resolves in
 * `zoneForFloating`, which callers set to the owning event's zone so UNTIL and
 * EXDATE values can share it (undefined = the process local zone). The wall
 * components ride along so recurrence expansion can reuse the event's wall
 * time on other dates.
 */
export function parseIcsDateTime(
  value: string,
  params: Record<string, string>,
  zoneForFloating: string | undefined,
): ResolvedDateTime {
  const valueParam = params["VALUE"]?.toUpperCase();
  if (valueParam !== undefined && valueParam !== "DATE" && valueParam !== "DATE-TIME") {
    return { kind: "invalid", reason: `unsupported VALUE=${valueParam}` };
  }
  const time = DATE_TIME_FORM.exec(value.trim());
  if (time !== null) {
    if (valueParam === "DATE") return { kind: "invalid", reason: "VALUE=DATE requires a bare date" };
    const wall = {
      year: Number(time[1]),
      month: Number(time[2]),
      day: Number(time[3]),
      hour: Number(time[4]),
      minute: Number(time[5]),
      second: Number(time[6]),
    };
    if (!isPlausibleWall(wall)) return { kind: "invalid", reason: "datetime components out of range" };
    const tzid = params["TZID"];
    if (tzid !== undefined && !isValidTimeZone(tzid)) {
      return { kind: "invalid", reason: `unknown time zone ${tzid}` };
    }
    const zone = time[7] === "Z" ? "UTC" : (tzid ?? zoneForFloating);
    const epochMs = resolveZonedWallTime(wall, zone);
    if (!Number.isFinite(epochMs)) return { kind: "invalid", reason: "datetime did not resolve to an instant" };
    return { kind: "timed", epochMs, wall, zone };
  }
  const date = DATE_FORM.exec(value.trim());
  if (date !== null) {
    const parsed = { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]) };
    if (!isPlausibleCalendarDate(parsed)) return { kind: "invalid", reason: "date components out of range" };
    return { kind: "date", date: parsed };
  }
  return { kind: "invalid", reason: "not an iCalendar DATE or DATE-TIME value" };
}

function isPlausibleWall(wall: ZoneWallTime): boolean {
  return (
    isPlausibleCalendarDate(wall) &&
    wall.hour >= 0 &&
    wall.hour <= 23 &&
    wall.minute >= 0 &&
    wall.minute <= 59 &&
    wall.second >= 0 &&
    wall.second <= 60
  );
}

/** The calendar date an instant falls on, in the given zone (undefined = local). */
export function calendarDateOfInstant(epochMs: number, timeZone: string | undefined): CalendarDate {
  const wall = zoneWallTime(epochMs, timeZone);
  return { year: wall.year, month: wall.month, day: wall.day };
}
