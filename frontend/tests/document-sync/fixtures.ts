import { WriteSchema, type Write } from "../../../packages/contracts/src/sync";
import { parseWrite } from "@/lib/document-sync/decision";

export const schedule = {
  institutionId: "unt", termId: "spring-2027", name: "Main", courses: [],
  selectedSections: {}, lockedSections: {}, autoPlanned: [], lastAuto: null,
};

type WriteInput = Partial<Omit<Write, "documentId" | "operationId">> & { documentId?: string; operationId?: string };

export function write(overrides: WriteInput = {}) {
  return WriteSchema.parse({ operationId: "operation-1", documentId: "schedule-1", kind: "schedule",
    baseRevision: 0, schemaVersion: 1, body: schedule, ...overrides });
}

export function bytes(value: unknown): Uint8Array { return new TextEncoder().encode(JSON.stringify(value)); }
export function prepared(overrides: WriteInput = {}) { return parseWrite(bytes({ ...write(), ...overrides })); }
export function versionBody(scheduleId = "schedule-1") {
  return { institutionId: "unt", scheduleId, reason: "before-auto", schedule };
}
