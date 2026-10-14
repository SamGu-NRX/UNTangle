/**
 * Single source of truth for the mock myUNT class-search results page: the
 * served page and the extension's unit tests both build from this module, so
 * the fixture cannot drift from what the tests assert.
 *
 * Rows mirror the documented stable PeopleSoft prefixes
 * (docs/research/registration-platforms/section-row-anatomy.md):
 * SSR_CLSRCH_ row ids with fixed, suffix-free terminal segments.
 */

/** The supported term, matching the sections route's real upstream data. */
export const FIXTURE_TERM = "spring-2027";

export type FixtureRow = {
  id: string;
  subject: string;
  catalog: string;
  section: string;
  classNumber: string;
  days: string;
  dates: string;
  instructor: string;
};

/**
 * Row 1 collides with the seeded Main schedule (the stub's planner has
 * CSCE 1040, MWF 9:30 AM - 10:20 AM). Row 2 is free. Row 3 is asynchronous
 * with no times to check.
 */
export const classSearchRows: FixtureRow[] = [
  {
    id: "SSR_CLSRCH_R1",
    subject: "CSCE",
    catalog: "1030",
    section: "001",
    classNumber: "14523",
    days: "MWF 9:00 AM - 9:50 AM",
    dates: "01/19/2027 - 05/07/2027",
    instructor: "Smith, John R.",
  },
  {
    id: "SSR_CLSRCH_R2",
    subject: "ENGL",
    catalog: "1310",
    section: "005",
    classNumber: "15802",
    days: "MWF 1:00 PM - 1:50 PM",
    dates: "01/19/2027 - 05/07/2027",
    instructor: "Doe, Jane",
  },
  {
    id: "SSR_CLSRCH_R3",
    subject: "CSCE",
    catalog: "2100",
    section: "004",
    classNumber: "16077",
    days: "Async (online)",
    dates: "01/19/2027 - 05/07/2027",
    instructor: "TBA",
  },
];

function cells(row: FixtureRow): string {
  return [
    `<td id="${row.id}_SUBJ">${row.subject}</td>`,
    `<td id="${row.id}_CAT">${row.catalog}</td>`,
    `<td id="${row.id}_SEC">${row.section}</td>`,
    `<td id="${row.id}_CLASS_NUM">${row.classNumber}</td>`,
    `<td id="${row.id}_DAYS">${row.days}</td>`,
    `<td id="${row.id}_DATES">${row.dates}</td>`,
    `<td id="${row.id}_INSTR">${row.instructor}</td>`,
  ].join("");
}

export function buildResultsTableHtml(rows: FixtureRow[] = classSearchRows): string {
  const body = rows.map(row => `<tr id="${row.id}">${cells(row)}</tr>`).join("");
  return [
    '<table id="CLASS_SRCH_WRK2_RESULTS">',
    "<tbody>",
    '<tr id="SSR_CLSRCH_HEADER"><th>Subject</th><th>Catalog</th><th>Section</th><th>Class</th><th>Days and times</th><th>Dates</th><th>Instructor</th></tr>',
    body,
    "</tbody>",
    "</table>",
  ].join("");
}

export function buildClassSearchHtml(): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head><meta charset=\"utf-8\" /><title>UNT Class Search</title></head>",
    "<body>",
    '<h1>UNT Class Search</h1>',
    // The page-level term indicator the parser reads.
    `<input id="SSR_CLSRCH_TERM" type="hidden" value="${FIXTURE_TERM}" />`,
    buildResultsTableHtml(),
    "</body>",
    "</html>",
  ].join("");
}
