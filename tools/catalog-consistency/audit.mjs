#!/usr/bin/env node
/**
 * UNTangle catalog consistency audit.
 *
 * Audits the internal consistency of the committed catalog records:
 * courses, sections, buildings (from the generated seed-data.json) and
 * majors (from the committed seed-data.ts presets). It intentionally does
 * NOT judge scheduling feasibility, teaching loads, or any university
 * policy — those belong to the schedule oracle and planner. Rules are
 * defined in RULES.md next to this file; each rule is grounded in the
 * repository's own committed types, loader, or README claims.
 *
 * Usage (from the repository root):
 *   node tools/catalog-consistency/audit.mjs \
 *     --input frontend/src/lib/generated/seed-data.json \
 *     --out   tools/catalog-consistency/results
 *
 *   node tools/catalog-consistency/audit.mjs --replay tools/catalog-consistency/results
 *
 * Inputs are read-only. The audit never edits generated data; it only
 * writes receipts, reports, and replay verdicts under --out.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const TOOL_VERSION = 1;
export const RULES_VERSION = 1;
export const RECEIPT_VERSION = 1;
export const REPORT_VERSION = 1;
export const REPLAY_VERSION = 1;

/** How many example records each finding retains (deterministic input order). */
export const EXAMPLE_LIMIT = 10;

/**
 * Day vocabulary mirrored from the committed type `weekDays` in
 * frontend/src/lib/types.ts. Meetings using tokens outside this set are
 * internally inconsistent with the shape the app itself commits to.
 */
export const DAY_VOCABULARY = ["Mon", "Tue", "Wed", "Thu", "Fri"];

/** Strict zero-padded 24-hour HH:MM, the uniform form used by every committed meeting. */
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Extract the majors array literal from the committed TypeScript source
 * (frontend/src/lib/seed-data.ts). The literal is plain JS, so evaluating it
 * yields exactly the committed major records.
 */
export function parseMajorsFromTs(text) {
  const match = text.match(/export const majors: Major\[\] = ([\s\S]*?\n\]);/);
  if (!match) {
    throw new Error("majors array not found in majors source (expected `export const majors: Major[] = [...]`)");
  }
  return new Function(`return (${match[1]})`)();
}

function pushExample(list, example) {
  if (list.length < EXAMPLE_LIMIT) list.push(example);
}

/** First duplicate key per record collection: { key, count } per duplicated identity. */
function findDuplicates(records, keyOf) {
  const seen = new Map();
  const duplicated = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (seen.has(key)) {
      // Count extra occurrences beyond the first sighting.
      duplicated.set(key, (duplicated.get(key) ?? 0) + 1);
    } else {
      seen.set(key, record);
    }
  }
  // Deterministic: sort duplicated keys lexicographically.
  return [...duplicated.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

function normalizeSourceCode(courseNumber) {
  // Source corpus files use `"course_number": "ANTH4520"`; the generated
  // catalog uses "ANTH 4520". This normalizes the corpus spelling for
  // comparison only.
  const match = /^([A-Z]+)(\d{1,4})$/.exec(courseNumber);
  return match ? `${match[1]} ${match[2]}` : courseNumber;
}

const TITLE_ANNOTATION_PATTERN = /\(([A-Z]{2,5} \d{1,4}[A-Z]?)\)/;

/**
 * Build the set of course codes present in the committed source corpus
 * (`courses/*.json`), either as course_number or as a parenthesized title
 * annotation. Returns null when the directory is unavailable so callers can
 * report "source corpus not available" instead of an empty set.
 */
export function buildSourceCorpusCodes(corpusDir) {
  if (!corpusDir || !existsSync(corpusDir)) return null;
  /** @type {Map<string, Set<string>>} code -> file paths */
  const byCode = new Map();
  const add = (code, file) => {
    if (!code) return;
    if (!byCode.has(code)) byCode.set(code, new Set());
    byCode.get(code).add(file);
  };
  for (const file of readdirSync(corpusDir).filter((f) => f.endsWith(".json")).sort()) {
    const path = join(corpusDir, file);
    let entries;
    try {
      entries = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      continue;
    }
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry === "object") {
        if (typeof entry.course_number === "string") add(normalizeSourceCode(entry.course_number), file);
        const annotation = typeof entry.title === "string" ? TITLE_ANNOTATION_PATTERN.exec(entry.title) : null;
        if (annotation) add(annotation[1], file);
      }
    }
  }
  const out = new Map();
  for (const [code, files] of [...byCode.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    out.set(code, [...files].sort());
  }
  return out;
}

/**
 * Core audit over in-memory records. Pure and deterministic: same inputs
 * produce the same findings object every time.
 */
