/**
 * The extension's add-option command against the same opt-in live Postgres the
 * device and document-sync live tests use (RATE_LIMIT_TEST_DATABASE_URL,
 * localhost-only, a disposable schema per run): a real documentRepository
 * behind the extension store, with real compare-and-set, receipt rows, and
 * tombstones. Cases from the lead review: add-option, a repeated operation
 * id, a reused operation id with a different command, a stale revision, and a
 * deleted schedule. store.ts is a server-only module its import graph refuses
 * under the test runner, so the store is mirrored here as the same
 * three-method delegation to the repository and the receipts table.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { ReceiptSchema } from "../../../packages/contracts/src/sync";
import { PreferencesBodySchema } from "../../../packages/contracts/src/documents";
import { schema, receipts, documents } from "@/lib/db/schema";
import { documentRepository } from "@/lib/document-sync/repository";
import type { Section } from "@/lib/sections/model";
import { applyAddOption, type ExtensionStore } from "@/server/extension/commands";
import type { ExtensionAddOptionCommand } from "@/server/extension/extension-api";
import { bytes, schedule, write } from "../document-sync/fixtures";

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const namespace = `extension_test_${crypto.randomUUID().replaceAll("-", "")}`;
let pool: Pool;
let repo: ReturnType<typeof documentRepository>;
let store: ExtensionStore;

const meeting = (overrides: Partial<Section["meetings"][number]> = {}) => ({
  room: "F151", buildingCode: null, buildingId: null, buildingName: "Fossil Green Hall",
  kind: "building" as const, offCampus: false, day: "Mon" as const,
  startMinutes: 540, endMinutes: 630, dates: { start: null, end: null, raw: "" },
  instructor: { display: null, raw: "" }, async: false, tba: false, ...overrides,
});

const section = (courseCode: string, sectionCode: string, classNumbers: string[]): Section => ({
  id: `vsb:spring-2027:${courseCode}:${sectionCode}`, term: "spring-2027", courseCode, sectionCode, classNumbers,
  option: null, instructor: { display: null, raw: "" }, seats: { open: 3, total: 40 },
  status: "open", rawStatus: "Open", session: { label: "16W", dates: { start: null, end: null, raw: "" } },
  components: [], meetings: [meeting()], online: false, async: false, tba: false,
});

const csce1030 = section("CSCE 1030", "001", ["10234"]);
const csce2110 = section("CSCE 2110", "001", ["20111"]);
const sectionsSource = { termSections: async () => [csce1030, csce2110] };

const command = (overrides: Record<string, unknown> = {}): ExtensionAddOptionCommand => ({
  command: "add-option", operationId: "live-op-1", scheduleId: "ext-main", optionId: "CSCE1030-10234", expectedRevision: 1,
  ...overrides,
} as ExtensionAddOptionCommand);
const apply = (one: ExtensionAddOptionCommand) =>
  applyAddOption({ store, sections: sectionsSource }, { userId: "alice", scheduleId: "ext-main" }, one);

describe.skipIf(!url)("extension add-option on Postgres", () => {
  beforeAll(async () => {
    if (!url || !/^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)) throw new Error("Live tests require localhost Postgres.");
    pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${namespace} -c timezone=Pacific/Kiritimati` });
    await pool.query(`CREATE SCHEMA ${namespace}`);
    const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      await pool.query((await readFile(`drizzle/${tag}.sql`, "utf8")).replaceAll('"public".', `"${namespace}".`));
    }
    await pool.query(`INSERT INTO "user" (id, name, email, email_verified) VALUES ('alice', 'Alice', 'alice@example.invalid', true)`);
    const db = drizzle(pool, { schema });
    const repository = documentRepository(db);
    repo = repository;
    // The same delegation store.ts performs: documents through the repository,
    // receipts straight off the receipts table.
    store = {
      getDocument: (userId, documentId) => repository.get(userId, documentId),
      write: (userId, bytes_, documentId) => repository.write(userId, bytes_, documentId),
      async receipt(userId, operationId) {
        const [row] = await db
          .select()
          .from(receipts)
          .where(and(eq(receipts.userId, userId), eq(receipts.operationId, operationId)));
        return row ? ReceiptSchema.parse(row) : null;
      },
      async preferences(userId) {
        // One preferences document per user and institution; a student with
        // several picks the first by id order.
        const [row] = await db
          .select({ body: documents.body })
          .from(documents)
          .where(and(eq(documents.userId, userId), eq(documents.kind, "preferences"), eq(documents.deleted, false)))
          .orderBy(documents.id);
        const parsed = PreferencesBodySchema.safeParse(row?.body);
        return parsed.success ? parsed.data : null;
      },
    };
    // The student's Main schedule at revision 1, written through the repository.
    await repo.write("alice", bytes(write({ documentId: "ext-main", operationId: "seed-1", body: schedule })), "ext-main");
  });

  afterAll(async () => {
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`); }
      finally { await pool.end(); }
    }
  });

  test("add-option commits through the document repository", async () => {
    const outcome = await apply(command());
    expect(outcome.status).toBe(200);
    expect(outcome.body).toMatchObject({ kind: "receipt", operationId: "live-op-1", committedRevision: 2 });
    expect(await store.getDocument("alice", "ext-main")).toMatchObject({
      revision: 2,
      body: { courses: ["CSCE 1030"], selectedSections: { "CSCE 1030": csce1030.id } },
    });
  });

  test("a repeated operation id returns the original receipt and writes nothing", async () => {
    const first = await apply(command());
    const retry = await apply(command());
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect((await store.getDocument("alice", "ext-main")).revision).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM receipts WHERE operation_id = 'live-op-1'")).rows).toEqual([{ n: 1 }]);
  });

  test("a reused operation id with a different command is refused, not acknowledged", async () => {
    const reused = await apply(command({ optionId: "CSCE2110-20111" }));
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ kind: "rejection", operationId: "live-op-1", reason: "operation-reused" });
    expect((await store.getDocument("alice", "ext-main")).revision).toBe(2);
  });

  test("a stale expected revision is a typed rejection, never an overwrite", async () => {
    const stale = await apply(command({ operationId: "live-op-2", expectedRevision: 5 }));
    expect(stale.status).toBe(409);
    expect(stale.body).toMatchObject({ kind: "rejection", operationId: "live-op-2", reason: "stale-revision" });
    expect(await store.receipt("alice", "live-op-2")).toBeNull();
    expect((await store.getDocument("alice", "ext-main")).revision).toBe(2);
  });

  test("a deleted schedule is not-found and keeps the operation uncommitted", async () => {
    await repo.write("alice", bytes(write({ documentId: "ext-main", operationId: "delete-1", baseRevision: 2, body: null })), "ext-main");
    const gone = await apply(command({ operationId: "live-op-3" }));
    expect(gone.status).toBe(422);
    expect(gone.body).toMatchObject({ kind: "rejection", operationId: "live-op-3", reason: "not-found" });
  });
});
