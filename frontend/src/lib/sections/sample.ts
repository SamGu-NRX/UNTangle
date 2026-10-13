import { campusBuildings } from "../campus-locations";
import { activeDataset } from "../data-provenance";
import { sections as seedSections } from "../seed-data";
import type { Diagnostic, Meeting, SampleCourseSections, SampleProvenance, Section } from "./model";

const buildings = new Map(campusBuildings.map(building => [building.id, building]));
const provenance: SampleProvenance = {
  kind: "sample",
  source: activeDataset.source,
  note: activeDataset.label,
};
const noDates = { start: null, end: null, raw: "" };

function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function sampleSection(seed: (typeof seedSections)[number]): Section {
  const instructor = { display: seed.professor, raw: seed.professor };
  const seats = { open: null, total: null };
  const meetings = seed.meetings.map((meeting): Meeting => {
    const building = meeting.buildingId ? buildings.get(meeting.buildingId) : undefined;
    return {
      room: meeting.location,
      buildingCode: building?.shortName ?? null,
      buildingId: building?.id ?? null,
      buildingName: building?.name ?? "Unknown building",
      kind: building ? "building" : "unknown",
      offCampus: building?.isOffCampus ?? false,
      day: meeting.day,
      startMinutes: toMinutes(meeting.start),
      endMinutes: toMinutes(meeting.end),
      dates: noDates,
      instructor,
      async: false,
      tba: false,
    };
  });
  return {
    id: seed.id,
    term: null,
    courseCode: seed.courseCode,
    sectionCode: seed.id,
    classNumbers: [],
    option: null,
    instructor,
    seats,
    status: "unknown",
    rawStatus: "Synthetic sample",
    session: { label: "Synthetic sample, no term", dates: noDates },
    components: [{
      id: seed.id,
      classNumber: null,
      sectionCode: seed.id,
      role: "primary",
      instructor,
      seats,
      meetings,
    }],
    meetings,
    online: false,
    async: false,
    tba: false,
  };
}

/** The result when vsb has no usable record: labeled synthetic samples, or nothing. */
export function sampleResult(
  term: string,
  courseCode: string,
  diagnostic: Diagnostic | null,
): SampleCourseSections {
  const sections = seedSections
    .filter(section => section.courseCode === courseCode)
    .map(sampleSection);
  return {
    term,
    courseCode,
    status: "unavailable",
    availability: sections.length ? "sample" : "missing",
    provenance,
    diagnostic,
    sections,
  };
}
