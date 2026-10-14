import type { OptWeights, OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import type { GradeTotals } from "@/lib/grades-history/types";
import type { Seats } from "@/lib/sections/model";

/** Kinds of reason a schedule can carry. */
export type ReasonKind =
  | "preference-met"
  | "trade-off"
  | "comparison"
  | "fact"
  | "grade-history"
  | "travel-unknown"
  | "seats";

/** A key into the student's preference weights. */
export type StatedPreference = keyof OptWeights;

export type EvidenceNumber = { label: string; value: number | string };

export type ReasonEvidence = {
  /**
   * The exact numbers the sentence rests on, each labeled, in the units the
   * sentence quotes plus the optimizer's own units. A reason with no numbers
   * is a claim without evidence and must not be emitted.
   */
  numbers: EvidenceNumber[];
};

export type Reason = {
  /** One plain sentence for the student. One fact per reason: no semicolons. */
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
  /** The request the schedules came from: courses, sections, and the student's weights. */
  request: OptimizeRequest;
  /** Section id -> seat facts. Absent entries mean nothing is known; no seats reason is made from them. */
  seats?: Readonly<Record<string, Seats>>;
  /**
   * Section id -> the chosen instructor's grade totals for that course,
   * summed over their past sections, from untgrades.app. Absent entries are
   * skipped. Per-instructor totals can differ between alternatives; a
   * course-level history could not explain a choice.
   */
  instructorGradeHistory?: Readonly<Record<string, GradeTotals>>;
  /** Most reasons to return; default 3. */
  maxReasons?: number;
};