export function auditRecords({ courses, sections, buildings, courseStatuses, majors, corpusCodes = null }) {
  const courseCodes = new Set(courses.map((course) => course.code));
  const buildingIds = new Set(buildings.map((building) => building.id));

  // ---- R1: duplicate identifiers --------------------------------------
  const duplicateCourseCodes = findDuplicates(courses, (course) => course.code);
  const duplicateSectionIds = findDuplicates(sections, (section) => section.id);
  const duplicateBuildingIds = findDuplicates(buildings, (building) => building.id);

  // ---- R3: meeting bounds ---------------------------------------------
  let meetingsChecked = 0;
  const endTimeNotAfterStart = [];
  const malformedTime = [];
  const dayOutsideVocabulary = [];
  for (const section of sections) {
    for (const meeting of section.meetings ?? []) {
      meetingsChecked += 1;
      const context = () => ({
        sectionId: section.id,
        day: meeting.day,
        start: meeting.start,
        end: meeting.end,
        buildingId: meeting.buildingId ?? null,
      });
      if (typeof meeting.day !== "string" || !DAY_VOCABULARY.includes(meeting.day)) {
        pushExample(dayOutsideVocabulary, { sectionId: section.id, day: meeting.day ?? null });
      }
      if (!TIME_PATTERN.test(meeting.start ?? "") || !TIME_PATTERN.test(meeting.end ?? "")) {
        pushExample(malformedTime, context());
        continue; // bounds comparison is meaningless for malformed times
      }
      if (meeting.end <= meeting.start) {
        pushExample(endTimeNotAfterStart, context());
      }
    }
  }

  // ---- R2: missing references ------------------------------------------
  const sectionToCourse = { checked: 0, unresolved: 0, examples: [] };
  for (const section of sections) {
    sectionToCourse.checked += 1;
    if (!courseCodes.has(section.courseCode)) {
      sectionToCourse.unresolved += 1;
      pushExample(sectionToCourse.examples, { sectionId: section.id, courseCode: section.courseCode });
    }
  }

  const meetingToBuilding = { checked: 0, unresolved: 0, examples: [] };
  for (const section of sections) {
    for (const meeting of section.meetings ?? []) {
      if (meeting.buildingId === undefined || meeting.buildingId === null) continue;
      meetingToBuilding.checked += 1;
      if (!buildingIds.has(meeting.buildingId)) {
        meetingToBuilding.unresolved += 1;
        pushExample(meetingToBuilding.examples, { sectionId: section.id, buildingId: meeting.buildingId });
      }
    }
  }

  const courseStatusToCourse = { checked: 0, unresolved: 0, examples: [] };
  for (const code of Object.keys(courseStatuses)) {
    courseStatusToCourse.checked += 1;
    if (!courseCodes.has(code)) {
      courseStatusToCourse.unresolved += 1;
      pushExample(courseStatusToCourse.examples, { courseCode: code, status: courseStatuses[code] });
    }
  }

  // Major core-course references. Majors are app-level presets that plan
  // progress against the bundled catalog (planner.ts getCoreCoursesForMajor
  // silently drops codes it cannot resolve), so an unresolved code is a dead
  // reference inside the app's own data — not an external prerequisite.
  const majorCoreToCourse = { checked: 0, unresolved: 0, examples: [] };
  for (const major of majors) {
    for (const code of major.coreCourseCodes ?? []) {
      majorCoreToCourse.checked += 1;
      if (!courseCodes.has(code)) {
        majorCoreToCourse.unresolved += 1;
        const example = { majorId: major.id, majorName: major.name, code };
        // Factual string match: a bundled course whose title annotates the
        // same code, e.g. `PSCI 2305` titled "US Political Behavior and
        // Policy  (GOVT 2305)". Recorded as evidence only.
        const equivalent = courses.find((course) => course.title?.includes(`(${code})`));
        if (equivalent) {
          example.titleAnnotatedEquivalent = { courseCode: equivalent.code, title: equivalent.title };
        }
        pushExample(majorCoreToCourse.examples, example);
      }
    }
  }

  // Prerequisite edges. The README commits the catalog as a *bundled subset*
  // ("A bundled UNT catalog (656 courses ...) built from courses/*.json"), so
  // a prerequisite code outside the bundle is classified as an intentional
  // external prerequisite — counted and reported, never failed as an unknown
  // reference and never silently allowlisted.
  const prerequisiteEdges = courses.flatMap((course) =>
    (course.prerequisites ?? []).map((prerequisiteCode) => ({ courseCode: course.code, prerequisiteCode })),
  );
  const externalPrereqByCode = new Map();
  let internalPrereqEdges = 0;
  for (const edge of prerequisiteEdges) {
    if (courseCodes.has(edge.prerequisiteCode)) {
      internalPrereqEdges += 1;
      continue;
    }
    const current = externalPrereqByCode.get(edge.prerequisiteCode) ?? { code: edge.prerequisiteCode, edges: 0 };
    current.edges += 1;
    externalPrereqByCode.set(edge.prerequisiteCode, current);
  }
  const externalCodes = [...externalPrereqByCode.keys()].sort();
  const externalInCorpus = [];
  const externalNotInCorpus = [];
  for (const code of externalCodes) {
    const record = { code, edges: externalPrereqByCode.get(code).edges };
    if (corpusCodes) {
      const files = corpusCodes.get(code);
      if (files) {
        record.inSourceCorpus = true;
        record.sourceFiles = files;
        externalInCorpus.push(record);
      } else {
        record.inSourceCorpus = false;
        externalNotInCorpus.push(record);
      }
    } else {
      record.inSourceCorpus = null;
      externalNotInCorpus.push(record);
    }
  }

  const unknownReferenceEdges =
    sectionToCourse.unresolved +
    meetingToBuilding.unresolved +
    courseStatusToCourse.unresolved +
    majorCoreToCourse.unresolved;

  return {
    duplicateIds: {
      courseCodes: { count: duplicateCourseCodes.length, examples: duplicateCourseCodes.slice(0, EXAMPLE_LIMIT).map(([key, extra]) => ({ key, extraOccurrences: extra })) },
      sectionIds: { count: duplicateSectionIds.length, examples: duplicateSectionIds.slice(0, EXAMPLE_LIMIT).map(([key, extra]) => ({ key, extraOccurrences: extra })) },
      buildingIds: { count: duplicateBuildingIds.length, examples: duplicateBuildingIds.slice(0, EXAMPLE_LIMIT).map(([key, extra]) => ({ key, extraOccurrences: extra })) },
    },
    meetingBounds: {
      meetingsChecked,
      endTimeNotAfterStart: { count: endTimeNotAfterStart.length, examples: endTimeNotAfterStart },
      malformedTime: { count: malformedTime.length, examples: malformedTime },
      dayOutsideCommittedVocabulary: { count: dayOutsideVocabulary.length, examples: dayOutsideVocabulary },
    },
    references: {
      sectionToCourse,
      meetingToBuilding,
      courseStatusToCourse,
      majorCoreToCourse,
      prerequisites: {
        edgesTotal: prerequisiteEdges.length,
        internalEdges: internalPrereqEdges,
        external: {
          edges: prerequisiteEdges.length - internalPrereqEdges,
          distinctCodes: externalCodes.length,
          classification:
            "intentional external prerequisites — the bundled catalog is a subset of the university catalog (README); prerequisite codes outside the bundle are counted, not failed",
          inSourceCorpus: { codes: externalInCorpus.length, examples: externalInCorpus.slice(0, EXAMPLE_LIMIT) },
          notInSourceCorpus: { codes: externalNotInCorpus.length, examples: externalNotInCorpus.slice(0, EXAMPLE_LIMIT) },
        },
      },
    },
    violations: {
      // Duplicate ids and contradictory meeting bounds are violations by rule.
      // Unknown references are unresolved references OUTSIDE the external-
      // prerequisite class (sections→courses, meetings→buildings, statuses→
      // courses, majors→courses).
      duplicateIds: duplicateCourseCodes.length + duplicateSectionIds.length + duplicateBuildingIds.length,
      meetingBounds: endTimeNotAfterStart.length + malformedTime.length + dayOutsideVocabulary.length,
      unknownReferences: unknownReferenceEdges,
    },
  };
}

