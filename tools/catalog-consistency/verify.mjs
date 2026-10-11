#!/usr/bin/env node
/**
 * Independent verifier for the UNTangle catalog-consistency v2 evidence bundle.
 *
 * Contract (spec v2): recompute counts, findings, violations and the provenance
 * block from the receipt-bound raw inputs with this tool OWN traversal; byte-check
 * the stored evidence files against results-manifest.json hashes and the canonical
 * re-serialization of their parsed content (JSON.stringify(v,null,2)+"\n", UTF-8).
 * Writes NOTHING into the audited results directory; --verdict-out is the only
 * optional write and is refused if it names an audited evidence file.
 *
 * The provenance recomputation mirrors the producer contract exactly but is
 * implemented here independently: both directions (bundle sections to compD rows
 * and compD rows back to bundle sections), building-aware meeting comparison, the
 * section-number lattice over the union, and the section-source assessment derived
 * from the stated premises (the strong string only when every premise holds, the
 * deterministic downgraded template otherwise, the unbound string when the section
 * source is absent).
 *
 * Node.js builtins only; zero npm dependencies; no imports from other tool files.
 *
 * Usage: node verify.mjs --results <resultsDir> --repo-root <repoRoot> [--verdict-out <file>]
 * Exit codes: 0 all checks pass; 1 verification failed; 2 usage error
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const TOOL_VERSION = 2;
const EVIDENCE_FILES = ["input-receipt.json", "report.json", "unresolved-examples.json"];
const ALL_EVIDENCE = [...EVIDENCE_FILES, "results-manifest.json"];
const UNRESOLVED_NOTE =
  "no committed evidence of external intent; consistent with the subset-catalog claim (README) but unverified per code — intent unresolved";
const ANNEX_NOTE =
  "Every unresolved finding with example records, capped at 10 per class; exact totals live in report.json. Nothing here is an allowlist: entries document defects and their committed repair locations (REPAIR-LOCATIONS.md).";
const DAY_VOCABULARY = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const EXAMPLE_CAP = 10;
const TITLE_RE = /\(([A-Z]{2,5} \d{1,4}[A-Z]?)\)/g;
const TERM_RE = /term|semester|session|year/i;

const ASSESSMENT_BOUND =
  "the committed sections and their meetings are fully derived from backend/data/compD.csv (bound in the receipt); compD.csv carries no term/semester/session/year column and its section-number lattice (every course carries section 001 and 002, with additional section numbers appearing in exact count pairs) is characteristic of generated rather than recorded offerings — treated as synthetic/generated, not a real-term export; no data repaired";
const ASSESSMENT_UNBOUND =
  "section source not available — backend/data/compD.csv absent; provenance not established";
const downgradedAssessment = ({ sectionsUnmatched, rowsUnmatched, termColumnCount, lattice }) =>
  `premises unmet — sections unmatched to compD rows: ${sectionsUnmatched}, compD rows unmatched to sections: ${rowsUnmatched}, term/semester/session/year columns present: ${termColumnCount}, section-number lattice violations: ${lattice.violations} courses (first: ${lattice.firstFailingCourse}) — sections cannot be certified fully derived from compD.csv; no data repaired`;

const canon = (v) => JSON.stringify(v, null, 2) + "\n";
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const sha256Text = (s) => sha256(Buffer.from(s, "utf8"));
const stripSpaces = (s) => String(s ?? "").replace(/ /g, "");
const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function fail(msg) {
  process.stderr.write(`error: ${msg}\n${usage()}`);
  process.exit(2);
}

function usage() {
  return [
    "usage: node verify.mjs --results <resultsDir> --repo-root <repoRoot> [--verdict-out <file>]",
    "",
    "  --results      directory holding the v2 evidence bundle (input-receipt.json,",
    "                 report.json, unresolved-examples.json, results-manifest.json)",
    "  --repo-root    checkout of the receipt-bound raw inputs",
    "  --verdict-out  optional path for the verdict report; refused if it names a file",
    "                 inside the audited results directory",
    "",
    "exit codes: 0 pass, 1 fail, 2 usage error",
  ].join("\n");
}

// ------------------------------------------------------------------ CLI

const argv = process.argv.slice(2);
let resultsDir = null;
let repoRoot = null;
let verdictOut = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--results") resultsDir = argv[++i];
  else if (a === "--repo-root") repoRoot = argv[++i];
  else if (a === "--verdict-out") verdictOut = argv[++i];
  else fail(`unknown argument: ${a}`);
}
if (!resultsDir || !repoRoot) fail("--results and --repo-root are required");
if (!existsSync(resultsDir) || !statSync(resultsDir).isDirectory()) fail(`results directory not found: ${resultsDir}`);
if (!existsSync(repoRoot) || !statSync(repoRoot).isDirectory()) fail(`repo root not found: ${repoRoot}`);

resultsDir = path.resolve(resultsDir);
repoRoot = path.resolve(repoRoot);

if (verdictOut) {
  const resolved = path.resolve(verdictOut);
  const rel = path.relative(resultsDir, resolved);
  if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
    process.stderr.write("refusing --verdict-out inside the audited results directory\n");
    process.exit(2);
  }
  verdictOut = resolved;
}

const repoPath = (...p) => path.join(repoRoot, ...p);

// ------------------------------------------------------------- raw inputs

function readJsonFile(p) {
  return JSON.parse(readFileSync(p, "utf8"));
}

/** Extract the `export const majors[: Type]? = [ ... ];` literal (pure JSON inside). */
function parseMajorsSource(tsPath) {
  const text = readFileSync(tsPath, "utf8");
  const start = text.indexOf("export const majors");
  if (start < 0) throw new Error("majors export not found");
  const eq = text.indexOf("=", start);
  if (eq < 0) throw new Error("majors export malformed");
  const open = text.indexOf("[", eq);
  if (open < 0) throw new Error("majors literal not found");
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "[") depth++;
    else if (text[i] === "]") {
      depth--;
      if (depth === 0) {
        // The majors literal is a TypeScript object literal (unquoted keys,
        // trailing commas), not JSON. Normalize to JSON before parsing.
        const json = text.slice(open, i + 1)
          .replace(/([{,]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, "$1\"$2\"$3")
          .replace(/,(\s*[}\]])/g, "$1");
        return JSON.parse(json);
      }
    }
  }
  throw new Error("majors literal unterminated");
}

