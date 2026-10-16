/**
 * The extension preview: what a myUNT class-search section looks like against
 * the student's Main schedule. Clear, conflict (naming the clashing course or
 * busy block, for the trusted panel only), or can't check, always carrying the
 * schedule revision the check ran against.
 */
import type { Day, Meeting, Section } from "@/lib/sections/model";
import type { ScheduleBody } from "../../../../packages/contracts/src/documents";
import { extensionPreviewSchema, type ExtensionPreview, type ExtensionPreviewClash } from "./extension-api";
import { extensionOptionId, optionIdFromClassNumber } from "./option-id";

/** The term data the section proxy serves, or null while it is unavailable. */
export type SectionsSource = {
  termSections(term: string): Promise<Section[] | null>;
};

/** A calendar busy block, from the preferences document. */
export type BusyBlock = { id: string; label: string; day: Day; start: number; end: number };

export type PreviewInput = {
  scheduleId: string;
  term: string;
  classNumber: string;
  /** The term's real sections; null when the term file is unavailable. */
  sections: Section[] | null;
  /** Main's body and revision, or null when the document is missing or unreadable. */
  schedule: { body: ScheduleBody; revision: number } | null;
  blocked: BusyBlock[];
};

/** Minutes after midnight, worded the way the panel shows times: "9:50 AM". */
function wordTime(minutes: number): string {
  const period = minutes >= 720 ? "PM" : "AM";
  const hour = Math.floor((minutes % 1440) / 60);
  const twelveHour = (hour + 11) % 12 + 1;
  return `${twelveHour}:${String(minutes % 60).padStart(2, "0")} ${period}`;
}

const wordRange = (start: number, end: number) => `${wordTime(start)} to ${wordTime(end)}`;

/**
 * The section's meetings as the panel lists them: meetings that share a time
 * and room become one row, "Mon Wed Fri", the way the extension's
 * PreviewMeeting documents its days. A meeting with no day (an online or To Be
 * Arranged one) says so instead of borrowing a weekday.
 */
function wordMeetings(meetings: Meeting[]) {
  const rows: { days: Day[] | null; time: string | null; room: string | null }[] = [];
  for (const meeting of meetings) {
    const time = meeting.day && meeting.startMinutes !== null && meeting.endMinutes !== null
      ? wordRange(meeting.startMinutes, meeting.endMinutes)
      : null;
    // The guard bounds a room line at 40 characters; a longer room stays out rather than breaking the preview.
    const room = meeting.room && meeting.room.length <= 40 ? meeting.room : null;
    // A dayless meeting is its own row, never merged into a weekday's.
    const same = rows.find((row) => row.time === time && row.room === room && (row.days === null) === (meeting.day === null));
    if (!same) rows.push({ days: meeting.day ? [meeting.day] : null, time, room });
    else if (meeting.day && same.days && !same.days.includes(meeting.day)) same.days.push(meeting.day);
  }
  return rows.slice(0, 8).map((row) => ({ days: row.days ? sortedDays(row.days).join(" ") : "No set day", time: row.time, room: row.room }));
}

const WEEK: readonly Day[] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const sortedDays = (days: Day[]) => [...days].sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b));

/** One busy interval: a day plus a start and end in minutes after midnight. */
type Interval = { day: Day; start: number; end: number };

const timedMeetings = (meetings: Meeting[]): Interval[] =>
  meetings
    .filter((meeting): meeting is Meeting & { day: Day; startMinutes: number; endMinutes: number } =>
      meeting.day !== null && meeting.startMinutes !== null && meeting.endMinutes !== null)
    .map((meeting) => ({ day: meeting.day, start: meeting.startMinutes, end: meeting.endMinutes }));

const overlaps = (a: Interval, b: Interval) => a.day === b.day && a.start < b.end && b.start < a.end;

/** The overlap of two intervals on the same day. */
const overlapOf = (a: Interval, b: Interval): Interval => ({ day: a.day, start: Math.max(a.start, b.start), end: Math.min(a.end, b.end) });

/**
 * One clash per course or busy block and overlap time, its days joined: a MWF
 * section against a MWF class is one clash on "Mon Wed Fri", not three.
 */
function groupClashes(found: { kind: "course" | "busy"; name: string; overlap: Interval }[]): ExtensionPreviewClash[] {
  const groups: { kind: "course" | "busy"; name: string; start: number; end: number; days: Day[] }[] = [];
  for (const { kind, name, overlap } of found) {
    const same = groups.find((group) => group.kind === kind && group.name === name && group.start === overlap.start && group.end === overlap.end);
    if (!same) groups.push({ kind, name, start: overlap.start, end: overlap.end, days: [overlap.day] });
    else if (!same.days.includes(overlap.day)) same.days.push(overlap.day);
  }
  return groups.map((group) => ({ kind: group.kind, name: clamp(group.name, 80), when: clamp(`${sortedDays(group.days).join(" ")} ${wordRange(group.start, group.end)}`, 80) }));
}

const clamp = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

/**
 * An unknown preview's first detail line says why nothing was compared; the
 * panel shows it as the verdict. Every unknown branch below starts its details
 * with that reason.
 */
