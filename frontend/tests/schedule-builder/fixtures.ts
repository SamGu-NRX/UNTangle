import type { Day, Meeting, Section } from "@/lib/sections";

type MeetingSpec = {
  day: Day;
  /** "9:00" style, 24-hour. */
  at: string;
  until: string;
  building?: string | null;
  room?: string;
  dates?: { start: string; end: string };
  /** Where the room resolves (lib/sections/buildings.ts); default "building", or "unknown" with no building. */
  kind?: Meeting["kind"];
};

const minutes = (clock: string) => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
};

export function meeting(spec: MeetingSpec): Meeting {
  const building = spec.building === undefined ? "gab" : spec.building;
  return {
    room: spec.room ?? (building ? `${building.toUpperCase()} 101` : "TBA"),
    buildingCode: building ? building.toUpperCase() : null,
    buildingId: building,
    buildingName: building ? building.toUpperCase() : "Unknown building",
    kind: spec.kind ?? (building ? "building" : "unknown"),
    offCampus: false,
    day: spec.day,
    startMinutes: minutes(spec.at),
    endMinutes: minutes(spec.until),
    dates: { start: spec.dates?.start ?? null, end: spec.dates?.end ?? null, raw: "" },
    instructor: { display: null, raw: "" },
    async: false,
    tba: false,
  };
}

/** An online meeting with no set time. */
export const asyncMeeting: Meeting = {
  room: "Online",
  buildingCode: null,
  buildingId: null,
  buildingName: "Online",
  kind: "online",
  offCampus: false,
  day: null,
  startMinutes: null,
  endMinutes: null,
  dates: { start: null, end: null, raw: "" },
  instructor: { display: null, raw: "" },
  async: true,
  tba: false,
};

type SectionSpec = {
  courseCode: string;
  sectionCode?: string;
  meetings: Meeting[];
  online?: boolean;
  classNumbers?: string[];
  open?: number | null;
  instructor?: string | null;
  /** null for a sample section. */
  term?: string | null;
};

export function section(spec: SectionSpec): Section {
  const sectionCode = spec.sectionCode ?? "001";
  const term = spec.term === undefined ? "spring-2027" : spec.term;
  const classNumbers = spec.classNumbers ?? [];
  const seats = { open: spec.open ?? null, total: spec.open === undefined || spec.open === null ? null : 40 };
  const instructor = { display: spec.instructor ?? null, raw: spec.instructor ?? "" };
  return {
    id: `${term ?? "sample"}:${spec.courseCode}:${sectionCode}`,
    term,
    courseCode: spec.courseCode,
    sectionCode,
    classNumbers,
    option: null,
    instructor,
    seats,
    status: spec.open === 0 ? "closed" : "open",
    rawStatus: "",
    session: { label: "Regular Academic Session", dates: { start: null, end: null, raw: "" } },
    components: [
      { id: `${spec.courseCode}-${sectionCode}`, classNumber: classNumbers[0] ?? null, sectionCode, role: "primary", instructor, seats, meetings: spec.meetings },
    ],
    meetings: spec.meetings,
    online: spec.online ?? false,
    async: spec.meetings.some((m) => m.async),
    tba: spec.meetings.some((m) => m.tba),
  };
}
