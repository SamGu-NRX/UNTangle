#!/usr/bin/env node
/**
 * catalog-consistency auditor — version 2 (producer).
 *
 * Reads the committed catalog records and the prerequisite source corpus,
 * reports catalog-consistency findings, and writes an input receipt binding
 * every source consumed (hashes of the exact bytes) plus a manifest binding
 * the written evidence files. It never repairs data and never edits inputs.
 *
 * What v2 changes over v1 (v1 was retired; see RULES.md):
 *  - Every finding reports the EXACT total of matching records over the full
 *    inputs; `examples` are capped displays (first 10 in deterministic order)
 *    and are never used as totals.
 *  - External prerequisite codes are classified by committed EVIDENCE per
 *    code (corpus occurrence > title annotation in the bundle > unknown);
 *    unknown intent is preserved and never relabeled "intentional".
 *  - Unresolved references carry typed evidence (or null) so that
 *    "unresolved" is never conflated with "confirmed bad".
 *  - The receipt binds: the generated catalog, the majors TS source, all
 *    rule-freeze sources, every corpus file (plus an aggregate digest), and
 *    the section source backend/data/compD.csv with its submodule pin.
 *  - A provenance block cross-matches every bundle section to the bound
 *    compD.csv AND every compD row back to a bundle section (building-aware
 *    on both directions, unmatched rows reported on both sides), and derives
 *    the section-source assessment from stated premises (all sections
 *    matched, no term column, the section-number lattice) — it reports the
 *    section source as a finding (synthetic/generated evidence), not as a
 *    repaired fact.
 *  - Independent verification is done by verify.mjs (same directory), which
 *    re-derives everything from the receipt-bound raw inputs. This program
 *    no longer supports --replay; byte-level verification belongs to verify.mjs.
 *
 * Semantics are specified in tools/catalog-consistency/RULES.md (v2) and the
 * format contract in tools/catalog-consistency/FORMAT-v2.md. Both producer
 * and verifier implement that contract exactly.
 *
 * Usage:
 *   node tools/catalog-consistency/audit.mjs --input <seed-data.json> [--out <dir>] [--section-source <compD.csv>]
 *
 * Exit codes: 0 success; 2 usage error; 1 missing/unparsable required input.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";

export const TOOL_VERSION = 2;
export const RULES_VERSION = 2;
export const RECEIPT_VERSION = 2;
export const REPORT_VERSION = 2;
export const ANNEX_VERSION = 2;
export const MANIFEST_VERSION = 1;

export const EXAMPLE_LIMIT = 10;
export const DAY_VOCABULARY = ["Mon", "Tue", "Wed", "Thu", "Fri"];
export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TITLE_ANNOTATION_PATTERN = /\(([A-Z]{2,5} \d{1,4}[A-Z]?)\)/g;
export const TERM_COLUMN_PATTERN = /term|semester|session|year/i;

export const UNKNOWN_PREREQ_NOTE =
  "no committed evidence of external intent; consistent with the subset-catalog claim (README) but unverified per code — intent unresolved";

export const ASSESSMENT_BOUND =
  "the committed sections and their meetings are fully derived from backend/data/compD.csv (bound in the receipt); compD.csv carries no term/semester/session/year column and its section-number lattice (every course carries section 001 and 002, with additional section numbers appearing in exact count pairs) is characteristic of generated rather than recorded offerings — treated as synthetic/generated, not a real-term export; no data repaired";

export const ASSESSMENT_UNBOUND =
  "section source not available — backend/data/compD.csv absent; provenance not established";

/* ---------------------------------- hashing ---------------------------------- */

export function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

