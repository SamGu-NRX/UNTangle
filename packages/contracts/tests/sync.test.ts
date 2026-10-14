import { describe, expect, test } from "bun:test";
import { PullListSchema, ReceiptSchema, WriteSchema } from "../src/sync";
import { schedule } from "./fixtures";
import { decoded, rejections, without } from "./helpers";

function sha256Hex(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

const write = {
  operationId: "0b6b5c1e-8f0a-4c4e-9d43-3f1b0f9a2c11",
  documentId: "schedule-main",
  baseRevision: 4,
  schemaVersion: 1,
  body: schedule,
};

describe("Write", () => {
  test("round-trips a save", () => {
    expect(decoded(WriteSchema, write)).toEqual(write);
  });

  test("round-trips a delete, whose body is null", () => {
    expect(decoded(WriteSchema, { ...write, body: null })).toEqual({ ...write, body: null });
  });

  test("round-trips a first write to a new document, based on revision 0", () => {
    expect(decoded(WriteSchema, { ...write, baseRevision: 0 })).toEqual({ ...write, baseRevision: 0 });
  });

  test("rejects a write with no body, so a delete is always explicit", () => {
    expect(rejections(WriteSchema, without(write, "body"))).toHaveLength(1);
  });

  test.each([
    ["a negative base revision", { baseRevision: -1 }],
    ["a fractional base revision", { baseRevision: 1.5 }],
    ["a schema version this client doesn't speak", { schemaVersion: 2 }],
    ["an operation id with a slash", { operationId: "op/1" }],
    ["an unknown field", { kind: "schedule" }],
  ])("rejects %s", (_case, change) => {
    expect(rejections(WriteSchema, { ...write, ...change })).toHaveLength(1);
  });
});

describe("Receipt", () => {
  const receipt = {
    userId: "user_8f2k",
    operationId: write.operationId,
    bodySha256: sha256Hex(JSON.stringify(write.body)),
    committedRevision: 5,
  };

  test("round-trips", () => {
    expect(decoded(ReceiptSchema, receipt)).toEqual(receipt);
  });

  test.each([
    ["an uppercase hash", { bodySha256: receipt.bodySha256.toUpperCase() }],
    ["a truncated hash", { bodySha256: receipt.bodySha256.slice(1) }],
    ["revision 0, which no commit produces", { committedRevision: 0 }],
    ["an empty user id", { userId: "" }],
  ])("rejects %s", (_case, change) => {
    expect(rejections(ReceiptSchema, { ...receipt, ...change })).toHaveLength(1);
  });
});

describe("pull list", () => {
  const list = [
    { documentId: "record-unt", kind: "academic-record", revision: 12, deleted: false },
    { documentId: "schedule-main", kind: "schedule", revision: 5, deleted: false },
    { documentId: "schedule-old", kind: "schedule", revision: 3, deleted: true },
    { documentId: "prefs-unt", kind: "preferences", revision: 2, deleted: false },
  ];

  test("round-trips", () => {
    expect(decoded(PullListSchema, list)).toEqual(list);
  });

  test("round-trips an empty list, for a student with no documents yet", () => {
    expect(decoded(PullListSchema, [])).toEqual([]);
  });

  test("rejects a document listed twice", () => {
    expect(rejections(PullListSchema, [...list, { ...list[1], revision: 6 }])).toEqual([
      "4.documentId: schedule-main is listed twice.",
    ]);
  });

  test("rejects a version, which is listed separately and paged", () => {
    expect(rejections(PullListSchema, [{ ...list[0], kind: "version" }])).toHaveLength(1);
  });

  test("rejects a kind that doesn't exist", () => {
    expect(rejections(PullListSchema, [{ ...list[0], kind: "roadmap" }])).toHaveLength(1);
  });
});
