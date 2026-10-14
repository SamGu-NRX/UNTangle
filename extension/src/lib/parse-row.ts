/**
 * Turns visible class-search results rows into ParsedSectionRow facts.
 *
 * The parser keys on PeopleSoft's documented stable id prefixes
 * (`SSR_CLSRCH_`, per docs/research/registration-platforms/
 * section-row-anatomy.md) and on structure. It never depends on generated
 * `$n$` index suffixes: cells are found by their row id plus a stable
 * terminal segment (`SSR_CLSRCH_R1_SUBJ`), and a row without the expected
 * cells is skipped rather than guessed at.
 */
import type { ParsedSectionRow } from "../shared/messages";
import { parseMeetingCell } from "./parse-meeting";

/** Rows live under this stable PeopleSoft prefix; the mock uses it verbatim. */
export const ROW_ID_PREFIX = "SSR_CLSRCH_R";
/** The page-level term indicator the fixture ships and the parser reads. */
export const TERM_INPUT_ID = "SSR_CLSRCH_TERM";

const CELL_KEYS = ["SUBJ", "CAT", "SEC", "CLASS_NUM", "DAYS", "DATES", "INSTR"] as const;
type CellKey = (typeof CELL_KEYS)[number];

export type RowCells = { rowId: string; cells: Partial<Record<CellKey, string>> };

/** Reads one results row's cells by stable terminal segment. DOM-facing, thin. */
export function readRowCells(tr: Element): RowCells | null {
  const rowId = tr.id;
  if (!rowId.startsWith(ROW_ID_PREFIX)) return null;
  const cells: Partial<Record<CellKey, string>> = {};
  const prefix = `${rowId}_`;
  for (const cell of Array.from(tr.querySelectorAll(`td[id^="${prefix}"]`))) {
    // PeopleSoft regenerates dollar-number-dollar index suffixes per render;
    // the stable key is the segment before the first dollar sign.
    const key = cell.id.slice(prefix.length).split("$", 1)[0] as CellKey;
    if (CELL_KEYS.includes(key)) cells[key] = cell.textContent?.trim() ?? "";
  }
  return { rowId, cells };
}

/**
 * The pure core: cell text -> row facts. Returns null when the row does not
 * name a course (no subject or catalog number), so headers and spacers never
 * become rows.
 */
export function parseRowCells(row: RowCells, term: string): ParsedSectionRow | null {
  const { cells } = row;
  const subject = (cells.SUBJ ?? "").trim().toUpperCase();
  const number = (cells.CAT ?? "").trim().toUpperCase();
  if (!subject || !number) return null;

  const meetingCell = parseMeetingCell(cells.DAYS ?? "");
  const instructorCell = (cells.INSTR ?? "").trim();
  return {
    rowId: row.rowId,
    term: term.trim(),
    courseSubject: subject,
    courseNumber: number,
    sectionNumber: (cells.SEC ?? "").trim(),
    classNumber: (cells.CLASS_NUM ?? "").trim(),
    meetings: meetingCell.kind === "times" ? meetingCell.meetings : [],
    datesRaw: (cells.DATES ?? "").trim() || null,
    instructorRaw: instructorCell && !/^tba$/i.test(instructorCell) ? instructorCell : null,
    isAsync: meetingCell.kind === "async",
    isTba: meetingCell.kind === "tba",
  };
}

/** Extracts every parseable section row from a document. DOM-facing, thin. */
export function extractRows(doc: Document): ParsedSectionRow[] {
  const term = doc.querySelector<HTMLInputElement>(`#${TERM_INPUT_ID}`)?.value ?? "";
  const rows: ParsedSectionRow[] = [];
  for (const tr of Array.from(doc.querySelectorAll(`tr[id^="${ROW_ID_PREFIX}"]`))) {
    const cells = readRowCells(tr);
    if (!cells) continue;
    const parsed = parseRowCells(cells, term);
    if (parsed) rows.push(parsed);
  }
  return rows;
}
