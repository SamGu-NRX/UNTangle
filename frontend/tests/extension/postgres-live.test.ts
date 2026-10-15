/**
 * The extension's add-option command against the same opt-in live Postgres the
 * device and document-sync live tests use (RATE_LIMIT_TEST_DATABASE_URL,
 * localhost-only, a disposable schema per run): a real documentRepository
 * behind the extension store, with real compare-and-set, receipt rows, and
 * tombstones. Cases: add-option, a repeated operation id, a reused operation
 * id with a different command, a stale revision, and a deleted schedule. The
 * store is the production factory from store-core.ts, which deliberately
 * carries no server-only import so this module can construct it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import { documentRepository } from "@/lib/document-sync/repository";
import type { Section } from "@/lib/sections/model";
import { applyAddOption } from "@/server/extension/commands";
import { extensionStore } from "@/server/extension/store-core";
import type { ExtensionAddOptionCommand } from "@/server/extension/extension-api";
import { bytes, schedule, write } from "../document-sync/fixtures";

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const namespace = `extension_test_${crypto.randomUUID().replaceAll("-", "")}`;
let pool: Pool;
let repo: ReturnType<typeof documentRepository>;
let store: ReturnType<typeof extensionStore>;

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
    repo = documentRepository(db);
    // The production store the routes use, built over the live database.
    store = extensionStore(db);
    // Main carries another course's pick before the add: jsonb re-sorts object
    // keys on the way through Postgres, so a rebuilt-byte replay check would
    // refuse a genuine retry from here on.
    await repo.write(
      "alice",
      bytes(write({
        documentId: "ext-main", operationId: "seed-1",
        body: { ...schedule, courses: ["MATH 1710"], selectedSections: { "MATH 1710": "vsb:spring-2027:MATH 1710:001" } },
      })),
      "ext-main",
    );
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
      body: { courses: ["MATH 1710", "CSCE 1030"], selectedSections: { "MATH 1710": "vsb:spring-2027:MATH 1710:001", "CSCE 1030": csce1030.id } },
    });
  });

  test("a repeated operation id returns the original receipt and writes nothing", async () => {
    const first = await apply(command());
    const retry = await apply(command());
    // The schedule already carries the MATH 1710 pick, so the committed bytes
    // and a rebuild differ in jsonb key order: the replay answers from the
    // committed effect, not from the bytes.
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual(first.body);
    expect((await store.getDocument("alice", "ext-main")).revision).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM receipts WHERE operation_id = 'live-op-1'")).rows).toEqual([{ n: 1 }]);
  });

  test("a reused operation id with a different command is refused, not acknowledged", async () => {
    const reused = await apply(command({ optionId: "CSCE2110-20111" }));
    expect(reused.status).toBe(409);
    expect(reused.body).toMatchObject({ kind: "rejection", operationId: "live-op-1", reason: "forbidden" });
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
