import { courses } from "@/lib/seed-data";
import { compareAcademicTerms } from "@/lib/term-chronology";
import type {
  Course,
  TranscriptAppliedStatus,
  TranscriptCourseRecord,
  TranscriptImportSummary,
  TranscriptSourceKind,
} from "@/lib/types";

// Chronological term ordering lives in @/lib/term-chronology (shared with the
// planner); re-exported here so importer consumers keep a single import site.
export { compareAcademicTerms };

export type RawTranscriptCourse = {
  code?: unknown;
  title?: unknown;
  term?: unknown;
  grade?: unknown;
  credits?: unknown;
  sourceKind?: unknown;
  confidence?: unknown;
  rationale?: unknown;
  duplicateExcluded?: unknown;
};

export type TranscriptAnalysisPayload = {
  records: RawTranscriptCourse[];
};

export type TranscriptReconcileResult = {
  records: TranscriptCourseRecord[];
  summary: TranscriptImportSummary;
};

const courseCodePattern = /\b([A-Z]{2,5})[\s._-]*(\d{4})\b/gi;
const transcriptRowPattern =
  /\b([A-Z]{2,5})\s+(\d{4})\s+(.+?)\s+(\d+\.\d{3})\s+(\d+\.\d{3})\s+(?:(A|B|C|D|F|P|CR|NP|I|W|Z|EN|IP)\s+)?(\d+\.\d{3})/g;
const termPattern =
  /\b((?:20\d{2}\s+(?:Fall|Spring|Summer|Winter))|(?:(?:Fall|Spring|Summer|Winter)\s+20\d{2}))\b/g;
const completedGrades = new Set(["A", "B", "C", "CR"]);
const reviewCompletedGrades = new Set(["D", "P"]);
const inProgressGrades = new Set(["EN", "IP"]);
const ignoredGrades = new Set(["F", "NP", "I", "W", "Z"]);
const validSourceKinds = new Set<TranscriptSourceKind>([
  "unt",
  "transfer",
  "exam",
  "current",
  "unknown",
]);

function text(value: unknown, fallback = "") {
  return typeof value === "string" ? value.trim() : fallback;
}

function numberOrNull(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function confidence(value: unknown) {
  const parsed = numberOrNull(value);
  if (parsed === null) return 0.65;
  return Math.min(1, Math.max(0, parsed));
}

function sourceKind(value: unknown, grade: string): TranscriptSourceKind {
  const candidate = text(value).toLowerCase() as TranscriptSourceKind;
  if (validSourceKinds.has(candidate)) return candidate;
  if (inProgressGrades.has(grade)) return "current";
  if (grade === "CR") return "transfer";
  return "unknown";
}

export function normalizeTranscriptCode(value: unknown) {
  const raw = text(value).toUpperCase();
  const match = raw.match(/^([A-Z]{2,5})[\s._-]*(\d{4})$/);
  if (!match) return null;
  return `${match[1]} ${match[2]}`;
}

function stableRecordId(record: {
  code: string;
  term: string;
  grade: string;
  sourceKind: TranscriptSourceKind;
}) {
  return [record.code, record.term || "unknown-term", record.grade || "no-grade", record.sourceKind]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]+/g, "-");
}

function classifyRecord({
  grade,
  source,
  duplicateExcluded,
  confidenceScore,
  knownCourse,
}: {
  grade: string;
  source: TranscriptSourceKind;
  duplicateExcluded: boolean;
  confidenceScore: number;
  knownCourse: Course | undefined;
}): Pick<
  TranscriptCourseRecord,
  "appliedStatus" | "prerequisiteSatisfied" | "reviewRequired" | "rationale"
