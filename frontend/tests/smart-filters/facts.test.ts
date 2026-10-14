import { describe, expect, test } from "bun:test";
import { campusesOf, meetingDays, modalityOf, sectionFacts } from "@/lib/smart-filters/facts";
import { meeting, section } from "./helpers";

describe("meetingDays", () => {
  test("dedupes stated days in week order", () => {
    const piece = section({ meetings: [meeting({ day: "Wed" }), meeting({ day: "Mon" }), meeting({ day: "Wed" })] });
    expect(meetingDays(piece)).toEqual(["Mon", "Wed"]);
  });

  test("a section with only async and TBA meetings states no days", () => {
    const piece = section({ meetings: [meeting({ day: null, startMinutes: null, endMinutes: null, async: true }), meeting({ day: null, tba: true })] });
    expect(meetingDays(piece)).toEqual([]);
  });
});

describe("modalityOf", () => {
  test("a fully online section is online", () => {
    const piece = section({ online: true, meetings: [meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null })] });
    expect(modalityOf(piece)).toBe("online");
  });

  test("a section with any real room is in-person", () => {
    expect(modalityOf(section({}))).toBe("in-person");
  });

  test("a section with only unresolved rooms is unknown", () => {
    const piece = section({ meetings: [meeting({ kind: "unassigned", buildingCode: null, buildingId: null, buildingName: "", room: "" })] });
    expect(modalityOf(piece)).toBe("unknown");
  });
});

describe("campusesOf", () => {
  test("a campus building meeting is Denton and an off-campus one is not", () => {
    expect(campusesOf(section({}))).toEqual(["denton"]);
    const off = section({ meetings: [meeting({ offCampus: true, buildingCode: "FRSC", buildingName: "Frisco Campus" })] });
    expect(campusesOf(off)).toEqual(["off-campus"]);
  });

  test("a hybrid section lists several campuses in a stable order", () => {
    const hybrid = section({
      meetings: [meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null }), meeting({ offCampus: true })],
    });
    expect(campusesOf(hybrid)).toEqual(["off-campus", "online"]);
  });

  test("unresolved rooms add no campus", () => {
    const piece = section({ meetings: [meeting({ kind: "unknown", buildingCode: null, buildingId: null, buildingName: "", room: "TEST 1" })] });
    expect(campusesOf(piece)).toEqual([]);
  });
});

describe("sectionFacts", () => {
  test("reports the earliest start and latest end across meetings", () => {
    const piece = section({
      meetings: [meeting({ startMinutes: 600, endMinutes: 660 }), meeting({ day: "Thu", startMinutes: 780, endMinutes: 810 })],
    });
    const facts = sectionFacts(piece);
    expect(facts.days).toEqual(["Tue", "Thu"]);
    expect(facts.earliestStart).toBe(600);
    expect(facts.latestEnd).toBe(810);
    expect(facts.modality).toBe("in-person");
    expect(facts.campuses).toEqual(["denton"]);
  });

  test("an async online section has no times, days, or campuses beyond online", () => {
    const piece = section({
      online: true,
      async: true,
      meetings: [meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null, async: true })],
    });
    const facts = sectionFacts(piece);
    expect(facts.days).toEqual([]);
    expect(facts.earliestStart).toBeNull();
    expect(facts.latestEnd).toBeNull();
    expect(facts.modality).toBe("online");
    expect(facts.campuses).toEqual(["online"]);
  });
});
