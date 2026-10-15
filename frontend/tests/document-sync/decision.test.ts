import { describe, expect, test } from "bun:test";
import { decideWrite, parseWrite, SyncError, type CurrentDocument } from "@/lib/document-sync/decision";
import { decodePage, encodePage } from "@/lib/document-sync/pagination";
import { bytes, prepared, schedule, versionBody, write } from "./fixtures";

const current: CurrentDocument = { kind: "schedule", revision: 1, institutionId: "unt", deleted: false };
function decide(overrides: Parameters<typeof prepared>[0] = {}, state: CurrentDocument | null = null) {
  return decideWrite({ ...prepared(overrides), receipt: null, current: state });
}
function rejects(run: () => unknown, code: string, status: number) {
  try { run(); throw new Error("Expected a SyncError"); }
  catch (error) { expect(error).toBeInstanceOf(SyncError); expect(error).toMatchObject({ code, status }); }
}

describe("document write decisions", () => {
  test("first write validates its kind's body and starts revision 1", () => {
    expect(decide()).toEqual({ kind: "document", revision: 1, institutionId: "unt", body: schedule, deleted: false });
    rejects(() => decide({ body: { institutionId: "unt" } }), "INVALID_BODY", 400);
    rejects(() => decide({ body: { ...schedule, futureField: true } }), "INVALID_BODY", 400);
  });
  test("later writes also reject invalid bodies and advance exactly once", () => {
    expect(decide({ baseRevision: 1, body: { ...schedule, name: "Edited" } }, current)).toMatchObject({ revision: 2, body: { name: "Edited" } });
    rejects(() => decide({ baseRevision: 1, body: {} }, current), "INVALID_BODY", 400);
  });
  test("receipt replay wins over newer revisions and a changed kind", () => {
    const input = prepared();
    const receipt = { userId: "a", operationId: input.write.operationId, writeSha256: input.writeSha256, committedRevision: 1 };
    expect(decideWrite({ ...input, receipt, current: { ...current, kind: "preferences", revision: 8 } })).toEqual({ kind: "replay", receipt });
    rejects(() => decideWrite({ ...prepared({ body: { ...schedule, name: "Other" } }), receipt, current }), "OPERATION_REUSED", 409);
  });
  test("the hash covers exact bytes, including whitespace and every envelope field", () => {
    const raw = JSON.stringify(write());
    const original = parseWrite(new TextEncoder().encode(raw));
    expect(original.writeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(parseWrite(new TextEncoder().encode(raw)).writeSha256).toBe(original.writeSha256);
    for (const changed of [raw + " ", JSON.stringify(write({ documentId: "another" })), JSON.stringify(write({ baseRevision: 1 })),
      JSON.stringify(write({ kind: "preferences" })), JSON.stringify(write({ operationId: "another" }))]) {
      expect(parseWrite(new TextEncoder().encode(changed)).writeSha256).not.toBe(original.writeSha256);
    }
    rejects(() => parseWrite(bytes({ ...write(), schemaVersion: 2 })), "INVALID_WRITE", 400);
  });
  test("stale edits and stale deletes conflict, including edit against a tombstone", () => {
    rejects(() => decide({}, current), "REVISION_CONFLICT", 409);
    rejects(() => decide({ body: null }, current), "REVISION_CONFLICT", 409);
    rejects(() => decide({ baseRevision: 1 }, { ...current, revision: 2, deleted: true }), "REVISION_CONFLICT", 409);
  });
  test("kind and institution stay fixed", () => {
    rejects(() => decide({ baseRevision: 1, kind: "preferences" }, current), "KIND_MISMATCH", 409);
    rejects(() => decide({ baseRevision: 1, body: { ...schedule, institutionId: "ut" } }, current), "INSTITUTION_MISMATCH", 409);
  });
  test("delete keeps the institution and advances the revision", () => {
    expect(decide({ baseRevision: 1, body: null }, current)).toEqual({ kind: "document", revision: 2, institutionId: "unt", body: null, deleted: true });
    rejects(() => decide({ body: null }), "NOT_FOUND", 404);
  });
  test("versions can be created but never edited or deleted", () => {
    expect(decide({ kind: "version", body: versionBody() })).toMatchObject({ kind: "version", body: versionBody() });
    rejects(() => decide({ kind: "version", body: versionBody() }, { ...current, kind: "version" }), "REVISION_CONFLICT", 409);
    rejects(() => prepared({ kind: "version", body: null }), "INVALID_WRITE", 400);
    rejects(() => prepared({ kind: "version", baseRevision: 1, body: versionBody() }), "INVALID_WRITE", 400);
    rejects(() => decide({ kind: "version", body: { ...versionBody(), schedule: { ...schedule, institutionId: "ut" } } }), "INVALID_BODY", 400);
  });
  test("invalid JSON and UTF-8 never become writes", () => {
    rejects(() => parseWrite(new TextEncoder().encode("{")), "INVALID_JSON", 400);
    rejects(() => parseWrite(new Uint8Array([255])), "INVALID_JSON", 400);
  });
});

test("version page tokens retain a tie-breaking id and reject a changed schedule filter", () => {
  const cursor = { createdAt: new Date("2026-01-01T00:00:00.123Z"), id: "version-z" };
  const page = encodePage(cursor, "schedule-1");
  expect(decodePage(page, "schedule-1")).toEqual(cursor);
  expect(decodePage(null, null)).toBeNull();
  for (const bad of ["!", "a".repeat(513), Buffer.from('["bad","id",null]').toString("base64url")]) {
    rejects(() => decodePage(bad, null), "INVALID_PAGE", 400);
  }
  rejects(() => decodePage(page, "schedule-2"), "INVALID_PAGE", 400);
});