export function buildPreview(input: PreviewInput): ExtensionPreview {
  const { scheduleId, term, classNumber, sections, schedule, blocked } = input;
  const revision = schedule?.revision ?? 0;

  // The term file is down or unknown: nothing can be checked, section or schedule.
  if (sections === null) {
    return extensionPreviewSchema.parse({
      scheduleId, optionId: optionIdFromClassNumber(classNumber), revision, title: classNumber,
      conflict: "unknown", unknownReason: "schedule-unavailable",
      details: ["Section data is unavailable right now. Check again in a moment."],
    });
  }

  const resolved = sections.find((section) => section.classNumbers.includes(classNumber)) ?? null;
  if (!resolved) {
    return extensionPreviewSchema.parse({
      scheduleId, optionId: optionIdFromClassNumber(classNumber), revision, title: classNumber,
      conflict: "unknown", unknownReason: "schedule-unavailable",
      details: [`No enrollment option for class number ${classNumber} in ${term}.`],
    });
  }

  // The student's Main schedule is missing or unreadable, or it plans another
  // term: the class search is real, but there is no schedule to check against.
  if (schedule === null) {
    return extensionPreviewSchema.parse({
      scheduleId, optionId: extensionOptionId(resolved) ?? optionIdFromClassNumber(classNumber), revision,
      title: resolved.courseCode, conflict: "unknown", unknownReason: "schedule-unavailable",
      details: ["Your UNTangle account has no Main schedule yet, so there is nothing to check this section against or add it to."],
      section: clamp(resolved.sectionCode, 12),
      meetings: wordMeetings(resolved.meetings),
    });
  }
  if (schedule.body.termId !== term) {
    return extensionPreviewSchema.parse({
      scheduleId, optionId: extensionOptionId(resolved) ?? optionIdFromClassNumber(classNumber), revision,
      title: resolved.courseCode, conflict: "unknown", unknownReason: "schedule-unavailable",
      details: [`Main is for ${schedule.body.termId}; this class search is ${term}.`],
      section: clamp(resolved.sectionCode, 12),
      meetings: wordMeetings(resolved.meetings),
    });
  }

  const details: string[] = [];
  const optionId = extensionOptionId(resolved) ?? optionIdFromClassNumber(classNumber);
  const inSchedule = schedule.body.selectedSections[resolved.courseCode] === resolved.id;

  // A To Be Arranged meeting may still be scheduled: the check would be a promise we can't keep.
  if (resolved.meetings.some((meeting) => meeting.tba)) {
    details.push("This section has a To Be Arranged meeting, so UNTangle can't check it against Main yet.");
    return extensionPreviewSchema.parse({
      scheduleId, optionId, revision, title: resolved.courseCode,
      conflict: "unknown", unknownReason: "no-set-time", details,
      section: clamp(resolved.sectionCode, 12),
      meetings: wordMeetings(resolved.meetings),
      inSchedule,
    });
  }

  // A pick in Main that the term data no longer knows, or that never had set
  // times, leaves the schedule's busy time unknown, so no verdict is honest.
  const optionIntervals = timedMeetings(resolved.meetings);
  for (const [code, pickId] of Object.entries(schedule.body.selectedSections)) {
    if (pickId === resolved.id) continue;
    const picked = sections.find((section) => section.id === pickId);
    if (!picked) {
      details.push(`Main picks ${code}, which this term's section data no longer lists, so UNTangle can't check times.`);
      return extensionPreviewSchema.parse({
        scheduleId, optionId, revision, title: resolved.courseCode,
        conflict: "unknown", unknownReason: "schedule-time-missing", details,
        section: clamp(resolved.sectionCode, 12),
        meetings: wordMeetings(resolved.meetings),
        inSchedule,
      });
    }
    if (picked.meetings.some((meeting) => meeting.tba)) {
      details.push(`Main picks ${code}, whose meeting time is To Be Arranged, so UNTangle can't check times.`);
      return extensionPreviewSchema.parse({
        scheduleId, optionId, revision, title: resolved.courseCode,
        conflict: "unknown", unknownReason: "schedule-time-missing", details,
        section: clamp(resolved.sectionCode, 12),
        meetings: wordMeetings(resolved.meetings),
        inSchedule,
      });
    }
  }

  // Overlaps with the other picks in Main, then with the student's calendar busy blocks.
  const found: { kind: "course" | "busy"; name: string; overlap: Interval }[] = [];
  for (const [code, pickId] of Object.entries(schedule.body.selectedSections)) {
    if (pickId === resolved.id) continue;
    const picked = sections.find((section) => section.id === pickId);
    if (!picked) continue;
    for (const optionInterval of optionIntervals) {
      const hit = timedMeetings(picked.meetings).find((pickedInterval) => overlaps(optionInterval, pickedInterval));
      if (hit) found.push({ kind: "course", name: code, overlap: overlapOf(optionInterval, hit) });
    }
  }
  for (const block of blocked) {
    const busy = { day: block.day, start: block.start, end: block.end };
    for (const optionInterval of optionIntervals) {
      if (overlaps(optionInterval, busy)) {
        found.push({ kind: "busy", name: block.label, overlap: overlapOf(optionInterval, busy) });
        break;
      }
    }
  }
  const clashes = groupClashes(found);

  // Meetings and clashes are their own fields; the details carry only what
  // nothing else in the preview says.
  details.push(resolved.seats.open !== null && resolved.seats.total !== null
    ? `${resolved.seats.open} of ${resolved.seats.total} seats open.`
    : "Seat availability unknown.");
  if (inSchedule) details.push("Already in Main.");

  return extensionPreviewSchema.parse({
    scheduleId, optionId, revision, title: resolved.courseCode,
    conflict: clashes.length ? "conflict" : "clear",
    details: details.slice(0, 30),
    section: clamp(resolved.sectionCode, 12),
    meetings: wordMeetings(resolved.meetings),
    clashes: clashes.slice(0, 12),
    inSchedule,
  });
}