> {
  if (duplicateExcluded) {
    return {
      appliedStatus: "ignored",
      prerequisiteSatisfied: false,
      reviewRequired: true,
      rationale: "Transcript marks this row as duplicate or excluded.",
    };
  }

  if (inProgressGrades.has(grade) || source === "current") {
    return {
      appliedStatus: "inProgress",
      prerequisiteSatisfied: false,
      reviewRequired: confidenceScore < 0.58,
      rationale: "Transcript indicates the course is currently enrolled or in progress.",
    };
  }

  if (ignoredGrades.has(grade)) {
    return {
      appliedStatus: "ignored",
      prerequisiteSatisfied: false,
      reviewRequired: true,
      rationale: "Grade does not indicate completed credit.",
    };
  }

  if (!knownCourse) {
    return {
      appliedStatus: "needsReview",
      prerequisiteSatisfied: false,
      reviewRequired: true,
      rationale: "Not in the planner catalog.",
    };
  }

  if (completedGrades.has(grade) || source === "transfer" || source === "exam") {
    return {
      appliedStatus: confidenceScore < 0.58 ? "needsReview" : "completed",
      prerequisiteSatisfied: true,
      reviewRequired: confidenceScore < 0.58,
      rationale:
        source === "transfer" || source === "exam"
          ? "Accepted transfer or exam credit counts as completed credit."
          : "Letter grade or credit marker satisfies completed credit.",
    };
  }

  if (reviewCompletedGrades.has(grade)) {
    return {
      appliedStatus: confidenceScore < 0.58 ? "needsReview" : "completed",
      prerequisiteSatisfied: grade !== "D",
      reviewRequired: true,
      rationale:
        grade === "D"
          ? "D can count as completed credit, but may not satisfy C-or-better prerequisites."
          : "P counts as credit, but some major requirements may require advisor validation.",
    };
  }

  return {
    appliedStatus: "needsReview",
    prerequisiteSatisfied: false,
    reviewRequired: true,
    rationale: "Grade or status needs review before it can be applied.",
  };
}

export function reconcileTranscriptCourses({
  payload,
  modelUsed,
  extractionMode,
  catalog = courses,
}: {
  payload: TranscriptAnalysisPayload;
  modelUsed: string;
  extractionMode: TranscriptImportSummary["extractionMode"];
  catalog?: Course[];
}): TranscriptReconcileResult {
  const catalogByCode = new Map(catalog.map((course) => [course.code.toUpperCase(), course]));
  const records = payload.records.map((raw): TranscriptCourseRecord | null => {
    const code = normalizeTranscriptCode(raw.code);
    if (!code) return null;

    const grade = text(raw.grade).toUpperCase();
    const source = sourceKind(raw.sourceKind, grade);
    const confidenceScore = confidence(raw.confidence);
    const duplicateExcluded = raw.duplicateExcluded === true;
    const knownCourse = catalogByCode.get(code);
    const term = text(raw.term, "Unknown term");
    const classified = classifyRecord({
      grade,
      source,
      duplicateExcluded,
      confidenceScore,
      knownCourse,
    });

    return {
      id: stableRecordId({ code, term, grade, sourceKind: source }),
      code,
      title: knownCourse?.title ?? text(raw.title, code),
      term,
      grade,
      credits: numberOrNull(raw.credits),
      sourceKind: source,
      confidence: confidenceScore,
      rationale: normalizeRationale(raw.rationale, classified.rationale),
      duplicateExcluded,
      appliedStatus: classified.appliedStatus,
      prerequisiteSatisfied: classified.prerequisiteSatisfied,
      reviewRequired: classified.reviewRequired,
    };
  });

  const deduped = new Map<string, TranscriptCourseRecord>();
  records.forEach((record) => {
    if (!record) return;
    const existing = deduped.get(record.id);
    if (!existing || record.confidence > existing.confidence) {
      deduped.set(record.id, record);
    }
  });

  const reconciled = [...deduped.values()].sort((a, b) => {
    const termOrder = compareAcademicTerms(a.term, b.term);
    if (termOrder !== 0) return termOrder;
    return a.code.localeCompare(b.code);
  });
  const applied = reconciled.filter((record) =>
    record.appliedStatus === "completed" || record.appliedStatus === "inProgress",
  ).length;
  const ignored = reconciled.filter((record) => record.appliedStatus === "ignored").length;
  const needsReview = reconciled.filter((record) => record.appliedStatus === "needsReview").length;

  return {
    records: reconciled,
    summary: {
      detected: reconciled.length,
      applied,
      ignored,
      needsReview,
      modelUsed,
      extractionMode,
    },
  };
}

export function buildLocalFallbackPayload(transcriptText: string): TranscriptAnalysisPayload {
  const parsedRows = parseUntTranscriptRows(transcriptText);
  if (parsedRows.length > 0) {
    return { records: parsedRows };
  }

  const seen = new Set<string>();
  const records: RawTranscriptCourse[] = [];

  for (const match of transcriptText.matchAll(courseCodePattern)) {
    const code = `${match[1].toUpperCase()} ${match[2]}`;
    if (seen.has(code)) continue;
    seen.add(code);
    records.push({
      code,
      title: code,
      term: "Needs review",
      grade: "",
      credits: null,
      sourceKind: "unknown",
      confidence: 0.35,
      rationale: "Found the course code, but not its grade or term. Check both before adding it.",
      duplicateExcluded: false,
    });
  }

  return { records };
}

