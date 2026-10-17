import { hasClass, isElement, normalizedText, parseHtml, type HtmlElement, type HtmlNode } from "./html";

/**
 * Reads the "Four-year degree plan (example)" a College of Engineering
 * program page prints: one table per year, each row holding a Semester 1
 * cell pair and a Semester 2 cell pair (course or placeholder, then hours).
 * Tests audit these plans as finished records, so the reader is strict: it
 * checks every semester against the "Total" row the page prints and fails on
 * any cell it cannot read.
 */

export type PlanEntry = {
  year: number;
  semester: 1 | 2;
  /** The cell text as printed, e.g. "CSCE 1030 - Computer Science I" or "American History core". */
  label: string;
  /** The course code when the cell names one; null for a placeholder such as "Elective". */
  code: string | null;
  hours: number;
};

const PLAN_HEADING = "Four-year degree plan (example)";
const CODE = /^([A-Z]{3,5}) (\d{4})\s*-/;
const HOURS = /^(\d+) hours?$/;

function children(element: HtmlElement, tag: string): HtmlElement[] {
  const found: HtmlElement[] = [];
  const walk = (node: HtmlNode): void => {
    if (!isElement(node)) return;
    if (node.tag === tag) {
      found.push(node);
      return;
    }
    node.children.forEach(walk);
  };
  element.children.forEach(walk);
  return found;
}

function planBlock(html: string): HtmlElement {
  const blocks: HtmlElement[] = [];
  const walk = (node: HtmlNode): void => {
    if (!isElement(node)) return;
    if (node.tag === "div" && hasClass(node, "acalog-core")) blocks.push(node);
    node.children.forEach(walk);
  };
  parseHtml(html).children.forEach(walk);
  const block = blocks.find((candidate) => children(candidate, "h2").concat(children(candidate, "h3")).some((heading) => normalizedText(heading) === PLAN_HEADING));
  if (!block) throw new Error(`no "${PLAN_HEADING}" section on the page`);
  return block;
}

export function readFourYearPlan(html: string): PlanEntry[] {
  const tables = children(planBlock(html), "table");
  if (tables.length !== 4) throw new Error(`expected 4 year tables in the four-year plan, found ${tables.length}`);
  const entries: PlanEntry[] = [];
  tables.forEach((table, index) => {
    const year = index + 1;
    const totals: Record<1 | 2, number | null> = { 1: null, 2: null };
    for (const row of children(table, "tr")) {
      const cells = children(row, "td").map((cell) => normalizedText(cell));
      if (cells.length === 0) continue;
      if (cells.length !== 4) throw new Error(`year ${year}: a plan row has ${cells.length} cells, expected 4: ${cells.join(" | ")}`);
      for (const semester of [1, 2] as const) {
        const label = cells[(semester - 1) * 2]!;
        const hoursText = cells[(semester - 1) * 2 + 1]!;
        if (label === "" && hoursText === "") continue;
        const hours = HOURS.exec(hoursText);
        if (!hours) throw new Error(`year ${year} semester ${semester}: cannot read hours "${hoursText}" for "${label}"`);
        if (label === "Total") {
          totals[semester] = Number(hours[1]);
          continue;
        }
        const code = CODE.exec(label);
        entries.push({ year, semester, label, code: code ? `${code[1]} ${code[2]}` : null, hours: Number(hours[1]) });
      }
    }
    for (const semester of [1, 2] as const) {
      const sum = entries.filter((entry) => entry.year === year && entry.semester === semester).reduce((total, entry) => total + entry.hours, 0);
      if (totals[semester] !== sum) throw new Error(`year ${year} semester ${semester}: the page prints a total of ${totals[semester]} hours, the rows add up to ${sum}`);
    }
  });
  return entries;
}
