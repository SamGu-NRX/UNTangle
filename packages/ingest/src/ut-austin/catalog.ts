/**
 * UT Austin undergraduate-catalog course pages, parsed from saved HTML.
 *
 * Source: catalog.utexas.edu course pages, one page per field of study, as
 * in https://catalog.utexas.edu/courses/c-s/ ("Computer Science (C S)"). The
 * pages are Courseleaf-published static HTML: one `div.courseblock` per
 * course, with the code, title, hours, description and labeled detail
 * spans. There is no public API, so the ingest job saves a page once,
 * politely, and this parser turns the saved copy into course records.
 *
 * Captures and their metadata live next to the fixtures:
 * packages/ingest/tests/fixtures/ut-austin/SOURCES.md records the source
 * URL and capture date of every saved page, and the access rules that were
 * checked are in docs/research/ut-austin/README.md.
 *
 * Pacing rules for future captures come from the reviewed source policy
 * "catalog-utexas" in packages/ingest/src/source-policies.ts. The parser
 * itself never fetches: it reads saved text only, so tests run without a
 * network.
 */

/** Where a saved catalog page came from, stamped on every record it yields. */
export type CatalogPageMeta = {
  /** The public URL the page was captured from, as a reader can open it. */
  sourceUrl: string;
  /** The capture date (ISO 8601 date), when the bytes were true upstream. */
  capturedAt: string;
};

/** One parsed course entry from a catalog course page. */
export type UtAustinCourseRecord = {
  /** The first code on the block, as UT prints it: "C S 301K". */
  code: string;
  /**
   * Every code the block grants credit under. Topic courses share one
   * description across numbered seats, as "M 175T, 275T, 375T, 475T"; the
   * continuation tokens carry no field abbreviation, so the parser repeats
   * the block's abbreviation ("M 275T", ...).
   */
  codes: string[];
  title: string;
  /** Credit hours when UT states one number; null when a range or variable. */
  hours: number | null;
  /** The hours text as printed: "3 Hours", "1-4 Hours". */
  hoursText: string;
  lectureHours: number | null;
  labHours: number | null;
  description: string;
  /** "Prerequisite" or "Pre/Corequisites"; null when the block states none. */
  prerequisiteLabel: string | null;
  /** The prerequisite sentence without its label; null when none is stated. */
  prerequisiteText: string | null;
  restrictions: string | null;
  /** The statewide Texas core component code, from "Core Curriculum: 093". */
  coreCode: string | null;
  sameAs: string | null;
  /** Texas Common Course Numbering equivalent, where the block states one. */
  tccn: string | null;
  gradeMode: string | null;
  repeatable: string | null;
  academicLevel: string | null;
  /**
   * Skills and Experience flags. The current catalog carries none: UT
   * retired the flags effective April 2025 (docs/research/ut-austin/README.md,
   * "Flags"). The field stays so archived captures parse into the same shape.
   */
  flags: string[];
  sourceUrl: string;
  capturedAt: string;
};

/** What one saved course page parses into. */
export type UtAustinCatalogPage = {
  /** The page title, "Computer Science (C S)", split into name and code. */
  department: { name: string; abbreviation: string | null };
  sourceUrl: string;
  capturedAt: string;
  records: UtAustinCourseRecord[];
};

/** Strips tags and decodes the entities Courseleaf pages actually use. */
function decode(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_all, digits: string) => String.fromCodePoint(Number(digits)))
    .replace(/\s+/g, " ")
    .trim();
}

/** The text of the first span with exactly this detail class, or null. */
function spanField(block: string, detailClass: string): string | null {
  const match = block.match(new RegExp(`<span class="text ${detailClass}[^"]*">(.*?)</span>`, "s"));
  if (!match) return null;
  const text = decode(match[1]);
  return text.length > 0 ? text : null;
}

/** A labeled field: "<strong>Prerequisite: </strong>text" -> label + text. */
function labeledField(block: string, detailClass: string): { label: string; text: string } | null {
  const match = block.match(new RegExp(`<span class="text ${detailClass}[^"]*"><strong>(.*?):?\\s*</strong>(.*?)</span>`, "s"));
  if (!match) return null;
  const label = decode(match[1]);
  const text = decode(match[2]);
  return { label, text };
}

/**
 * "C S 301K" -> ["C S", "301K"]. The abbreviation is everything before the
 * whitespace that runs into the first digit, so spaced abbreviations hold:
 * "C S" for computer science, "M" for mathematics.
 */
function splitCode(code: string): { abbreviation: string; number_: string } | null {
  const match = code.match(/^(.+?)\s+(\d.*)$/);
  if (!match) return null;
  return { abbreviation: match[1], number_: match[2] };
}

