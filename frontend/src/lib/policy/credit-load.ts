/**
 * Official UNT credit-load thresholds, held as sourced data.
 *
 * The credit-load meter needs to know where a student's hours sit against
 * the university's official rules: part-time, full-time at the normal load,
 * heavy but permitted, permitted only with approval, or past what the
 * catalog allows. This module is that policy, kept separate from the
 * parser so a threshold change is a data edit with a paper trail, not a
 * condition buried in logic.
 *
 * Every number carries the unt.edu page it came from, the sentence that
 * states it, and the date the page was retrieved. The contract test in
 * `frontend/tests/policy/credit-load.test.ts` walks every threshold in
 * this module and fails if any of them loses its source, so a future
 * editor cannot quietly add an unsourced number.
 *
 * Sources (retrieved 2026-10-14):
 *
 * - Student Load, 2026-2027 Undergraduate Catalog (catalog.unt.edu):
 *   https://catalog.unt.edu/content.php?catoid=37&navoid=4280
 * - Enrollment Certification, Undergraduate section (catalog.unt.edu):
 *   https://catalog.unt.edu/content.php?catoid=36&navoid=4059
 */

/** A term the credit-load rules distinguish. */
export type Term = "fall" | "spring" | "summer";

/**
 * The zones the credit-load meter renders, in increasing load. Summer has
 * no approval tier in the catalog, so `needs-approval` never occurs there
 * and hours past the summer maximum map to `exceeds-maximum` instead.
 */
export type CreditLoadZone =
  | "part-time"
  | "full-time"
  | "heavy"
  | "needs-approval"
  | "exceeds-maximum";

/** One sourced numeric rule from the UNT catalog. */
export interface SourcedThreshold {
  readonly value: number;
  readonly sourceUrl: string;
  readonly sourceQuote: string;
  /** ISO date (YYYY-MM-DD) the source page was retrieved. */
  readonly retrievedAt: string;
  /**
   * Enrollment condition the source attaches to this number, such as a
   * GPA bound, or null when the sentence states none. Zone names describe
   * load bands, not permission: `heavy` does not mean every student may
   * enroll at that load, only that no approval tier applies to it.
   */
  readonly condition: string | null;
}

/**
 * How far enrollment may go above the unconditioned maximum. Fall and
 * spring allow up to 21 hours with a 3.000 GPA; the catalog states no
 * approval path for summer, so `none-in-catalog` carries the sentence
 * that governs the summer maximum instead of an invented ceiling.
 */
export type ApprovalCeiling =
  | { readonly kind: "with-approval"; readonly maximum: SourcedThreshold }
  | {
      readonly kind: "none-in-catalog";
      readonly sourceUrl: string;
      readonly sourceQuote: string;
      readonly retrievedAt: string;
    };

/** The thresholds one term's undergraduate credit-load meter needs. */
export interface TermProfile {
  /** Part-time zone is below this. */
  readonly partTimeBelow: SourcedThreshold;
  /** Full-time zone runs up to the normal load, inclusive. */
  readonly fullTimeNormalLoad: SourcedThreshold;
  /** Heavy zone runs up to this ceiling, inclusive. */
  readonly maximumWithoutConditions: SourcedThreshold;
  /** Needs-approval zone and its cap, or the catalog's explicit lack of one. */
  readonly approvalCeiling: ApprovalCeiling;
}

/** Shared retrieval date for every source cited in this module. */
export const RETRIEVED_AT = "2026-10-14";

const STUDENT_LOAD_URL =
  "https://catalog.unt.edu/content.php?catoid=37&navoid=4280";

const CERTIFICATION_URL =
  "https://catalog.unt.edu/content.php?catoid=36&navoid=4059";

const sourced = (
  value: number,
  sourceUrl: string,
  sourceQuote: string,
  condition: string | null = null,
): SourcedThreshold => ({
  value,
  sourceUrl,
  sourceQuote,
  retrievedAt: RETRIEVED_AT,
  condition,
});

