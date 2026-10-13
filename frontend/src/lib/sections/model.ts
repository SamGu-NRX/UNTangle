export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type SectionStatus = "open" | "closed" | "waitlist" | "cancelled" | "unknown";
export type DateRange = { start: string | null; end: string | null; raw: string };
export type Instructor = { display: string | null; raw: string };
export type Seats = { open: number | null; total: number | null };

export type Location = {
  room: string;
  buildingCode: string | null;
  buildingId: string | null;
  buildingName: string;
  kind: "building" | "unknown" | "online" | "unassigned";
  offCampus: boolean;
};

/** Times are minutes after midnight; null means the source gave no day or time. */
export type Meeting = Location & {
  day: Day | null;
  startMinutes: number | null;
  endMinutes: number | null;
  dates: DateRange;
  instructor: Instructor;
  async: boolean;
  tba: boolean;
};

export type LinkedComponent = {
  id: string;
  /** Null only for synthetic samples, which have no class numbers. */
  classNumber: string | null;
  sectionCode: string;
  role: "primary" | "required-linked";
  instructor: Instructor;
  seats: Seats;
  meetings: Meeting[];
};

/** One enrollment option: a primary component plus any required linked components. */
export type Section = {
  id: string;
  term: string | null;
  courseCode: string;
  sectionCode: string;
  classNumbers: string[];
  option: string | null;
  instructor: Instructor;
  seats: Seats;
  status: SectionStatus;
  rawStatus: string;
  session: { label: string; dates: DateRange };
  components: LinkedComponent[];
  /** Every component's meetings, flattened once. */
  meetings: Meeting[];
  online: boolean;
  async: boolean;
  tba: boolean;
};

export type Diagnostic = { code: "schema_error" | "upstream_error"; message: string };
export type RealProvenance = {
  kind: "real";
  source: "vsb.untgrades.app";
  updatedAt: string;
  note: string;
};
export type SampleProvenance = { kind: "sample"; source: string; note: string };

type CourseBase = {
  term: string;
  courseCode: string;
  diagnostic: Diagnostic | null;
  sections: Section[];
};

/** Real vsb data, checked within the TTL (`ok`) or kept after it lapsed (`stale`). */
export type RealCourseSections = CourseBase & {
  status: "ok" | "stale";
  availability: "sections" | "no_classes";
  provenance: RealProvenance;
  checkedAt: string;
};

/** No usable real record: labeled synthetic samples, or nothing. */
export type SampleCourseSections = CourseBase & {
  status: "unavailable";
  availability: "sample" | "missing";
  provenance: SampleProvenance;
};

export type CourseSections = RealCourseSections | SampleCourseSections;
