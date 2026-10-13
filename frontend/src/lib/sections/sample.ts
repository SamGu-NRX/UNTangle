import { sections } from "../seed-data";
import { campusBuildings } from "../campus-locations";
import type { Section } from "./model";
const buildings = new Map(campusBuildings.map(building => [building.id, building]));
const sampleMinutes = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes; };
export function getSampleSections(courseCode: string): Section[] {
  return sections.filter(section => section.courseCode === courseCode).map(section => {
    const instructor = { display: section.professor, raw: section.professor };
    const dates = { start: null, end: null, raw: "" };
    const meetings = section.meetings.map(meeting => {
      const building = meeting.buildingId ? buildings.get(meeting.buildingId) : undefined;
      return { day: meeting.day, startMinutes: sampleMinutes(meeting.start), endMinutes: sampleMinutes(meeting.end),
        room: meeting.location, buildingCode: building?.shortName ?? null, buildingId: building?.id ?? null,
        buildingName: building?.name ?? "Unknown building", kind: building ? "building" as const : "unknown" as const,
        offCampus: building?.isOffCampus ?? false, dates, instructor, online: false, async: false, tba: false };
    });
    return { id: section.id, term: null, courseCode, sectionCode: section.id, classNumbers: [], option: null,
      instructor, seats: { open: null, total: null }, status: "unknown", rawStatus: "Synthetic sample",
      session: { label: "Synthetic sample, no term", dates }, components: [], meetings, online: false, async: false, tba: false };
  });
}
