import type { TranscriptCourseRecord } from "../types";
import type { CatalogCourse, Evidence, ParseResult, Prerequisite, SchoolAdapter } from "./types";

export function normalizeUntCourseId(code: string): string {
  const match = code.trim().match(/^([A-Z]{2,5})[\s._-]*(\d{4}[A-Z]?)$/i);
  if (!match) throw new Error(`Invalid UNT course code: ${code}`);
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
}

const gradeRanks = new Map([ ["F", 0], ["D", 1], ["C", 2], ["B", 3], ["A", 4] ]);
const standingRanks = new Map([ ["freshman", 0], ["sophomore", 1], ["junior", 2], ["senior", 3], ["graduate", 4] ]);

export const untAdapter: SchoolAdapter = {
  isPassingGrade(grade) {
    const value = grade.trim().toUpperCase();
    if (["P", "CR"].includes(value)) return true;
    if (["NP", "W", "I", "Z", "EN", "IP"].includes(value)) return false;
    const rank = gradeRanks.get(value);
    return rank === undefined ? undefined : rank > 0;
  },
  meetsMinimumGrade(actual, minimum) {
    const a = gradeRanks.get(actual.trim().toUpperCase());
    const b = gradeRanks.get(minimum.trim().toUpperCase());
    return a === undefined || b === undefined ? undefined : a >= b;
  },
  meetsStanding(actual, minimum) {
    const a = standingRanks.get(actual.toLowerCase());
    const b = standingRanks.get(minimum.toLowerCase());
    return a === undefined || b === undefined ? undefined : a >= b;
  },
};

const gradePrefix = /^(?:(?:a\s+)?grade of\s+)?["“]?([A-D])["”]?\s+or\s+(?:better|higher)\s+in\s+(?:(?:each|one) of the following:\s*|the following:\s*|:\s*)?/i;
const gradeSuffix = /\s*,?\s*(?:(?:each|both)\s+)?(?:completed\s+)?(?:with\s+)?(?:a\s+)?(?:grade of\s+)?([A-D])\s+or\s+(?:better|higher)\s*$/i;

function unknown(source: string): Prerequisite {
  return { kind: "unknown", source, detail: "Catalog clause needs advisor interpretation." };
}

function applyGrade(node: Prerequisite, grade: string): Prerequisite {
  if (node.kind === "and" || node.kind === "or") {
    return { ...node, children: node.children.map(child => applyGrade(child, grade)) };
  }
  if (node.kind === "course" || node.kind === "corequisite") {
    return { kind: "minGrade", grade: grade.toUpperCase(), requirement: node, source: node.source };
  }
  return node;
}

