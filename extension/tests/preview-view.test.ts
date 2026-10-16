import { expect, test } from "bun:test";
import type { Preview } from "../src/shared/extension-api";
import { canAdd, unplannedTerm, verdictOf } from "../src/shared/preview-view";

const base: Preview = { scheduleId: "main", optionId: "section-5907", revision: 1, title: "ENGL 1310", conflict: "clear", details: ["24 of 24 seats open."] };

test("a course that clashes on several days is named once", () => {
  const preview: Preview = {
    ...base, conflict: "conflict",
    clashes: [
      { kind: "course", name: "MATH 1680", when: "Mon 1:25 PM to 2:15 PM" },
      { kind: "course", name: "MATH 1680", when: "Wed 1:25 PM to 2:15 PM" },
      { kind: "busy", name: "Work", when: "Fri 1:25 PM to 2:00 PM" },
    ],
  };
  expect(verdictOf(preview).words).toBe("Overlaps MATH 1680 and your busy time “Work”.");
});

test("an unknown verdict says UNTangle's own reason, and More doesn't repeat it", () => {
  const noMain: Preview = {
    ...base, conflict: "unknown", unknownReason: "schedule-unavailable", revision: 0,
    details: ["Your UNTangle account has no Main schedule yet, so there is nothing to check this section against or add it to."],
  };
  expect(verdictOf(noMain)).toEqual({ marker: "unknown", words: noMain.details[0], more: [] });
  // With no reason line, the reason code's own sentence stands in.
  expect(verdictOf({ ...noMain, details: [] }).words).toBe("UNTangle couldn't check this section against Main.");
  expect(verdictOf({ ...base, conflict: "unknown", unknownReason: "no-set-time", details: [] }).words).toBe("This section has no set meeting time, so there's nothing to compare.");
});

test("a fit and an add already in Main keep every detail line for More", () => {
  expect(verdictOf(base)).toEqual({ marker: "clear", words: "Fits Main. It overlaps none of your classes or busy times.", more: base.details });
  expect(verdictOf({ ...base, inSchedule: true })).toMatchObject({ marker: "added", words: "ENGL 1310 is already in Main.", more: base.details });
});

test("Add is offered only when UNTangle could check the section against Main", () => {
  expect(canAdd(base)).toBe(true);
  expect(canAdd({ ...base, conflict: "conflict" })).toBe(true);
  expect(canAdd({ ...base, conflict: "unknown", unknownReason: "no-set-time" })).toBe(true);
  expect(canAdd({ ...base, conflict: "unknown", unknownReason: "schedule-time-missing" })).toBe(true);
  expect(canAdd({ ...base, conflict: "unknown", unknownReason: "schedule-unavailable" })).toBe(false);
  expect(canAdd({ ...base, inSchedule: true })).toBe(false);
});

test("a term UNTangle doesn't plan names the planned term; an outage with the same reason doesn't", () => {
  // The server's reply for a Fall 2027 class search while UNTangle plans Spring 2027 (frontend/src/server/extension/preview.ts).
  const unplanned: Preview = {
    scheduleId: "main", optionId: "9000", revision: 0, title: "9000", conflict: "unknown", unknownReason: "schedule-unavailable",
    details: ["UNTangle plans only Spring 2027 for now. This class search is Fall 2027."], plannedTerms: ["Spring 2027"],
  };
  expect(unplannedTerm(unplanned, "Fall 2027")).toEqual({
    title: "UNTangle plans only Spring 2027 for now",
    lead: "This class search is for Fall 2027. Switch class search to Spring 2027 to check sections against Main.",
  });
  expect(unplannedTerm({ ...unplanned, plannedTerms: ["Spring 2027", "Summer 2027"] }, "Fall 2027")?.lead)
    .toBe("This class search is for Fall 2027. Switch class search to Spring 2027 or Summer 2027 to check sections against Main.");
  const outage: Preview = { ...unplanned, plannedTerms: undefined, details: ["Section data is unavailable right now. Check again in a moment."] };
  expect(unplannedTerm(outage, "Spring 2027")).toBeNull();
  expect(canAdd(unplanned)).toBe(false);
});
