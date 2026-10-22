import { expect, test } from "bun:test";
import { ScheduleAvailabilitySchema } from "../src/schedule-availability";

const evidence = { checkedAt: "2026-10-22T06:00:00Z", provenance: {
  kind: "real", source: "vsb.untgrades.app", updatedAt: "2026-10-21T00:00:00Z", note: "Source snapshot",
} };
const section = { id: "choice", sectionCode: "001", classNumbers: ["1234"], status: "open", seats: "open",
  components: [{ classNumber: "1234", sectionCode: "001", role: "primary", seats: { open: 4, total: 20 } }],
};
const response = { documentId: "schedule-1", revision: 3, institutionId: "unt", termId: "spring-2027", summary: "open",
  courses: [{ courseCode: "MATH 1680", selectedSectionId: "choice", state: "open", section, evidence }],
};

test("a client can parse source evidence and every required component", () => {
  const result = ScheduleAvailabilitySchema.parse(response);
  expect<unknown>(result).toEqual(response);
});

test("positive and stale results cannot masquerade as evidence-free samples", () => {
  for (const course of [
    { ...response.courses[0], evidence: null },
    { ...response.courses[0], state: "sample" },
    { ...response.courses[0], state: "unselected" },
    { ...response.courses[0], state: "missing" },
  ]) expect(ScheduleAvailabilitySchema.safeParse({ ...response, courses: [course] }).success).toBe(false);
  expect<unknown>(ScheduleAvailabilitySchema.parse({ ...response, summary: "unknown", courses: [
    { ...response.courses[0], state: "stale", section: null },
  ] }).courses[0]).toEqual({ courseCode: "MATH 1680", selectedSectionId: "choice", state: "stale", section: null, evidence });
});

test("malformed revisions, unknown fields, and negative seats fail at the client boundary", () => {
  expect(ScheduleAvailabilitySchema.safeParse({ ...response, revision: 0 }).success).toBe(false);
  expect(ScheduleAvailabilitySchema.safeParse({ ...response, userId: "another-user" }).success).toBe(false);
  expect(ScheduleAvailabilitySchema.safeParse({ ...response, courses: [{ ...response.courses[0], section: {
    ...section, components: [{ ...section.components[0], seats: { open: -1, total: 20 } }],
  } }] }).success).toBe(false);
  expect(ScheduleAvailabilitySchema.parse(response).revision).toBe(3);
});
