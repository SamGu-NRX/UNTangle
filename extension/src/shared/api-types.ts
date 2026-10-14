/**
 * Type-only re-exports of the frontend's API response types. Importing them
 * from the frontend sources (instead of redeclaring them) means contract
 * drift between the app and the extension breaks the typecheck. None of these
 * reach the bundle: `import type` is erased, so the extension never ships
 * frontend runtime code.
 */
export type {
  CourseSections,
  RealCourseSections,
  SampleCourseSections,
  Section,
  LinkedComponent,
  Meeting,
  Day,
  DateRange,
  Instructor,
  SectionStatus,
} from "../../../frontend/src/lib/sections/model";
export type { ClassNumberMatch } from "../../../frontend/src/lib/sections/proxy";
export type {
  HistoryResult,
  GradeSearch,
  InstructorHistory,
  CourseHistory,
  HistorySection,
  GradeTotals,
  InstructorIdentity,
  UnavailableReason,
} from "../../../frontend/src/lib/grades-history/types";
export type { PlannerState } from "../../../frontend/src/lib/types";
export type { GradeData } from "../../../frontend/src/lib/grades";
export type { Candidate, MatchResult } from "../../../frontend/src/lib/instructors/match";
