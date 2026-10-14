import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { buildClassSearchHtml, classSearchRows } from "../../tools/mock-myunt/class-search-fixture";
import { extractRows, parseRowCells, readRowCells } from "../src/lib/parse-row";

function documentFrom(html: string): Document {
  const window = new Window();
  window.document.body.innerHTML = html;
  // happy-dom implements the DOM API but not the DOM lib's class tree; the
  // cast records that single test-boundary concession.
  return window.document as unknown as Document;
}

describe("extractRows over the shared fixture", () => {
  test("parses all three fixture rows with their facts", () => {
    const rows = extractRows(documentFrom(buildClassSearchHtml()));
    expect(rows).toHaveLength(3);

    const [first, second, third] = rows;
    expect(first).toMatchObject({
      rowId: "SSR_CLSRCH_R1",
      term: "spring-2027",
      courseSubject: "CSCE",
      courseNumber: "1030",
      sectionNumber: "001",
      classNumber: "14523",
      datesRaw: "01/19/2027 - 05/07/2027",
      instructorRaw: "Smith, John R.",
      isAsync: false,
      isTba: false,
    });
    expect(first?.meetings).toEqual([
      { day: "Mon", startMinutes: 540, endMinutes: 590 },
      { day: "Wed", startMinutes: 540, endMinutes: 590 },
      { day: "Fri", startMinutes: 540, endMinutes: 590 },
    ]);

    expect(second?.courseSubject).toBe("ENGL");
    expect(second?.courseNumber).toBe("1310");
    expect(second?.classNumber).toBe("15802");

    expect(third?.isAsync).toBe(true);
    expect(third?.meetings).toEqual([]);
    // A TBA instructor cell means no instructor listed.
    expect(third?.instructorRaw).toBeNull();
  });

  test("skips the header row", () => {
    const rows = extractRows(documentFrom(buildClassSearchHtml()));
    expect(rows.map(row => row.rowId)).toEqual(classSearchRows.map(row => row.id));
  });

  test("stays dormant without a results grid", () => {
    const rows = extractRows(documentFrom("<html><body><h1>View Unofficial Transcript</h1></body></html>"));
    expect(rows).toEqual([]);
  });
});

describe("generated PeopleSoft suffixes", () => {
  test("cells with generated id suffixes still classify", () => {
    const html = [
      '<div id="SSR_CLSRCH_TERM">spring-2027</div>',
      "<table><tbody>",
      '<tr id="SSR_CLSRCH_R1$115">',
      '<td id="SSR_CLSRCH_R1$115_SUBJ$115">CSCE</td>',
      '<td id="SSR_CLSRCH_R1$115_CAT$115">1030</td>',
      '<td id="SSR_CLSRCH_R1$115_SEC$115">001</td>',
      '<td id="SSR_CLSRCH_R1$115_CLASS_NUM$115">14523</td>',
      '<td id="SSR_CLSRCH_R1$115_DAYS$115">MWF 9:00 AM - 9:50 AM</td>',
      '<td id="SSR_CLSRCH_R1$115_DATES$115">01/19/2027 - 05/07/2027</td>',
      '<td id="SSR_CLSRCH_R1$115_INSTR$115">Smith, John R.</td>',
      "</tr>",
      "</tbody></table>",
    ].join("");
    const rows = extractRows(documentFrom(html));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.rowId).toBe("SSR_CLSRCH_R1$115");
    expect(rows[0]?.courseSubject).toBe("CSCE");
    expect(rows[0]?.classNumber).toBe("14523");
    expect(rows[0]?.meetings).toHaveLength(3);
  });
});

describe("parseRowCells", () => {
  test("returns null when the row does not name a course", () => {
    expect(parseRowCells({ rowId: "SSR_CLSRCH_R9", cells: {} }, "spring-2027")).toBeNull();
  });

  test("reads cells by stable terminal segment", () => {
    const html = `<table><tbody><tr id="SSR_CLSRCH_R4"><td id="SSR_CLSRCH_R4_SUBJ">MATH</td><td id="SSR_CLSRCH_R4_CAT">1650</td><td id="SSR_CLSRCH_R4_SEC">002</td><td id="SSR_CLSRCH_R4_CLASS_NUM">15001</td><td id="SSR_CLSRCH_R4_DAYS">TR 9:30 AM - 10:50 AM</td><td id="SSR_CLSRCH_R4_DATES">01/19/2027 - 05/07/2027</td><td id="SSR_CLSRCH_R4_INSTR">Doe, Jane</td></tr></tbody></table>`;
    const document = documentFrom(html);
    const tr = document.querySelector("#SSR_CLSRCH_R4");
    expect(tr).not.toBeNull();
    const cells = readRowCells(tr as Element);
    expect(cells).not.toBeNull();
    const parsed = parseRowCells(cells as NonNullable<ReturnType<typeof readRowCells>>, "spring-2027");
    expect(parsed).toMatchObject({
      courseSubject: "MATH",
      courseNumber: "1650",
      classNumber: "15001",
      instructorRaw: "Doe, Jane",
      isTba: false,
      isAsync: false,
    });
    expect(parsed?.meetings).toEqual([
      { day: "Tue", startMinutes: 570, endMinutes: 650 },
      { day: "Thu", startMinutes: 570, endMinutes: 650 },
    ]);
  });
});
