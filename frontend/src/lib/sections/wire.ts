import type { CourseSections, DateRange, Freshness, Instructor, LinkedComponent, Location, Meeting, Provenance, Seats, Section, Term } from "./model";
import { SectionSchemaError } from "./vsb";

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const textOrNull = (value: unknown) => value === null || typeof value === "string";
const numberOrNull = (value: unknown) => value === null || (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);
function list<T>(value: unknown, item: (value: unknown) => value is T): value is T[] { return Array.isArray(value) && value.every(item); }
const text = (value: unknown): value is string => typeof value === "string";
const oneOf = (value: unknown, values: readonly string[]) => text(value) && values.includes(value);
function dates(value: unknown): value is DateRange { return object(value) && textOrNull(value.start) && textOrNull(value.end) && text(value.raw); }
function instructor(value: unknown): value is Instructor { return object(value) && textOrNull(value.display) && text(value.raw); }
function seats(value: unknown): value is Seats { return object(value) && numberOrNull(value.open) && numberOrNull(value.total); }
function location(value: unknown): value is Location {
  return object(value) && text(value.room) && textOrNull(value.buildingCode) && textOrNull(value.buildingId) && text(value.buildingName) &&
    oneOf(value.kind, ["building", "unknown", "online", "unassigned"]) && typeof value.offCampus === "boolean";
}
function meeting(value: unknown): value is Meeting {
  return object(value) && (value.day === null || oneOf(value.day, ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"])) &&
    numberOrNull(value.startMinutes) && numberOrNull(value.endMinutes) && dates(value.dates) && instructor(value.instructor) &&
    typeof value.online === "boolean" && typeof value.async === "boolean" && typeof value.tba === "boolean" && location(value);
}
function component(value: unknown): value is LinkedComponent {
  return object(value) && text(value.id) && text(value.classNumber) && text(value.sectionCode) &&
    (value.role === "primary" || value.role === "required-linked") && value.componentType === "unspecified" &&
    instructor(value.instructor) && seats(value.seats) && list(value.meetings, meeting);
}
function section(value: unknown): value is Section {
  return object(value) && text(value.id) && textOrNull(value.term) && text(value.courseCode) && text(value.sectionCode) && list(value.classNumbers, text) &&
    textOrNull(value.option) && instructor(value.instructor) && seats(value.seats) && oneOf(value.status, ["open", "closed", "waitlist", "cancelled", "unknown"]) &&
    text(value.rawStatus) && object(value.session) && text(value.session.label) && dates(value.session.dates) &&
    list(value.components, component) && list(value.meetings, meeting) && typeof value.online === "boolean" && typeof value.async === "boolean" && typeof value.tba === "boolean";
}
function provenance(value: unknown): value is Provenance {
  if (!object(value) || !text(value.note)) return false;
  return value.kind === "real" ? value.source === "vsb.untgrades.app" && text(value.term) && text(value.updated_at) :
    value.kind === "sample" && text(value.source) && value.term === null && value.updated_at === null;
}
function freshness(value: unknown): value is Freshness {
  return object(value) && oneOf(value.status, ["ok", "stale", "unavailable"]) && textOrNull(value.checkedAt) && textOrNull(value.updatedAt) &&
    (value.diagnostic === null || (object(value.diagnostic) && oneOf(value.diagnostic.code, ["schema_error", "upstream_error", "cache_error"]) && text(value.diagnostic.message)));
}
function courseSections(value: unknown): value is CourseSections {
  return object(value) && text(value.term) && text(value.courseCode) && freshness(value.freshness) && value.status === value.freshness.status &&
    provenance(value.provenance) && oneOf(value.availability, ["sections", "no_classes", "sample", "missing"]) && list(value.sections, section);
}
export function parseProxyCourse(value: unknown, term: string, code: string): CourseSections {
  if (!courseSections(value) || value.term !== term || value.courseCode !== code || value.sections.some(s => s.courseCode !== code)) throw new SectionSchemaError("proxy.course", `invalid normalized response for ${term}/${code}`);
  const consistent = value.provenance.kind === "real"
    ? value.provenance.term === term && value.status !== "unavailable" &&
      (value.availability === "sections" ? value.sections.length > 0 : value.availability === "no_classes" && value.sections.length === 0) && value.sections.every(s => s.term === term)
    : value.status === "unavailable" && (value.availability === "sample" ? value.sections.length > 0 : value.availability === "missing" && value.sections.length === 0) && value.sections.every(s => s.term === null);
  if (!consistent) throw new SectionSchemaError("proxy.course.provenance", `status/availability/section term contradict provenance for ${term}/${code}`);
  return value;
}
function term(value: unknown): value is Term { return object(value) && text(value.id) && text(value.label) && freshness(value.freshness) && provenance(value.provenance); }
export function parseProxyTerms(value: unknown): Term[] {
  if (!object(value) || !list(value.terms, term)) throw new SectionSchemaError("proxy.terms", "invalid normalized term list");
  return value.terms;
}