function parseUntTranscriptRows(transcriptText: string): RawTranscriptCourse[] {
  const records: RawTranscriptCourse[] = [];

  for (const match of transcriptText.matchAll(transcriptRowPattern)) {
    const [fullMatch, department, number, rawTitle, attempted, earned, grade = "", points] = match;
    const title = rawTitle.replace(/\s+/g, " ").trim();
    if (
      title.length > 84 ||
      /Term GPA|Term Totals|Transfer Totals|Cum GPA|Academic Standing|Exam Date|Course Description/i.test(title)
    ) {
      continue;
    }

    const isZeroCreditDuplicate = Number(attempted) === 0 && Number(earned) === 0 && Number(points) === 0;

    records.push({
      code: `${department.toUpperCase()} ${number}`,
      title,
      term: findTermBefore(transcriptText, match.index ?? 0),
      grade: grade || (isZeroCreditDuplicate ? "Z" : ""),
      credits: Number(earned),
      sourceKind: sourceKindBefore(transcriptText, match.index ?? 0, grade),
      confidence: 0.92,
      rationale: "",
      duplicateExcluded: isZeroCreditDuplicate || /duplicate|exclude|repeat/i.test(fullMatch),
    });
  }

  return records;
}

/** A row's own note (e.g. a code found without its grade) wins; otherwise the classification's. */
function normalizeRationale(rawRationale: unknown, classifiedRationale: string) {
  return text(rawRationale) || classifiedRationale;
}

function findTermBefore(transcriptText: string, index: number) {
  const before = transcriptText.slice(0, index);
  const terms = [...before.matchAll(termPattern)];
  return terms.at(-1)?.[1] ?? "Unknown term";
}

function sourceKindBefore(
  transcriptText: string,
  index: number,
  grade: string | undefined,
): TranscriptSourceKind {
  const before = transcriptText.slice(0, index);
  const lowerBefore = before.toLowerCase();
  const lastTerm = lastTermIndex(before);
  const lastExam = lowerBefore.lastIndexOf("credit by exam");
  const lastTransfer = lowerBefore.lastIndexOf("transfer credit");

  if (lastExam > lastTerm) return "exam";
  if (lastTransfer > lastTerm) return "transfer";
  if (grade && inProgressGrades.has(grade)) return "current";
  return "unt";
}

function lastTermIndex(value: string) {
  const matches = [...value.matchAll(termPattern)];
  return matches.at(-1)?.index ?? -1;
}
export function redactTranscriptText(transcriptText: string) {
  return transcriptText
    .replace(/Name:\s*.*?(?=\s+Student ID:)/gi, "Name: [redacted]")
    .replace(/Student ID:\s*[0-9-]+/gi, "Student ID: [redacted]")
    .replace(/\b(?:UNT ID|EMPLID|Student Number|ID)\s*:?\s*[0-9-]+\b/gi, "[redacted student id]")
    .replace(/\b(?:DOB|Date of Birth)\s*:?\s*\d{1,2}\/\d{1,2}\/\d{2,4}\b/gi, "[redacted birth date]")
    .replace(/Student Address:\s*.*?(?=\s+Print Date:)/gi, "Student Address: [redacted]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[redacted email]")
    .replace(/\b\d{3}[-.\s]\d{2}[-.\s]\d{4}\b/g, "[redacted id]")
    .replace(/\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, "[redacted phone]");
}

export function effectiveTranscriptRecord(
  record: TranscriptCourseRecord,
  override: TranscriptAppliedStatus | undefined,
): TranscriptCourseRecord {
  if (!override || override === record.appliedStatus) return record;

  return {
    ...record,
    appliedStatus: override,
    prerequisiteSatisfied: override === "completed" ? record.grade !== "D" : false,
    reviewRequired: override === "needsReview",
    rationale:
      override === "completed" || override === "inProgress"
        ? `${record.rationale} Manually included during transcript review.`
        : record.rationale,
  };
}

// The apply gate for the transcript import review step: only rows the user
// explicitly included (per-row approval) that still resolve to completed or
// in-progress credit are applied to the planner.
export function selectApprovedTranscriptRecords(
  records: TranscriptCourseRecord[],
  included: ReadonlySet<string>,
  overrides: Record<string, TranscriptAppliedStatus> = {},
): TranscriptCourseRecord[] {
  return records
    .map((record) => effectiveTranscriptRecord(record, overrides[record.id]))
    .filter(
      (record) =>
        included.has(record.id) &&
        (record.appliedStatus === "completed" || record.appliedStatus === "inProgress"),
    );
}
