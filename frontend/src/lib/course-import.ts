import { courses } from "./seed-data";
import type { Course } from "./types";

export type ImportedCourse = {
  code: string;
  title: string;
  department: string;
};

export type CourseImportResult = {
  matched: ImportedCourse[];
  unknownCodes: string[];
  duplicateCodes: string[];
  totalCodesFound: number;
};

const courseCodePattern = /\b([A-Z]{2,5})[\s._-]*(\d{4})\b/gi;

function decodeLooseText(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ");
}

export function normalizeCourseCode(department: string, number: string) {
  return `${department.toUpperCase()} ${number}`;
}

export function parseCourseImportText(
  input: string,
  catalog: Course[] = courses,
): CourseImportResult {
  const catalogByCode = new Map(catalog.map((course) => [course.code.toUpperCase(), course]));
  const text = decodeLooseText(input);
  const seenCodes = new Set<string>();
  const duplicatedCodes = new Set<string>();
  const unknownCodes = new Set<string>();
  const matched: ImportedCourse[] = [];
  let totalCodesFound = 0;

  for (const match of text.matchAll(courseCodePattern)) {
    const code = normalizeCourseCode(match[1], match[2]);
    totalCodesFound += 1;

    if (seenCodes.has(code)) {
      duplicatedCodes.add(code);
      continue;
    }

    seenCodes.add(code);
    const course = catalogByCode.get(code);

    if (!course) {
      unknownCodes.add(code);
      continue;
    }

    matched.push({
      code: course.code,
      title: course.title,
      department: course.department,
    });
  }

  return {
    matched,
    unknownCodes: [...unknownCodes],
    duplicateCodes: [...duplicatedCodes],
    totalCodesFound,
  };
}
