/**
 * Each section's final exam, from UNT's published rule.
 *
 * The rule is the registrar's final-exam page, parsed by
 * packages/ingest/src/exam-schedule.ts into lib/generated/unt-final-exams.ts
 * and applied by `examFor` in @untangle/core/final-exams: a class's final
 * follows from its first meeting day and earliest start, per campus and
 * session.
 *
 * On 2026-10-16 UNT had not published Spring 2027 finals, so the newest
 * rule, Fall 2026's, is used and its dates are moved into Spring 2027's
 * finals week by weekday (Fall's Monday final lands on Spring's Monday).
 * Every such final is `projected`, and the page says so once. UNT changed
 * its grid between Spring 2026 and Fall 2026, so a projected time can be
 * wrong; the rule is recaptured when Spring 2027's page is out
 * (packages/ingest/tests/fixtures/unt-exams/SOURCES.md).
 *
 * A section the rule doesn't place gets an `unknown` answer with the reason.
 * Auto checks only known finals, so Week names the unknown ones instead of
 * letting them pass as clash-free.
 */
import { examFor, inWeek, moveToWeek, type ExamClass, type ExamDay, type ExamSlot, type ExamUnknownReason } from "@untangle/core/final-exams";
import { UNT_FINAL_EXAMS } from "@/lib/generated/unt-final-exams";
import { DISCOVERY_PARK_ID, isTimed, otherSiteOf, planningTerm } from "@/lib/planner-sections";
import type { Section } from "@/lib/sections";
import { fullSession, getTermCalendar, type SessionKind } from "@/lib/terms";

export type { ExamSlot } from "@untangle/core/final-exams";

/**
 * - sample: a made-up section has no final.
 * - unpublished: the class's session has finals outside finals week (first
 *   eight weeks), whose day UNT hasn't set for Spring 2027.
 */
export type SectionExamUnknown = ExamUnknownReason | "sample" | "unpublished";

export type SectionExam = { kind: "known"; exam: ExamSlot; projected: boolean } | { kind: "unknown"; reason: SectionExamUnknown };

/** The first day of the planning term's finals week, from the registrar's calendar (lib/terms). */
const planningWeekStart = (() => {
  const finals = fullSession(planningTerm.label).finalExams;
  if (!finals) throw new Error(`lib/terms has no finals week for ${planningTerm.label}`);
  return finals.begin;
})();

/** Whether the rule is another term's, moved into the planning term's finals week. */
const projected = UNT_FINAL_EXAMS.term !== planningTerm.label;
/** The first day of the rule's own finals week: its earliest full-term final. */
const sourceWeekStart = UNT_FINAL_EXAMS.grid
  .filter((row) => row.session === "full")
  .map((row) => row.exam.date)
  .sort()[0];

/** Where the finals come from, for the one line that says so. */
export const FINALS_SOURCE = {
  /** "Fall 2026" */
  term: UNT_FINAL_EXAMS.term,
  planningTerm: planningTerm.label,
  projected,
  url: UNT_FINAL_EXAMS.sourceUrl,
  capturedAt: UNT_FINAL_EXAMS.capturedAt,
} as const;

/** The planning term's sessions, from the registrar's calendar (lib/terms). */
const planningSessions = getTermCalendar(planningTerm.label)?.sessions ?? [];
const KINDS: Partial<Record<SessionKind, ExamClass["session"]>> = { full: "full", "8w1": "8w1", "8w2": "8w2" };
/** vsb's session labels, for a section whose dates match no calendar session. */
const LABELS: Record<string, ExamClass["session"]> = {
  "Regular Academic Session": "full",
  "Eight Week - First": "8w1",
  "Eight Week - Second": "8w2",
};

/**
 * Which of the rule's sessions a section is in. Its dates decide when they
 * are a session of the calendar (01/11 to 03/05 is the first eight weeks,
 * whatever the label says), and its vsb label otherwise.
 */
function sessionOf(section: Section): ExamClass["session"] {
  const { start, end } = section.session.dates;
  const match = planningSessions.find((session) => session.classesBegin === start && session.sessionEnd === end);
  if (match) return KINDS[match.kind] ?? "other";
  return LABELS[section.session.label] ?? "other";
}

/** What the rule reads from a section: its primary component's timed meetings, its session and its site. */
function examClassOf(section: Section): ExamClass {
  const primary = section.components.find((component) => component.role === "primary");
  const meetings = (primary?.meetings ?? section.meetings).filter(isTimed);
  return {
    courseCode: section.courseCode,
    session: sessionOf(section),
    campus: otherSiteOf(section) !== null ? "other" : meetings.some((meeting) => meeting.buildingId === DISCOVERY_PARK_ID) ? "discovery-park" : "main",
    meetings: meetings.map((meeting) => ({ day: meeting.day as ExamDay, start: meeting.startMinutes })),
  };
}

const cache = new WeakMap<Section, SectionExam>();

/** The section's final in the planning term, or why it isn't known. */
export function examOf(section: Section): SectionExam {
  const cached = cache.get(section);
  if (cached) return cached;
  const answer = examAnswer(section);
  cache.set(section, answer);
  return answer;
}

function examAnswer(section: Section): SectionExam {
  if (section.term === null) return { kind: "unknown", reason: "sample" };
  const answer = examFor(examClassOf(section), UNT_FINAL_EXAMS);
  if (answer.kind === "unknown") return answer;
  if (!projected) return { kind: "known", exam: answer.exam, projected: false };
  // A first eight-week final sits weeks before finals week; its Spring 2027 day can't be read off Fall's.
  if (!inWeek(answer.exam, sourceWeekStart)) return { kind: "unknown", reason: "unpublished" };
  return { kind: "known", exam: moveToWeek(answer.exam, sourceWeekStart, planningWeekStart), projected: true };
}

/** Why a section has no known final, as one sentence. */
export function unknownExamSentence(section: Section, reason: SectionExamUnknown): string {
  switch (reason) {
    case "sample":
      return "This sample section is made up, so it has no final.";
    case "no-set-time":
      // A hybrid section can have a timed lab under an online lecture with no set time.
      return section.meetings.some(isTimed)
        ? "Its online part has no set time, so the syllabus sets the final."
        : "It has no set meeting time, so the syllabus sets the final.";
    case "other-site":
      return `${otherSiteOf(section) ?? "Its site"} lists its own finals, and UNTangle doesn't read that list yet.`;
    case "unpublished":
      return `First eight-week finals fall on one day UNT hasn't set for ${planningTerm.label}.`;
    case "session":
      return `UNT's exam schedule has no rule for its session (${section.session.label}).`;
    case "no-rule":
      return "UNT's exam schedule has no row for its days and start time.";
  }
}
