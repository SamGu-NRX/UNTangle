export type CourseId = string;

export type Prerequisite = {
  source: string;
  /** An alternative admission route blocks closure for this requirement and its descendants. */
  escape?: "equivalent" | "replacement" | "consent";
} & (
  | { kind: "course"; courseId: CourseId }
  | { kind: "and" | "or"; children: readonly Prerequisite[] }
  | { kind: "consent"; authority: string }
  | { kind: "standing"; minimum: string }
  | { kind: "corequisite"; requirement: Prerequisite }
  | { kind: "minGrade"; grade: string; requirement: Prerequisite }
  // A major condition cannot waive independent clauses or supply closure facts.
  | { kind: "unknown"; detail: string; scope?: "clause" }
);

export type ParseResult = {
  source: string;
  expression: Prerequisite;
  coverage: "full" | "partial" | "unknown";
  annotations: readonly string[];
};

export type CatalogCourse = {
  id: CourseId;
  credits: number;
  prerequisite: Prerequisite;
};

/** Grade and standing policy belong to the school, not the evaluator. */
export interface SchoolAdapter {
  isPassingGrade(grade: string): boolean | undefined;
  meetsMinimumGrade(actual: string, minimum: string): boolean | undefined;
  meetsStanding(actual: string, minimum: string): boolean | undefined;
  /** Hour threshold for a standing label or adapter-defined credit requirement. */
  minimumHours?(minimum: string): number | undefined;
}

export type Completion = { courseId: CourseId; grade: string; source?: string; credits?: number | null };
export type CourseStatus = "done" | "taking" | "eligible" | "locked" | "unknown";
export type Override = { status: CourseStatus; reason: string; grade?: string };
export type Evidence = {
  transcript?: readonly Completion[];
  inProgress?: readonly CourseId[];
  planned?: readonly CourseId[];
  needsReview?: readonly CourseId[];
  overrides?: ReadonlyMap<CourseId, Override>;
  standing?: string;
  earnedHours?: number;
};

export type Reason = {
  kind: "course" | "grade" | "standing" | "advisor" | "and" | "or" |
    "corequisite" | "closure" | "transcript" | "inProgress" | "override" | "cycle";
  outcome: "satisfied" | "unmet" | "unknown";
  message: string;
  courseId?: CourseId;
  source?: string;
  children?: readonly Reason[];
};

export type CourseAssessment = { courseId: CourseId; status: CourseStatus; reason: Reason };
export type InferenceResult = {
  statuses: ReadonlyMap<CourseId, CourseAssessment>;
  /** Strongly connected components. Evidence may still resolve a reported cycle. */
  cycles: readonly (readonly CourseId[])[];
  catalog: readonly CatalogCourse[];
  /**
   * Courses satisfied only through closure: covered course id -> the passed
   * course whose mandatory requirements prove it (the first such course the
   * closure walk expands, in id order). A covered course gains no credit and
   * keeps its own status; other rules treat it as met. Built by the same walk
   * that supplies closure facts, so escape routes and whole-rule barriers
   * apply to it unchanged.
   */
  coverage: ReadonlyMap<CourseId, CourseId>;
};

export type Major = { coreCourseCodes: readonly CourseId[] };
export type Suggestion = {
  courseId: CourseId;
  credits: number;
  downstream: readonly CourseId[];
  score: number;
  reasons: readonly string[];
};
export type SuggestionScorer = (course: CatalogCourse, status: CourseAssessment) => number;
