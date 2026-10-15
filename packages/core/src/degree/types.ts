/**
 * The requirements tree the UNT catalog pages turn into, and the shapes the
 * pure audit in this package reads.
 *
 * Every node carries a citation: the saved catalog page it came from, the
 * page URL, the heading anchor on that page, and the heading text. A value
 * with no citation must not exist in this tree.
 *
 * The parser that builds these trees lives in packages/ingest; it imports
 * these types across the package boundary so the shapes cannot drift.
 */

/** Where a requirement's wording lives. */
export type Citation = {
  /** Saved page file name under packages/ingest/data/catalog/unt-2026-27/. */
  page: string;
  url: string;
  /** The catalog's own anchor id on that page, when the heading has one. */
  anchor: string | null;
  heading: string;
};

/**
 * One option the catalog lists: every course in `must` is required together —
 * a lecture with the lab the catalog pairs it with, for example.
 */
export type OptionGroup = {
  must: string[];
};

/**
 * One slot in an all-requirements node: the alternatives are the catalog's
 * "A or B" choices; completing any one alternative satisfies the slot.
 */
export type CourseSlot = {
  alternatives: OptionGroup[];
};

type Base = { name: string; citation: Citation };

/** Courses every student must complete; each slot is one course or its listed alternatives. */
export type AllNode = Base & { kind: "all"; items: CourseSlot[] };

/** Complete exactly `count` option groups (a lecture-plus-lab pair is one). */
export type ChooseNode = Base & { kind: "choose"; count: number; options: OptionGroup[] };

/** `hours` credit hours from the listed option groups. */
export type HoursNode = Base & { kind: "hours"; hours: number; options: OptionGroup[] };

/** `hours` credit hours matching a level/subject rule, e.g. any 4000-level TECM course. */
export type PoolNode = Base & {
  kind: "pool";
  hours: number;
  match: { subjects: string[] | null; minLevel: number | null; maxLevel: number | null };
  /** Set when the authoritative course list lives on a page we did not capture. */
  note?: string;
};

/** Student picks one branch. */
export type ChoiceNode = Base & {
  kind: "choice";
  branches: { name: string; node: RequirementNode }[];
};

/** All children required. */
export type GroupNode = Base & { kind: "group"; children: RequirementNode[] };

/**
 * The typed course filter a grade or GPA policy applies to, parsed at ingest
 * from the catalog's scope wording. A policy without a resolvable filter
 * reports unverifiable — the audit never guesses a scope.
 */
export type CourseScope =
  | { kind: "overall" }
  | { kind: "unt" }
  /** Courses the audit applied toward the major, plus completed pool matches. */
  | { kind: "major" }
  /** An explicit course set: one core area's list, or a program's foundation subtree. */
  | { kind: "codes"; codes: string[] }
  /** A subject/level rule, e.g. mathematics courses numbered 3350 or above. */
  | { kind: "subjectLevel"; subjects: string[]; minLevel: number | null };

export type Policy =
  | { type: "totalHours"; hours: number; courseScope?: CourseScope }
  | { type: "advancedHours"; hours: number }
  | { type: "residencyPercent"; percent: number }
  | { type: "advancedHoursAtUnt"; hours: number }
  | { type: "subjectHours"; hours: number; subjects: string[] }
  | { type: "minGrade"; grade: string; scope: string; courseScope?: CourseScope }
  | { type: "gpa"; minimum: number; scope: string; courseScope?: CourseScope }
  /** A rule the audit cannot measure; shown, never silently dropped. */
  | { type: "note" };

export type PolicyNode = Base & { kind: "policy"; policy: Policy; quote: string };

/** A catalog passage the parser cannot encode structurally. Kept verbatim, cited, untracked. */
export type NoteNode = Base & { kind: "note"; text: string };

export type RequirementNode = AllNode | ChooseNode | HoursNode | PoolNode | ChoiceNode | GroupNode | PolicyNode | NoteNode;

/** A program's requirement tree as the parser builds it. */
export type ProgramData = {
  id: string;
  name: string;
  catalogId: string;
  sourceUrl: string;
  requirements: RequirementNode[];
  /**
   * Courses that may count toward both a core area and the major: the
   * intersection of the core course lists and the program's own lists,
   * computed from the two captured pages.
   */
  coreSharedCourses: string[];
  /**
   * True for the core program: the catalog's double-dip rule counts each
   * course toward at most one core area, so the audit allocates courses to
   * nodes in tree order (areas claim theirs before the Component Area
   * Option choice reads what is left) instead of every node reading the
   * full record independently.
   */
  oneCourseOneArea?: boolean;
};

/** The built dataset: the captured-page manifest plus the programs. */
export type DegreeData = {
  catalogId: string;
  catalogYear: string;
  builtAt: string;
  pages: { file: string; url: string; title: string; capturedAt: string; sha256: string }[];
  programs: ProgramData[];
};
