import type { DatedPiece } from "./occurrences";

export const MINUTE_MS = 60_000;
export const DAY_MS = 86_400_000;
const HOUR_MS = 60 * MINUTE_MS;

/** UTC arithmetic represents plain dates here, independently of the host zone. */
export function dateMs(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError(`Invalid calendar date: ${value}`);
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || value < "0001-01-01" || isoDate(ms) !== value) {
    throw new RangeError(`Invalid calendar date: ${value}`);
  }
  return ms;
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The parser supplies UTC instants; reject rolled-over dates and host-local strings. */
export function instantMs(value: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/.exec(value);
  if (match === null || Number(match[2]) > 23 || Number(match[3]) > 59 || Number(match[4]) > 59) {
    throw new RangeError(`Invalid UTC instant: ${value}`);
  }
  dateMs(match[1]);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new RangeError(`Invalid UTC instant: ${value}`);
  return ms;
}

/**
 * Campus wall times use the feed parser's DST choices: the earlier instant
 * in a repeated hour, and the transition instant for a nonexistent time.
 * Offset candidates follow frontend/src/lib/calendar-feeds/datetime.ts.
 */
export class OccurrenceZone {
  private readonly formatter: Intl.DateTimeFormat;

  constructor(timeZone: string) {
    this.formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  private offsetAt(ms: number): number {
    const parts = this.formatter.formatToParts(ms);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const part = parts.find((part) => part.type === type);
      if (part === undefined) throw new Error(`Intl omitted ${type} from a wall time`);
      return Number(part.value);
    };
    const wall = new Date(0);
    // Date.UTC treats years 0 through 99 as 1900 through 1999.
    wall.setUTCFullYear(read("year"), read("month") - 1, read("day"));
    wall.setUTCHours(read("hour"), read("minute"), read("second"), 0);
    return wall.getTime() - Math.floor(ms / 1000) * 1000;
  }

  /** First offset change in (start, end], located to the millisecond. */
  private nextTransition(start: number, end: number): number | null {
    const offset = this.offsetAt(start);
    // Probe within a day rather than just its endpoints, which can have the
    // same offset over longer spans containing both seasonal changes.
    for (let before = start; before < end;) {
      let after = Math.min(before + HOUR_MS, end);
      if (this.offsetAt(after) !== offset) {
        while (after - before > 1) {
          const middle = Math.floor((before + after) / 2);
          if (this.offsetAt(middle) === offset) before = middle;
          else after = middle;
        }
        return after;
      }
      before = after;
    }
    return null;
  }

  resolve(day: number, minutes = 0): number {
    const naive = day + minutes * MINUTE_MS;
    const probes = [-48, -24, 0, 24, 48].map((hours) => naive + hours * HOUR_MS);
    const offsets = new Set(probes.map((ms) => this.offsetAt(ms)));
    const candidates = [...offsets]
      .map((offset) => naive - offset)
      .filter((candidate) => candidate + this.offsetAt(candidate) === naive);
    if (candidates.length > 0) return Math.min(...candidates);

    for (let index = 1; index < probes.length; index += 1) {
      const transition = this.nextTransition(probes[index - 1], probes[index]);
      if (transition === null) continue;
      const before = transition + this.offsetAt(transition - 1);
      const after = transition + this.offsetAt(transition);
      if (before <= naive && naive < after) return transition;
    }
    throw new RangeError(`Cannot resolve campus wall time: ${new Date(naive).toISOString()}`);
  }

  split(start: number, end: number, maxPieces: number = Number.POSITIVE_INFINITY, onOverBudget?: () => never): DatedPiece[] {
    const pieces: DatedPiece[] = [];
    for (let cursor = start; cursor < end;) {
      // Checked before each piece, so a caller's budget is exact however many DST changes the span crosses.
      if (pieces.length >= maxPieces) onOverBudget?.();
      const offset = this.offsetAt(cursor);
      const local = cursor + offset;
      const date = isoDate(local);
      const midnight = dateMs(date);
      const startMinutes = (local - midnight) / MINUTE_MS;
      const limit = Math.min(end, midnight + DAY_MS - offset);
      const pieceEnd = this.nextTransition(cursor, limit) ?? limit;
      pieces.push({
        date,
        startMinutes,
        endMinutes: startMinutes + (pieceEnd - cursor) / MINUTE_MS,
        start: new Date(cursor).toISOString(),
        end: new Date(pieceEnd).toISOString(),
      });
      cursor = pieceEnd;
    }
    return pieces;
  }
}
