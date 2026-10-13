import type { TranscriptCourseRecord } from "../types";
import type { CatalogCourse, Evidence, ParseResult, Prerequisite, SchoolAdapter } from "./types";

export function normalizeUntCourseId(code: string): string {
  const match = code.trim().match(/^([A-Z]{2,5})[\s._-]*(\d{4}[A-Z]?)$/i);
  if (!match) throw new Error(`Invalid UNT course code: ${code}`);
  return `${match[1].toUpperCase()} ${match[2].toUpperCase()}`;
}

const gradeRanks = new Map([ ["F", 0], ["D", 1], ["C", 2], ["B", 3], ["A", 4] ]);
const standingRanks = new Map([ ["freshman", 0], ["sophomore", 1], ["junior", 2], ["senior", 3], ["graduate", 4] ]);
// UNT's classification table uses completed hours: https://caiaa.unt.edu/advising/undergraduate-faqs.html
// Upper-level is the catalog's junior-or-senior category; scoped departmental hours stay unknown.
const standingHours = new Map([ ["freshman", 0], ["sophomore", 30], ["junior", 60], ["upper-level", 60], ["senior", 90] ]);

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
    const a = standingRanks.get(actual.toLowerCase() === "upper-level" ? "junior" : actual.toLowerCase());
    const b = standingRanks.get(minimum.toLowerCase() === "upper-level" ? "junior" : minimum.toLowerCase());
    return a === undefined || b === undefined ? undefined : a >= b;
  },
  minimumHours(minimum) {
    const threshold = minimum.match(/^credits:(\d+)$/);
    return threshold ? Number(threshold[1]) : standingHours.get(minimum.toLowerCase());
  },
};

const gradePrefix = /^(?:(?:a\s+)?grade of\s+)?["“]?([A-D])["”]?\s+or\s+(?:better|higher)\s+in\s*:?\s*(?:(?:each|one) of the following:\s*|the following:\s*)?/i;
const gradeSuffix = /\s*,?\s*(?:(?:each|both|all)\s+)?(?:(?:of\s+)?which\s+must\s+be\s+)?(?:completed\s+)?(?:with\s+)?(?:a\s+)?(?:grade of\s+)?([A-D])\s+or\s+(?:better|higher)\s*$/i;

function unknown(source: string): Prerequisite {
  return { kind: "unknown", source, detail: "Catalog clause needs advisor interpretation." };
}

function applyGrade(node: Prerequisite, grade: string): Prerequisite {
  if (node.kind === "minGrade" && node.grade === grade.toUpperCase()) return node;
  if (node.kind === "and" || node.kind === "or") {
    return { ...node, children: node.children.map(child => applyGrade(child, grade)) };
  }
  if (node.kind === "course" || node.kind === "corequisite" || node.kind === "minGrade") {
    return { kind: "minGrade", grade: grade.toUpperCase(), requirement: node, source: node.source };
  }
  return node;
}