export function canonicalStringify(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

/* ------------------------------ code normalization ---------------------------- */

/** "ANTH4520" -> "ANTH 4520" (corpus / compD course_number form). */
export function normalizeCourseCode(code) {
  const m = /^([A-Z]+)(\d{1,4})$/.exec(code);
  return m ? `${m[1]} ${m[2]}` : code;
}

/** "ANTH 4520" -> "ANTH4520" (provenance match key side). */
export function stripSpaces(code) {
  return String(code).replace(/ /g, "");
}

/** Title annotations like "(GOVT 2305)" inside a course/section title. */
export function titleAnnotations(title) {
  if (typeof title !== "string") return [];
  const out = [];
  for (const m of title.matchAll(TITLE_ANNOTATION_PATTERN)) out.push(m[1]);
  return out;
}

/* ------------------------------- majors source ------------------------------ */

/**
 * The majors records live in committed TypeScript (seed-data.ts) as a plain
 * object-literal array. Parse exactly that literal; nothing else in the file
 * is evaluated.
 */
export function parseMajorsFromTs(text) {
  const declMarker = "export const majors: Major[] = ";
  const decl = text.indexOf(declMarker);
  if (decl < 0) return null;
  // First bracket AFTER the declaration is the literal opening — Major[] sits inside the marker.
  const start = text.indexOf("[", decl + declMarker.length);
  if (start < 0) return null;
  if (text.startsWith("[]", start)) return [];
  const end = text.indexOf("];", start); // first ]; is the literal closer — stringify emits no semicolons
  if (end < 0) return null;
  const literal = text.slice(start, end + 1); // includes the closing ]
  const majors = new Function(`return (${literal});`)();
  if (!Array.isArray(majors)) return null;
  return majors;
}

/* ------------------------------ prerequisite corpus --------------------------- */

/**
 * Walk the corpus directory (courses/*.json), returning sorted file bindings,
 * a code -> sorted-file-paths map (course_number or title-annotation codes),
 * and the aggregate corpus digest: sha256 over "<sha256hex>  <path>\n" lines
 * (paths relative to the repo root, sorted by path).
 */
export function buildSourceCorpusCodes(corpusDir) {
  if (!fs.existsSync(corpusDir) || !fs.statSync(corpusDir).isDirectory()) {
    return { files: [], codes: new Map(), digest: sha256(Buffer.alloc(0)), present: false };
  }
  const repoRoot = path.dirname(corpusDir);
  const filePaths = fs
    .readdirSync(corpusDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(corpusDir, f));

  const codes = new Map();
  const fileBindings = [];
  const digestLines = [];

  for (const fp of filePaths) {
    const rel = path.relative(repoRoot, fp).split(path.sep).join("/");
    const buf = fs.readFileSync(fp);
    digestLines.push(`${sha256(buf)}  ${rel}\n`);
    let parsed;
    try {
      parsed = JSON.parse(buf.toString("utf8"));
    } catch {
      continue; // unparsable corpus files bind by hash but contribute no codes
    }
    if (!Array.isArray(parsed)) continue;
    for (const rec of parsed) {
      const found = [];
      if (typeof rec?.course_number === "string") found.push(normalizeCourseCode(rec.course_number));
      for (const a of titleAnnotations(rec?.title)) found.push(a);
      for (const code of found) {
        const list = codes.get(code) ?? [];
        list.push(rel);
        codes.set(code, list);
      }
    }
  }

  for (const [code, files] of codes) codes.set(code, [...files].sort());
  for (const fp of filePaths) {
    const buf = fs.readFileSync(fp);
    fileBindings.push({ path: path.relative(repoRoot, fp).split(path.sep).join("/"), sha256: sha256(buf), bytes: buf.byteLength });
  }

  return { files: fileBindings, codes, digest: sha256(Buffer.from(digestLines.join(""), "utf8")), present: true };
}

/** Code -> up to 3 annotated titles, in input order (courses then sections). */
export function buildBundleAnnotations(courses, sections) {
  const map = new Map();
  const add = (code, title) => {
    const list = map.get(code) ?? [];
    if (list.length < 3) list.push(title);
    map.set(code, list);
  };
  for (const c of courses ?? []) for (const code of titleAnnotations(c?.title)) add(code, c.title);
  for (const s of sections ?? []) for (const code of titleAnnotations(s?.title)) add(code, s.title);
  return map;
}

/* ---------------------------------- findings ---------------------------------- */

function duplicateFindings(courses, sections, buildings) {
  const mk = (items, keyOf) => {
    const counts = new Map();
    for (const item of items ?? []) {
      const key = keyOf(item);
      if (key == null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const dupes = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return {
      total: dupes.length,
      examples: dupes.slice(0, EXAMPLE_LIMIT).map(([key, n]) => ({ key, extraOccurrences: n - 1 })),
    };
  };
  return {
    courseCodes: mk(courses, (c) => c?.code),
    sectionIds: mk(sections, (s) => s?.id),
    buildingIds: mk(buildings, (b) => b?.id),
  };
}

function meetingExample(section, meeting) {
  return {
    sectionId: section.id,
    day: meeting?.day ?? null,
    start: meeting?.start ?? null,
    end: meeting?.end ?? null,
    buildingId: meeting?.buildingId ?? null,
  };
}

function meetingBoundsFindings(sections) {
  let meetingsChecked = 0;
  let endNotAfter = 0;
  let malformed = 0;
  let badDay = 0;
  const exEnd = [];
  const exMal = [];
  const exDay = [];

  for (const section of sections ?? []) {
    for (const meeting of section?.meetings ?? []) {
      meetingsChecked++;
      const startOk = typeof meeting?.start === "string" && TIME_PATTERN.test(meeting.start);
      const endOk = typeof meeting?.end === "string" && TIME_PATTERN.test(meeting.end);
      if (startOk && endOk) {
        if (meeting.end <= meeting.start) {
          endNotAfter++;
          if (exEnd.length < EXAMPLE_LIMIT) exEnd.push(meetingExample(section, meeting));
        }
      } else {
        malformed++;
        if (exMal.length < EXAMPLE_LIMIT) exMal.push(meetingExample(section, meeting));
      }
      if (!DAY_VOCABULARY.includes(meeting?.day)) {
        badDay++;
        if (exDay.length < EXAMPLE_LIMIT) exDay.push({ sectionId: section.id, day: meeting?.day ?? null });
      }
    }
  }

  return {
    meetingsChecked,
    endTimeNotAfterStart: { total: endNotAfter, examples: exEnd },
    malformedTime: { total: malformed, examples: exMal },
    dayOutsideCommittedVocabulary: { total: badDay, examples: exDay },
  };
}

function referenceFindings(courses, sections, buildings, courseStatuses, majors) {
  const courseCodes = new Set((courses ?? []).map((c) => c?.code));
  const buildingIds = new Set((buildings ?? []).map((b) => b?.id));

  let sChecked = 0;
  let sBad = 0;
  const sEx = [];
  for (const section of sections ?? []) {
    sChecked++;
    if (!courseCodes.has(section?.courseCode)) {
      sBad++;
      if (sEx.length < EXAMPLE_LIMIT) sEx.push({ sectionId: section.id, courseCode: section.courseCode });
    }
  }

  let mChecked = 0;
  let mBad = 0;
  const mEx = [];
  for (const section of sections ?? []) {
    for (const meeting of section?.meetings ?? []) {
      if (meeting?.buildingId == null) continue;
      mChecked++;
      if (!buildingIds.has(meeting.buildingId)) {
        mBad++;
        if (mEx.length < EXAMPLE_LIMIT) mEx.push({ sectionId: section.id, buildingId: meeting.buildingId });
      }
    }
  }

  let stChecked = 0;
  let stBad = 0;
  const stEx = [];
  for (const [code, status] of Object.entries(courseStatuses ?? {})) {
    stChecked++;
    if (!courseCodes.has(code)) {
      stBad++;
      if (stEx.length < EXAMPLE_LIMIT) stEx.push({ courseCode: code, status });
    }
  }

  let mcChecked = 0;
  let mcBad = 0;
  const mcEx = [];
  for (const major of majors ?? []) {
    for (const code of major?.coreCourseCodes ?? []) {
      mcChecked++;
      if (!courseCodes.has(code)) {
        mcBad++;
        const annotated = (courses ?? []).find(
          (c) => typeof c?.title === "string" && c.title.includes(`(${code})`),
        );
        const evidence = annotated
          ? { kind: "titleAnnotatedEquivalent", courseCode: annotated.code, title: annotated.title }
          : null;
        if (mcEx.length < EXAMPLE_LIMIT) mcEx.push({ majorId: major.id, majorName: major.name, code, evidence });
      }
    }
  }

  return {
    sectionToCourse: { checked: sChecked, unresolved: { total: sBad, examples: sEx } },
    meetingToBuilding: { checked: mChecked, unresolved: { total: mBad, examples: mEx } },
    courseStatusToCourse: { checked: stChecked, unresolved: { total: stBad, examples: stEx } },
    majorCoreToCourse: { checked: mcChecked, unresolved: { total: mcBad, examples: mcEx } },
  };
}

function prerequisiteFindings(courses, corpusCodes, bundleAnnotations) {
  const courseCodes = new Set((courses ?? []).map((c) => c?.code));
  let edgesTotal = 0;
  let internalEdges = 0;
  const external = new Map(); // raw code -> edge count
  for (const course of courses ?? []) {
    for (const prereq of course?.prerequisites ?? []) {
      edgesTotal++;
      if (courseCodes.has(prereq)) {
        internalEdges++;
      } else {
        external.set(prereq, (external.get(prereq) ?? 0) + 1);
      }
    }
  }

  const classified = { inSourceCorpus: new Map(), titleAnnotatedInBundle: new Map(), unknown: new Map() };
  const sortedExternal = [...external.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [code, edges] of sortedExternal) {
    if (corpusCodes.has(code)) classified.inSourceCorpus.set(code, edges);
    else if (bundleAnnotations.has(code)) classified.titleAnnotatedInBundle.set(code, edges);
    else classified.unknown.set(code, edges);
  }

  const toView = (map, kind) => {
    const codes = [...map.keys()];
    const edges = [...map.values()].reduce((a, b) => a + b, 0);
    const examples = codes.slice(0, EXAMPLE_LIMIT).map((code) => ({
      code,
      edges: map.get(code),
      category: kind,
      evidence:
        kind === "inSourceCorpus"
          ? { kind: "sourceCorpusFile", files: corpusCodes.get(code) }
          : kind === "titleAnnotatedInBundle"
            ? { kind: "titleAnnotationInBundle", titles: bundleAnnotations.get(code) }
            : null,
    }));
    const view = { codes: codes.length, edges, examples };
    if (kind === "unknown") view.note = UNKNOWN_PREREQ_NOTE;
    return view;
  };

  return {
    edgesTotal,
    internalEdges,
    external: {
      edges: edgesTotal - internalEdges,
      distinctCodes: external.size,
      categories: {
        inSourceCorpus: toView(classified.inSourceCorpus, "inSourceCorpus"),
        titleAnnotatedInBundle: toView(classified.titleAnnotatedInBundle, "titleAnnotatedInBundle"),
        unknown: toView(classified.unknown, "unknown"),
      },
    },
  };
}

/* ---------------------------------- provenance -------------------------------- */

/** Minimal RFC-4180 CSV parser: quoted fields, CRLF or LF, no dependencies. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === "\"") {
        if (text[i + 1] === "\"") {
          field += "\"";
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === "\"") {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

/** Last ALL-CAPS parenthetical in a compD location string, e.g. "(CHEM)". */
export function locationShortCode(location) {
  if (typeof location !== "string") return null;
  const matches = [...location.matchAll(/\(([A-Z]{2,6})\)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

const DAY_TOKEN_MAP = { M: "Mon", Tu: "Tue", T: "Tue", W: "Wed", Th: "Thu", F: "Fri" };

/** Expand a compD day pattern like "MWF" / "TuTh" into day names. */
export function expandDayTokens(days) {
  const tokens = [];
  let i = 0;
  const s = typeof days === "string" ? days : "";
  while (i < s.length) {
    const two = s.slice(i, i + 2);
    if (two === "Tu" || two === "Th") {
      tokens.push(two);
      i += 2;
    } else {
      tokens.push(s[i]);
      i += 1;
    }
  }
  return tokens.map((t) => DAY_TOKEN_MAP[t] ?? null);
}

function meetingTuple(meeting) {
  return JSON.stringify([meeting?.day ?? null, meeting?.start ?? null, meeting?.end ?? null, meeting?.buildingId ?? null]);
}

function multisetEqual(a, b) {
  if (a.length !== b.length) return false;
  const counts = new Map();
  for (const v of a) counts.set(v, (counts.get(v) ?? 0) + 1);
  for (const v of b) {
    const n = counts.get(v) ?? 0;
    if (n === 0) return false;
    counts.set(v, n - 1);
  }
  return true;
}

export function readCompd(compdAbsPath) {
  if (!fs.existsSync(compdAbsPath) || !fs.statSync(compdAbsPath).isFile()) return { present: false, rows: [], header: [] };
  const rows = parseCsv(fs.readFileSync(compdAbsPath, "utf8"));
  if (rows.length === 0) return { present: true, rows: [], header: [] };
  const header = rows[0].map((h) => h.trim());
  const col = (name) => header.indexOf(name);
  const cCourse = col("course_number");
  const cSection = col("section_number");
  const cStart = col("start_time");
  const cEnd = col("end_time");
  const cDays = col("days");
  const cLocation = col("location");
  const dataRows = [];
  for (const raw of rows.slice(1)) {
    const get = (idx) => (idx >= 0 && raw[idx] != null ? raw[idx] : null);
    dataRows.push({
      courseNumber: get(cCourse),
      sectionNumber: get(cSection),
      start: get(cStart),
      end: get(cEnd),
      days: get(cDays),
      location: get(cLocation),
    });
  }
  return { present: true, rows: dataRows, header };
}

/**
 * The section-number lattice premise (P4): every course — by normalized
 * course key, across BOTH the bundle sections and the compD rows — carries
 * section numbers 1 and 2, and any section numbers beyond {1, 2} occur as
 * consecutive pairs (e.g. 3&4 or 501&502). This is the generator-shaped
 * numbering the strong assessment describes; a course violating it fails
 * the premise and downgrades the assessment.
 */
export function sectionLattice(courseNumbers) {
  const courses = [...courseNumbers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let violations = 0;
  let firstFailingCourse = null;
  for (const [course, numbers] of courses) {
    const distinct = [...new Set([...numbers].map((n) => (/^\d+$/.test(n) ? Number(n) : NaN)).filter((n) => Number.isInteger(n)))].sort(
      (a, b) => a - b,
    );
    let ok = distinct.length >= 2 && distinct[0] === 1 && distinct[1] === 2;
    if (ok) {
      const extras = distinct.slice(2);
      if (extras.length % 2 !== 0) ok = false;
      else for (let i = 0; i < extras.length; i += 2) if (extras[i + 1] !== extras[i] + 1) { ok = false; break; }
    }
    if (!ok) {
      violations++;
      if (firstFailingCourse == null) firstFailingCourse = course;
    }
  }
  return { ok: violations === 0 && courses.length > 0, coursesChecked: courses.length, violations, firstFailingCourse };
}

/**
 * Deterministic downgraded assessment: rendered whenever any provenance
 * premise fails. The producer, the verifier, and the hand-computed test
 * literals all render this exact template from their own counters.
 */
export function downgradedAssessment({ sectionsUnmatched, rowsUnmatched, termColumnCount, lattice }) {
  return `premises unmet — sections unmatched to compD rows: ${sectionsUnmatched}, compD rows unmatched to sections: ${rowsUnmatched}, term/semester/session/year columns present: ${termColumnCount}, section-number lattice violations: ${lattice.violations} courses (first: ${lattice.firstFailingCourse}) — sections cannot be certified fully derived from compD.csv; no data repaired`;
}

/**
 * Cross-match committed sections against the bound compD.csv — in BOTH
 * directions: every bundle section must match a compD row, and every compD
 * row must match back to a bundle section. Meeting comparison includes the
 * building short code resolved to the bundle building id. The assessment is
 * a conclusion COMPUTED from the stated premises, never a constant.
 */
export function computeProvenance({ data, sectionSourceRecordPath, compdAbsPath, submoduleCommit }) {
  const unbound = () => ({
    bound: false,
    path: sectionSourceRecordPath,
    submoduleCommit: submoduleCommit ?? null,
    rows: 0,
    sectionsMatchedToRows: 0,
    sectionsUnmatchedToRows: 0,
    rowsMatchedToSections: 0,
    rowsUnmatchedToSections: 0,
    meetingsFromDayPatterns: 0,
    sectionsMeetingsAgree: 0,
    sectionsMeetingsDisagree: 0,
    buildingShortCodes: 0,
    buildingCodesInBundle: 0,
    termColumns: [],
    lattice: { ok: false, coursesChecked: 0, violations: 0, firstFailingCourse: null },
    assessment: ASSESSMENT_UNBOUND,
  });

  const compd = readCompd(compdAbsPath);
  if (!compd.present) return unbound();

  const shortToId = new Map((data.buildings ?? []).map((b) => [b?.shortName, b?.id]));

  const rowsBySection = new Map();
  for (const row of compd.rows) {
    const key = `${stripSpaces(normalizeCourseCode(row.courseNumber ?? ""))}|${row.sectionNumber}`;
    const list = rowsBySection.get(key) ?? [];
    list.push(row);
    rowsBySection.set(key, list);
  }
  // First bundle section per pair key, for the reverse (row -> section) direction.
  const sectionsByPair = new Map();
  for (const section of data.sections ?? []) {
    const id = typeof section?.id === "string" ? section.id : "";
    const secNo = id.slice(id.lastIndexOf("-") + 1);
    const key = `${stripSpaces(section?.courseCode ?? "")}|${secNo}`;
    if (!sectionsByPair.has(key)) sectionsByPair.set(key, section);
  }

  // Building short codes are a census over ALL compD rows, matched or not.
  const shortCodes = new Set();
  for (const row of compd.rows) {
    const code = locationShortCode(row.location);
    if (code != null) shortCodes.add(code);
  }

  // Direction 1: every bundle section must match a compD row.
  let sectionsMatched = 0;
  let sectionsUnmatched = 0;
  let meetingsFromPatterns = 0;
  let agree = 0;
  let disagree = 0;
  for (const section of data.sections ?? []) {
    const id = typeof section?.id === "string" ? section.id : "";
    const secNo = id.slice(id.lastIndexOf("-") + 1);
    const key = `${stripSpaces(section?.courseCode ?? "")}|${secNo}`;
    const row = rowsBySection.get(key)?.[0];
    if (!row) {
      sectionsUnmatched++;
      continue;
    }
    sectionsMatched++;
    const buildingCode = locationShortCode(row.location);
    const buildingId = buildingCode != null && shortToId.has(buildingCode) ? shortToId.get(buildingCode) : null;
    const expansion = expandDayTokens(row.days).map((day) => ({ day, start: row.start, end: row.end, buildingId }));
    meetingsFromPatterns += expansion.length;
    const actual = (section?.meetings ?? []).map(meetingTuple);
    if (multisetEqual(actual, expansion.map(meetingTuple))) agree++;
    else disagree++;
  }

  // Direction 2: every compD row must match back to a bundle section.
  let rowsMatched = 0;
  let rowsUnmatched = 0;
  for (const row of compd.rows) {
    const key = `${stripSpaces(normalizeCourseCode(row.courseNumber ?? ""))}|${row.sectionNumber}`;
    if (sectionsByPair.has(key)) rowsMatched++;
    else rowsUnmatched++;
  }

  // Section-number lattice over the union of bundle sections and compD rows.
  const courseNumbers = new Map();
  const addNumber = (courseRaw, num) => {
    if (courseRaw == null || num == null || num === "") return;
    const key = stripSpaces(normalizeCourseCode(String(courseRaw)));
    if (!key) return;
    const set = courseNumbers.get(key) ?? new Set();
    set.add(String(num));
    courseNumbers.set(key, set);
  };
  for (const section of data.sections ?? []) {
    const id = typeof section?.id === "string" ? section.id : "";
    addNumber(section?.courseCode, id.slice(id.lastIndexOf("-") + 1));
  }
  for (const row of compd.rows) addNumber(row.courseNumber, row.sectionNumber);
  const lattice = sectionLattice(courseNumbers);

  const termColumns = compd.header.filter((h) => TERM_COLUMN_PATTERN.test(h));
  const allPremisesHold =
    sectionsUnmatched === 0 && rowsUnmatched === 0 && termColumns.length === 0 && lattice.ok;
  const assessment = allPremisesHold
    ? ASSESSMENT_BOUND
    : downgradedAssessment({ sectionsUnmatched, rowsUnmatched, termColumnCount: termColumns.length, lattice });

  const sortedShortCodes = [...shortCodes].sort();
  return {
    bound: true,
    path: sectionSourceRecordPath,
    submoduleCommit: submoduleCommit ?? null,
    rows: compd.rows.length,
    sectionsMatchedToRows: sectionsMatched,
    sectionsUnmatchedToRows: sectionsUnmatched,
    rowsMatchedToSections: rowsMatched,
    rowsUnmatchedToSections: rowsUnmatched,
    meetingsFromDayPatterns: meetingsFromPatterns,
    sectionsMeetingsAgree: agree,
    sectionsMeetingsDisagree: disagree,
    buildingShortCodes: sortedShortCodes.length,
    buildingCodesInBundle: sortedShortCodes.filter((c) => shortToId.has(c)).length,
    termColumns,
    lattice,
    assessment,
  };
}

/* ------------------------------------ git ------------------------------------- */

function gitPlumbing(args, cwd) {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

// A submodule entry in `git ls-tree` output is a gitlink: mode 160000.
// (Trees are 040000; the v1 regex used 040000 and never matched.)
export function submodulePinFromLsTree(lsTree) {
  if (!lsTree) return null;
  const match = /^160000 commit ([0-9a-f]{40})\tbackend$/m.exec(lsTree);
  return match ? match[1] : null;
}

/* ---------------------------------- document builds --------------------------- */

export function buildInputBinding({ role, recordPath, absPath, required = false }) {
  const present = fs.existsSync(absPath) && fs.statSync(absPath).isFile();
  if (!present) {
    if (required) throw new Error(`required input missing: ${absPath}`);
    return { role, path: recordPath, sha256: null, bytes: 0, present: false };
  }
  const buf = fs.readFileSync(absPath);
  return { role, path: recordPath, sha256: sha256(buf), bytes: buf.byteLength, present: true };
}

export function buildCounts({ data, majors, corpus, compd }) {
  return {
    buildings: (data.buildings ?? []).length,
    courses: (data.courses ?? []).length,
    sections: (data.sections ?? []).length,
    majors: (majors ?? []).length,
    courseStatusEntries: Object.keys(data.courseStatuses ?? {}).length,
    sectionMeetings: (data.sections ?? []).reduce((sum, s) => sum + (s?.meetings?.length ?? 0), 0),
    prerequisiteEdges: (data.courses ?? []).reduce((sum, c) => sum + (c?.prerequisites?.length ?? 0), 0),
    corpusFiles: corpus.files.length,
    compDRows: compd.rows.length,
  };
}

export function buildReceipt({ sourceCommit, inputs, submodulePins, corpusDigest, counts }) {
  return {
    receiptVersion: RECEIPT_VERSION,
    toolVersion: TOOL_VERSION,
    rulesVersion: RULES_VERSION,
    sourceCommit: sourceCommit ?? null,
    inputs,
    submodulePins,
    corpusDigest: { algorithm: "sha256", digest: corpusDigest },
    counts,
  };
}

export function buildReport({ sourceCommit, inputs, counts, provenance, findings }) {
  return {
    reportVersion: REPORT_VERSION,
    toolVersion: TOOL_VERSION,
    rulesVersion: RULES_VERSION,
    sourceCommit: sourceCommit ?? null,
    inputs,
    counts,
    provenance,
    violations: {
      duplicateIds:
        findings.duplicateIds.courseCodes.total +
        findings.duplicateIds.sectionIds.total +
        findings.duplicateIds.buildingIds.total,
      meetingBounds:
        findings.meetingBounds.endTimeNotAfterStart.total +
        findings.meetingBounds.malformedTime.total +
        findings.meetingBounds.dayOutsideCommittedVocabulary.total,
      unknownReferences:
        findings.references.sectionToCourse.unresolved.total +
        findings.references.meetingToBuilding.unresolved.total +
        findings.references.courseStatusToCourse.unresolved.total +
        findings.references.majorCoreToCourse.unresolved.total,
    },
    findings,
  };
}

export function buildAnnex({ report, provenance }) {
  return {
    unresolvedExamplesVersion: ANNEX_VERSION,
    toolVersion: TOOL_VERSION,
    note: "Every unresolved finding with example records, capped at 10 per class; exact totals live in report.json. Nothing here is an allowlist: entries document defects and their committed repair locations (REPAIR-LOCATIONS.md).",
    referenceExamples: [
      { check: "sectionToCourse", total: report.findings.references.sectionToCourse.unresolved.total, examples: report.findings.references.sectionToCourse.unresolved.examples },
      { check: "meetingToBuilding", total: report.findings.references.meetingToBuilding.unresolved.total, examples: report.findings.references.meetingToBuilding.unresolved.examples },
      { check: "courseStatusToCourse", total: report.findings.references.courseStatusToCourse.unresolved.total, examples: report.findings.references.courseStatusToCourse.unresolved.examples },
      { check: "majorCoreToCourse", total: report.findings.references.majorCoreToCourse.unresolved.total, examples: report.findings.references.majorCoreToCourse.unresolved.examples },
    ],
    externalPrerequisites: report.findings.references.prerequisites.external,
    provenanceSummary: { bound: provenance.sectionSource.bound, assessment: provenance.sectionSource.assessment },
  };
}

/* ------------------------------------ audit run ------------------------------- */

export function runAudit({ inputPath, outDir, sectionSourceAbsPath }) {
  const inputAbs = path.resolve(inputPath);
  if (!fs.existsSync(inputAbs) || !fs.statSync(inputAbs).isFile()) {
    throw new Error(`input not found: ${inputAbs}`);
  }
  // input sits at <repoRoot>/frontend/src/lib/generated/seed-data.json — five levels up to the root.
  const repoRoot = path.resolve(inputAbs, "..", "..", "..", "..", "..");

  const rawCatalog = fs.readFileSync(inputAbs, "utf8");
  let data;
  try {
    data = JSON.parse(rawCatalog);
  } catch (err) {
    throw new Error(`unparsable generated catalog (${inputAbs}): ${err.message}`);
  }

  const majorsAbs = path.resolve(inputAbs, "..", "..", "seed-data.ts");
  const majorsText = fs.readFileSync(majorsAbs, "utf8");
  const majors = parseMajorsFromTs(majorsText);
  if (majors == null) throw new Error(`unparsable majors source (${majorsAbs})`);

  const corpusDir = path.join(repoRoot, "courses");
  const corpus = buildSourceCorpusCodes(corpusDir);

  const sectionSourceRecordPath = sectionSourceAbsPath
    ? path.relative(repoRoot, path.resolve(sectionSourceAbsPath)).split(path.sep).join("/")
    : "backend/data/compD.csv";
  const compdAbs = sectionSourceAbsPath ? path.resolve(sectionSourceAbsPath) : path.join(repoRoot, "backend", "data", "compD.csv");

  const sourceCommit = gitPlumbing(["rev-parse", "HEAD"], repoRoot);
  const lsTree = gitPlumbing(["ls-tree", "HEAD", "backend"], repoRoot);
  const submoduleCommit = submodulePinFromLsTree(lsTree);

  const compd = readCompd(compdAbs);
  const bundleAnnotations = buildBundleAnnotations(data.courses, data.sections);

  const findings = {
    duplicateIds: duplicateFindings(data.courses, data.sections, data.buildings),
    meetingBounds: meetingBoundsFindings(data.sections),
    references: {
      ...referenceFindings(data.courses, data.sections, data.buildings, data.courseStatuses, majors),
      prerequisites: prerequisiteFindings(data.courses, corpus.codes, bundleAnnotations),
    },
  };

  const counts = buildCounts({ data, majors, corpus, compd });

  const inputs = [];
  inputs.push(buildInputBinding({ role: "generated-catalog", recordPath: path.relative(repoRoot, inputAbs).split(path.sep).join("/"), absPath: inputAbs, required: true }));
  inputs.push(buildInputBinding({ role: "majors-source", recordPath: path.relative(repoRoot, majorsAbs).split(path.sep).join("/"), absPath: majorsAbs, required: true }));
  for (const rel of ["frontend/src/lib/types.ts", "frontend/src/lib/planner.ts", "README.md", "tools/catalog-consistency/RULES.md"]) {
    inputs.push(buildInputBinding({ role: "rule-source", recordPath: rel, absPath: path.join(repoRoot, rel) }));
  }
  for (const file of corpus.files) {
    inputs.push({ role: "prerequisite-corpus", path: file.path, sha256: file.sha256, bytes: file.bytes, present: true });
  }
  inputs.push(buildInputBinding({ role: "section-source", recordPath: sectionSourceRecordPath, absPath: compdAbs }));

  const provenance = {
    sectionSource: computeProvenance({
      data,
      sectionSourceRecordPath,
      compdAbsPath: compdAbs,
      submoduleCommit,
    }),
  };

  const receipt = buildReceipt({
    sourceCommit,
    inputs,
    submodulePins: [{ path: "backend", commit: submoduleCommit }],
    corpusDigest: corpus.digest,
    counts,
  });
  const report = buildReport({ sourceCommit, inputs, counts, provenance, findings });
  const annex = buildAnnex({ report, provenance });

  fs.mkdirSync(outDir, { recursive: true });
  const written = {};
  for (const [name, doc] of [
    ["input-receipt.json", receipt],
    ["report.json", report],
    ["unresolved-examples.json", annex],
  ]) {
    const bytes = Buffer.from(canonicalStringify(doc), "utf8");
    fs.writeFileSync(path.join(outDir, name), bytes);
    written[name] = { sha256: sha256(bytes), bytes: bytes.byteLength };
  }
  const manifest = {
    manifestVersion: MANIFEST_VERSION,
    files: {
      "input-receipt.json": written["input-receipt.json"],
      "report.json": written["report.json"],
      "unresolved-examples.json": written["unresolved-examples.json"],
    },
  };
  fs.writeFileSync(path.join(outDir, "results-manifest.json"), Buffer.from(canonicalStringify(manifest), "utf8"));

  return { receipt, report, annex, manifest };
}

/* -------------------------------------- CLI ----------------------------------- */

export function parseCliArgs(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        input: { type: "string" },
        out: { type: "string", default: "tools/catalog-consistency/results" },
        "section-source": { type: "string" },
        // Declared only so parseArgs accepts it; the guard below rejects it.
        replay: { type: "boolean" },
      },
    });
  } catch (err) {
    return { error: `usage error: ${err.message}` };
  }
  if (parsed.values.replay != null) {
    return { error: "usage error: --replay was retired in v2; byte-level verification is done by verify.mjs (node tools/catalog-consistency/verify.mjs --results <dir>)" };
  }
  if (!parsed.values.input) return { error: "usage error: --input <seed-data.json path> is required" };
  return {
    input: parsed.values.input,
    out: parsed.values.out,
    sectionSource: parsed.values["section-source"] ?? undefined,
  };
}

export function main(argv = process.argv.slice(2)) {
  const args = parseCliArgs(argv);
  if (args.error) {
    process.stderr.write(`${args.error}\n`);
    return 2;
  }
  try {
    const result = runAudit({ inputPath: args.input, outDir: args.out, sectionSourceAbsPath: args.sectionSource });
    const v = result.report.violations;
    const ext = result.report.findings.references.prerequisites.external;
    process.stdout.write(`catalog-consistency auditor v${TOOL_VERSION} (rules v${RULES_VERSION})\n`);
    process.stdout.write(
      `records: ${result.report.counts.courses} courses, ${result.report.counts.sections} sections, ${result.report.counts.buildings} buildings, ${result.report.counts.majors} majors, ${result.report.counts.corpusFiles} corpus files\n`,
    );
    process.stdout.write(`violations: duplicates ${v.duplicateIds}, meeting bounds ${v.meetingBounds}, unresolved references ${v.unknownReferences}\n`);
    process.stdout.write(
      `external prerequisites: ${ext.edges} edges / ${ext.distinctCodes} codes (corpus ${ext.categories.inSourceCorpus.codes}, bundle-annotated ${ext.categories.titleAnnotatedInBundle.codes}, unknown ${ext.categories.unknown.codes})\n`,
    );
    process.stdout.write(`provenance: ${result.report.provenance.sectionSource.bound ? "bound" : "unbound"} — ${result.report.provenance.sectionSource.assessment}\n`);
    process.stdout.write(`wrote: ${args.out}/input-receipt.json, report.json, unresolved-examples.json, results-manifest.json\n`);
    process.stdout.write(`verify with: node tools/catalog-consistency/verify.mjs --results ${args.out}\n`);
    return 0;
  } catch (err) {
    process.stderr.write(`audit failed: ${err.message}\n`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) {
  process.exitCode = main();
}

