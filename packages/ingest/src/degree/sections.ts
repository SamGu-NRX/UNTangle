import { parseHtml, isElement, hasClass, type HtmlElement, type HtmlNode } from "./html";

/**
 * One `div.acalog-core` block of a catalog program page: a heading with the
 * catalog's own anchor, and the content that follows it as a flat, ordered
 * item stream. The derive rules in derive.ts read only this stream, so the
 * extraction here stays a faithful, testable view of the page.
 *
 * Course lists keep the catalog's own option structure:
 * - a `courseGroup` is one conjunction-free run of a bullet's courses; the
 *   conjunctions printed between a bullet's own courses split it into several
 *   groups ("A 1000 ... or B 1000 ..." becomes two groups tied by "or"), so
 *   parseUnits sees the alternatives the catalog prints. A bullet joined by
 *   "and" still requires its courses together, because "and" merges the runs
 *   into one unit;
 * - the conjunction that ties a bullet to the next one — a standalone marker
 *   bullet ("or", "and", "with either") or the trailing conjunction printed in
 *   the course title ("... and/or") — is preserved as the last group's `connector`.
 */

export type CourseRef = { code: string; title: string };

export type FlowItem =
  | { type: "heading"; level: number; text: string; anchor: string | null }
  | { type: "paragraph"; text: string }
  | { type: "courseGroup"; courses: CourseRef[]; connector: string | null }
  | { type: "marker"; text: string }
  | { type: "table"; text: string };

export type Section = {
  heading: string;
  anchor: string | null;
  items: FlowItem[];
};

export type CatalogPage = {
  file: string;
  url: string;
  title: string;
  sections: Section[];
};

const COURSE_PATTERN = /^([A-Z]{3,5})\s?(\d{4})\s*[-\u2013]\s*(.+)$/;
const COURSE_LOOKAHEAD_SPLIT = /\s+(and\/or|with either|and|or)(?=\s+[A-Z]{3,5}\s?\d{4}\s*[-\u2013])/gi;
const TRAILING_CONNECTOR = /\s*(and\/or|with either|and|or)\s*$/i;
const MARKER_PATTERN = /^(or|and|with either|or with)$/i;

/** Connectors the catalog prints in course titles: "and/or" reads as "or". */
export function normalizeConnector(raw: string): string | null {
  const text = raw.trim().toLowerCase();
  if (text === "and/or") return "or";
  if (text === "or with") return "with either";
  if (text === "or" || text === "and" || text === "with either") return text;
  return null;
}

/** One courseGroup-worthy run: this bullet's courses plus the conjunction
 * tying the run to the next one. */
export type CourseGroupPiece = { courses: CourseRef[]; connector: string | null };

/**
 * Splits one bullet's text into course pieces on conjunctions that are
 * followed by another course. A conjunction followed by a course IS the
 * catalog's option structure ("A and B", "A or B"): each conjunction closes
 * the current piece and starts the next, so "A or B" parses as two groups
 * tied by "or" — alternatives — while "A and B" parses as two groups tied by
 * "and", which parseUnits merges into one required combination. A conjunction
 * followed by other text ("Procedures and Manuals") belongs to the title and
 * stays inside it.
 */
export function parseCourseListText(text: string): CourseGroupPiece[] {
  const segments = text.split(COURSE_LOOKAHEAD_SPLIT);
  const pieces: CourseGroupPiece[] = [];
  let current: CourseRef[] = [];
  let pending: string | null = null;
  let trailing: string | null = null;
  for (let i = 0; i < segments.length; i += 1) {
    if (i % 2 === 1) {
      pending = normalizeConnector(segments[i]);
      continue;
    }
    const match = COURSE_PATTERN.exec(segments[i].trim());
    if (!match) continue;
    if (pending !== null) {
      pieces.push({ courses: current, connector: pending });
      current = [];
      pending = null;
    }
    // A conjunction printed at the very end of the bullet is never followed by
    // a course, so the lookahead does not split it off; it sits in the title.
    const connectorMatch = TRAILING_CONNECTOR.exec(match[3]);
    const title = connectorMatch ? match[3].replace(TRAILING_CONNECTOR, "").trim() : match[3].trim();
    if (connectorMatch) trailing = normalizeConnector(connectorMatch[1]);
    current.push({ code: `${match[1]} ${match[2]}`, title });
  }
  if (current.length > 0) {
    // A split whose array ends on a captured separator (the conjunction's
    // follow-on never parsed as a course) reads as the bullet's trailing
    // conjunction, as does one printed in the last title.
    const bulletConnector = (segments.length % 2 === 0 ? normalizeConnector(segments[segments.length - 1]) : null) ?? trailing;
    pieces.push({ courses: current, connector: bulletConnector });
  }
  return pieces;
}