function gitHeadSha() {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Build the versioned input receipt binding record counts to the exact input files. */
export function buildReceipt({ inputPath, inputBuf, majorsPath, majorsBuf, majors, data, sourceCommit }) {
  return {
    receiptVersion: RECEIPT_VERSION,
    toolVersion: TOOL_VERSION,
    rulesVersion: RULES_VERSION,
    sourceCommit,
    input: { path: inputPath, sha256: sha256(inputBuf), bytes: inputBuf.byteLength },
    majorsSource: { path: majorsPath, sha256: sha256(majorsBuf), bytes: majorsBuf.byteLength },
    counts: {
      buildings: data.buildings.length,
      courses: data.courses.length,
      sections: data.sections.length,
      majors: majors.length,
      courseStatusEntries: Object.keys(data.courseStatuses ?? {}).length,
      sectionMeetings: data.sections.reduce((sum, section) => sum + (section.meetings?.length ?? 0), 0),
      prerequisiteEdges: data.courses.reduce((sum, course) => sum + (course.prerequisites?.length ?? 0), 0),
    },
  };
}

/** Assemble the full report object from a receipt and audit findings. */
export function buildReport({ receipt, findings }) {
  return {
    reportVersion: REPORT_VERSION,
    toolVersion: TOOL_VERSION,
    rulesVersion: RULES_VERSION,
    sourceCommit: receipt.sourceCommit,
    input: receipt.input,
    majorsSource: receipt.majorsSource,
    counts: receipt.counts,
    violations: findings.violations,
    findings,
  };
}

function stringifyStable(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseArgs(argv) {
  const args = { input: null, out: null, replay: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--input") args.input = argv[++i];
    else if (arg === "--out") args.out = argv[++i];
    else if (arg === "--replay") args.replay = argv[++i];
    else throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

/** Load and normalize everything the audit needs from the repository working tree. */
export function loadCatalog({ inputPath, majorsPath = null }) {
  const inputAbs = resolve(inputPath);
  const inputBuf = readFileSync(inputAbs);
  const data = JSON.parse(inputBuf.toString("utf8"));
  const majorsAbs = majorsPath ? resolve(majorsPath) : join(dirname(inputAbs), "..", "seed-data.ts");
  const majorsBuf = readFileSync(majorsAbs);
  const majors = parseMajorsFromTs(majorsBuf.toString("utf8"));
  // inputAbs is `<root>/frontend/src/lib/generated/seed-data.json`; `..`
  // pops the file itself first, so five levels up is the repository root,
  // where `courses/` lives.
  const corpusDir = resolve(inputAbs, "../../../../../courses");
  return { inputBuf, data, majorsPath: majorsAbs, majorsBuf, majors, corpusDir };
}

function writeResult(outDir, name, value) {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, name), stringifyStable(value));
}

function runAudit({ input, out }) {
  // Receipts record the paths exactly as passed (repo-relative when run from
  // the repository root) so replay stays portable across checkouts.
  const inputRaw = input;
  const majorsRaw = join(dirname(inputRaw), "..", "seed-data.ts");
  const outDir = resolve(out);
  const { inputBuf, data, majorsBuf, majors, corpusDir } = loadCatalog({ inputPath: inputRaw, majorsPath: majorsRaw });
  const corpusCodes = buildSourceCorpusCodes(corpusDir);
  const findings = auditRecords({
    courses: data.courses,
    sections: data.sections,
    buildings: data.buildings,
    courseStatuses: data.courseStatuses ?? {},
    majors,
    corpusCodes,
  });
  const receipt = buildReceipt({
    inputPath: inputRaw,
    majorsPath: majorsRaw,
    inputBuf,
    majorsBuf,
    majors,
    data,
    sourceCommit: gitHeadSha(),
  });
  const report = buildReport({ receipt, findings });

  const unresolvedExamples = {
    unresolvedExamplesVersion: 1,
    toolVersion: TOOL_VERSION,
    note:
      "Every unresolved finding with example records. Nothing here is an allowlist: entries document defects and their committed repair locations, decided in REPAIR-LOCATIONS.md.",
    unknownReferences: findings.references.majorCoreToCourse.unresolved > 0
      ? { check: "majorCoreToCourse", count: findings.references.majorCoreToCourse.unresolved, examples: findings.references.majorCoreToCourse.examples }
      : { check: "majorCoreToCourse", count: 0, examples: [] },
    duplicateIds: findings.violations.duplicateIds > 0 ? findings.duplicateIds : { count: 0 },
    meetingBounds: findings.violations.meetingBounds > 0 ? findings.meetingBounds : { count: 0 },
    externalPrerequisites: {
      edges: findings.references.prerequisites.external.edges,
      distinctCodes: findings.references.prerequisites.external.distinctCodes,
      inSourceCorpus: findings.references.prerequisites.external.inSourceCorpus,
      notInSourceCorpus: findings.references.prerequisites.external.notInSourceCorpus,
    },
  };

  writeResult(outDir, "input-receipt.json", receipt);
  writeResult(outDir, "report.json", report);
  writeResult(outDir, "unresolved-examples.json", unresolvedExamples);

  const v = report.violations;
  process.stdout.write(
    [
      `catalog-consistency audit ${TOOL_VERSION}`,
      `input: ${receipt.input.path} sha256=${receipt.input.sha256}`,
      `counts: buildings=${receipt.counts.buildings} courses=${receipt.counts.courses} sections=${receipt.counts.sections} majors=${receipt.counts.majors} meetings=${receipt.counts.sectionMeetings} prerequisiteEdges=${receipt.counts.prerequisiteEdges}`,
      `violations: duplicateIds=${v.duplicateIds} meetingBounds=${v.meetingBounds} unknownReferences=${v.unknownReferences}`,
      `external prerequisites: ${findings.references.prerequisites.external.edges} edges / ${findings.references.prerequisites.external.distinctCodes} distinct codes (counted, not failed)`,
      `wrote: ${outDir}/{input-receipt.json,report.json,unresolved-examples.json}`,
    ].join("\n"),
  );
}

function runReplay({ replayDir }) {
  const dir = resolve(replayDir);
  const readJson = (name) => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const receipt = readJson("input-receipt.json");
  const committedReport = readJson("report.json");
  const committedExamples = readJson("unresolved-examples.json");

  const differences = [];
  const { inputBuf, data, majorsBuf, majors, corpusDir } = loadCatalog({
    inputPath: receipt.input.path,
    majorsPath: receipt.majorsSource.path,
  });
  const inputUnchanged = sha256(inputBuf) === receipt.input.sha256;
  if (!inputUnchanged) differences.push("input sha256 no longer matches input-receipt.json");
  const majorsUnchanged = sha256(majorsBuf) === receipt.majorsSource.sha256;
  if (!majorsUnchanged) differences.push("majors source sha256 no longer matches input-receipt.json");

  const corpusCodes = buildSourceCorpusCodes(corpusDir);
  const findings = auditRecords({
    courses: data.courses,
    sections: data.sections,
    buildings: data.buildings,
    courseStatuses: data.courseStatuses ?? {},
    majors,
    corpusCodes,
  });
  const recomputedReceipt = buildReceipt({
    inputPath: receipt.input.path,
    inputBuf,
    majorsPath: receipt.majorsSource.path,
    majorsBuf,
    majors,
    data,
    sourceCommit: receipt.sourceCommit, // replay compares against the recorded commit
  });
  const countsMatch =
    JSON.stringify(recomputedReceipt.counts) === JSON.stringify(receipt.counts);
  if (!countsMatch) differences.push("record counts no longer match input-receipt.json");

  const report = buildReport({ receipt: recomputedReceipt, findings });
  const reportBytes = stringifyStable(report);
  const committedReportBytes = stringifyStable(committedReport);
  const reportMatches = reportBytes === committedReportBytes;
  if (!reportMatches) differences.push("recomputed report differs from committed report.json");

  // Independent recheck of the committed examples: every unresolved example
  // must still be present in the recomputed findings.
  const examplesStable =
    stringifyStable({
      unknownReferences: { count: findings.references.majorCoreToCourse.unresolved, examples: findings.references.majorCoreToCourse.examples },
      externalPrerequisites: {
        edges: findings.references.prerequisites.external.edges,
        distinctCodes: findings.references.prerequisites.external.distinctCodes,
        inSourceCorpus: findings.references.prerequisites.external.inSourceCorpus,
        notInSourceCorpus: findings.references.prerequisites.external.notInSourceCorpus,
      },
    }) ===
    stringifyStable({
      unknownReferences: {
        count: committedExamples.unknownReferences?.count ?? 0,
        examples: committedExamples.unknownReferences?.examples ?? [],
      },
      externalPrerequisites: committedExamples.externalPrerequisites,
    });
  if (!examplesStable) differences.push("committed unresolved-examples.json no longer matches recomputed findings");

  const verdict = {
    replayVersion: REPLAY_VERSION,
    toolVersion: TOOL_VERSION,
    replayOf: replayDir, // exactly as passed — keeps the committed verdict portable
    inputUnchanged,
    majorsSourceUnchanged: majorsUnchanged,
    countsMatch,
    reportByteIdentical: reportMatches,
    examplesStable,
    differences,
    result: differences.length === 0 ? "match" : "mismatch",
  };
  writeResult(dir, "replay.json", verdict);
  process.stdout.write(
    [
      `replay of ${dir}`,
      `inputUnchanged=${inputUnchanged} countsMatch=${countsMatch} reportByteIdentical=${reportMatches} examplesStable=${examplesStable}`,
      `result: ${verdict.result}`,
    ].join("\n"),
  );
  if (verdict.result !== "match") process.exitCode = 1;
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.replay) {
    runReplay({ replayDir: args.replay });
  } else if (args.input) {
    runAudit({ input: args.input, out: args.out ?? "tools/catalog-consistency/results" });
  } else {
    throw new Error("pass --input <seed-data.json> --out <dir>, or --replay <dir>");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
