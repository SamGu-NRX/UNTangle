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
export type DeviceScopeName = "schedule:read" | "schedule:add-option";
export const DEVICE_SCOPES: readonly DeviceScopeName[] = ["schedule:read", "schedule:add-option"];
/** A token pair exactly as the server sends it, per the contract's deviceTokenResponse. */
export interface DeviceTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  scopes: DeviceScopeName[];
  grantId: string;
}
/**
 * The pair as the worker keeps it in chrome.storage.local (trusted contexts
 * only): the grant's own identity, the schedule it may read, and the access
 * token's expiry computed from expiresIn when the pair was saved.
 */
export interface StoredGrant {
  grantId: string;
  accessToken: string;
  refreshToken: string;
  scopes: DeviceScopeName[];
  scheduleId: string;
  accessExpiresAt: number;
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
// Opaque tokens from the contract are 43-character base64url strings.
const OPAQUE = /^[A-Za-z0-9_-]{43}$/;
const isScope = (x: unknown): x is DeviceScopeName => x === "schedule:read" || x === "schedule:add-option";
const isScopes = (x: unknown): x is DeviceScopeName[] => Array.isArray(x) && x.length > 0 && x.length <= DEVICE_SCOPES.length && x.every(isScope);
export function isTokenResponse(x: unknown): x is DeviceTokenResponse {
  return isRecord(x) && Object.keys(x).length === 6
    && typeof x.accessToken === "string" && OPAQUE.test(x.accessToken)
    && typeof x.refreshToken === "string" && OPAQUE.test(x.refreshToken)
    && x.tokenType === "Bearer"
    && typeof x.expiresIn === "number" && Number.isSafeInteger(x.expiresIn) && x.expiresIn > 0
    && isScopes(x.scopes)
    && isId(x.grantId);
}
export function isStoredGrant(x: unknown): x is StoredGrant {
  return isRecord(x) && Object.keys(x).length === 6
    && isId(x.grantId)
    && typeof x.accessToken === "string" && OPAQUE.test(x.accessToken)
    && typeof x.refreshToken === "string" && OPAQUE.test(x.refreshToken)
    && isScopes(x.scopes)
    && typeof x.scheduleId === "string" && x.scheduleId.length >= 1 && x.scheduleId.length <= 200
    && typeof x.accessExpiresAt === "number" && Number.isFinite(x.accessExpiresAt);
}
export function isCommand(x: unknown): x is AddOptionCommand {
  return isRecord(x) && Object.keys(x).length === 5 && x.command === "add-option" && isId(x.operationId) && isId(x.scheduleId) && isId(x.optionId) && isRevision(x.expectedRevision);
}
export function isAddReply(x: unknown): x is AddReply {
  if (!isRecord(x) || !isId(x.operationId))
    return false;
  return x.kind === "receipt" ? isRevision(x.committedRevision) : x.kind === "rejection" && (x.reason === "stale-revision" || x.reason === "not-found" || x.reason === "forbidden");
}
