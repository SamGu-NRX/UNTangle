import { CLASS_NUMBER_PATTERN, TERM_PATTERN } from "../config";
export interface SectionRef {
  term: string;
  classNumber: string;
}
export interface Preview {
  scheduleId: string;
  optionId: string;
  revision: number;
  title: string;
  conflict: "conflict" | "clear" | "unknown";
  details: string[];
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
export function isPreview(x: unknown): x is Preview {
  return isRecord(x) && isId(x.scheduleId) && isId(x.optionId) && isRevision(x.revision) && typeof x.title === "string" && x.title.length <= 160 && (x.conflict === "clear" || x.conflict === "conflict" || x.conflict === "unknown") && Array.isArray(x.details) && x.details.length <= 30 && x.details.every(s => typeof s === "string" && s.length <= 500);
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
