import { CLASS_NUMBER_PATTERN, TERM_PATTERN } from "../config";
export interface SectionRef {
  term: string;
  classNumber: string;
}
/** One meeting pattern, already worded: days "Mon Wed Fri", time "9:00 to 9:50 AM" or null for no set time. */
export interface PreviewMeeting {
  days: string;
  time: string | null;
  room: string | null;
}
/** What the section overlaps in Main: a course by its code, or a busy time by its private label. */
export interface PreviewClash {
  kind: "course" | "busy";
  name: string;
  when: string;
}
export type PreviewGrades = {
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
export type UnknownReason = "no-set-time" | "schedule-time-missing" | "schedule-unavailable";
export interface Preview {
  scheduleId: string;
  optionId: string;
  revision: number;
  /** The course code, "CSCE 1030". */
  title: string;
  conflict: "conflict" | "clear" | "unknown";
  details: string[];
  // The panel's course-detail layout reads these when the server sends them.
  // Each is optional so a preview without them still renders, from details.
  courseTitle?: string;
  section?: string;
  meetings?: PreviewMeeting[];
  clashes?: PreviewClash[];
  unknownReason?: UnknownReason;
  grades?: PreviewGrades;
  /** The section is already in Main. */
  inSchedule?: boolean;
}
export interface AddOptionCommand {
  command: "add-option";
  operationId: string;
  scheduleId: string;
  optionId: string;
  expectedRevision: number;
}
export type AddReply = {
  kind: "receipt";
  operationId: string;
  committedRevision: number;
} | {
  kind: "rejection";
  operationId: string;
  reason: "stale-revision" | "not-found" | "forbidden";
};
export interface DeviceGrant {
  accessToken: string;
  grantId: string;
  accountId: string;
  expiresAt: number;
}
export const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
export const isId = (x: unknown): x is string => typeof x === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(x);
export const isRevision = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0;
export function isSectionRef(x: unknown): x is SectionRef {
  return isRecord(x) && Object.keys(x).length === 2 && typeof x.term === "string" && TERM_PATTERN.test(x.term) && typeof x.classNumber === "string" && CLASS_NUMBER_PATTERN.test(x.classNumber);
}
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
export function isGrant(x: unknown): x is DeviceGrant {
  return isRecord(x) && typeof x.accessToken === "string" && /^[A-Za-z0-9._~-]{1,4096}$/.test(x.accessToken) && isId(x.grantId) && isId(x.accountId) && typeof x.expiresAt === "number" && Number.isFinite(x.expiresAt);
}
export function isCommand(x: unknown): x is AddOptionCommand {
  return isRecord(x) && Object.keys(x).length === 5 && x.command === "add-option" && isId(x.operationId) && isId(x.scheduleId) && isId(x.optionId) && isRevision(x.expectedRevision);
}
export function isAddReply(x: unknown): x is AddReply {
  if (!isRecord(x) || !isId(x.operationId))
    return false;
  return x.kind === "receipt" ? isRevision(x.committedRevision) : x.kind === "rejection" && (x.reason === "stale-revision" || x.reason === "not-found" || x.reason === "forbidden");
}
