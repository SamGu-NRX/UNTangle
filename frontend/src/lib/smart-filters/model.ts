import type { Day } from "@/lib/sections/model";
import type { UnavailableReason } from "@/lib/grades-history/types";

/** Where a section's meetings are, as far as the section data proves. */
export type Campus = "denton" | "off-campus" | "online";

/**
 * What kind of meetings a section holds: "online" when every meeting is
 * online, "in-person" when at least one meeting has a real room, "unknown"
 * when no meeting places the section either way (all rooms unassigned or
 * time and place TBA).
 */
export type Modality = "online" | "in-person" | "unknown";

/** The two modalities a filter can ask for; "unknown" matches neither. */
export type ModalityChoice = "online" | "in-person";

/** The section facts the filters query, derived once per section. */
export type SectionFacts = {
  /** Stated meeting days, deduped and in week order. Async and TBA meetings add none. */
  days: Day[];
  /** Earliest stated start across meetings, or null when no meeting states a time. */
  earliestStart: number | null;
  /** Latest stated end across meetings, or null when no meeting states a time. */
  latestEnd: number | null;
  modality: Modality;
  /** Campus facts across the section's meetings; a hybrid section lists several. */
  campuses: Campus[];
};

/** One filter over section facts. Several filters combine with AND. */
export type SmartFilter =
  | { kind: "open-seats"; minimum: number }
  | { kind: "meeting-days"; days: readonly Day[] }
  | { kind: "time-window"; startMinutes: number; endMinutes: number }
  | { kind: "modality"; modality: ModalityChoice }
  | { kind: "campus"; campus: Campus };

/**
 * Grade facts joined onto one section through the abstain-first instructor
 * matcher. "no-history" covers both a course the source has no history for
 * and a matcher abstention: neither state ever carries a figure.
 */
export type SectionGradeFacts =
  | {
      kind: "matched";
      /** The matched grade-history identity id (the JSON name pair). */
      instructorId: string;
      /** Graded sections (at least one A-F enrollment) for this instructor in this course. */
      gradedSections: number;
      /** A-F enrollments across those sections. */
      gradedEnrollments: number;
      /** A-F weighted mean over the instructor's graded enrollments in this course. */
      avgGpa: number;
      /** Share of graded enrollments earning an A or B, from 0 to 1. */
      abShare: number;
    }
  | {
      kind: "insufficient-data";
      /** The matched identity, so the caller can see who the figures are withheld for. */
      instructorId: string;
      gradedSections: number;
      gradedEnrollments: number;
    }
  | { kind: "no-history"; reason: string };

/** Why a course's grade history could not be read for this response. */
export type HistoryUnavailableReason = UnavailableReason | "not-attempted";

/** One section's grade facts as the route reports them: a join outcome, or the history could not be read at all. */
export type GradeFactsResult =
  | SectionGradeFacts
  | { kind: "unavailable"; reason: HistoryUnavailableReason; message: string; retryAfterSeconds?: number };
