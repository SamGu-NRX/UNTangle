import { describe, expect, test } from "bun:test";
import { PullListSchema, ReceiptSchema, WriteSchema } from "../src/sync";
import { schedule, version } from "./fixtures";
import { decoded, rejections, without } from "./helpers";

function sha256Hex(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

const write = {
  operationId: "0b6b5c1e-8f0a-4c4e-9d43-3f1b0f9a2c11",
  documentId: "schedule-main",
  kind: "schedule",
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

  test("rejects a write with no kind, so a first write can be checked against its body schema", () => {
    expect(rejections(WriteSchema, without(write, "kind"))).toHaveLength(1);
  });

  test("rejects a write with no body, so a delete is always explicit", () => {
    expect(rejections(WriteSchema, without(write, "body"))).toHaveLength(1);
  });

  test.each([
    ["a negative base revision", { baseRevision: -1 }],
    ["a fractional base revision", { baseRevision: 1.5 }],
    ["a schema version this client doesn't speak", { schemaVersion: 2 }],
    ["an operation id with a slash", { operationId: "op/1" }],
    ["an unknown field", { note: "extra" }],
    ["an unknown document kind", { kind: "roadmap" }],
  ])("rejects %s", (_case, change) => {
    expect(rejections(WriteSchema, { ...write, ...change })).toHaveLength(1);
  });

  describe("a version is only ever created", () => {
    const create = { ...write, documentId: "version-1", kind: "version", baseRevision: 0, body: version };

    test("round-trips its creation", () => {
      expect(decoded(WriteSchema, create)).toEqual(create);
    });

    test("rejects an update", () => {
      expect(rejections(WriteSchema, { ...create, baseRevision: 1 })).toEqual([
        "baseRevision: A version is only ever created, from revision 0.",
      ]);
    });

    test("rejects a delete", () => {
      expect(rejections(WriteSchema, { ...create, baseRevision: 1, body: null })).toEqual([
        "baseRevision: A version is only ever created, from revision 0.",
        "body: A version can't be deleted.",
      ]);
    });
  });
});

describe("Receipt", () => {
  const receipt = {
    userId: "user_8f2k",
    operationId: write.operationId,
    writeSha256: sha256Hex(JSON.stringify(write)),
    committedRevision: 5,
  };

  test("round-trips", () => {
    expect(decoded(ReceiptSchema, receipt)).toEqual(receipt);
  });

  test("two deletes with one operation id hash differently when they target different documents", () => {
    const deleteA = sha256Hex(JSON.stringify({ ...write, body: null }));
    const deleteB = sha256Hex(JSON.stringify({ ...write, documentId: "schedule-other", body: null }));
    expect(deleteA).not.toBe(deleteB);
  });

  test.each([
    ["an uppercase hash", { writeSha256: receipt.writeSha256.toUpperCase() }],
    ["a truncated hash", { writeSha256: receipt.writeSha256.slice(1) }],
    ["the old body-only field name", { bodySha256: receipt.writeSha256 }],
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
