/**
 * The option id the extension protocol carries. The extension's `isId` guard
 * only accepts letters, digits, hyphens and underscores, while the planner's
 * stored section ids are vsb's ("vsb:spring-2027:CSCE 1030:10234+10235",
 * colons and all). The extension id is therefore its own reversible form: the
 * course code without its space, then the section's class numbers sorted and
 * joined, "CSCE1030-10234-10235". It maps back to the exact section through
 * the term's section data, and the schedule write stores the planner's own id.
 */
import type { Section } from "@/lib/sections/model";

const sortedClassNumbers = (classNumbers: string[]) => [...classNumbers].sort();

/** The extension id for an option, or null when it has no class numbers (synthetic samples). */
export function extensionOptionId(section: Pick<Section, "courseCode" | "classNumbers">): string | null {
  if (!section.classNumbers.length) return null;
  return `${section.courseCode.replaceAll(" ", "")}-${sortedClassNumbers(section.classNumbers).join("-")}`;
}

/** A preview against data that never resolved to a section still names one: the class number itself. */
export const optionIdFromClassNumber = (classNumber: string) => classNumber;

const parsed = /^([A-Z]{3,4})(\d{3,4}[A-Z]?)-(\d{4,5}(?:-\d{4,5})*)$/;

/** Decodes an extension id back to the course code and class numbers it names, or null. */
export function parseExtensionOptionId(optionId: string): { courseCode: string; classNumbers: string[] } | null {
  const match = parsed.exec(optionId);
  if (!match) return null;
  return { courseCode: `${match[1]} ${match[2]}`, classNumbers: match[3].split("-") };
}

/** True when the section is exactly the option the id names. */
export function sectionMatchesOptionId(section: Section, optionId: string): boolean {
  return extensionOptionId(section) === optionId;
}
