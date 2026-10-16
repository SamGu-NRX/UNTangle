/**
 * The option id the extension protocol carries. The extension's `isId` guard
 * only accepts letters, digits, hyphens and underscores, while the planner's
 * stored section ids are vsb's ("vsb:spring-2027:CSCE 1030:10234+10235",
 * colons and all). The extension id is therefore its own reversible form: the
 * term, the course code without its space, then the section's class numbers
 * sorted and joined, "spring-2027-CSCE1030-10234-10235". It maps back to the
 * exact section through that term's section data, and the schedule write
 * stores the planner's own id.
 *
 * The term is part of the id because myUNT reuses class numbers from term to
 * term, and because it picks which Main an add goes to: the extension echoes
 * the preview's option id in its add-option command, so the term on screen
 * when the student confirmed is the term the add lands in.
 */
import type { Section } from "@/lib/sections/model";

const sortedClassNumbers = (classNumbers: string[]) => [...classNumbers].sort();

/** The extension id for an option, or null when it has no class numbers or no term (synthetic samples). */
export function extensionOptionId(section: Pick<Section, "term" | "courseCode" | "classNumbers">): string | null {
  if (!section.classNumbers.length || section.term === null) return null;
  return `${section.term}-${section.courseCode.replaceAll(" ", "")}-${sortedClassNumbers(section.classNumbers).join("-")}`;
}

/** A preview against data that never resolved to a section still names one: the class number itself. */
export const optionIdFromClassNumber = (classNumber: string) => classNumber;

const parsed = /^((?:spring|summer|fall)-\d{4})-([A-Z]{3,4})(\d{3,4}[A-Z]?)-(\d{4,5}(?:-\d{4,5})*)$/;

/**
 * Decodes an extension id back to the term, course code and class numbers it
 * names, or null. An id without a term, as previews sent before the term was
 * added, decodes to null: it can't say which term's Main it meant.
 */
export function parseExtensionOptionId(optionId: string): { term: string; courseCode: string; classNumbers: string[] } | null {
  const match = parsed.exec(optionId);
  if (!match) return null;
  return { term: match[1], courseCode: `${match[2]} ${match[3]}`, classNumbers: match[4].split("-") };
}

/** True when the section is exactly the option the id names. */
export function sectionMatchesOptionId(section: Section, optionId: string): boolean {
  return extensionOptionId(section) === optionId;
}
