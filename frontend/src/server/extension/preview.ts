/**
 * The extension preview: what a myUNT class-search section looks like against
 * the student's Main schedule. Clear, conflict (naming the clashing course or
 * busy block, for the trusted panel only), or can't check, always carrying the
 * schedule revision the check ran against.
 */
import type { Day, Meeting, Section } from "@/lib/sections/model";
import { blockConflicts } from "@/lib/optimizer/prepare";
import type { OptBlockedTime } from "@/lib/optimizer/types";
import { isTimed, meetingsConflict, termDates, toOptSection } from "@/lib/planner-sections";
import type { ScheduleBody } from "../../../../packages/contracts/src/documents";
import { extensionPreviewSchema, type ExtensionPreview, type ExtensionPreviewClash } from "./extension-api";
import { extensionOptionId, optionIdFromClassNumber } from "./option-id";

/** The term data the section proxy serves, or null while it is unavailable. */
export type SectionsSource = {
  termSections(term: string): Promise<Section[] | null>;
};

export type PreviewInput = {
  scheduleId: string;
  term: string;
  classNumber: string;
  /** The term's real sections; null when the term file is unavailable. */
  sections: Section[] | null;
  /** Main's body and revision, or null when the document is missing or unreadable. */
  schedule: { body: ScheduleBody; revision: number } | null;
  /** The preferences document's busy blocks. */
  blocked: OptBlockedTime[];
};

/** Minutes after midnight, worded the way the panel shows times: "9:50 AM". */
function wordTime(minutes: number): string {
  // vsb encodes a midnight end as 1440, which is 12:00 AM.
  const period = minutes % 1440 >= 720 ? "PM" : "AM";
  const hour = Math.floor((minutes % 1440) / 60);
  const twelveHour = (hour + 11) % 12 + 1;
  return `${twelveHour}:${String(minutes % 60).padStart(2, "0")} ${period}`;
}

const wordMeeting = (meeting: Meeting) => ({
  days: meeting.day ?? (meeting.async ? "Online" : "TBA"),
  time: meeting.day && meeting.startMinutes !== null && meeting.endMinutes !== null
    ? `${wordTime(meeting.startMinutes)} to ${wordTime(meeting.endMinutes)}`
    : null,
  // The guard bounds a room line at 40 characters; a longer room stays out rather than breaking the preview.
  room: meeting.room && meeting.room.length <= 40 ? meeting.room : meeting.room ? null : null,
});

const wordRoom = (meeting: Meeting) => (meeting.room && meeting.room.length <= 40 ? ` in ${meeting.room}` : "");

/** One busy interval: a day plus a start and end in minutes after midnight. */
type Interval = { day: Day; start: number; end: number };

const intervalOf = (meeting: Meeting & { day: Day; startMinutes: number; endMinutes: number }): Interval =>
  ({ day: meeting.day, start: meeting.startMinutes, end: meeting.endMinutes });

const wordOverlap = (a: Interval, b: Interval): string => {
  const start = Math.max(a.start, b.start);
  const end = Math.min(a.end, b.end);
  return `${a.day} ${wordTime(start)} to ${wordTime(end)}`;
};

