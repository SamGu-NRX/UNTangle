import { describe, expect, test } from "bun:test";
import { sectionMatchesFilters } from "@/lib/smart-filters/filters";
import type { SmartFilter } from "@/lib/smart-filters/model";
import { meeting, section } from "./helpers";

describe("open-seats", () => {
  test("matches a known open count at or above the minimum", () => {
    const piece = section({ seats: { open: 5, total: 30 } });
    expect(sectionMatchesFilters(piece, [{ kind: "open-seats", minimum: 5 }])).toBe(true);
    expect(sectionMatchesFilters(piece, [{ kind: "open-seats", minimum: 6 }])).toBe(false);
  });

  test("a section with unknown seat counts matches no open-seat filter", () => {
    const piece = section({ seats: { open: null, total: null } });
    expect(sectionMatchesFilters(piece, [{ kind: "open-seats", minimum: 0 }])).toBe(false);
  });
});

describe("meeting-days", () => {
  test("fits only when every stated meeting day is selected", () => {
    const piece = section({ meetings: [meeting({ day: "Mon" }), meeting({ day: "Wed" })] });
    expect(sectionMatchesFilters(piece, [{ kind: "meeting-days", days: ["Mon", "Wed"] }])).toBe(true);
    expect(sectionMatchesFilters(piece, [{ kind: "meeting-days", days: ["Mon"] }])).toBe(false);
    expect(sectionMatchesFilters(piece, [{ kind: "meeting-days", days: ["Mon", "Tue", "Wed"] }])).toBe(true);
  });

  test("meetings without a day impose no constraint", () => {
    const piece = section({ meetings: [meeting({ day: null, startMinutes: null, endMinutes: null, async: true })] });
    expect(sectionMatchesFilters(piece, [{ kind: "meeting-days", days: ["Fri"] }])).toBe(true);
  });

  test("an empty selection constrains nothing", () => {
    expect(sectionMatchesFilters(section({}), [{ kind: "meeting-days", days: [] }])).toBe(true);
  });
});

describe("time-window", () => {
  test("fits only when every timed meeting lies inside the window", () => {
    const piece = section({ meetings: [meeting({ startMinutes: 600, endMinutes: 660 })] });
    const inside: SmartFilter = { kind: "time-window", startMinutes: 570, endMinutes: 690 };
    const early: SmartFilter = { kind: "time-window", startMinutes: 540, endMinutes: 600 };
    const late: SmartFilter = { kind: "time-window", startMinutes: 660, endMinutes: 720 };
    expect(sectionMatchesFilters(piece, [inside])).toBe(true);
    expect(sectionMatchesFilters(piece, [early])).toBe(false);
    expect(sectionMatchesFilters(piece, [late])).toBe(false);
  });

  test("meetings at the window edges fit", () => {
    const piece = section({ meetings: [meeting({ startMinutes: 600, endMinutes: 660 })] });
    const exact: SmartFilter = { kind: "time-window", startMinutes: 600, endMinutes: 660 };
    expect(sectionMatchesFilters(piece, [exact])).toBe(true);
  });

  test("meetings without times and sections without timed meetings fit any window", () => {
    const piece = section({ meetings: [meeting({ startMinutes: null, endMinutes: null, async: true })] });
    const window: SmartFilter = { kind: "time-window", startMinutes: 600, endMinutes: 660 };
    expect(sectionMatchesFilters(piece, [window])).toBe(true);
  });
});

describe("modality", () => {
  test("an online section matches online and not in-person", () => {
    const piece = section({ online: true, meetings: [meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null })] });
    expect(sectionMatchesFilters(piece, [{ kind: "modality", modality: "online" }])).toBe(true);
    expect(sectionMatchesFilters(piece, [{ kind: "modality", modality: "in-person" }])).toBe(false);
  });

  test("a section with a real room matches in-person", () => {
    expect(sectionMatchesFilters(section({}), [{ kind: "modality", modality: "in-person" }])).toBe(true);
  });

  test("a section of unknown modality matches neither choice", () => {
    const piece = section({ meetings: [meeting({ kind: "unassigned", buildingCode: null, buildingId: null, buildingName: "", room: "" })] });
    expect(sectionMatchesFilters(piece, [{ kind: "modality", modality: "online" }])).toBe(false);
    expect(sectionMatchesFilters(piece, [{ kind: "modality", modality: "in-person" }])).toBe(false);
  });
});

describe("campus", () => {
  test("matches the campus its meetings resolve to", () => {
    expect(sectionMatchesFilters(section({}), [{ kind: "campus", campus: "denton" }])).toBe(true);
    expect(sectionMatchesFilters(section({}), [{ kind: "campus", campus: "online" }])).toBe(false);
  });

  test("a hybrid section matches several campus filters", () => {
    const hybrid = section({
      meetings: [meeting({ offCampus: true }), meeting({ kind: "online", day: null, startMinutes: null, endMinutes: null })],
    });
    expect(sectionMatchesFilters(hybrid, [{ kind: "campus", campus: "off-campus" }])).toBe(true);
    expect(sectionMatchesFilters(hybrid, [{ kind: "campus", campus: "online" }])).toBe(true);
    expect(sectionMatchesFilters(hybrid, [{ kind: "campus", campus: "denton" }])).toBe(false);
  });
});

describe("combining filters", () => {
  test("filters combine with AND", () => {
    const piece = section({
      seats: { open: 5, total: 30 },
      meetings: [meeting({ day: "Mon", startMinutes: 600, endMinutes: 660 })],
    });
    const open: SmartFilter = { kind: "open-seats", minimum: 1 };
    const mondays: SmartFilter = { kind: "meeting-days", days: ["Mon"] };
    const evenings: SmartFilter = { kind: "time-window", startMinutes: 1020, endMinutes: 1200 };
    expect(sectionMatchesFilters(piece, [open, mondays])).toBe(true);
    expect(sectionMatchesFilters(piece, [open, evenings])).toBe(false);
  });

  test("no filters matches every section", () => {
    expect(sectionMatchesFilters(section({}), [])).toBe(true);
  });
});
