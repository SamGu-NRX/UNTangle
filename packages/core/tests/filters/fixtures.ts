/**
 * Fixtures for filters.test.ts: enrollment options as parseTerm
 * (frontend/src/lib/sections/vsb.ts) returned them for
 * frontend/tests/sections/fixtures/spring-2027.json on 2026-10-14, some with
 * one raw field edited before parsing, as each comment says. Typed with the
 * app's own Section, so they hold only what the app can produce, and frozen,
 * so a filter that changes its input throws.
 */
import type { Section } from "../../../../frontend/src/lib/sections/model";
import type { FilterContext } from "../../src/filters";

function frozen<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

/** Sites as the planner reads them today (otherSiteOf in frontend/src/lib/planner-sections.ts): Discovery Park counts as Denton, FRLD is Frisco. */
export const context: FilterContext = frozen({
  creditHours: 3,
  sites: {
    byBuildingId: { cury: "unt-denton", gab: "unt-denton", sage: "unt-denton", ntdp: "unt-denton" },
    byRoomCode: { FRLD: "unt-frisco", FRISCO: "unt-frisco" },
  },
});

/** MATH 1680, option 6862+6863, as the source gives it: open, lecture 99 seats and lab 33, Tue/Thu 9:35 to 10:55 in Curry Hall and Mon 8:00 to 8:50 in GAB. */
export const math: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the lab at 0 open seats. */
export const mathLabFull: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 0, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the lab's open seats missing (null). */
export const mathLabSeatsUnknown: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: null, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the lecture full and the lab's seats missing. */
export const mathLectureFullLabUnknown: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 0, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: null, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with a status the parser doesn't know ("Reserved"). */
export const mathStatusUnknown: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "unknown",
  rawStatus: "Reserved",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680, cancelled. */
export const mathCancelled: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "cancelled",
  rawStatus: "Cancelled",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the Monday lab held online at its set time. */
