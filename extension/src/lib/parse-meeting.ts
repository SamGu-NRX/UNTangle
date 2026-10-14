/**
 * Parses the days-and-times cell of a myUNT class-search results row into
 * weekly meetings with concrete minutes. Pure and deterministic: the same
 * cell text always yields the same result, with no clocks and no locale
 * dependencies.
 */
import type { Day } from "../shared/api-types";
import type { ParsedMeeting } from "../shared/messages";

export type MeetingCell =
  | { kind: "times"; meetings: ParsedMeeting[] }
  | { kind: "tba" }
  | { kind: "async" }
  | { kind: "none" };

/** PeopleSoft day letters, per the documented stable row anatomy. */
const DAY_LETTERS: Record<string, Day> = {
  M: "Mon",
  T: "Tue",
  W: "Wed",
  R: "Thu",
  F: "Fri",
  S: "Sat",
  U: "Sun",
};

/** "9:00 AM", "12:00 PM" -> minutes after midnight (12 AM is 0, 12 PM is 720). */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(text.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || minutes > 59) return null;
  const meridiem = (match[3] ?? "").toUpperCase();
  if (hours < 1 || hours > 12) return null;
  const hour24 = hours === 12 ? (meridiem === "AM" ? 0 : 12) : meridiem === "PM" ? hours + 12 : hours;
  return hour24 * 60 + minutes;
}

/** "MWF", "TR", "S" -> the days the weekly slot meets. */
export function parseDays(text: string): Day[] {
  const days: Day[] = [];
  for (const char of text.trim().toUpperCase()) {
    const day = DAY_LETTERS[char];
    if (!day) return [];
    days.push(day);
  }
  return days;
}

/** A class ending at 12:00 AM ends at 1440 (sections/INTEGRATION.md). */
function normalizedEnd(start: number, end: number): number {
  return end === 0 && start > 0 ? 1440 : end;
}

/**
 * Parses one days-and-times cell. "TBA" marks a time-to-be-announced row,
 * "Async (online)" (or "ARR") an asynchronous one; anything without a
 * readable day letter plus time range is treated as having no times.
 */
export function parseMeetingCell(text: string): MeetingCell {
  const value = text.trim();
  if (!value) return { kind: "none" };
  if (/^tba$/i.test(value)) return { kind: "tba" };
  if (/^async/i.test(value) || /^arr\b/i.test(value)) return { kind: "async" };

  // Split the leading day letters from the time range: "MWF 9:00 AM - 9:50 AM".
  const match = /^(\S+)\s+(.+)$/.exec(value);
  if (!match) return { kind: "none" };
  const days = parseDays(match[1] ?? "");
  if (days.length === 0) return { kind: "none" };

  const range = (match[2] ?? "").split(/\s*-\s*/);
  if (range.length !== 2) return { kind: "none" };
  const start = parseClock(range[0] ?? "");
  const end = parseClock(range[1] ?? "");
  if (start === null || end === null) return { kind: "none" };

  const meetings = days.map(day => ({ day, startMinutes: start, endMinutes: normalizedEnd(start, end) }));
  return { kind: "times", meetings };
}
