import { readFile } from "node:fs/promises";
import { parseVsbTerm } from "../src/lib/sections/vsb";

const path = process.argv[2];
const termId = process.argv[3] ?? "spring-2027";
if (!path) throw new Error("Usage: bun --no-env-file scripts/sections-coverage.ts <local-term.json> [term-id]");
const raw: unknown = JSON.parse(await readFile(path, "utf8"));
const term = parseVsbTerm(raw, termId);
const sections = [...term.courses.values()].flatMap(course => course.sections);
const meetings = sections.flatMap(section => section.meetings);
const physical = (section: typeof sections[number]) => section.meetings.filter(meeting => meeting.kind === "building" || meeting.kind === "unknown");
const spatialSections = sections.filter(section => physical(section).length);
const fullyMapped = spatialSections.filter(section => physical(section).every(meeting => meeting.buildingId !== null));
const unknown = new Map<string, number>();
for (const section of sections) {
  for (const code of new Set(physical(section).filter(meeting => meeting.buildingId === null).map(meeting => meeting.buildingCode ?? "unknown"))) {
    unknown.set(code, (unknown.get(code) ?? 0) + 1);
  }
}
const percent = (numerator: number, denominator: number) => denominator ? +(100 * numerator / denominator).toFixed(2) : 0;
console.log(JSON.stringify({
  file: path, term: term.id, updated_at: term.provenance.updated_at,
  coursesParsed: term.courses.size, sectionsParsed: sections.length, meetings: meetings.length,
  linkedOptions: sections.filter(section => section.components.length > 1).length,
  componentOccurrences: sections.reduce((sum, section) => sum + section.components.length, 0),
  mappedSections: fullyMapped.length, sectionsWithPhysicalRooms: spatialSections.length,
  buildingMappingPercentAllSections: percent(fullyMapped.length, sections.length),
  buildingMappingPercentPhysicalSections: percent(fullyMapped.length, spatialSections.length),
  onlineOptions: sections.filter(section => section.online).length,
  tbaOptions: sections.filter(section => section.tba).length,
  unknownCodesByOption: Object.fromEntries([...unknown].sort(([a], [b]) => a.localeCompare(b))),
  sourceNote: term.provenance.note,
}, null, 2));
