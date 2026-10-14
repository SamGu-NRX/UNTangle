/**
 * Identifiers from docs/architecture/README.md ("Identifiers"), plus the
 * opaque document and operation ids the sync protocol uses.
 *
 * Each id is a plain string at runtime, written the way the institution
 * writes it ("CSCE 1030", "spring-2027"), never prefixed. The brand exists
 * only in the type system, so an InstitutionId can't be passed where a TermId
 * is expected. The schemas are the only way to get one from untrusted input.
 */
import { z } from "zod";

export type Id<K extends string> = string & { readonly __kind: K };

/** An institution, such as "unt". */
export type InstitutionId = Id<"institution">;
/** A term, such as "spring-2027". Unique within an institution. */
export type TermId = Id<"term">;
/** A course code, such as "CSCE 1030". Unique within an institution. */
export type CourseId = Id<"course">;

/** Lowercase words joined by single hyphens: "unt", "spring-2027". */
const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/**
 * Visible characters and single spaces, nothing at either end: "CSCE 1030",
 * and also "C S 312" for an institution that writes codes that way. The
 * institution's campus adapter owns the exact grammar.
 */
const courseCode = /^\S(?: ?\S)*$/;

const isInstitutionId = (value: string): value is InstitutionId => slug.test(value);
const isTermId = (value: string): value is TermId => slug.test(value);
const isCourseId = (value: string): value is CourseId => courseCode.test(value);

export const InstitutionIdSchema = z
  .string()
  .max(64)
  .refine(isInstitutionId, 'An institution id is lowercase words joined by hyphens, like "unt".');

export const TermIdSchema = z
  .string()
  .max(64)
  .refine(isTermId, 'A term id is lowercase words joined by hyphens, like "spring-2027".');

export const CourseIdSchema = z
  .string()
  .max(32)
  .refine(isCourseId, 'A course id is the code as the institution writes it, like "CSCE 1030".');

/**
 * A course code inside a document body. Bodies keep today's planner types,
 * where codes are plain strings, so this checks the same format as
 * CourseIdSchema without branding the result.
 */
export const CourseCodeSchema = z
  .string()
  .max(32)
  .regex(courseCode, 'A course code is written as the institution writes it, like "CSCE 1030".');

/** A synced document. */
export type DocumentId = Id<"document">;
/**
 * One write, kept across its retries. Branded apart from DocumentId: a
 * document id reused as an operation id would make every later save look
 * like a retry of the first and fail its receipt's hash check.
 */
export type OperationId = Id<"operation">;

/** Up to 128 letters, digits, "-" or "_", so a UUID fits and the id is safe in a URL path. */
const opaqueId = /^[A-Za-z0-9_-]{1,128}$/;

const isDocumentId = (value: string): value is DocumentId => opaqueId.test(value);
const isOperationId = (value: string): value is OperationId => opaqueId.test(value);

export const DocumentIdSchema = z
  .string()
  .refine(isDocumentId, "A document id is 1 to 128 letters, digits, hyphens or underscores.");

export const OperationIdSchema = z
  .string()
  .refine(isOperationId, "An operation id is 1 to 128 letters, digits, hyphens or underscores.");