export const mathHybrid: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 taught by two instructors. */
export const mathCoTaught: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen,Lineros,Jose", display: "Allen Mann; Jose Lineros" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Cury 203", buildingCode: "CURY", buildingId: "cury", buildingName: "Curry Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the lecture at Discovery Park (NTDP), a catalogue building marked off campus. */
export const mathAtDiscoveryPark: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "NTDP B185", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: true, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "NTDP B185", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: true, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "NTDP B185", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: true, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "NTDP B185", buildingCode: "NTDP", buildingId: "ntdp", buildingName: "Discovery Park", kind: "building", offCampus: true, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** MATH 1680 with the lecture in MHA, a room code the campus catalogue doesn't map. */
export const mathInMha: Section = frozen({
  id: "vsb:spring-2027:MATH 1680:6862+6863",
  term: "spring-2027",
  courseCode: "MATH 1680",
  sectionCode: "110 + 111",
  classNumbers: ["6862", "6863"],
  option: "4",
  instructor: { raw: "Mann,Allen", display: "Allen Mann" },
  seats: { open: 99, total: 99 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:MATH 1680:6862",
      classNumber: "6862",
      sectionCode: "110",
      role: "primary",
      instructor: { raw: "Mann,Allen", display: "Allen Mann" },
      seats: { open: 99, total: 99 },
      meetings: [
        { room: "MHA 176", buildingCode: "MHA", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
        { room: "MHA 176", buildingCode: "MHA", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
      ],
    },
    {
      id: "vsb-component:spring-2027:MATH 1680:6863",
      classNumber: "6863",
      sectionCode: "111",
      role: "required-linked",
      instructor: { raw: "None", display: null },
      seats: { open: 33, total: 33 },
      meetings: [{ room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false }],
    },
  ],
  meetings: [
    { room: "MHA 176", buildingCode: "MHA", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Tue", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "MHA 176", buildingCode: "MHA", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Thu", startMinutes: 575, endMinutes: 655, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Mann,Allen", display: "Allen Mann" }, async: false, tba: false },
    { room: "Gab 511", buildingCode: "GAB", buildingId: "gab", buildingName: "General Academic Building", kind: "building", offCampus: false, day: "Mon", startMinutes: 480, endMinutes: 530, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** ACCT 5120: online with no set day or time. */
export const acctAsync: Section = frozen({
  id: "vsb:spring-2027:ACCT 5120:1002",
  term: "spring-2027",
  courseCode: "ACCT 5120",
  sectionCode: "400",
  classNumbers: ["1002"],
  option: "2",
  instructor: { raw: "Lineros,Jose", display: "Jose Lineros" },
  seats: { open: 70, total: 70 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Eight Week - Second", dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:ACCT 5120:1002",
      classNumber: "1002",
      sectionCode: "400",
      role: "primary",
      instructor: { raw: "Lineros,Jose", display: "Jose Lineros" },
      seats: { open: 70, total: 70 },
      meetings: [{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: null, startMinutes: null, endMinutes: null, dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" }, instructor: { raw: "Lineros,Jose", display: "Jose Lineros" }, async: true, tba: false }],
    },
  ],
  meetings: [{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: null, startMinutes: null, endMinutes: null, dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" }, instructor: { raw: "Lineros,Jose", display: "Jose Lineros" }, async: true, tba: false }],
  online: true,
  async: true,
  tba: false,
});

/** ACCT 5120 online on Mondays 8:00 to 9:00. */
export const acctTimed: Section = frozen({
  id: "vsb:spring-2027:ACCT 5120:1002",
  term: "spring-2027",
  courseCode: "ACCT 5120",
  sectionCode: "400",
  classNumbers: ["1002"],
  option: "2",
  instructor: { raw: "Lineros,Jose", display: "Jose Lineros" },
  seats: { open: 70, total: 70 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Eight Week - Second", dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:ACCT 5120:1002",
      classNumber: "1002",
      sectionCode: "400",
      role: "primary",
      instructor: { raw: "Lineros,Jose", display: "Jose Lineros" },
      seats: { open: 70, total: 70 },
      meetings: [{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: "Mon", startMinutes: 480, endMinutes: 540, dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" }, instructor: { raw: "Lineros,Jose", display: "Jose Lineros" }, async: false, tba: false }],
    },
  ],
  meetings: [{ room: "UNT Internet Course", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Online", kind: "online", day: "Mon", startMinutes: 480, endMinutes: 540, dates: { raw: "03/15/2027 - 05/07/2027", start: "2027-03-15", end: "2027-05-07" }, instructor: { raw: "Lineros,Jose", display: "Jose Lineros" }, async: false, tba: false }],
  online: true,
  async: false,
  tba: false,
});

/** BCIS 4740: a Thursday line with no time (TBA) and a Thursday line at 17:30 to 18:50. */
export const bcisTba: Section = frozen({
  id: "vsb:spring-2027:BCIS 4740:11671",
  term: "spring-2027",
  courseCode: "BCIS 4740",
  sectionCode: "301",
  classNumbers: ["11671"],
  option: "1",
  instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" },
  seats: { open: 65, total: 65 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:BCIS 4740:11671",
      classNumber: "11671",
      sectionCode: "301",
      role: "primary",
      instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" },
      seats: { open: 65, total: 65 },
      meetings: [
        { room: "SAGE 331", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: true },
        { room: "SAGE 333", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 1050, endMinutes: 1130, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: false },
      ],
    },
  ],
  meetings: [
    { room: "SAGE 331", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: true },
    { room: "SAGE 333", buildingCode: "SAGE", buildingId: "sage", buildingName: "Sage Hall", kind: "building", offCampus: false, day: "Thu", startMinutes: 1050, endMinutes: 1130, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Kim,Dan J.", display: "Dan J. Kim" }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: true,
});

/** DBAS 6003 at Frisco (room code FRLD, unmapped), Sat and Sun 11:30 to 14:20, each line listed four times. */
export const dbasFrisco: Section = frozen({
  id: "vsb:spring-2027:DBAS 6003:12747",
  term: "spring-2027",
  courseCode: "DBAS 6003",
  sectionCode: "501",
  classNumbers: ["12747"],
  option: "1",
  instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
  seats: { open: 20, total: 20 },
  status: "open",
  rawStatus: "Open",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:DBAS 6003:12747",
      classNumber: "12747",
      sectionCode: "501",
      role: "primary",
      instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
      seats: { open: 20, total: 20 },
      meetings: [
        {
          room: "FRLD 458",
          buildingCode: "FRLD",
          buildingId: null,
          buildingName: "Unknown building",
          kind: "unknown",
          offCampus: false,
          day: "Sat",
          startMinutes: 690,
          endMinutes: 860,
          dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
          instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
          async: false,
          tba: false,
        },
        {
          room: "FRLD 458",
          buildingCode: "FRLD",
          buildingId: null,
          buildingName: "Unknown building",
          kind: "unknown",
          offCampus: false,
          day: "Sun",
          startMinutes: 690,
          endMinutes: 860,
          dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
          instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
          async: false,
          tba: false,
        },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
        { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
      ],
    },
  ],
  meetings: [
    {
      room: "FRLD 458",
      buildingCode: "FRLD",
      buildingId: null,
      buildingName: "Unknown building",
      kind: "unknown",
      offCampus: false,
      day: "Sat",
      startMinutes: 690,
      endMinutes: 860,
      dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
      instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
      async: false,
      tba: false,
    },
    {
      room: "FRLD 458",
      buildingCode: "FRLD",
      buildingId: null,
      buildingName: "Unknown building",
      kind: "unknown",
      offCampus: false,
      day: "Sun",
      startMinutes: 690,
      endMinutes: 860,
      dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
      instructor: { raw: "Giddens,Laurie Genette", display: "Laurie Genette Giddens" },
      async: false,
      tba: false,
    },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sat", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
    { room: "FRLD 458", buildingCode: "FRLD", buildingId: null, buildingName: "Unknown building", kind: "unknown", offCampus: false, day: "Sun", startMinutes: 690, endMinutes: 860, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "None", display: null }, async: false, tba: false },
  ],
  online: false,
  async: false,
  tba: false,
});

/** ADES 5510: closed, seats missing, no instructor, no day, time or room. */
export const adesClosed: Section = frozen({
  id: "vsb:spring-2027:ADES 5510:8608",
  term: "spring-2027",
  courseCode: "ADES 5510",
  sectionCode: "001",
  classNumbers: ["8608"],
  option: "1",
  instructor: { raw: "Closed", display: null },
  seats: { open: null, total: null },
  status: "closed",
  rawStatus: "Closed",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:ADES 5510:8608",
      classNumber: "8608",
      sectionCode: "001",
      role: "primary",
      instructor: { raw: "Closed", display: null },
      seats: { open: null, total: null },
      meetings: [{ room: "None", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Unassigned room", kind: "unassigned", day: null, startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Closed", display: null }, async: false, tba: true }],
    },
  ],
  meetings: [{ room: "None", buildingCode: null, buildingId: null, offCampus: false, buildingName: "Unassigned room", kind: "unassigned", day: null, startMinutes: null, endMinutes: null, dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" }, instructor: { raw: "Closed", display: null }, async: false, tba: true }],
  online: false,
  async: false,
  tba: true,
});

/** ART 5450: wait-listed with 999 open seats, no day, time or room. */
export const artWaitlist: Section = frozen({
  id: "vsb:spring-2027:ART 5450:8776",
  term: "spring-2027",
  courseCode: "ART 5450",
  sectionCode: "730",
  classNumbers: ["8776"],
  option: "1",
  instructor: { raw: "Gibson,Michael Robert", display: "Michael Robert Gibson" },
  seats: { open: 999, total: 999 },
  status: "waitlist",
  rawStatus: "Wait List",
  session: { label: "Regular Academic Session", dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" } },
  components: [
    {
      id: "vsb-component:spring-2027:ART 5450:8776",
      classNumber: "8776",
      sectionCode: "730",
      role: "primary",
      instructor: { raw: "Gibson,Michael Robert", display: "Michael Robert Gibson" },
      seats: { open: 999, total: 999 },
      meetings: [
        {
          room: "No Facility Assigned",
          buildingCode: null,
          buildingId: null,
          offCampus: false,
          buildingName: "Unassigned room",
          kind: "unassigned",
          day: null,
          startMinutes: null,
          endMinutes: null,
          dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
          instructor: { raw: "Gibson,Michael Robert", display: "Michael Robert Gibson" },
          async: false,
          tba: true,
        },
      ],
    },
  ],
  meetings: [
    {
      room: "No Facility Assigned",
      buildingCode: null,
      buildingId: null,
      offCampus: false,
      buildingName: "Unassigned room",
      kind: "unassigned",
      day: null,
      startMinutes: null,
      endMinutes: null,
      dates: { raw: "01/11/2027 - 05/07/2027", start: "2027-01-11", end: "2027-05-07" },
      instructor: { raw: "Gibson,Michael Robert", display: "Michael Robert Gibson" },
      async: false,
      tba: true,
    },
  ],
  online: false,
  async: false,
  tba: true,
});
