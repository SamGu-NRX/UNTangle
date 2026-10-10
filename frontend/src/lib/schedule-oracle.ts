/**
 * Independent schedule oracle.
 *
 * Deliberately dumb, brute-force reference implementation of two schedule
 * questions, written from scratch so it shares no code, no helpers and no
 * policy with the planner:
 *
 *   1. total credits  = sum of the credit hours of every selected section's course
 *   2. conflicts      = naive pairwise overlap check on (day, start, end) minutes
 *
 * Deliberate limits (documented in docs/schedule-oracle-report.md):
 *   - No university-grade or prerequisite policy is modeled.
 *   - Adjacent meetings (one ends exactly when the other starts) are NOT
 *     conflicts: the intervals are treated as half-open [start, end).
 *
 * The file imports nothing. Types are structural, so the planner's own
 * section/meeting objects can be passed in directly for comparison.
 */

export type OracleMeeting = {
  day: string;
  start: string;
  end: string;
};

export type OracleSection = {
  id: string;
  courseCode: string;
  meetings: OracleMeeting[];
};

export type OracleConflictPair = {
  left: number;
  right: number;
};

/** "HH:MM" -> minutes since midnight. No validation on purpose: the oracle assumes well-formed catalog times. */
export function oracleTimeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/** Naive interval overlap on half-open [start, end) intervals within the same day. */
export function oracleMeetingsOverlap(a: OracleMeeting, b: OracleMeeting): boolean {
  if (a.day !== b.day) {
    return false;
  }
  const aStart = oracleTimeToMinutes(a.start);
  const aEnd = oracleTimeToMinutes(a.end);
  const bStart = oracleTimeToMinutes(b.start);
  const bEnd = oracleTimeToMinutes(b.end);
  return Math.max(aStart, bStart) < Math.min(aEnd, bEnd);
}

/** Two sections conflict if ANY of their meetings overlap. */
export function oracleSectionsOverlap(a: OracleSection, b: OracleSection): boolean {
  for (const aMeeting of a.meetings) {
    for (const bMeeting of b.meetings) {
      if (oracleMeetingsOverlap(aMeeting, bMeeting)) {
        return true;
      }
    }
  }
  return false;
}

/** Brute force: every unordered pair of selected sections, checked against every meeting combination. */
export function oracleConflictingPairs(selectedSections: OracleSection[]): OracleConflictPair[] {
  const pairs: OracleConflictPair[] = [];
  for (let left = 0; left < selectedSections.length; left += 1) {
    for (let right = left + 1; right < selectedSections.length; right += 1) {
      if (oracleSectionsOverlap(selectedSections[left], selectedSections[right])) {
        pairs.push({ left, right });
      }
    }
  }
  return pairs;
}

/**
 * Total credits = sum, per selected section, of the credit hours of that
 * section's course. Courses missing from the map contribute 0 (the oracle
 * does not model credit policy beyond this sum).
 */
export function oracleTotalCredits(
  selectedSections: OracleSection[],
  creditHoursByCourseCode: Record<string, number>,
): number {
  let total = 0;
  for (const section of selectedSections) {
    total += creditHoursByCourseCode[section.courseCode] ?? 0;
  }
  return total;
}
