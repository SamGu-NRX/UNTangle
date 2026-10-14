import type { Day, Section } from "@/lib/sections/model";
import { campusesOf, modalityOf } from "./facts";
import type { SmartFilter } from "./model";

/** A section has the open-seat fact when its open count is known and meets the minimum. */
function meetsOpenSeats(section: Section, minimum: number): boolean {
  return section.seats.open !== null && section.seats.open >= minimum;
}

/**
 * Fit semantics: every stated meeting day must be a selected day, so a
 * section meeting on an unselected day cannot pass. Meetings without a day
 * (async, TBA) impose no constraint, and an empty selection constrains
 * nothing.
 */
function fitsMeetingDays(section: Section, days: readonly Day[]): boolean {
  if (days.length === 0) return true;
  const selected = new Set(days);
  return section.meetings.every((meeting) => meeting.day === null || selected.has(meeting.day));
}

/**
 * Fit semantics: every timed meeting starts no earlier than the window and
 * ends no later than it, so the section fits the caller's free time. Meetings
 * without times impose no constraint, and a section with no timed meetings
 * fits any window.
 */
function fitsTimeWindow(section: Section, startMinutes: number, endMinutes: number): boolean {
  return section.meetings.every(
    (meeting) =>
      meeting.startMinutes === null ||
      meeting.endMinutes === null ||
      (meeting.startMinutes >= startMinutes && meeting.endMinutes <= endMinutes),
  );
}

function matchesFilter(section: Section, filter: SmartFilter): boolean {
  switch (filter.kind) {
    case "open-seats":
      return meetsOpenSeats(section, filter.minimum);
    case "meeting-days":
      return fitsMeetingDays(section, filter.days);
    case "time-window":
      return fitsTimeWindow(section, filter.startMinutes, filter.endMinutes);
    case "modality":
      return modalityOf(section) === filter.modality;
    case "campus":
      return campusesOf(section).includes(filter.campus);
    default: {
      const _exhaustive: never = filter;
      return _exhaustive;
    }
  }
}

/** True when the section passes every filter; no filters always matches. */
export function sectionMatchesFilters(section: Section, filters: readonly SmartFilter[]): boolean {
  return filters.every((filter) => matchesFilter(section, filter));
}
