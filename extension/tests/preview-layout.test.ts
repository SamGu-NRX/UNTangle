import { expect, test } from "bun:test";
import { isPreview, type Preview } from "../src/shared/extension-api";
const base: Preview = { scheduleId: "main", optionId: "section-14523", revision: 1, title: "CSCE 1030", conflict: "conflict", details: [] };
const full: Preview = {
  ...base,
  courseTitle: "Computer Science I",
  section: "001",
  meetings: [{ days: "Mon Wed Fri", time: "9:00 to 9:50 AM", room: null }, { days: "Online", time: null, room: null }],
  clashes: [{ kind: "course", name: "CSCE 1040", when: "Mon Wed Fri 9:30 to 10:20 AM" }, { kind: "busy", name: "Work", when: "Mon 9:00 to 10:00 AM" }],
  unknownReason: "no-set-time",
  grades: { status: "history", instructor: "John Smith", averageGpa: 3.4, students: 146, source: "UNT grade records", terms: "2019 to 2025" },
  inSchedule: false,
};
test("a preview without layout fields is still valid", () => {
  expect(isPreview(base)).toBe(true);
});
test("well-formed layout fields are accepted", () => {
  expect(isPreview(full)).toBe(true);
  expect(isPreview({ ...base, grades: { status: "none", instructor: null, source: "UNT grade records" } })).toBe(true);
  expect(isPreview({ ...base, grades: { status: "unavailable", instructor: "Jane Doe", source: "UNT grade records" } })).toBe(true);
  expect(isPreview({ ...base, grades: { ...full.grades, averageGpa: null } })).toBe(true);
});
test("one malformed layout field rejects the whole preview", () => {
  const broken: unknown[] = [
    { ...full, courseTitle: "" },
    { ...full, courseTitle: "x".repeat(161) },
    { ...full, section: 1 },
    { ...full, meetings: "Mon Wed Fri" },
    { ...full, meetings: [{ days: "Mon", time: 540, room: null }] },
    { ...full, meetings: [{ days: "Mon", time: null }] },
    { ...full, meetings: Array.from({ length: 9 }, () => full.meetings![0]) },
    { ...full, clashes: [{ kind: "event", name: "Work", when: "Mon" }] },
    { ...full, clashes: [{ kind: "busy", name: "", when: "Mon" }] },
    { ...full, unknownReason: "offline" },
    { ...full, grades: { ...full.grades, averageGpa: 4.5 } },
    { ...full, grades: { ...full.grades, students: 1.5 } },
    { ...full, grades: { ...full.grades, source: "" } },
    { ...full, grades: { status: "history", source: "UNT grade records" } },
    { ...full, grades: { status: "maybe", instructor: null, source: "UNT grade records" } },
    { ...full, inSchedule: "yes" },
  ];
  for (const preview of broken)
    expect(isPreview(preview)).toBe(false);
});
test("plannedTerms is one to four term names when present", () => {
  expect(isPreview({ ...base, plannedTerms: ["Spring 2027"] })).toBe(true);
  for (const plannedTerms of [[], [""], "Spring 2027", [2027], Array.from({ length: 5 }, () => "Spring 2027"), ["x".repeat(41)]])
    expect(isPreview({ ...base, plannedTerms })).toBe(false);
});