/** A whole-clause grammar. Unsupported residue becomes an explicit unknown node. */
function parseClause(source: string): Prerequisite | undefined {
  let text = source.trim().replace(/[.]+$/, "").trim();
  if (!text) return { kind: "and", children: [], source };
  const coreq = text.match(/^(?:co-?requisite(?:\(s\)|s)?\s*:\s*|concurrent enrollment in\s+|co-enrolled in\s+)/i);
  if (coreq) {
    const requirement = parseClause(text.slice(coreq[0].length));
    return requirement && { kind: "corequisite", requirement, source };
  }
  const explicitAlternatives = text.split(/\s*;\s*or\s+|\s*,?\s+or\s+(?=(?:consent\b|instructor consent\b|department(?:al)? consent\b))/i);
  if (explicitAlternatives.length > 1) {
    const children = explicitAlternatives.map(parseClause);
    return children.every((child): child is Prerequisite => child !== undefined)
      ? { kind: "or", children, source } : undefined;
  }
  const standingTail = text.match(/\s*,?\s*\band\s+((?:at least\s+)?(?:freshman|sophomore|junior|senior)(?:\s+or\s+senior)?\s+(?:class\s+)?(?:standing|status|classification))$/i);
  if (standingTail) {
    const first = parseClause(text.slice(0, text.length - standingTail[0].length));
    const standing = parseClause(standingTail[1]);
    return first && standing ? { kind: "and", children: [first, standing], source } : undefined;
  }
  const prefix = text.match(gradePrefix) ?? text.match(/^Grade of A, B, or C in\s+/i);
  const suffix = text.match(gradeSuffix);
  if (prefix && suffix) return undefined;
  let grade: string | undefined;
  if (prefix) { grade = prefix[1] ?? "C"; text = text.slice(prefix[0].length); }
  if (suffix) { grade = suffix[1]; text = text.slice(0, text.length - suffix[0].length); }
  text = text.replace(/^either\s+|^both\s+/i, "");
  text = text.replace(/([A-Z]{2,5}\s*\d{4}[A-Z]?)\s*\(or\s+([A-Z]{2,5}\s*\d{4}[A-Z]?)\s*\)/gi, "($1 or $2)");
  const alternativesList = /one of the following/i.test(prefix?.[0] ?? "");
  if (alternativesList) text = text.replace(/,\s*(?:or\s+)?/gi, " or ");
  // Without an explicit list rule, A, B or C does not tell us whether A is mandatory.
  if (!alternativesList && /,/.test(text) && /\bor\b/i.test(text) && !/,\s*and\b/i.test(text) && !/,\s*or\s+consent\b/i.test(text)) return undefined;

  // Comma-and separates a list of alternatives from the next mandatory clause.
  const groups = text.split(/\s*;\s*(?:and\s+)?|\s*,\s*and\s+/i);
  if (groups.length > 1 && groups.every(group => !/^or\b/i.test(group))) {
    const children = groups.map(parseClause);
    if (children.every((child): child is Prerequisite => child !== undefined)) {
      const result: Prerequisite = { kind: "and", children, source };
      return grade ? applyGrade(result, grade) : result;
    }
    return undefined;
  }

  type Token = { type: "atom"; node: Prerequisite } | { type: "and" | "or" | "open" | "close" };
  const tokens: Token[] = [];
  while (text.trim()) {
    text = text.trimStart();
    const course = text.match(/^[A-Z]{2,5}\s*\d{4}[A-Z]?\b/i);
    if (course) {
      let node: Prerequisite = { kind: "course", courseId: normalizeUntCourseId(course[0]), source: course[0] };
      text = text.slice(course[0].length);
      const concurrent = text.match(/^\s*\(may be taken concurrently\)/i);
      if (concurrent) {
        node = { kind: "corequisite", requirement: node, source: course[0] + concurrent[0] };
        text = text.slice(concurrent[0].length);
      }
      tokens.push({ type: "atom", node });
      continue;
    }
    const consent = text.match(/^(?:(?:instructor|department(?:al)?)\s+consent|consent\s+(?:of\s+)?(?:the\s+)?(?:department|instructor|supervising faculty member|Forensic Science Program|Honors College dean))(?:\s+required)?/i);
    if (consent) {
      tokens.push({ type: "atom", node: { kind: "consent", authority: consent[0], source: consent[0] } });
      text = text.slice(consent[0].length);
      continue;
    }
    const standing = text.match(/^(?:at least\s+)?(freshman|sophomore|junior|senior)(?:\s+or\s+senior)?\s+(?:class\s+)?(?:standing|status|classification)/i);
    if (standing) {
      tokens.push({ type: "atom", node: { kind: "standing", minimum: standing[1].toLowerCase(), source: standing[0] } });
      text = text.slice(standing[0].length);
      continue;
    }
    const operator = text.match(/^(and|or)\b|^([,;/()])/i);
    if (!operator) return undefined;
    const value = operator[0].toLowerCase();
    const type = value === "(" ? "open" : value === ")" ? "close" : value === "or" ? "or" : "and";
    // Catalog commas before 'or' are punctuation, not a second operator.
    if (!(value === "," && /^\s*(?:or|and)\b/i.test(text.slice(1)))) tokens.push({ type });
    text = text.slice(operator[0].length);
  }
  let position = 0;
  function atom(): Prerequisite | undefined {
    const token = tokens[position++];
    if (token?.type === "atom") return token.node;
    if (token?.type !== "open") return undefined;
    const result = expression("or");
    if (tokens[position++]?.type !== "close") return undefined;
    return result;
  }
  function expression(operator: "and" | "or"): Prerequisite | undefined {
    const next = operator === "or" ? () => expression("and") : atom;
    const first = next();
    if (!first) return undefined;
    const children = [first];
    while (tokens[position]?.type === operator) {
      position++;
      const child = next();
      if (!child) return undefined;
      children.push(child);
    }
    return children.length === 1 ? first : { kind: operator, children, source };
  }
  const result = expression("or");
  if (!result || position !== tokens.length) return undefined;
  return grade ? applyGrade({ ...result, source }, grade) : { ...result, source };
}

export function parseUntPrerequisite(source: string): ParseResult {
  const annotations: string[] = [];
  const clauses = source.replace(/\s+(Corequisite\(s\):)/gi, ". $1").split(/\.\s+(?=[A-Z*])|\.\s*$/);
  let unparsed = 0;
  let parsed = 0;
  const children: Prerequisite[] = [];
  for (const clause of clauses) {
    if (!clause.trim()) continue;
    if (/^(?:Core Category:|Recommended:|May (?:not )?be repeated\b)/i.test(clause.trim())) {
      annotations.push(clause);
      continue;
    }
    const node = parseClause(clause);
    if (node) { children.push(node); parsed++; continue; }
    unparsed++;
    children.push(unknown(clause));
  }
  return {
    source,
    expression: { kind: "and", source, children },
    coverage: unparsed === 0 ? "full" : parsed > 0 ? "partial" : "unknown",
    annotations,
  };
}

export type UntCatalogEntry = {
  course_number: string;
  number_of_hours: string;
  prerequisites: string;
  prerequisites_course_codes: readonly string[];
};

export function adaptUntCatalog(entries: readonly UntCatalogEntry[], creditHours?: ReadonlyMap<string, number>): CatalogCourse[] {
  return entries.map(entry => {
    const match = entry.number_of_hours.match(/^(\d+(?:\.\d+)?)\s+hours?$/i);
    const id = normalizeUntCourseId(entry.course_number);
    const credits = creditHours?.get(id) ?? (match ? Number(match[1]) : undefined);
    if (credits === undefined || !Number.isFinite(credits) || credits < 0) {
      throw new Error(`Supply credit hours for ${id}: ${entry.number_of_hours}`);
    }
    return { id, credits, prerequisite: parseUntPrerequisite(entry.prerequisites).expression };
  });
}

/** Review-required, excluded, and ignored importer rows never become completion evidence. */
export function evidenceFromUntTranscript(records: readonly TranscriptCourseRecord[]): Evidence {
  const accepted = records.filter(record => !record.duplicateExcluded && !record.reviewRequired);
  return {
    transcript: accepted.filter(record => record.appliedStatus === "completed")
      .map(record => ({ courseId: normalizeUntCourseId(record.code), grade: record.grade, source: record.id })),
    inProgress: accepted.filter(record => record.appliedStatus === "inProgress")
      .map(record => normalizeUntCourseId(record.code)),
    needsReview: records.filter(record => !record.duplicateExcluded && (record.reviewRequired || record.appliedStatus === "needsReview"))
      .map(record => normalizeUntCourseId(record.code)),
  };
}