const clamp = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1)}…`);

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

  // A class number shared by several options (a lab linked to more than one
  // lecture) names the option whose primary component it is, else the first
  // that lists it: SectionsProxy.findClassNumber's rule.
  const resolved =
    sections.find((section) =>
      section.components.some((component) => component.role === "primary" && component.classNumber === classNumber)) ??
    sections.find((section) => section.classNumbers.includes(classNumber)) ??
    null;
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
      details: ["Main is not in your UNTangle account yet. Sign in and save a schedule first."],
      section: clamp(resolved.sectionCode, 12),
      meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
    });
  }
  if (schedule.body.termId !== term) {
    return extensionPreviewSchema.parse({
      scheduleId, optionId: extensionOptionId(resolved) ?? optionIdFromClassNumber(classNumber), revision,
      title: resolved.courseCode, conflict: "unknown", unknownReason: "schedule-unavailable",
      details: [`Main is for ${schedule.body.termId}; this class search is ${term}.`],
      section: clamp(resolved.sectionCode, 12),
      meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
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
      meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
      inSchedule,
    });
  }

  // A pick in Main that the term data no longer knows, or that never had set
  // times, leaves the schedule's busy time unknown, so no verdict is honest.
  // The course's own pick is skipped: adding the option replaces it.
  for (const [code, pickId] of Object.entries(schedule.body.selectedSections)) {
    if (code === resolved.courseCode) continue;
    const picked = sections.find((section) => section.id === pickId);
    if (!picked) {
      details.push(`Main picks ${code}, which this term's section data no longer lists, so UNTangle can't check times.`);
      return extensionPreviewSchema.parse({
        scheduleId, optionId, revision, title: resolved.courseCode,
        conflict: "unknown", unknownReason: "schedule-time-missing", details,
        section: clamp(resolved.sectionCode, 12),
        meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
        inSchedule,
      });
    }
    if (picked.meetings.some((meeting) => meeting.tba)) {
      details.push(`Main picks ${code}, whose meeting time is To Be Arranged, so UNTangle can't check times.`);
      return extensionPreviewSchema.parse({
        scheduleId, optionId, revision, title: resolved.courseCode,
        conflict: "unknown", unknownReason: "schedule-time-missing", details,
        section: clamp(resolved.sectionCode, 12),
        meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
        inSchedule,
      });
    }
  }

  // Overlaps with the other picks in Main, then with the student's calendar
  // busy blocks, on real dates: the planner's and the optimizer's own rules,
  // so a first-half and a second-half 8-week section at one time never clash.
  const clashes: ExtensionPreviewClash[] = [];
  const optionMeetings = resolved.meetings.filter(isTimed);
  for (const [code, pickId] of Object.entries(schedule.body.selectedSections)) {
    if (code === resolved.courseCode) continue;
    const picked = sections.find((section) => section.id === pickId);
    if (!picked) continue;
    const pickedMeetings = picked.meetings.filter(isTimed);
    for (const optionMeeting of optionMeetings) {
      const pickedMeeting = pickedMeetings.find((candidate) => meetingsConflict(optionMeeting, candidate));
      if (pickedMeeting) {
        clashes.push({ kind: "course", name: clamp(code, 80), when: clamp(wordOverlap(intervalOf(optionMeeting), intervalOf(pickedMeeting)), 80) });
      }
    }
  }
  const optMeetings = toOptSection(resolved)?.meetings ?? [];
  for (const block of blocked) {
    const optMeeting = optMeetings.find((candidate) => blockConflicts(block, candidate, termDates[term] ?? null));
    if (optMeeting) {
      clashes.push({
        kind: "busy",
        // The app's editors save an unnamed block as "Busy" (schedule-builder/limits.ts
        // UNNAMED); a synced or older document may still carry an empty label.
        name: clamp(block.label.trim() || "Busy", 80),
        when: clamp(wordOverlap(optMeeting, block), 80),
      });
    }
  }

  const meeting = resolved.meetings.find((value) => value.day !== null && value.startMinutes !== null);
  details.push(
    resolved.meetings.length && meeting
      ? clamp(`Meets ${wordMeeting(meeting).days} ${wordMeeting(meeting).time}${wordRoom(meeting)}.`, 500)
      : "No set meeting times.",
  );
  details.push(resolved.seats.open !== null && resolved.seats.total !== null
    ? `${resolved.seats.open} of ${resolved.seats.total} seats open.`
    : "Seat availability unknown.");
  if (inSchedule) details.push("Already in Main.");
  // add-option refuses to replace a pinned pick, so say so before the student confirms.
  const pinned = schedule.body.lockedSections[resolved.courseCode];
  if (pinned !== undefined && pinned !== resolved.id) {
    details.push(clamp(`Main pins another ${resolved.courseCode} section. Unpin it in UNTangle to switch.`, 500));
  }
  for (const clash of clashes) {
    details.push(clash.kind === "course"
      ? `Conflicts with ${clash.name} on ${clash.when}.`
      : `Conflicts with your busy time ${clash.name} on ${clash.when}.`);
  }

  return extensionPreviewSchema.parse({
    scheduleId, optionId, revision, title: resolved.courseCode,
    conflict: clashes.length ? "conflict" : "clear",
    details: details.slice(0, 30),
    section: clamp(resolved.sectionCode, 12),
    meetings: resolved.meetings.slice(0, 8).map(wordMeeting),
    clashes: clashes.slice(0, 12),
    inSchedule,
  });
}