// Fall and spring share one rulebook: every catalog sentence covers
// "the fall or spring term/semester", so both terms point at the same
// sourced thresholds.
const fallSpringProfile: TermProfile = {
  partTimeBelow: sourced(
    12,
    CERTIFICATION_URL,
    "Full Time: fall, spring or summer terms/semesters, 12 or more hours.",
  ),
  fullTimeNormalLoad: sourced(
    15,
    STUDENT_LOAD_URL,
    "The normal load for full-time undergraduate students is 15 semester hours for each fall or spring term/semester, or 30 hours for the nine-month academic year.",
  ),
  maximumWithoutConditions: sourced(
    19,
    STUDENT_LOAD_URL,
    "During the fall/spring terms, a full-time undergraduate student with a GPA of less than 3.000 may select multiple sessions for a maximum of 19 semester hours.",
    "GPA of less than 3.000; at 3.000 or above the approval path allows up to 21",
  ),
  approvalCeiling: {
    kind: "with-approval",
    maximum: sourced(
      21,
      STUDENT_LOAD_URL,
      "An undergraduate student with a GPA of at least 3.000 may enroll for a maximum of 21 hours for the fall or spring term/semester by meeting the following conditions",
      "GPA of at least 3.000, plus the three conditions the catalog lists after this sentence",
    ),
  },
};

const summerProfile: TermProfile = {
  partTimeBelow: sourced(
    12,
    CERTIFICATION_URL,
    "Full Time: fall, spring or summer terms/semesters, 12 or more hours.",
  ),
  fullTimeNormalLoad: sourced(
    12,
    STUDENT_LOAD_URL,
    "The normal load for full-time students is 12 hours for the summer term/semester.",
  ),
  maximumWithoutConditions: sourced(
    18,
    STUDENT_LOAD_URL,
    "During the summer term/semester, a full-time undergraduate student with a GPA of more than 3.000 may select multiple sessions for a maximum of 18 semester hours.",
    "GPA of more than 3.000",
  ),
  approvalCeiling: {
    kind: "none-in-catalog",
    sourceUrl: STUDENT_LOAD_URL,
    sourceQuote:
      "During the summer term/semester, a full-time undergraduate student with a GPA of more than 3.000 may select multiple sessions for a maximum of 18 semester hours.",
    retrievedAt: RETRIEVED_AT,
  },
};

/**
 * Undergraduate credit-load profiles, the default for the meter. The
 * summer approval ceiling is deliberately absent: the catalog grants the
 * 21-hour approval path only to "the fall or spring term/semester" and
 * states nothing beyond the summer maximum of 18.
 */
export const UNDERGRADUATE: Record<Term, TermProfile> = {
  fall: fallSpringProfile,
  spring: fallSpringProfile,
  summer: summerProfile,
};

/** The graduate profile's sourced values. Summer carries no sourced maximum, so none is modeled. */
export interface GraduateProfile {
  /** Certification full-time floor: 9 or more hours. */
  readonly fullTimeMinimum: SourcedThreshold;
  /** Fall/spring scheduling maximum. */
  readonly fallSpringMaximum: SourcedThreshold;
}

/**
 * Graduate thresholds the retrieved catalog pages state. Kept separate
 * from `UNDERGRADUATE` so callers opt in explicitly; the undergraduate
 * profile stays the meter's default.
 */
export const GRADUATE: GraduateProfile = {
  fullTimeMinimum: sourced(
    9,
    CERTIFICATION_URL,
    "Full Time: fall, spring or summer terms/semesters, 9 or more hours.",
  ),
  fallSpringMaximum: sourced(
    16,
    STUDENT_LOAD_URL,
    "Graduate students may schedule a maximum of 16 hours during any fall or spring term/semester.",
  ),
};

/**
 * Which zone `hours` of undergraduate credit falls into for `term`.
 *
 * Boundaries derive from the sourced thresholds above, never literals.
 * Total over every `Term`; throws on hours that are not a non-negative
 * finite number rather than silently clamping them into a zone.
 *
 * Zones are load bands, not enrollment permission: the catalog conditions
 * the 19, 18, and 21 hour ceilings on GPA, and this function takes no
 * GPA, so callers must not read `heavy` or `needs-approval` as permitted
 * for every student. The per-threshold `condition` field carries the
 * eligibility wording for UI that needs it.
 */
export function zoneFor(hours: number, term: Term): CreditLoadZone {
  if (!Number.isFinite(hours) || hours < 0) {
    throw new RangeError(
      `credit hours must be a non-negative finite number, got ${hours}`,
    );
  }

  const profile = UNDERGRADUATE[term];
  if (hours < profile.partTimeBelow.value) return "part-time";
  if (hours <= profile.fullTimeNormalLoad.value) return "full-time";
  if (hours <= profile.maximumWithoutConditions.value) return "heavy";

  const ceiling = profile.approvalCeiling;
  if (ceiling.kind === "with-approval") {
    if (hours <= ceiling.maximum.value) return "needs-approval";
    return "exceeds-maximum";
  }
  return "exceeds-maximum";
}
