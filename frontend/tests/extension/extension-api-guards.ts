/**
 * Verbatim copies of the extension client's response guards, from
 * `extension/src/shared/extension-api.ts` on origin/edge at commit
 * 0d8f95948a489c98345bb6b8a38560568e2e5aee (edge head, 2026-10-15). The
 * extension validates every route response with isPreview and isAddReply, so
 * the route tests feed actual route responses through them: anything the
 * guards reject would break the panel.
 *
 * isSectionRef is omitted (it needs the config's TERM_PATTERN and
 * CLASS_NUMBER_PATTERN and no response guard uses it). isAddReply's reason
 * union is the edge client's as of that commit: the "operation-reused"
 * rejection this branch adds extends the contract, so the reused-operation
 * test asserts that reply by exact shape and documents the guard gap until
 * the client learns the new reason.
 */

export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const isId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x);
export const isRevision = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
const isText = (x: unknown, max: number): x is string => typeof x === "string" && x.length > 0 && x.length <= max;
const isNullableText = (x: unknown, max: number) => x === null || isText(x, max);
const isList = (x: unknown, max: number, item: (value: unknown) => boolean) => Array.isArray(x) && x.length <= max && x.every(item);
const isMeeting = (x: unknown) => isRecord(x) && isText(x.days, 40) && isNullableText(x.time, 40) && isNullableText(x.room, 40);
const isClash = (x: unknown) => isRecord(x) && (x.kind === "course" || x.kind === "busy") && isText(x.name, 80) && isText(x.when, 80);
function isGrades(x: unknown): boolean {
  if (!isRecord(x) || !isText(x.source, 120))
    return false;
  if (x.status === "history")
    return isText(x.instructor, 120) && (x.averageGpa === null || (typeof x.averageGpa === "number" && x.averageGpa >= 0 && x.averageGpa <= 4)) && typeof x.students === "number" && Number.isSafeInteger(x.students) && x.students >= 0 && isNullableText(x.terms, 60);
  return (x.status === "none" || x.status === "unavailable") && isNullableText(x.instructor, 120);
}
/** Absent fields are fine; a present one must be well formed, or the whole preview is rejected. */
function hasValidLayoutFields(x: Record<string, unknown>): boolean {
  return (x.courseTitle === undefined || isText(x.courseTitle, 160))
    && (x.section === undefined || isText(x.section, 12))
    && (x.meetings === undefined || isList(x.meetings, 8, isMeeting))
    && (x.clashes === undefined || isList(x.clashes, 12, isClash))
    && (x.unknownReason === undefined || x.unknownReason === "no-set-time" || x.unknownReason === "schedule-time-missing" || x.unknownReason === "schedule-unavailable")
    && (x.grades === undefined || isGrades(x.grades))
    && (x.inSchedule === undefined || typeof x.inSchedule === "boolean");
}
export function isPreview(x: unknown): x is Preview {
  return isRecord(x) && isId(x.scheduleId) && isId(x.optionId) && isRevision(x.revision) && typeof x.title === "string" && x.title.length <= 160 && (x.conflict === "clear" || x.conflict === "conflict" || x.conflict === "unknown") && Array.isArray(x.details) && x.details.length <= 30 && x.details.every(s => typeof s === "string" && s.length <= 500) && hasValidLayoutFields(x);
}
export function isAddReply(x: unknown): x is AddReply {
  if (!isRecord(x) || !isId(x.operationId))
    return false;
  return x.kind === "receipt" ? isRevision(x.committedRevision) : x.kind === "rejection" && (x.reason === "stale-revision" || x.reason === "not-found" || x.reason === "forbidden");
}

type PreviewMeeting = {
  days: string;
  time: string | null;
  room: string | null;
};
type PreviewClash = {
  kind: "course" | "busy";
  name: string;
  when: string;
};
type PreviewGrades = {
  status: "history";
  instructor: string;
  averageGpa: number | null;
  students: number;
  source: string;
  terms: string | null;
} | {
  status: "none" | "unavailable";
  instructor: string | null;
  source: string;
};
interface Preview {
  scheduleId: string;
  optionId: string;
  revision: number;
  title: string;
  conflict: "conflict" | "clear" | "unknown";
  details: string[];
  courseTitle?: string;
  section?: string;
  meetings?: PreviewMeeting[];
  clashes?: PreviewClash[];
  unknownReason?: "no-set-time" | "schedule-time-missing" | "schedule-unavailable";
  grades?: PreviewGrades;
  inSchedule?: boolean;
}
type AddReply = {
  kind: "receipt";
  operationId: string;
  committedRevision: number;
} | {
  kind: "rejection";
  operationId: string;
  reason: "stale-revision" | "not-found" | "forbidden";
};
