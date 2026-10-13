import { describe, expect, test } from "bun:test";
import fixture from "./fixtures/spring-2027.json";
import { normalizeInstructor, parseVsbTerm } from "../../src/lib/sections/vsb";
import { resolveRoom } from "../../src/lib/sections/buildings";
import { campusBuildings } from "../../src/lib/campus-locations";

const parse = () => parseVsbTerm(fixture, "spring-2027");
function section(code: string) {
  const result = parse().courses.get(code)?.sections[0];
  if (!result) throw new Error(`Fixture missing ${code}`);
  return result;
}
describe("vsb schema v2", () => {
  test("enrollment options preserve lecture plus required components without double counting", () => {
    const result = section("MATH 1680");
    expect(result.id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
    expect(result.components.map(c => [c.classNumber, c.role, c.seats.open])).toEqual([["6862", "primary", 99], ["6863", "required-linked", 33]]);
    expect(result.meetings.map(m => [m.day, m.startMinutes, m.endMinutes, m.buildingId])).toEqual([
      ["Tue", 575, 655, "cury"], ["Thu", 575, 655, "cury"], ["Mon", 480, 530, "gab"],
    ]);
    expect(result.instructor).toEqual({ display: "Allen Mann", raw: "Mann,Allen" });
    expect(result.components[1].instructor).toEqual({ display: null, raw: "None" });
  });
  test("online async options retain eight-week dates and real provenance", () => {
    const result = section("ACCT 5120");
    expect([result.online, result.async, result.tba]).toEqual([true, true, false]);
    expect(result.meetings.map(m => [m.day, m.startMinutes, m.buildingId, m.kind])).toEqual([[null, null, null, "online"]]);
    expect(result.session).toEqual({ label: "Eight Week - Second", dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" } });
    expect(parse().provenance).toEqual({ kind: "real", source: "vsb.untgrades.app", term: "spring-2027", updated_at: fixture.updated_at, note: fixture.note });
  });
  test("known day with TBA time stays a meeting with no invented time", () => {
    const result = section("BCIS 4740");
    expect(result.meetings.map(m => [m.day, m.startMinutes, m.endMinutes, m.buildingId, m.tba])).toEqual([["Thu", null, null, "sage", true], ["Thu", 1050, 1130, "sage", false]]);
    expect(result.async).toBe(false);
  });
  test("scheduled online meetings stay timed and zero seats stay zero", () => {
    const input = structuredClone(fixture);
    const option = input.courses["ACCT 5120"].sections[0];
    option.meetings[0].days = "M";
    option.meetings[0].start_time = "8:00AM";
    option.meetings[0].end_time = "9:00AM";
    option.open_seats = 0;
    const result = parseVsbTerm(input, "spring-2027").courses.get("ACCT 5120")?.sections[0];
    expect(result).toMatchObject({ online: true, async: false, tba: false, seats: { open: 0 } });
    expect(result?.meetings[0]).toMatchObject({ day: "Mon", startMinutes: 480, endMinutes: 540 });
  });
  test("legacy and letter-suffixed catalogue codes retain their exact identity", () => {
    const course = fixture.courses["MATH 1680"];
    const input = { ...fixture, courses: {
      "MATH 340": { ...course, course_code: "MATH 340" },
      "MEEN 5940Z": { ...course, course_code: "MEEN 5940Z" },
    } };
    const result = parseVsbTerm(input, "spring-2027");
    expect(result.courses.get("MATH 340")?.sections[0].id).toBe("vsb:spring-2027:MATH 340:6862+6863");
    expect(result.courses.get("MEEN 5940Z")?.sections[0].id).toBe("vsb:spring-2027:MEEN 5940Z:6862+6863");
  });
  test("all multi-meeting rows, weekends and unknown rooms survive", () => {
    const result = section("DBAS 6003");
    expect(result.meetings).toHaveLength(8);
    expect(result.meetings.map(m => m.day)).toEqual(["Sat", "Sun", "Sat", "Sun", "Sat", "Sun", "Sat", "Sun"]);
    expect(result.meetings[0]).toMatchObject({ startMinutes: 690, endMinutes: 860, room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building" });
  });
  test("closed null seats and wait lists remain distinct from open seats", () => {
    expect(section("ADES 5510")).toMatchObject({ status: "closed", rawStatus: "Closed", seats: { open: null, total: null }, instructor: { display: null, raw: "Closed" } });
    expect(section("ART 5450")).toMatchObject({ status: "waitlist", rawStatus: "Wait List" });
    expect(parse().courses.get("AARS 6810")?.status).toBe("no_classes");
  });
  test("cancelled statuses and noon/midnight normalization", () => {
    const input = structuredClone(fixture);
    const option = input.courses["MATH 1680"].sections[0];
    option.status = "Cancelled";
    option.meetings[0].start_time = "12:00AM";
    option.meetings[0].end_time = "12:00PM";
    const result = parseVsbTerm(input, "spring-2027").courses.get("MATH 1680")?.sections[0];
    expect(result).toMatchObject({ status: "cancelled" });
    expect(result?.meetings[0]).toMatchObject({ startMinutes: 0, endMinutes: 720 });
  });
  test("option numbering and component order do not define ids", () => {
    const input = structuredClone(fixture);
    const option = input.courses["MATH 1680"].sections[0];
    option.option = "99";
    option.section = "renumbered";
    option.class_numbers.reverse(); option.linked_sections.reverse(); option.class_number = option.class_numbers.join("+");
    expect(parseVsbTerm(input, "spring-2027").courses.get("MATH 1680")?.sections[0].id).toBe("vsb:spring-2027:MATH 1680:6862+6863");
  });
  test("missing detailed meetings use linked component schedule", () => {
    const input = structuredClone(fixture);
    input.courses["MATH 1680"].sections[0].meetings = [];
    expect(parseVsbTerm(input, "spring-2027").courses.get("MATH 1680")?.sections[0].meetings.map(m => m.day)).toEqual(["Tue", "Thu", "Mon"]);
  });
  test("instructor normalization preserves suffixes and already formatted names", () => {
    expect(normalizeInstructor("Curran Jr,Anthony A")).toEqual({ display: "Anthony A Curran Jr", raw: "Curran Jr,Anthony A" });
    expect(normalizeInstructor("  Jane  Smith ")).toEqual({ display: "Jane Smith", raw: "  Jane  Smith " });
    expect(normalizeInstructor("Jimenez,Jaime Enrique, Ogden Jr,Samuel J")).toEqual({ display: "Jaime Enrique Jimenez; Samuel J Ogden Jr", raw: "Jimenez,Jaime Enrique, Ogden Jr,Samuel J" });
    expect(normalizeInstructor("None, Lee,Annie Seong")).toEqual({ display: "Annie Seong Lee", raw: "None, Lee,Annie Seong" });
    expect(normalizeInstructor("None None")).toEqual({ display: null, raw: "None None" });
  });
  test("first eight-week sessions and five-day schedules retain per-meeting dates", () => {
    const input = structuredClone(fixture);
    const option = input.courses["MATH 1680"].sections[0];
    option.session = "Eight Week - First";
    option.meeting_dates = "01/11/2027 - 03/05/2027";
    option.meetings[0].days = "MTWRF";
    option.meetings[0].meeting_dates = "01/11/2027 - 03/05/2027";
    const result = parseVsbTerm(input, "spring-2027").courses.get("MATH 1680")?.sections[0];
    expect(result?.session.dates).toMatchObject({ start: "2027-01-11", end: "2027-03-05" });
    expect(result?.components[0].meetings.map(m => m.day)).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri"]);
    expect(result?.meetings[0].dates.end).toBe("2027-03-05");
  });
  test.each([
    ["version", { ...fixture, schema_version: 3 }, "$.schema_version"],
    ["unknown field", { ...fixture, new_field: true }, "$.new_field"],
    ["wrong shape", { ...fixture, courses: [] }, "$.courses"],
  ])("rejects %s with the exact source path", (_label, input, path) => {
    expect(() => parseVsbTerm(input, "spring-2027")).toThrow(`vsb schema v2: ${path}`);
  });
  test("rejects changed nested shape, days, time, dates and status", () => {
    const mutations = [
      (s: typeof fixture.courses["MATH 1680"]["sections"][number]) => { s.meetings[0].days = "H"; },
      (s: typeof fixture.courses["MATH 1680"]["sections"][number]) => { s.meetings[0].start_time = "25:00PM"; },
      (s: typeof fixture.courses["MATH 1680"]["sections"][number]) => { s.meetings[0].meeting_dates = "02/30/2027 - 05/07/2027"; },
      (s: typeof fixture.courses["MATH 1680"]["sections"][number]) => { s.status = "New Status"; },
    ];
    for (const mutate of mutations) {
      const input = structuredClone(fixture); mutate(input.courses["MATH 1680"].sections[0]);
      expect(() => parseVsbTerm(input, "spring-2027")).toThrow("vsb schema v2: $.courses[\"MATH 1680\"].sections[0]");
    }
    expect(() => parseVsbTerm(fixture, "fall-2027")).toThrow("$.term");
  });
});
describe("catalogue-backed room mapping", () => {
  test.each([
    ["Gab 104", "gab", "General Academic Building"], ["GAB 104", "gab", "General Academic Building"],
    ["Wh 316", "wh", "Wooten Hall"], ["Audb 100", "aud", "Auditorium Building"],
    ["HKRY 101", "hick", "Hickory Hall"], ["ARTF 101", "arta", "Art Annex"],
    ["NTDP F100", "ntdp", "Discovery Park"], ["MGV P124", "mgvp", "MGV Building P"],
  ])("%s resolves to the registered building", (room, id, name) => {
    expect(resolveRoom(room)).toMatchObject({ buildingId: id, buildingName: name, kind: "building" });
    expect(campusBuildings.find(b => b.id === id)?.name).toBe(name);
  });
  test("every catalogue mnemonic resolves to its own id", () => {
    for (const building of campusBuildings) {
      expect(resolveRoom(`${building.mnemonic} 101`).buildingId).toBe(building.id);
    }
  });
  test("unknown campuses and rooms are never guessed", () => {
    expect(resolveRoom("Frisco Landing 150")).toMatchObject({ buildingId: null, kind: "unknown", buildingName: "Unknown building" });
    expect(resolveRoom("MGV Q124").buildingId).toBeNull();
    expect(resolveRoom("No Room").kind).toBe("unassigned");
    expect(resolveRoom("None").kind).toBe("unassigned");
    expect(resolveRoom("UNT Internet Course").kind).toBe("online");
    expect(resolveRoom("NTDP F100").offCampus).toBe(true);
  });
});
