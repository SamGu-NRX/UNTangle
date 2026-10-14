import type { Day, Meeting, Section } from "@/lib/sections/model";
import type { Campus, Modality, SectionFacts } from "./model";

const weekOrder: Record<Day, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** The stated meeting days, deduped and in week order. Meetings without a day add none. */
export function meetingDays(section: Section): Day[] {
  const days = new Set<Day>();
  for (const meeting of section.meetings) {
    if (meeting.day !== null) days.add(meeting.day);
  }
  return [...days].sort((a, b) => weekOrder[a] - weekOrder[b]);
}

/** Online when every meeting is online; in-person when one meeting has a real room. */
export function modalityOf(section: Section): Modality {
  if (section.online) return "online";
  if (section.meetings.some((meeting) => meeting.kind === "building")) return "in-person";
  return "unknown";
}

function hasTimes(meeting: Meeting): meeting is Meeting & { startMinutes: number; endMinutes: number } {
  return meeting.startMinutes !== null && meeting.endMinutes !== null;
}

/**
 * Campus facts across meetings: an online meeting is campus "online", a
 * resolved off-campus building is "off-campus", and any other resolved
 * building is on the Denton campus (the campus building catalogue lists
 * Denton addresses). Unresolved rooms add no campus.
 */
export function campusesOf(section: Section): Campus[] {
  const found = new Set<Campus>();
  for (const meeting of section.meetings) {
    if (meeting.kind === "online") found.add("online");
    else if (meeting.kind === "building") found.add(meeting.offCampus ? "off-campus" : "denton");
  }
  const order: readonly Campus[] = ["denton", "off-campus", "online"];
  return order.filter((campus) => found.has(campus));
}

export function sectionFacts(section: Section): SectionFacts {
  const timed = section.meetings.filter(hasTimes);
  return {
    days: meetingDays(section),
    earliestStart: timed.length ? Math.min(...timed.map((meeting) => meeting.startMinutes)) : null,
    latestEnd: timed.length ? Math.max(...timed.map((meeting) => meeting.endMinutes)) : null,
    modality: modalityOf(section),
    campuses: campusesOf(section),
  };
}
