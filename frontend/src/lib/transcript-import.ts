import { courses } from "@/lib/seed-data";
import type {
  Course,
  TranscriptCourseRecord,
  TranscriptImportSummary,
  TranscriptSourceKind,
} from "@/lib/types";

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
const termPattern = /\b(20\d{2}\s+(?:Fall|Spring|Summer|Winter))\b/g;
const completedGrades = new Set(["A", "B", "C", "CR"]);
const reviewCompletedGrades = new Set(["D", "P"]);
const inProgressGrades = new Set(["EN", "IP"]);
const ignoredGrades = new Set(["F", "NP", "I", "W", "Z"]);
const localParserRationale = "Parsed from transcript table text without AI.";
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
    const termOrder = a.term.localeCompare(b.term);
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

export function extractTranscriptJson(value: unknown): TranscriptAnalysisPayload {
  const directPayload = payloadFromUnknown(value);
  if (directPayload) return directPayload;

  const raw = stringifyAiResponse(value);
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const candidate = fenced ?? raw.match(/\{[\s\S]*\}/)?.[0] ?? raw.match(/\[[\s\S]*\]/)?.[0] ?? raw;
  const parsed = JSON.parse(candidate) as unknown;
  const payload = payloadFromUnknown(parsed);

  if (!payload) {
    throw new Error("AI response did not include a records array.");
  }

  return payload;
}

export function stringifyAiResponse(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const maybeMessage = value as {
      choices?: Array<{ message?: { content?: unknown }; text?: unknown }>;
      message?: { content?: unknown };
      text?: unknown;
      content?: unknown;
      output_text?: unknown;
      response?: unknown;
      result?: unknown;
    };

    if (typeof maybeMessage.text === "string") return maybeMessage.text;
    if (typeof maybeMessage.output_text === "string") return maybeMessage.output_text;
    if (typeof maybeMessage.content === "string") return maybeMessage.content;
    if (typeof maybeMessage.message?.content === "string") return maybeMessage.message.content;
    if (Array.isArray(maybeMessage.choices) && maybeMessage.choices.length > 0) {
      return stringifyAiResponse(maybeMessage.choices[0]?.message?.content ?? maybeMessage.choices[0]?.text);
    }
    if (Array.isArray(maybeMessage.message?.content)) {
      return stringifyContentParts(maybeMessage.message.content);
    }
    if (Array.isArray(maybeMessage.content)) return stringifyContentParts(maybeMessage.content);
    if (maybeMessage.response) return stringifyAiResponse(maybeMessage.response);
    if (maybeMessage.result) return stringifyAiResponse(maybeMessage.result);
  }

  return String(value ?? "");
}

export function buildTranscriptPrompt(transcriptText: string) {
  const redactedText = redactTranscriptText(transcriptText);
  const localPayload = buildLocalFallbackPayload(redactedText);
  const candidateRows =
    localPayload.records.length > 0 ? JSON.stringify(compactCandidateRows(localPayload.records)).slice(0, 18000) : "";
  const transcriptExcerpt = redactedText.slice(0, candidateRows ? 8000 : 26000);

  return `You are reading an unofficial UNT undergraduate transcript. Extract every course row and return only valid JSON.

Rules:
- Return an object: {"records":[...]}.
- Each record must include: code, title, term, grade, credits, sourceKind, confidence, rationale, duplicateExcluded.
- sourceKind must be one of: unt, transfer, exam, current, unknown.
- code must be a UNT-style subject plus four digits, for example "CSCE 1030".
- Treat transfer credit and exam credit as separate source kinds when the transcript says transfer, AP, exam, or non-traditional credit.
- Mark duplicateExcluded true only when the transcript indicates repeated, duplicate, excluded, or not counted credit.
- Use grade EN or IP for current enrolled or in-progress rows.
- If browser-extracted candidate rows are provided, correct them instead of inventing unrelated courses.
- Keep rationale under 10 words and describe only unusual rows such as transfer, duplicate, current, failed, or unclear grade.
- Return JSON only. Do not include markdown.

Browser-extracted candidate rows:
${candidateRows || "None"}

Transcript text:
${transcriptExcerpt}`;
}

export function buildTranscriptImagePrompt() {
  return `Read these rendered pages of an unofficial UNT undergraduate transcript. Student identity fields may be masked. Ignore redaction marks. Extract every course row and return only valid JSON.

Rules:
- Return an object: {"records":[...]}.
- Each record must include: code, title, term, grade, credits, sourceKind, confidence, rationale, duplicateExcluded.
- sourceKind must be one of: unt, transfer, exam, current, unknown.
- code must be a UNT-style subject plus four digits, for example "CSCE 1030".
- Include transfer credit and exam credit rows.
- Use grade EN or IP for current enrolled or in-progress rows.
- Keep rationale under 10 words and describe only unusual rows such as transfer, duplicate, current, failed, or unclear grade.
- Return JSON only. Do not include markdown.`;
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
      rationale: "Detected locally after AI analysis was unavailable.",
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
      rationale: localParserRationale,
      duplicateExcluded: isZeroCreditDuplicate || /duplicate|exclude|repeat/i.test(fullMatch),
    });
  }

  return records;
}

function compactCandidateRows(records: RawTranscriptCourse[]) {
  return records.map((record) => ({
    code: record.code,
    title: record.title,
    term: record.term,
    grade: record.grade,
    credits: record.credits,
    sourceKind: record.sourceKind,
    duplicateExcluded: record.duplicateExcluded,
  }));
}

function payloadFromUnknown(value: unknown): TranscriptAnalysisPayload | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) return { records: value as RawTranscriptCourse[] };

  const candidate = value as {
    records?: unknown;
    courses?: unknown;
    data?: unknown;
    output?: unknown;
  };

  if (Array.isArray(candidate.records)) return { records: candidate.records as RawTranscriptCourse[] };
  if (Array.isArray(candidate.courses)) return { records: candidate.courses as RawTranscriptCourse[] };
  return payloadFromUnknown(candidate.data) ?? payloadFromUnknown(candidate.output);
}

function stringifyContentParts(parts: unknown[]) {
  return parts
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object") {
        const candidate = part as { text?: unknown; content?: unknown; value?: unknown };
        if (typeof candidate.text === "string") return candidate.text;
        if (typeof candidate.content === "string") return candidate.content;
        if (typeof candidate.value === "string") return candidate.value;
        return stringifyAiResponse(candidate.text ?? candidate.content ?? candidate.value);
      }
      return "";
    })
    .join("");
}

function normalizeRationale(rawRationale: unknown, classifiedRationale: string) {
  const raw = text(rawRationale);
  if (!raw || raw === localParserRationale || /^parsed from transcript table/i.test(raw)) {
    return classifiedRationale;
  }
  return raw;
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