/** A whole-clause grammar. Unsupported residue becomes an explicit unknown node. */
function parseSimpleClause(source: string): Prerequisite | undefined {
  let text = source.trim().replace(/[.]+$/, "").trim();
  if (!text) return { kind: "and", children: [], source };
  const hours = text.match(/^(?:(?:have |must have )?completed |completion of |students must have )?(?:at least )?(\d+)\s+(?:semester |earned |credit )?hours(?: of (?:credit|college course work|college coursework))?$/i);
  if (hours) return { kind: "standing", minimum: `credits:${hours[1]}`, source };
  if (/^approval of (?:the )?(?:supervisory faculty member|department chair(?: and the dean of the school or college in which the thesis is prepared)?|dean of the Honors College|department|instructor)(?: required)?$/i.test(text)) {
    return { kind: "consent", authority: text, source };
  }
  const explicitAlternatives = splitTopLevel(text, /\s*;\s*or\s+|\s*,?\s+or\s+(?=(?:consent\b|instructor consent\b|department(?:al)? consent\b))/gi);
  if (explicitAlternatives.length > 1) {
    const children = explicitAlternatives.map(parseClause);
    return { kind: "or", children, source };
  }
  const standingTail = text.match(/\s*,?\s*\band\s+((?:at least\s+)?(?:freshman|sophomore|junior|senior)(?:\s+or\s+senior)?\s+(?:class\s+)?(?:standing|status|classification))$/i);
  if (standingTail) {
    const first = parseClause(text.slice(0, text.length - standingTail[0].length));
    const standing = parseClause(standingTail[1]);
    return { kind: "and", children: [first, standing], source };
  }
  const prefix = text.match(gradePrefix) ?? text.match(/^Grade of A, B, or C in\s+/i);
  const suffix = text.match(gradeSuffix);
  if (prefix && suffix) return undefined;
  const semicolonGroups = splitTopLevel(text, /\s*;\s*(?:and\s+)?/gi);
  // Explicit shared grades are handled before splitting; ECON 4030's unmarked grade stays local.
  if (!prefix && semicolonGroups.length > 1 && semicolonGroups.every(group => !/^or\b/i.test(group))) {
    return { kind: "and", source, children: semicolonGroups.map(parseClause) };
  }
  let grade: string | undefined;
  if (prefix) { grade = prefix[1] ?? "C"; text = text.slice(prefix[0].length); }
  if (suffix) { grade = suffix[1]; text = text.slice(0, text.length - suffix[0].length); }
  const standaloneList = /^one of the following:\s*/i.test(text);
  text = text.replace(/^either\s+|^both\s+|^one of the following:\s*/i, "");
  text = text.replace(/([A-Z]{2,5}\s*\d{4}[A-Z]?)\s*\(or\s+([A-Z]{2,5}\s*\d{4}[A-Z]?)\s*\)/gi, "($1 or $2)");
  const alternativesList = standaloneList || /one of the following/i.test(prefix?.[0] ?? "");
  if (alternativesList) text = splitTopLevel(text, /,\s*(?:or\s+)?/gi).join(" or ");
  // Without an explicit list rule, A, B or C does not tell us whether A is mandatory.
  if (!alternativesList && /,/.test(text) && /\bor\b/i.test(text) && !/,\s*and\b/i.test(text) && !/,\s*or\s+consent\b/i.test(text)) return undefined;

  // Comma-and separates a list of alternatives from the next mandatory clause.
  const groups = splitTopLevel(text, /\s*;\s*(?:and\s+)?|\s*,\s*and\s+|\s+and\s+either\s+/gi);
  if (groups.length > 1 && groups.every(group => !/^or\b/i.test(group))) {
    const children = groups.map(parseClause);
    const result: Prerequisite = { kind: "and", children, source };
    return grade ? applyGrade(result, grade) : result;
  }

  type Token = { type: "atom"; node: Prerequisite } | { type: "and" | "or" };
  const tokens: Token[] = [];
  while (text.trim()) {
    text = text.trimStart();
    const course = text.match(/^[A-Z]{2,5}\s*\d{4}[A-Z]?\b/i);
    if (course) {
      let node: Prerequisite = { kind: "course", courseId: normalizeUntCourseId(course[0]), source: course[0] };
      text = text.slice(course[0].length);
      const equivalent = text.match(/^\s+or\s+(?:(?:the|its|their)\s+)?equivalents?\b/i);
      if (equivalent) {
        node = { kind: "or", escape: "equivalent", source: course[0] + equivalent[0], children: [
          node, { ...unknown(equivalent[0]), escape: "equivalent" },
        ] };
        text = text.slice(equivalent[0].length);
      }
      const conditionalCompanion = text.match(/^\s*\(and\s+[A-Z]{2,5}\s*\d{4}[A-Z]?\s+for\s+[^()]+students\)/i);
      if (conditionalCompanion) {
        node = { kind: "and", source: course[0] + conditionalCompanion[0], children: [node, unknown(conditionalCompanion[0])] };
        text = text.slice(conditionalCompanion[0].length);
      }
      const concurrent = text.match(/^\s*(?:\((?:may|should) be taken concurrently\)|or concurrent enrollment\b)/i);
      if (concurrent) {
        node = { kind: "corequisite", requirement: node, source: course[0] + concurrent[0] };
        text = text.slice(concurrent[0].length);
      }
      tokens.push({ type: "atom", node });
      continue;
    }
    if (text.startsWith("(")) {
      const end = groupEnd(text);
      if (end === undefined) return undefined;
      tokens.push({ type: "atom", node: { ...parseClause(text.slice(1, end)), source: text.slice(0, end + 1) } });
      text = text.slice(end + 1);
      continue;
    }
    const consent = text.match(/^(?:(?:instructor|department(?:al)?)\s+consent|(?:by\s+)?consent\s+(?:of\s+)?(?:the\s+)?(?:department|instructor|directing professor|supervising faculty member|Forensic Science Program|Honors College dean|school|Mayborn school|Teach North Texas advisor))(?:\s+required)?/i);
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
    const upperLevel = text.match(/^(?:upper[- ]level(?: academic)?|advanced \(junior or senior\)) standing\b/i);
    if (upperLevel) {
      tokens.push({ type: "atom", node: { kind: "standing", minimum: "upper-level", source: upperLevel[0] } });
      text = text.slice(upperLevel[0].length);
      continue;
    }
    const operator = text.match(/^(and|or)\b|^([,;/])/i);
    if (!operator) return undefined;
    const value = operator[0].toLowerCase();
    const type = value === "or" ? "or" : "and";
    // Catalog commas before 'or' are punctuation, not a second operator.
    if (!(value === "," && /^\s*(?:or|and)\b/i.test(text.slice(1)))) tokens.push({ type });
    text = text.slice(operator[0].length);
  }
  let position = 0;
  function atom(): Prerequisite | undefined {
    const token = tokens[position++];
    return token?.type === "atom" ? token.node : undefined;
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

function groupEnd(text: string): number | undefined {
  let depth = 0;
  for (let index = 0; index < text.length; index++) {
    if (text[index] === "(") depth++;
    if (text[index] === ")" && --depth === 0) return index;
  }
  return undefined;
}

function splitTopLevel(text: string, separator: RegExp): string[] {
  const depthAt: number[] = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    depthAt[i] = depth;
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
  }
  if (depth !== 0 || depthAt.some(value => value < 0)) return [text];
  const parts: string[] = [];
  let start = 0;
  for (const match of text.matchAll(separator)) if (depthAt[match.index] === 0) {
    parts.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  parts.push(text.slice(start));
  return parts;
}

/** Recover complete conjuncts. Conditional prose stays whole so closure cannot invent mandatory courses. */
function parseClause(source: string): Prerequisite {
  const text = source.trim().replace(/\.$/, "").trim();
  if (text.startsWith("(") && groupEnd(text) === text.length - 1) return { ...parseClause(text.slice(1, -1)), source };
  const coreq = text.match(/^(?:co-?requisite(?:\(s\)|s)?\s*:\s*|concurrent enrollment in\s+|co-enrolled in\s+)/i);
  if (coreq) return { kind: "corequisite", requirement: parseClause(text.slice(coreq[0].length)), source };
  if (/^if\b/i.test(text)) return unknown(source);
  if (/\b(?:majors?|minors?)\b[^;]*\b(?:must|that have|only)\b|\b(?:major|minor) status:|\b(?:majors?|minors?):|^Non-Majors:/i.test(text)) {
    const parts = splitTopLevel(text, /;\s*/g);
    if (parts.length > 1) return { kind: "and", source, children: parts.map(part => /^consent\b/i.test(part.trim()) ? parseClause(part) : unknown(part)) };
    return unknown(source);
  }
  const sharedGrade = text.match(gradeSuffix);
  // MEEN 3210's "all" qualifies the whole list, including groups before semicolons.
  if (sharedGrade && /\b(?:all|each|both)\b/i.test(sharedGrade[0])) {
    return { ...applyGrade(parseClause(text.slice(0, -sharedGrade[0].length)), sharedGrade[1]), source };
  }
  const qualifiedTail = splitTopLevel(text, /\s+and\s+(?=(?:(?:a\s+)?grade of\s+)?["“]?[A-D]["”]?\s+or\s+(?:better|higher)\s+in\b)/gi);
  if (qualifiedTail.length > 1) return { kind: "and", source, children: qualifiedTail.map(parseClause) };
  const simple = parseSimpleClause(source);
  if (simple) return simple;
  const equivalenceWithRestriction = text.match(/^([A-Z]{2,5}\s*\d{4}[A-Z]?\s+or\s+(?:(?:the|its)\s+)?equivalent)\s+(Required of .+)$/i);
  if (equivalenceWithRestriction) return { kind: "and", source, children: [parseClause(equivalenceWithRestriction[1]), unknown(equivalenceWithRestriction[2])] };
  const prefix = text.match(gradePrefix);
  const suffix = text.match(gradeSuffix);
  if (prefix && !suffix) return applyGrade({ ...parseClause(text.slice(prefix[0].length)), source }, prefix[1]);
  if (suffix && !prefix) return applyGrade({ ...parseClause(text.slice(0, -suffix[0].length)), source }, suffix[1]);
  const commaParts = splitTopLevel(text, /,\s*/g);
  if (commaParts.length > 1 && /\bor\b/i.test(text) && !/,\s*and\b/i.test(text)) return unknown(source);
  const separators = [
    { kind: "and", separator: /;\s*(?:and\s+)?(?!or\b)|,\s*and\s+/gi },
    { kind: "or", separator: /\s+or\s+(?!(?:better|higher|equivalent|the equivalent|its equivalent|their equivalents|concurrent enrollment)\b)/gi },
    { kind: "and", separator: /\s+and\s+|,\s*(?!(?:or|and)\b)/gi },
  ] as const;
  for (const { kind, separator } of separators) {
    const parts = splitTopLevel(text, separator);
    if (parts.length < 2 || parts.some(part => !part.trim())) continue;
    return { kind, source, children: parts.map(parseClause) };
  }
  return unknown(source);
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
    const consentException = clause.trim().match(/^If (?:these|the above) requirements are not met,?\s*(?:department(?:al)? )?consent is required$/i);
    if (consentException) {
      const consent: Prerequisite = { kind: "consent", authority: "department", source: clause };
      if (children.length === 0) { children.push(consent); continue; }
      const requirement: Prerequisite = { kind: "and", source: children.map(child => child.source).join(". "), children: [...children] };
      children.splice(0, children.length, { kind: "or", escape: "consent", source: requirement.source + ". " + clause, children: [requirement, consent] });
      continue;
    }
    const replacement = clause.trim().match(/^([A-Z]{2,5}\s*\d{4}[A-Z]?) can be replaced (?:with|by) (.+)$/i);
    if (replacement) {
      const id = normalizeUntCourseId(replacement[1]);
      const alternative = parseClause(replacement[2]);
      let found = false;
      function attach(node: Prerequisite): Prerequisite {
        const course = node.kind === "course" ? node : node.kind === "minGrade" && node.requirement.kind === "course" ? node.requirement : undefined;
        if (course?.courseId === id) {
          found = true;
          return { kind: "or", escape: "replacement", source: clause, children: [node, alternative] };
        }
        if (node.kind === "and" || node.kind === "or") return { ...node, children: node.children.map(attach) };
        if (node.kind === "minGrade" || node.kind === "corequisite") return { ...node, requirement: attach(node.requirement) };
        return node;
      }
      for (let index = 0; index < children.length; index++) children[index] = attach(children[index]);
      if (!found) children.push(unknown(clause));
      continue;
    }
    children.push(parseClause(clause));
  }
  function count(node: Prerequisite) {
    if (node.kind === "unknown") { if (node.escape === "equivalent") parsed++; else unparsed++; return; }
    if (node.kind === "and" || node.kind === "or") { node.children.forEach(count); return; }
    if (node.kind === "corequisite" || node.kind === "minGrade") { count(node.requirement); return; }
    parsed++;
  }
  children.forEach(count);
  for (const match of source.matchAll(/\b[A-Z]{2,5}\s*\d{4}[A-Z]?\s+or\s+(?:(?:the|its|their)\s+)?equivalents?\b/gi)) annotations.push(`Equivalent credit needs advisor confirmation: ${match[0]}`);
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
      .map(record => ({ courseId: normalizeUntCourseId(record.code), grade: record.grade, source: record.id, credits: record.credits })),
    inProgress: accepted.filter(record => record.appliedStatus === "inProgress")
      .map(record => normalizeUntCourseId(record.code)),
    needsReview: records.filter(record => !record.duplicateExcluded && (record.reviewRequired || record.appliedStatus === "needsReview"))
      .map(record => normalizeUntCourseId(record.code)),
  };
}