/** compD is materialized only if it exists as a real file in this checkout. */
function fileMaterialized(p) {
  return existsSync(p) && statSync(p).isFile();
}

/** Gitlink (submodule) sha recorded in HEAD for a path, or null. */
function gitlinkFor(repoRoot, subPath) {
  const res = spawnSync("git", ["-C", repoRoot, "ls-tree", "HEAD", "--", subPath], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout) return null;
  const m = /^160000 commit (\S+)\t/.exec(res.stdout);
  return m ? m[1] : null;
}

/** Day-pattern expansion: two-char tokens first (Tu, Th), then single chars;
 *  unmapped tokens expand to null-day meetings (kept, not skipped). */
const DAY_TOKEN_MAP = { M: "Mon", Tu: "Tue", T: "Tue", W: "Wed", Th: "Thu", F: "Fri" };
function expandDayPattern(pattern) {
  const tokens = [];
  const s = typeof pattern === "string" ? pattern : "";
  let i = 0;
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

function parseCompD(csvPath) {
  const text = readFileSync(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) throw new Error("compD.csv empty");
  const header = lines[0].split(",");
  const termColumns = header.filter((c) => TERM_RE.test(c));
  const idx = (name) => header.findIndex((h) => h.trim().toLowerCase() === name);
  const courseI = idx("course_number");
  const secI = idx("section_number");
  const startI = idx("start_time");
  const endI = idx("end_time");
  const daysI = idx("days");
  const locI = idx("location");
  if (courseI < 0 || secI < 0 || startI < 0 || endI < 0 || daysI < 0 || locI < 0) {
    throw new Error("compD.csv header missing an expected column");
  }
  const rows = [];
  const lastI = Math.max(courseI, secI, startI, endI, daysI, locI);
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length <= lastI) continue; // not a section record
    rows.push({
      courseNumber: cols[courseI].trim(),
      sectionNumber: cols[secI].trim(),
      days: cols[daysI].trim(),
      start: cols[startI].trim(),
      end: cols[endI].trim(),
      location: cols.slice(locI).join(","), // location may contain commas
    });
  }
  return { header, termColumns, rows };
}

/** Last ALL-CAPS parenthetical (2-6 letters), matching the compD location convention. */
function buildingShortOf(location) {
  const matches = [...String(location ?? "").matchAll(/\(([A-Z]{2,6})\)/g)];
  return matches.length ? matches[matches.length - 1][1] : null;
}

// ------------------------------------------------- recomputation from inputs

function computeCounts({ catalog, majors, corpusBindings, compD }) {
  const courseStatuses = catalog.courseStatuses ?? {};
  return {
    buildings: (catalog.buildings ?? []).length,
    courses: (catalog.courses ?? []).length,
    sections: (catalog.sections ?? []).length,
    majors: majors.length,
    courseStatusEntries: Object.keys(courseStatuses).length,
    sectionMeetings: (catalog.sections ?? []).reduce((n, s) => n + (s?.meetings?.length ?? 0), 0),
    prerequisiteEdges: (catalog.courses ?? []).reduce((n, c) => n + (Array.isArray(c?.prerequisites) ? c.prerequisites.length : 0), 0),
    corpusFiles: corpusBindings.length,
    compDRows: compD ? compD.rows.length : 0,
  };
}