/** Every code a block grants credit under, with abbreviations repeated. */
function parseCodes(utCode: string): string[] {
  const tokens = utCode.split(",").map((token) => token.trim()).filter(Boolean);
  const codes: string[] = [];
  for (const token of tokens) {
    if (/^\d/.test(token)) {
      const head = codes[0];
      const parts = head ? splitCode(head) : null;
      codes.push(parts ? `${parts.abbreviation} ${token}` : token);
    } else {
      codes.push(token);
    }
  }
  return codes;
}

/** "3 Hours" -> 3; "1-4 Hours" and anything variable -> null. */
function parseHours(text: string | null): { hours: number | null; hoursText: string } {
  if (!text) return { hours: null, hoursText: "" };
  const match = text.match(/^(\d+)\s+Hours?$/);
  return { hours: match ? Number(match[1]) : null, hoursText: text };
}

/** "3 Lecture Hours" -> 3; "1,2,3,4 Lecture Hours" -> null. */
function parseComponentHours(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/^(\d+)\s+Lecture Hours$|^(\d+)\s+Lab Hours$/);
  return match ? Number(match[1] ?? match[2]) : null;
}

/** "Core Curriculum: 093" -> "093". */
function parseCoreCode(text: string | null): string | null {
  if (!text) return null;
  const match = text.match(/^Core Curriculum:\s*(.+)$/);
  return match ? match[1].trim() : null;
}

/** The page title, "Computer Science (C S)", into name and abbreviation. */
function parseDepartment(html: string, meta: CatalogPageMeta): { name: string; abbreviation: string | null } {
  const match = html.match(/<h1 class="page-title"[^>]*>([\s\S]*?)<\/h1>/);
  const title = match ? decode(match[1]) : "";
  const withCode = title.match(/^(.*?)\s*\(([^()]+)\)\s*$/);
  if (withCode) return { name: withCode[1], abbreviation: withCode[2] };
  if (title) return { name: title, abbreviation: null };
  const path = meta.sourceUrl.replace(/\/$/, "").split("/").pop() ?? "";
  return { name: path, abbreviation: null };
}

/**
 * Parses one saved catalog course page into course records.
 *
 * Throws when the page carries no course blocks: a layout change or a wrong
 * page must fail loudly, never publish an empty catalog.
 */
export function parseCatalogCoursePage(html: string, meta: CatalogPageMeta): UtAustinCatalogPage {
  const blocks = html.split('<div class="courseblock">').slice(1);
  if (blocks.length === 0) {
    throw new Error(`No course blocks found in the page captured from ${meta.sourceUrl} on ${meta.capturedAt}`);
  }

  const records: UtAustinCourseRecord[] = [];
  for (const rawBlock of blocks) {
    // Each block runs to the next one; cut trailing sibling markup off.
    const block = rawBlock.slice(0, rawBlock.indexOf('<div class="courseblock">') === -1 ? undefined : rawBlock.indexOf('<div class="courseblock">'));

    const utCode = spanField(block, "detail-ut_code");
    const title = spanField(block, "detail-title");
    if (!utCode || !title) continue;

    const codes = parseCodes(utCode);
    const hours = parseHours(spanField(block, "detail-hours_html"));
    // The description is the first courseblockextra div on the block.
    const descriptionMatch = block.match(/<div class="courseblockextra[^"]*">([\s\S]*?)<\/div>/);
    const prereq = labeledField(block, "detail-prereq");
    const restrictions = labeledField(block, "detail-restrictions");

    records.push({
      code: codes[0],
      codes,
      title,
      hours: hours.hours,
      hoursText: hours.hoursText,
      lectureHours: parseComponentHours(spanField(block, "detail-lecture_hours")),
      labHours: parseComponentHours(spanField(block, "detail-lab_hours")),
      description: descriptionMatch ? decode(descriptionMatch[1]) : "",
      prerequisiteLabel: prereq?.label ?? null,
      prerequisiteText: prereq?.text ?? null,
      restrictions: restrictions?.text ?? null,
      coreCode: parseCoreCode(spanField(block, "detail-utexas_core")),
      sameAs: spanField(block, "detail-utexas_sameas"),
      tccn: spanField(block, "detail-utexas_tccn"),
      gradeMode: labeledField(block, "detail-utexas_grade_mode")?.text ?? null,
      repeatable: labeledField(block, "detail-utexas_repeatable")?.text ?? null,
      academicLevel: labeledField(block, "detail-acad_level")?.text ?? null,
      flags: [],
      sourceUrl: meta.sourceUrl,
      capturedAt: meta.capturedAt,
    });
  }

  return {
    department: parseDepartment(html, meta),
    sourceUrl: meta.sourceUrl,
    capturedAt: meta.capturedAt,
    records,
  };
}