/** Walks the element tree in document order, collecting flow items. */
function collectItems(node: HtmlElement, out: FlowItem[]): void {
  for (const child of node.children) {
    if (typeof child === "string") {
      const text = child.replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push({ type: "paragraph", text });
      continue;
    }
    switch (child.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const text = visibleText(child).replace(/\s+/g, " ").trim();
        if (!text) break;
        out.push({ type: "heading", level: Number(child.tag[1]), text, anchor: headingAnchor(child) });
        break;
      }
      case "p":
      case "blockquote": {
        const text = visibleText(child).replace(/\s+/g, " ").trim();
        if (text) out.push({ type: "paragraph", text });
        break;
      }
      case "ul":
      case "ol":
        collectList(child, out);
        break;
      case "table": {
        const text = visibleText(child).replace(/\s+/g, " ").trim();
        if (text) out.push({ type: "table", text });
        break;
      }
      case "hr":
        break;
      default:
        collectItems(child, out);
    }
  }
}

function collectList(list: HtmlElement, out: FlowItem[]): void {
  for (const child of list.children) {
    if (typeof child === "string") {
      const text = child.replace(/\s+/g, " ").trim();
      if (!text) continue;
      out.push(MARKER_PATTERN.test(text) ? { type: "marker", text: text.toLowerCase() } : { type: "paragraph", text });
      continue;
    }
    if (child.tag !== "li") {
      // collectItems matches its tag cases against children while walking, so a
      // block-level element handed over directly (a bare <p> or nested <ul>
      // between list items) would be walked generically and lose its inline
      // structure — the note <p> split into per-anchor paragraphs. Wrap it so
      // the element's own case applies.
      collectItems({ tag: "#list-flow", attrs: {}, children: [child] }, out);
      continue;
    }
    const nested = child.children.filter((grandchild) => isElement(grandchild) && (grandchild.tag === "ul" || grandchild.tag === "ol"));
    const ownText = ownTextOf(child);
    if (ownText) {
      if (MARKER_PATTERN.test(ownText)) out.push({ type: "marker", text: ownText.toLowerCase() });
      else if (COURSE_PATTERN.test(ownText) || /[A-Z]{3,5}\s?\d{4}/.test(ownText)) {
        const parsed = parseCourseListText(ownText);
        if (parsed.length > 0) for (const piece of parsed) out.push({ type: "courseGroup", courses: piece.courses, connector: piece.connector });
        else out.push({ type: "paragraph", text: ownText });
      } else out.push({ type: "paragraph", text: ownText });
    }
    for (const sub of nested) collectList(sub as HtmlElement, out);
  }
}

/** The list item's own text: excluding nested list content. */
function ownTextOf(li: HtmlElement): string {
  let text = "";
  for (const child of li.children) {
    if (typeof child === "string") text += child;
    else if (child.tag !== "ul" && child.tag !== "ol") text += visibleText(child);
  }
  return text.replace(/\s+/g, " ").trim();
}

function visibleText(node: HtmlNode): string {
  if (typeof node === "string") return node;
  if (node.tag === "span" && /display:\s*none/i.test(node.attrs.style ?? "")) return "";
  return node.children.map(visibleText).join("");
}

/** The anchor the catalog gives a heading: the heading's own id, or a named anchor child. */
function headingAnchor(heading: HtmlElement): string | null {
  const own = heading.attrs.id;
  if (own) return own;
  for (const child of heading.children) {
    if (typeof child === "string") continue;
    if (child.tag === "a" && child.attrs.name) return child.attrs.name;
    if (child.tag === "a" && child.attrs.id) return child.attrs.id;
  }
  return null;
}

/** Reads every top-level acalog-core block of a saved catalog page. */
export function readCatalogPage(file: string, url: string, html: string): CatalogPage {
  const { children } = parseHtml(html);
  const blocks: HtmlElement[] = [];
  const walk = (element: HtmlElement): void => {
    if (element.tag === "div" && hasClass(element, "acalog-core")) {
      blocks.push(element);
      return;
    }
    for (const child of element.children) {
      if (typeof child === "string") continue;
      walk(child);
    }
  };
  for (const top of children) {
    if (isElement(top)) walk(top);
  }
  const titleMatch = /<title>([^<]*)<\/title>/i.exec(html);
  const sections: Section[] = blocks.map((block) => {
    const items: FlowItem[] = [];
    collectItems(block, items);
    const firstHeading = items.find((item) => item.type === "heading");
    let heading = "";
    let anchor: string | null = null;
    if (firstHeading && firstHeading.type === "heading") {
      heading = firstHeading.text;
      anchor = firstHeading.anchor;
    }
    return { heading, anchor, items };
  });
  return { file, url, title: titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : file, sections };
}
