import type { OptWeights, OptimizeRequest, RankedSchedule } from "@/lib/optimizer/types";
import type { CourseHistory } from "@/lib/grades-history/types";

/** Kinds of reason a schedule can carry. */
export type ReasonKind = "preference-met" | "trade-off" | "comparison" | "grade-history" | "walking" | "seats";

/** A key into the student's preference weights. */
export type StatedPreference = keyof OptWeights;

export type EvidenceNumber = { label: string; value: number | string };

export type ReasonEvidence = {
  /**
   * The exact numbers the sentence rests on, each labeled. A reason with no
   * numbers is a claim without evidence and must not be emitted.
   */
  numbers: EvidenceNumber[];
  /** Where each number came from. */
  facts: string[];
};

export type Reason = {
  /** One plain sentence for the student. */
  sentence: string;
  kind: ReasonKind;
  /** The stated preference this rests on; null when none does. */
  preference: StatedPreference | null;
  /** 0..1; higher-strength reasons come first. */
  strength: number;
  evidence: ReasonEvidence;
};

/**
 * Seat facts for one section, structurally the same as `Seats` in
 * `lib/sections/model.ts`, so either can be passed in. Null means unknown,
 * and an unknown is never treated as a number.
 */
export type SectionSeats = { open: number | null; total: number | null };

export type ScheduleReasonsInput = {
  /** The schedule being explained: one of `alternatives`. */
  schedule: RankedSchedule;
  /** The optimizer's actual alternatives, in rank order, including `schedule`. */
  alternatives: readonly RankedSchedule[];
  /** The request the schedules came from: courses, sections, and the student's weights. */
  request: OptimizeRequest;
  /** Section id -> seat facts. Absent entries mean nothing is known; no seats reason is made from them. */
  seats?: Readonly<Record<string, SectionSeats>>;
  /** Course code -> grade history from untgrades.app. Absent entries are skipped. */
  gradeHistory?: Readonly<Record<string, CourseHistory>>;
  /** Most reasons to return; default 3. */
  maxReasons?: number;
};
