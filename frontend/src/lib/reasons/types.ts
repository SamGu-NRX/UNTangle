import type { OptWeights, OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import type { CourseHistory } from "@/lib/grades-history/types";
import type { Section } from "@/lib/sections/model";

/**
 * - comparison: better than the next option on a stated preference.
 * - trade-off: worse than the next option on a stated preference.
 * - preference-met: no option does better on a stated preference.
 * - fact: this option alone, on a stated preference.
 * - grade-history: the chosen instructor's past grades.
 * - seats: a chosen section is closed, wait-listed, cancelled or full.
 */
export type ReasonKind = "comparison" | "trade-off" | "preference-met" | "fact" | "grade-history" | "seats";

/** A key into the student's preference weights. */
export type StatedPreference = keyof OptWeights;

export type EvidenceNumber = { label: string; value: number | string };

export type ReasonEvidence = {
  /** The numbers the sentence rests on, each labeled. A reason with none must not be emitted. */
  numbers: EvidenceNumber[];
};

export type Reason = {
  /** One plain sentence for the student, carrying one fact. */
  sentence: string;
  kind: ReasonKind;
  /** The stated preference this rests on; null when none does. */
  preference: StatedPreference | null;
  evidence: ReasonEvidence;
};

export type ScheduleReasonsInput = {
  /** The optimizer's actual alternatives, in rank order. */
  alternatives: readonly RankedSchedule[];
  /** Which of the alternatives is being explained. */
  index: number;
  /** The exact request the alternatives came from, `walkingTime` included. Store it with the results; do not rebuild it. */
  request: OptimizeRequest;
  /** Section id -> the catalog section's status and seats. Sections without an entry get no seat warning. */
  seats?: Readonly<Record<string, Pick<Section, "status" | "components">>>;
  /**
   * Section id -> the chosen instructor's history for that section's course:
   * the matching entry of `InstructorHistory.courses`. Sections without an
   * entry are skipped.
   */
  instructorGradeHistory?: Readonly<Record<string, CourseHistory>>;
  /** Most preference and grade reasons to return; default 3. Seat warnings come on top of these. */
  maxReasons?: number;
};