function computeFindings({ catalog, majors, corpus }) {
  const buildings = catalog.buildings ?? [];
  const courses = catalog.courses ?? [];
  const sections = catalog.sections ?? [];
  const courseStatuses = catalog.courseStatuses ?? {};

  const buildingById = new Set(buildings.map((b) => b?.id));
  const courseCodes = new Set(courses.map((c) => c?.code));

  // duplicates: DISTINCT keys occurring more than once, sorted, with occurrence counts
  const collectDups = (arr, key) => {
    const counts = new Map();
    for (const item of arr) {
      const k = key(item);
      if (k == null) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return [...counts.entries()]
      .filter(([, n]) => n > 1)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  };
  const dupCourseCodes = collectDups(courses, (c) => (typeof c?.code === "string" ? c.code : null));
  const dupSectionIds = collectDups(sections, (s) => (typeof s?.id === "string" ? s.id : null));
  const dupBuildingIds = collectDups(buildings, (b) => (typeof b?.id === "string" ? b.id : null));

  // meeting bounds over every stored meeting
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const badEnd = [];
  const badTime = [];
  const badDay = [];
  let meetingsChecked = 0;
  for (const s of sections) {
    for (const m of s?.meetings ?? []) {
      meetingsChecked++;
      const start = m?.start;
      const end = m?.end;
      if (typeof start !== "string" || typeof end !== "string" || !TIME_RE.test(start) || !TIME_RE.test(end)) {
        badTime.push({ sectionId: s.id, day: m?.day ?? null, start: start ?? null, end: end ?? null, buildingId: m?.buildingId ?? null });
        continue;
      }
      if (end <= start) badEnd.push({ sectionId: s.id, day: m?.day ?? null, start, end, buildingId: m?.buildingId ?? null });
      if (typeof m?.day !== "string" || !DAY_VOCABULARY.includes(m.day)) {
        badDay.push({ sectionId: s.id, day: m?.day ?? null });
      }
    }
  }
  const cap = (list) => list.slice(0, EXAMPLE_CAP);

  // references — membership is RAW string equality, matching the producer contract
  const sectionUnresolved = [];
  let sectionsChecked = 0;
  for (const s of sections) {
    sectionsChecked++;
    if (!courseCodes.has(s?.courseCode)) {
      sectionUnresolved.push({ sectionId: s.id, courseCode: s.courseCode });
    }
  }
  const buildingUnresolved = [];
  let meetingsWithBuilding = 0;
  for (const s of sections) {
    for (const m of s?.meetings ?? []) {
      if (m?.buildingId == null) continue;
      meetingsWithBuilding++;
      if (!buildingById.has(m.buildingId)) {
        buildingUnresolved.push({ sectionId: s.id, buildingId: m.buildingId });
      }
    }
  }
  const statusUnresolved = [];
  for (const [code, status] of Object.entries(courseStatuses)) {
    if (!courseCodes.has(code)) statusUnresolved.push({ courseCode: code, status });
  }

  const majorCoreUnresolved = [];
  let majorCoreChecked = 0;
  for (const major of majors) {
    for (const code of major?.coreCourseCodes ?? []) {
      majorCoreChecked++;
      if (!courseCodes.has(code)) {
        const needle = `(${code})`;
        const annotating = courses.find((c) => typeof c?.title === "string" && c.title.includes(needle)) ?? null;
        majorCoreUnresolved.push({
          majorId: major.id,
          majorName: major.name,
          code,
          evidence: annotating
            ? { kind: "titleAnnotatedEquivalent", courseCode: annotating.code, title: annotating.title }
            : null,
        });
      }
    }
  }

  // prerequisites — external edges keyed by the RAW code string
  const edgesTotal = courses.reduce((n, c) => n + (Array.isArray(c?.prerequisites) ? c.prerequisites.length : 0), 0);
  const externalByCode = new Map(); // raw code -> edge count
  let internalEdges = 0;
  for (const c of courses) {
    for (const pre of Array.isArray(c?.prerequisites) ? c.prerequisites : []) {
      if (courseCodes.has(pre)) { internalEdges++; continue; }
      externalByCode.set(pre, (externalByCode.get(pre) ?? 0) + 1);
    }
  }
  // classification priority: source corpus first, then bundle title annotation.
  // Corpus index keys: spaced-normalized course_number ("ANTH4520" -> "ANTH 4520")
  // plus pattern-extracted title-annotation codes, mirroring the producer.
  const crossSourceForm = (code) => {
    const m = /^([A-Z]+)(\d{1,4})$/.exec(code);
    return m ? `${m[1]} ${m[2]}` : code;
  };
  const corpusIndex = new Map(); // code -> Set of relative paths
  for (const binding of corpus) {
    const entries = Array.isArray(binding.json) ? binding.json : Array.isArray(binding.json?.data) ? binding.json.data : [];
    for (const entry of entries) {
      const found = [];
      if (typeof entry?.course_number === "string") found.push(crossSourceForm(entry.course_number));
      if (typeof entry?.title === "string") for (const m of entry.title.matchAll(TITLE_RE)) found.push(m[1]);
      for (const code of found) {
        if (!corpusIndex.has(code)) corpusIndex.set(code, new Set());
        corpusIndex.get(code).add(binding.relPath);
      }
    }
  }
  const bundleAnnotations = new Map(); // code -> titles (cap 3, courses then sections, input order)
  const addAnnot = (code, title) => {
    const list = bundleAnnotations.get(code) ?? [];
    if (list.length < 3) list.push(title);
    bundleAnnotations.set(code, list);
  };
  for (const c of courses) {
    if (typeof c?.title !== "string") continue;
    for (const m of c.title.matchAll(TITLE_RE)) addAnnot(m[1], c.title);
  }
  for (const s of sections) {
    if (typeof s?.title !== "string") continue;
    for (const m of s.title.matchAll(TITLE_RE)) addAnnot(m[1], s.title);
  }

  const inCorpus = [];
  const inTitles = [];
  const unknown = [];
  for (const [code, edges] of [...externalByCode.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
    const corpusFiles = corpusIndex.get(code);
    if (corpusFiles) {
      inCorpus.push({ code, edges, category: "inSourceCorpus", evidence: { kind: "sourceCorpusFile", files: [...corpusFiles].sort() } });
      continue;
    }
    const titles = bundleAnnotations.get(code);
    if (titles) {
      inTitles.push({ code, edges, category: "titleAnnotatedInBundle", evidence: { kind: "titleAnnotationInBundle", titles } });
      continue;
    }
    unknown.push({ code, edges, category: "unknown", evidence: null });
  }

  const classOf = (total, examples) => ({ total, examples });
  const dupView = (list) => classOf(list.length, list.slice(0, EXAMPLE_CAP).map(([key, n]) => ({ key, extraOccurrences: n - 1 })));
  return {
    duplicateIds: {
      courseCodes: dupView(dupCourseCodes),
      sectionIds: dupView(dupSectionIds),
      buildingIds: dupView(dupBuildingIds),
    },
    meetingBounds: {
      meetingsChecked,
      endTimeNotAfterStart: classOf(badEnd.length, cap(badEnd)),
      malformedTime: classOf(badTime.length, cap(badTime)),
      dayOutsideCommittedVocabulary: classOf(badDay.length, cap(badDay)),
    },
    references: {
      sectionToCourse: { checked: sectionsChecked, unresolved: classOf(sectionUnresolved.length, cap(sectionUnresolved)) },
      meetingToBuilding: { checked: meetingsWithBuilding, unresolved: classOf(buildingUnresolved.length, cap(buildingUnresolved)) },
      courseStatusToCourse: { checked: Object.keys(courseStatuses).length, unresolved: classOf(statusUnresolved.length, cap(statusUnresolved)) },
      majorCoreToCourse: { checked: majorCoreChecked, unresolved: classOf(majorCoreUnresolved.length, cap(majorCoreUnresolved)) },
      prerequisites: {
        edgesTotal,
        internalEdges,
        external: {
          edges: [...externalByCode.values()].reduce((n, e) => n + e, 0),
          distinctCodes: externalByCode.size,
          categories: {
            inSourceCorpus: { codes: inCorpus.length, edges: inCorpus.reduce((n, e) => n + e.edges, 0), examples: inCorpus.slice(0, EXAMPLE_CAP) },
            titleAnnotatedInBundle: { codes: inTitles.length, edges: inTitles.reduce((n, e) => n + e.edges, 0), examples: inTitles.slice(0, EXAMPLE_CAP) },
            unknown: { codes: unknown.length, edges: unknown.reduce((n, e) => n + e.edges, 0), examples: unknown.slice(0, EXAMPLE_CAP), note: UNRESOLVED_NOTE },
          },
        },
      },
    },
  };
}

function computeViolations(findings) {
  const dup = findings.duplicateIds;
  const mb = findings.meetingBounds;
  const refs = findings.references;
  return {
    duplicateIds: dup.courseCodes.total + dup.sectionIds.total + dup.buildingIds.total,
    meetingBounds: mb.endTimeNotAfterStart.total + mb.malformedTime.total + mb.dayOutsideCommittedVocabulary.total,
    unknownReferences:
      refs.sectionToCourse.unresolved.total +
      refs.meetingToBuilding.unresolved.total +
      refs.courseStatusToCourse.unresolved.total +
      refs.majorCoreToCourse.unresolved.total,
  };
}

/** Section-number lattice over the union of bundle sections and compD rows. */
function sectionLattice(courseNumbers) {
  const courses = [...courseNumbers.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let violations = 0;
  let firstFailingCourse = null;
  for (const [course, numbers] of courses) {
    const distinct = [...new Set([...numbers].map((n) => (/^\d+$/.test(n) ? Number(n) : NaN)).filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
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

const meetingTuple = (meeting) =>
  JSON.stringify([meeting?.day ?? null, meeting?.start ?? null, meeting?.end ?? null, meeting?.buildingId ?? null]);

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

/** Full provenance recomputation from materialized compD content: both directions,
 *  building-aware meeting comparison, lattice over the union, assessment from premises. */
function computeProvenanceBound({ compD, catalog, compDRelPath, receipt }) {
  const sections = catalog.sections ?? [];
  const shortToId = new Map((catalog.buildings ?? []).map((b) => [b?.shortName, b?.id]));

  const rowsBySection = new Map();
  for (const row of compD.rows) {
    const key = `${stripSpaces(row.courseNumber)}|${row.sectionNumber}`;
    const list = rowsBySection.get(key) ?? [];
    list.push(row);
    rowsBySection.set(key, list);
  }
  // First bundle section per pair key, for the reverse (row -> section) direction.
  const sectionsByPair = new Map();
  for (const s of sections) {
    const id = typeof s?.id === "string" ? s.id : "";
    const secNo = id.slice(id.lastIndexOf("-") + 1);
    const key = `${stripSpaces(s?.courseCode)}|${secNo}`;
    if (!sectionsByPair.has(key)) sectionsByPair.set(key, s);
  }

  // Building short codes are a census over ALL compD rows, matched or not.
  const shorts = new Set();
  for (const row of compD.rows) {
    const code = buildingShortOf(row.location);
    if (code != null) shorts.add(code);
  }

  // Direction 1: every bundle section must match a compD row.
  let sectionsMatched = 0;
  let sectionsUnmatched = 0;
  let meetingsFromDayPatterns = 0;
  let agree = 0;
  let disagree = 0;
  for (const s of sections) {
    const id = typeof s?.id === "string" ? s.id : "";
    const secNo = id.slice(id.lastIndexOf("-") + 1);
    const key = `${stripSpaces(s?.courseCode)}|${secNo}`;
    const row = rowsBySection.get(key)?.[0];
    if (!row) {
      sectionsUnmatched++;
      continue;
    }
    sectionsMatched++;
    const short = buildingShortOf(row.location);
    const buildingId = short != null && shortToId.has(short) ? shortToId.get(short) : null;
    const expanded = expandDayPattern(row.days).map((day) => ({ day, start: row.start, end: row.end, buildingId }));
    meetingsFromDayPatterns += expanded.length;
    const actual = (s?.meetings ?? []).map(meetingTuple);
    if (multisetEqual(actual, expanded.map(meetingTuple))) agree++;
    else disagree++;
  }

  // Direction 2: every compD row must match back to a bundle section.
  let rowsMatched = 0;
  let rowsUnmatched = 0;
  for (const row of compD.rows) {
    const key = `${stripSpaces(row.courseNumber)}|${row.sectionNumber}`;
    if (sectionsByPair.has(key)) rowsMatched++;
    else rowsUnmatched++;
  }

  // Section-number lattice over the union.
  const courseNumbers = new Map();
  const addNumber = (courseRaw, num) => {
    if (courseRaw == null || num == null || num === "") return;
    const key = stripSpaces(String(courseRaw));
    if (!key) return;
    const set = courseNumbers.get(key) ?? new Set();
    set.add(String(num));
    courseNumbers.set(key, set);
  };
  for (const s of sections) {
    const id = typeof s?.id === "string" ? s.id : "";
    addNumber(s?.courseCode, id.slice(id.lastIndexOf("-") + 1));
  }
  for (const row of compD.rows) addNumber(row.courseNumber, row.sectionNumber);
  const lattice = sectionLattice(courseNumbers);

  const allPremisesHold = sectionsUnmatched === 0 && rowsUnmatched === 0 && compD.termColumns.length === 0 && lattice.ok;
  const assessment = allPremisesHold
    ? ASSESSMENT_BOUND
    : downgradedAssessment({ sectionsUnmatched, rowsUnmatched, termColumnCount: compD.termColumns.length, lattice });

  const sortedShorts = [...shorts].sort();
  return {
    bound: true,
    path: compDRelPath,
    submoduleCommit: (receipt.submodulePins ?? []).find((p) => compDRelPath === p.path || compDRelPath.startsWith(p.path + "/"))?.commit ?? null,
    rows: compD.rows.length,
    sectionsMatchedToRows: sectionsMatched,
    sectionsUnmatchedToRows: sectionsUnmatched,
    rowsMatchedToSections: rowsMatched,
    rowsUnmatchedToSections: rowsUnmatched,
    meetingsFromDayPatterns,
    sectionsMeetingsAgree: agree,
    sectionsMeetingsDisagree: disagree,
    buildingShortCodes: sortedShorts.length,
    buildingCodesInBundle: sortedShorts.filter((c) => shortToId.has(c)).length,
    termColumns: compD.termColumns,
    lattice,
    assessment,
  };
}

// ------------------------------------------------------------- comparisons

function classMatches(stored, recomputed, label, problems) {
  if (!isPlainObject(stored) || !isPlainObject(recomputed)) {
    problems.push(`${label}: malformed class`);
    return;
  }
  if (stored.total !== recomputed.total) {
    problems.push(`${label}.total: report ${stored.total}, recomputed ${recomputed.total}`);
    return;
  }
  const pool = Array.isArray(recomputed.examples) ? recomputed.examples : [];
  for (const ex of Array.isArray(stored.examples) ? stored.examples : []) {
    const found = pool.some((cand) => JSON.stringify(cand) === JSON.stringify(ex));
    if (!found) {
      problems.push(`${label}.examples: stored example not among recomputed defects: ${JSON.stringify(ex).slice(0, 160)}`);
      return;
    }
  }
}

function findingsMatch(stored, recomputed, problems) {
  if (!isPlainObject(stored) || !isPlainObject(recomputed)) {
    problems.push("findings: malformed");
    return;
  }
  const dupS = stored.duplicateIds ?? {};
  const dupR = recomputed.duplicateIds;
  for (const k of ["courseCodes", "sectionIds", "buildingIds"]) classMatches(dupS[k], dupR[k], `duplicateIds.${k}`, problems);
  const mbS = stored.meetingBounds ?? {};
  const mbR = recomputed.meetingBounds;
  if (mbS.meetingsChecked !== mbR.meetingsChecked) problems.push(`meetingBounds.meetingsChecked: report ${mbS.meetingsChecked}, recomputed ${mbR.meetingsChecked}`);
  for (const k of ["endTimeNotAfterStart", "malformedTime", "dayOutsideCommittedVocabulary"]) classMatches(mbS[k], mbR[k], `meetingBounds.${k}`, problems);
  const refS = stored.references ?? {};
  const refR = recomputed.references;
  for (const k of ["sectionToCourse", "meetingToBuilding", "courseStatusToCourse", "majorCoreToCourse"]) {
    if (refS[k]?.checked !== refR[k]?.checked) problems.push(`references.${k}.checked: report ${refS[k]?.checked}, recomputed ${refR[k]?.checked}`);
    classMatches(refS[k]?.unresolved, refR[k]?.unresolved, `references.${k}.unresolved`, problems);
  }
  const pS = refS.prerequisites ?? {};
  const pR = refR.prerequisites;
  if (pS.edgesTotal !== pR.edgesTotal) problems.push(`references.prerequisites.edgesTotal: report ${pS.edgesTotal}, recomputed ${pR.edgesTotal}`);
  if (pS.internalEdges !== pR.internalEdges) problems.push(`references.prerequisites.internalEdges: report ${pS.internalEdges}, recomputed ${pR.internalEdges}`);
  const eS = pS.external ?? {};
  const eR = pR.external;
  if (eS.edges !== eR.edges) problems.push(`prerequisites.external.edges: report ${eS.edges}, recomputed ${eR.edges}`);
  if (eS.distinctCodes !== eR.distinctCodes) problems.push(`prerequisites.external.distinctCodes: report ${eS.distinctCodes}, recomputed ${eR.distinctCodes}`);
  for (const k of ["inSourceCorpus", "titleAnnotatedInBundle", "unknown"]) {
    const cS = eS.categories?.[k] ?? {};
    const cR = eR.categories[k];
    if (cS.codes !== cR.codes) problems.push(`prerequisites.categories.${k}.codes: report ${cS.codes}, recomputed ${cR.codes}`);
    if (cS.edges !== cR.edges) problems.push(`prerequisites.categories.${k}.edges: report ${cS.edges}, recomputed ${cR.edges}`);
    classMatches({ total: cS.codes, examples: cS.examples }, { total: cR.codes, examples: cR.examples }, `prerequisites.categories.${k}.examples`, problems);
    if (k === "unknown" && cS.note !== cR.note) problems.push("prerequisites.categories.unknown.note: missing or not the fixed string");
  }
}

// ------------------------------------------------------------------- main

const lines = [];

const runChecks = () => {
  // ---- check 1: parse -----------------------------------------------------
  const parsed = {};
  for (const name of ALL_EVIDENCE) {
    const p = path.join(resultsDir, name);
    if (!existsSync(p)) {
      lines.push(`FAIL parse: missing evidence file: ${name}`);
      return false;
    }
    try {
      parsed[name] = readJsonFile(p);
    } catch (err) {
      lines.push(`FAIL parse: ${name}: ${err.message}`);
      return false;
    }
  }
  lines.push("ok parse");

  const receipt = parsed["input-receipt.json"];
  const report = parsed["report.json"];
  const annex = parsed["unresolved-examples.json"];
  const manifest = parsed["results-manifest.json"];

  // ---- check 2: versions --------------------------------------------------
  {
    const problems = [];
    if (receipt.receiptVersion !== 2) problems.push(`receiptVersion ${JSON.stringify(receipt.receiptVersion)}`);
    if (receipt.toolVersion !== TOOL_VERSION) problems.push(`receipt toolVersion ${JSON.stringify(receipt.toolVersion)}`);
    if (receipt.rulesVersion !== 2) problems.push(`receipt rulesVersion ${JSON.stringify(receipt.rulesVersion)}`);
    if (report.reportVersion !== 2) problems.push(`reportVersion ${JSON.stringify(report.reportVersion)}`);
    if (report.toolVersion !== TOOL_VERSION) problems.push(`report toolVersion ${JSON.stringify(report.toolVersion)}`);
    if (report.rulesVersion !== 2) problems.push(`report rulesVersion ${JSON.stringify(report.rulesVersion)}`);
    if (annex.unresolvedExamplesVersion !== 2) problems.push(`unresolvedExamplesVersion ${JSON.stringify(annex.unresolvedExamplesVersion)}`);
    if (annex.toolVersion !== TOOL_VERSION) problems.push(`annex toolVersion ${JSON.stringify(annex.toolVersion)}`);
    if (manifest.manifestVersion !== 1) problems.push(`manifestVersion ${JSON.stringify(manifest.manifestVersion)}`);
    if (problems.length > 0) {
      lines.push(`FAIL versions: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok versions");
  }

  // ---- check 3: manifest-bytes ---------------------------------------------
  {
    const problems = [];
    const files = manifest.files ?? {};
    for (const name of EVIDENCE_FILES) {
      const entry = files[name];
      if (!isPlainObject(entry)) { problems.push(`${name}: no manifest entry`); continue; }
      const bytes = readFileSync(path.join(resultsDir, name));
      if (entry.sha256 !== sha256(bytes)) problems.push(`${name}: sha256 mismatch`);
      else if (entry.bytes !== bytes.length) problems.push(`${name}: bytes mismatch (manifest ${entry.bytes}, actual ${bytes.length})`);
    }
    if (problems.length > 0) {
      lines.push(`FAIL manifest-bytes: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok manifest-bytes");
  }

  // ---- check 4: canonical-bytes ---------------------------------------------
  {
    const problems = [];
    for (const name of ALL_EVIDENCE) {
      const raw = readFileSync(path.join(resultsDir, name));
      if (sha256(raw) !== sha256Text(canon(parsed[name]))) problems.push(`${name}: stored bytes are not canonical (JSON.stringify(v,null,2)+"\n")`);
    }
    if (problems.length > 0) {
      lines.push(`FAIL canonical-bytes: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok canonical-bytes");
  }

  // ---- check 5: input-binding ----------------------------------------------
  {
    const problems = [];
    const inputs = receipt.inputs;
    if (!Array.isArray(inputs) || inputs.length === 0) {
      lines.push("FAIL input-binding: receipt.inputs missing or empty");
      return false;
    }
    const roles = new Set(inputs.map((b) => b?.role));
    for (const role of ["generated-catalog", "majors-source", "prerequisite-corpus", "section-source"]) {
      if (!roles.has(role)) problems.push(`no ${role} binding`);
    }
    const recomputedByPath = new Map();
    for (const binding of inputs) {
      if (!isPlainObject(binding) || typeof binding.path !== "string" || typeof binding.role !== "string") {
        problems.push("malformed input binding");
        continue;
      }
      const abs = repoPath(binding.path);
      const materialized = fileMaterialized(abs);
      if (materialized) {
        const bytes = readFileSync(abs);
        const hash = sha256(bytes);
        recomputedByPath.set(binding.path, hash);
        if (binding.sha256 !== hash) problems.push(`${binding.path}: sha256 mismatch`);
        else if (binding.bytes !== bytes.length) problems.push(`${binding.path}: bytes mismatch`);
        if (binding.present !== true) problems.push(`${binding.path}: present should be true for a materialized file`);
      } else {
        if (binding.present !== false) problems.push(`${binding.path}: file absent but binding claims present`);
      }
    }
    // A binding that claims present but whose file is absent may live inside an
    // unmaterialized submodule: verify the pin against the HEAD gitlink.
    const pins = Array.isArray(receipt.submodulePins) ? receipt.submodulePins : null;
    if (pins === null) problems.push("receipt.submodulePins missing");
    for (const binding of inputs) {
      if (binding?.present !== true) continue;
      if (recomputedByPath.has(binding.path)) continue; // materialized and already verified
      const pin = (pins ?? []).find((p) => binding.path === p.path || binding.path.startsWith(p.path + "/"));
      if (!pin) { problems.push(`${binding.path}: claims present but the file is absent and no submodule pin covers it`); continue; }
      const gitlink = gitlinkFor(repoRoot, pin.path);
      if (gitlink === null) problems.push(`submodule pin ${pin.path}: no gitlink in HEAD`);
      else if (gitlink !== pin.commit) problems.push(`submodule pin ${pin.path}: pinned ${pin.commit}, HEAD gitlink ${gitlink}`);
    }
    // corpus digest: prerequisite-corpus bindings in receipt order, "sha256  path\n" lines
    const corpusBindings = inputs.filter((b) => b?.role === "prerequisite-corpus");
    const digestText = corpusBindings.map((b) => `${recomputedByPath.get(b.path) ?? b.sha256}  ${b.path}\n`).join("");
    const digest = sha256Text(digestText);
    const cd = receipt.corpusDigest;
    if (!isPlainObject(cd) || (cd.algorithm !== undefined && cd.algorithm !== "sha256") || cd.digest !== digest) {
      problems.push(`corpusDigest mismatch: recomputed ${digest}`);
    }
    if (problems.length > 0) {
      lines.push(`FAIL input-binding: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok input-binding");
  }

  // ---- check 6: cross-binding ------------------------------------------------
  {
    if (JSON.stringify(report.inputs) !== JSON.stringify(receipt.inputs)) {
      lines.push("FAIL cross-binding: report.inputs is not deep-equal to receipt.inputs");
      return false;
    }
    lines.push("ok cross-binding");
  }

  // ---- raw-input traversal (shared by checks 7-10) ---------------------------
  const catalogBinding = receipt.inputs.find((b) => b?.role === "generated-catalog");
  const majorsBinding = receipt.inputs.find((b) => b?.role === "majors-source");
  const compDBinding = receipt.inputs.find((b) => b?.role === "section-source");
  const corpusBindings = receipt.inputs.filter((b) => b?.role === "prerequisite-corpus");

  let catalog;
  let majors;
  let corpus;
  let compD = null;
  try {
    catalog = readJsonFile(repoPath(catalogBinding.path));
    majors = parseMajorsSource(repoPath(majorsBinding.path));
    corpus = corpusBindings.map((b) => ({ relPath: b.path, json: readJsonFile(repoPath(b.path)) }));
    if (compDBinding?.present !== false && fileMaterialized(repoPath(compDBinding.path))) {
      compD = parseCompD(repoPath(compDBinding.path));
    }
  } catch (err) {
    lines.push(`FAIL counts: raw input traversal failed: ${err.message}`);
    return false;
  }

  const recomputedCounts = computeCounts({ catalog, majors, corpusBindings, compD });

  // ---- check 7: counts --------------------------------------------------------
  {
    const problems = [];
    const stored = report.counts ?? {};
    for (const key of Object.keys(recomputedCounts)) {
      const rec = recomputedCounts[key];
      const rep = stored[key];
      // compDRows is only recomputable when compD is materialized in this checkout
      if (key === "compDRows" && compD === null && compDBinding?.present !== false) continue;
      if (rep !== rec) problems.push(`${key}: report ${JSON.stringify(rep)}, recomputed ${JSON.stringify(rec)}`);
    }
    if (problems.length > 0) {
      lines.push(`FAIL counts: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok counts");
  }

  // ---- check 8: findings -------------------------------------------------------
  const recomputedFindings = computeFindings({ catalog, majors, corpus });
  {
    const problems = [];
    findingsMatch(report.findings, recomputedFindings, problems);
    if (problems.length > 0) {
      lines.push(`FAIL findings: ${problems.slice(0, 5).join("; ")}`);
      return false;
    }
    lines.push("ok findings");
  }

  // ---- check 9: violations ------------------------------------------------------
  {
    const recomputedViolations = computeViolations(recomputedFindings);
    const stored = report.violations ?? {};
    const problems = [];
    for (const k of Object.keys(recomputedViolations)) {
      if (stored[k] !== recomputedViolations[k]) problems.push(`${k}: report ${JSON.stringify(stored[k])}, recomputed ${recomputedViolations[k]}`);
    }
    if (problems.length > 0) {
      lines.push(`FAIL violations: ${problems.join("; ")}`);
      return false;
    }
    lines.push("ok violations");
  }

  // ---- check 10: provenance ------------------------------------------------------
  {
    const stored = report.provenance?.sectionSource ?? {};
    const problems = [];
    if (compD !== null) {
      // compD materialized: full recomputation and comparison
      const recomputed = computeProvenanceBound({ compD, catalog, compDRelPath: compDBinding.path, receipt });
      for (const k of Object.keys(recomputed)) {
        if (JSON.stringify(stored[k]) !== JSON.stringify(recomputed[k])) {
          problems.push(`${k}: report ${JSON.stringify(stored[k])}, recomputed ${JSON.stringify(recomputed[k])}`);
        }
      }
      // the assessment must follow the premises, not just match a string
      if (recomputed.sectionsUnmatchedToRows === 0 && recomputed.rowsUnmatchedToSections === 0 && recomputed.termColumns.length === 0 && recomputed.lattice.ok) {
        if (stored.assessment !== ASSESSMENT_BOUND) problems.push("assessment: premises hold but the assessment is not the strong bound string");
      } else {
        const expected = downgradedAssessment({ sectionsUnmatched: recomputed.sectionsUnmatchedToRows, rowsUnmatched: recomputed.rowsUnmatchedToSections, termColumnCount: recomputed.termColumns.length, lattice: recomputed.lattice });
        if (stored.assessment !== expected) problems.push("assessment: premises fail but the assessment is not the exact downgraded string");
      }
    } else if (compDBinding?.present !== false) {
      // compD bound but inside an unmaterialized submodule: verify pin + consistency
      if (stored.bound !== true) problems.push(`bound: report ${JSON.stringify(stored.bound)}, receipt binds a present section source`);
      const pin = (receipt.submodulePins ?? []).find((p) => compDBinding.path === p.path || compDBinding.path.startsWith(p.path + "/"));
      if (!pin) problems.push("no submodule pin covers the bound section source");
      else if (stored.submoduleCommit !== pin.commit) problems.push(`submoduleCommit: report ${JSON.stringify(stored.submoduleCommit)}, pin ${pin.commit}`);
      if (stored.rows !== receipt.counts?.compDRows) problems.push(`rows: report ${JSON.stringify(stored.rows)}, receipt compDRows ${JSON.stringify(receipt.counts?.compDRows)}`);
      for (const k of ["sectionsMatchedToRows", "sectionsUnmatchedToRows", "rowsMatchedToSections", "rowsUnmatchedToSections", "meetingsFromDayPatterns", "sectionsMeetingsAgree", "sectionsMeetingsDisagree", "buildingShortCodes", "buildingCodesInBundle"]) {
        if (!Number.isInteger(stored[k]) || stored[k] < 0) problems.push(`${k}: not a non-negative integer`);
      }
      if (!isPlainObject(stored.lattice)) problems.push("lattice: not an object");
      if (!Array.isArray(stored.termColumns)) problems.push("termColumns: not an array");
      if (typeof stored.assessment !== "string" || stored.assessment.length === 0) problems.push("assessment: missing or empty");
      if (stored.path !== compDBinding.path) problems.push(`path: report ${JSON.stringify(stored.path)}, receipt ${JSON.stringify(compDBinding.path)}`);
    } else {
      // unbound: all counters zero/empty, lattice zeroed, assessment the exact unbound string
      if (stored.bound !== false) problems.push(`bound: report ${JSON.stringify(stored.bound)}, section source is unbound`);
      for (const k of ["rows", "sectionsMatchedToRows", "sectionsUnmatchedToRows", "rowsMatchedToSections", "rowsUnmatchedToSections", "meetingsFromDayPatterns", "sectionsMeetingsAgree", "sectionsMeetingsDisagree", "buildingShortCodes", "buildingCodesInBundle"]) {
        if (stored[k] !== 0) problems.push(`${k}: report ${JSON.stringify(stored[k])}, expected 0 for an unbound source`);
      }
      if (!Array.isArray(stored.termColumns) || stored.termColumns.length !== 0) problems.push("termColumns: expected empty for an unbound source");
      if (JSON.stringify(stored.lattice) !== JSON.stringify({ ok: false, coursesChecked: 0, violations: 0, firstFailingCourse: null })) problems.push("lattice: expected the zeroed lattice for an unbound source");
      if (stored.assessment !== ASSESSMENT_UNBOUND) problems.push("assessment: expected the exact unbound string");
    }
    if (problems.length > 0) {
      lines.push(`FAIL provenance: ${problems.slice(0, 5).join("; ")}`);
      return false;
    }
    lines.push("ok provenance");
  }

  // ---- check 11: examples-cap ------------------------------------------------------
  {
    const problems = [];
    const checkClass = (cls, label) => {
      if (!isPlainObject(cls)) { problems.push(`${label}: malformed class`); return; }
      if (!Number.isInteger(cls.total) || cls.total < 0) { problems.push(`${label}.total: not a non-negative integer`); return; }
      if (!Array.isArray(cls.examples)) { problems.push(`${label}.examples: not an array`); return; }
      if (cls.examples.length > EXAMPLE_CAP) problems.push(`${label}: ${cls.examples.length} stored examples exceed the cap of ${EXAMPLE_CAP}`);
      if (cls.examples.length > cls.total) problems.push(`${label}: ${cls.examples.length} stored examples exceed the total of ${cls.total}`);
    };
    const f = report.findings ?? {};
    for (const k of ["courseCodes", "sectionIds", "buildingIds"]) checkClass(f.duplicateIds?.[k], `duplicateIds.${k}`);
    for (const k of ["endTimeNotAfterStart", "malformedTime", "dayOutsideCommittedVocabulary"]) checkClass(f.meetingBounds?.[k], `meetingBounds.${k}`);
    for (const k of ["sectionToCourse", "meetingToBuilding", "courseStatusToCourse", "majorCoreToCourse"]) checkClass(f.references?.[k]?.unresolved, `references.${k}.unresolved`);
    for (const k of ["inSourceCorpus", "titleAnnotatedInBundle", "unknown"]) { const c = f.references?.prerequisites?.external?.categories?.[k]; if (!isPlainObject(c)) problems.push(`prerequisites.categories.${k}: malformed class`); }

    // annex must mirror the report classes exactly, and mirror provenance
    const a = annex;
    if (a.note !== ANNEX_NOTE) problems.push("annex.note: not the fixed string");
    const refS = a.referenceExamples;
    if (!Array.isArray(refS)) problems.push("annex.referenceExamples: not an array");
    else {
      for (const entry of refS) {
        const reportClass = f.references?.[entry?.check]?.unresolved;
        if (entry?.total !== reportClass?.total || JSON.stringify(entry?.examples) !== JSON.stringify(reportClass?.examples)) {
          problems.push(`annex.referenceExamples[${entry?.check}]: does not mirror report.json`);
        }
        checkClass(entry, `annex.referenceExamples.${entry?.check}`);
      }
    }
    const extA = a.externalPrerequisites ?? {};
    const extR = f.references?.prerequisites?.external ?? {};
    for (const k of ["inSourceCorpus", "titleAnnotatedInBundle", "unknown"]) {
      const cA = extA.categories?.[k];
      const cR = extR.categories?.[k];
      if (JSON.stringify(cA) !== JSON.stringify(cR)) problems.push(`annex.externalPrerequisites.categories.${k}: does not mirror report.json`);
    }
    const provA = a.provenanceSummary ?? {};
    if (provA.bound !== report.provenance?.sectionSource?.bound) problems.push("annex.provenanceSummary.bound: does not mirror report.json");
    if (provA.assessment !== report.provenance?.sectionSource?.assessment) problems.push("annex.provenanceSummary.assessment: does not mirror report.json");

    if (problems.length > 0) {
      lines.push(`FAIL examples-cap: ${problems.slice(0, 5).join("; ")}`);
      return false;
    }
    lines.push("ok examples-cap");
  }

  return true;
};

const allPassed = runChecks();
lines.push(`verdict: ${allPassed ? "PASS" : "FAIL"}`);
const output = lines.join("\n") + "\n";
process.stdout.write(output);

if (verdictOut) writeFileSync(verdictOut, output);
process.exit(allPassed ? 0 : 1);

