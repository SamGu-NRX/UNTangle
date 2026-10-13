import type { GradeData } from "@/lib/grades";

export type GradeCounts = Record<string, number>;
export type CourseIdentity = { subject: string; number: string; title: string };
export type InstructorIdentity = { id: string; firstName: string; lastName: string; name: string };
export type GradeTotals = { counts: GradeCounts; total: number; grades: GradeData };
export type HistorySection = GradeTotals & { sectionNumber: string; instructor: InstructorIdentity };
export type HistoryTerm = GradeTotals & { year: string; term: string; sections: HistorySection[] };
export type CourseHistory = GradeTotals & { course: CourseIdentity; terms: HistoryTerm[]; sectionCount: number; gpa: number | null };
export type InstructorHistory = GradeTotals & { instructor: InstructorIdentity; courses: CourseHistory[] };
export type GradeSearch = { courses: CourseIdentity[]; instructors: InstructorIdentity[] };
export type UnavailableReason = "throttled" | "upstream" | "malformed" | "storage" | "invalid-request";
export type HistoryResult<T> =
  | { status: "ok"; source: "untgrades.app"; data: T }
  | { status: "no-history"; source: "untgrades.app"; data: null }
  | { status: "unavailable"; source: "untgrades.app"; data: null; error: { reason: UnavailableReason; message: string; retryAfterSeconds?: number } };
