export type Day = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
export type SectionStatus = "open" | "closed" | "waitlist" | "cancelled" | "unknown";
export type DateRange = { start: string | null; end: string | null; raw: string };
export type Instructor = { display: string | null; raw: string };
export type Location = {
  room: string;
  buildingCode: string | null;
  buildingId: string | null;
  buildingName: string;
  kind: "building" | "unknown" | "online" | "unassigned";
  offCampus: boolean;
};
export type Meeting = Location & {
  day: Day | null;
  startMinutes: number | null;
  endMinutes: number | null;
  dates: DateRange;
  instructor: Instructor;
  online: boolean;
  async: boolean;
  tba: boolean;
};
export type Seats = { open: number | null; total: number | null };
export type LinkedComponent = {
  id: string;
  classNumber: string;
  sectionCode: string;
  role: "primary" | "required-linked";
  // Schema v2 labels the option, but does not identify lecture/lab/recitation types.
  componentType: "unspecified";
  instructor: Instructor;
  seats: Seats;
  meetings: Meeting[];
};
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
  meetings: Meeting[];
  online: boolean;
  async: boolean;
  tba: boolean;
};
export type Provenance =
  | { kind: "real"; source: "vsb.untgrades.app"; term: string; updated_at: string; note: string }
  | { kind: "sample"; source: string; term: null; updated_at: null; note: string };
export type Diagnostic = { code: "schema_error" | "upstream_error" | "cache_error"; message: string };
export type Freshness = {
  status: "ok" | "stale" | "unavailable";
  checkedAt: string | null;
  updatedAt: string | null;
  diagnostic: Diagnostic | null;
};
export type CourseSections = {
  term: string;
  courseCode: string;
  status: Freshness["status"];
  freshness: Freshness;
  provenance: Provenance;
  availability: "sections" | "no_classes" | "sample" | "missing";
  sections: Section[];
};
export type Term = { id: string; label: string; freshness: Freshness; provenance: Provenance };
export interface SectionSource {
  getTerms(): Promise<Term[]>;
  getCourseSections(term: string, courseCode: string): Promise<CourseSections>;
  freshness(term: string): Promise<Freshness>;
}
