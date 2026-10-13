// Building-mapping coverage for a local vsb term file. Makes no network requests.
import { readFile } from "node:fs/promises";
import type { Section } from "../src/lib/sections/model";
import { parseTerm } from "../src/lib/sections/vsb";

const [path, termId = "spring-2027"] = process.argv.slice(2);
if (!path) throw new Error("Usage: bun scripts/sections-coverage.ts <term.json> [term-id]");
const term = parseTerm(JSON.parse(await readFile(path, "utf8")), termId);
const records = [...term.courses.values()];
const sections = records.filter(record => Array.isArray(record)).flat();
const physical = (section: Section) =>
  section.meetings.filter(meeting => meeting.kind === "building" || meeting.kind === "unknown");
const placed = sections.filter(section => physical(section).length);
const mapped = placed.filter(section => physical(section).every(meeting => meeting.buildingId));
const unknown = new Map<string, number>();
for (const section of sections) {
  const unmapped = physical(section).filter(meeting => !meeting.buildingId);
  for (const code of new Set(unmapped.map(meeting => meeting.buildingCode ?? "unknown"))) {
    unknown.set(code, (unknown.get(code) ?? 0) + 1);
  }
}
const percent = (part: number, whole: number) => (whole ? +((100 * part) / whole).toFixed(2) : 0);
console.log(JSON.stringify({
  file: path,
  term: term.term,
  updatedAt: term.provenance.updatedAt,
  coursesParsed: records.length,
  coursesWithSchemaErrors: records.filter(record => !Array.isArray(record)).length,
  sectionsParsed: sections.length,
  meetings: sections.reduce((sum, section) => sum + section.meetings.length, 0),
  linkedOptions: sections.filter(section => section.components.length > 1).length,
  // Options with a physical room where every physical room maps to a catalogue building.
  mappedSections: mapped.length,
  sectionsWithPhysicalRooms: placed.length,
  buildingMappingPercentAllSections: percent(mapped.length, sections.length),
  buildingMappingPercentPhysicalSections: percent(mapped.length, placed.length),
  onlineOptions: sections.filter(section => section.online).length,
  tbaOptions: sections.filter(section => section.tba).length,
  unknownCodesByOption: Object.fromEntries([...unknown].sort(([a], [b]) => a.localeCompare(b))),
  sourceNote: term.provenance.note,
}, null, 2));
