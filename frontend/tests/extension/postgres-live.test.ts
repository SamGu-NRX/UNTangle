/**
 * The extension routes against the same opt-in live Postgres the device and
 * document-sync live tests use (RATE_LIMIT_TEST_DATABASE_URL, localhost-only,
 * a disposable schema per run): real device grants, the production extension
 * store over a real documentRepository (compare-and-set, receipt rows,
 * tombstones), and the web planner's own sync reading the result through the
 * real /api/v1 document handlers. Only the term's section data is a stub.
 *
 * Cases: an add lands in the Main Week shows for its term; an add for a term
 * the planner doesn't plan is refused; a new account's first add creates
 * Main; two first adds at once; a grant approved before its account had any
 * Main still works; replays, reused operation ids and stale revisions;
 * preferences scoped to an institution; a deleted Main. The store is the production factory from
 * store-core.ts, which carries no server-only import so this module can
 * construct it.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import { documentRepository } from "@/lib/document-sync/repository";
import { documentHandlers } from "@/lib/document-sync/handlers";
import type { Section } from "@/lib/sections/model";
import { httpSyncIO } from "@/lib/sync/planner-sync";
import { createDeviceGrants, pkceChallenge, type DeviceGrants } from "@/server/auth/device-grants";
import { postgresDeviceStore } from "@/server/auth/device-postgres";
import { createV1Auth } from "@/server/auth/v1-auth";
import { createExtensionHttp } from "@/server/extension/http";
import { extensionOptionId } from "@/server/extension/option-id";
import { extensionStore } from "@/server/extension/store-core";
import { bytes, schedule, write } from "../document-sync/fixtures";
import { webPlannerView } from "./web-planner";

const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const namespace = `extension_test_${crypto.randomUUID().replaceAll("-", "")}`;
const origin = "http://localhost:3000";
const springMain = "main-unt-spring-2027";
const fallMain = "main-unt-fall-2027";
let pool: Pool;
let repo: ReturnType<typeof documentRepository>;
let store: ReturnType<typeof extensionStore>;
let grants: DeviceGrants;
let http: ReturnType<typeof createExtensionHttp>;
let database: ReturnType<typeof drizzle<typeof schema>>;

const meeting = (overrides: Partial<Section["meetings"][number]> = {}) => ({
  room: "F151", buildingCode: null, buildingId: null, buildingName: "Fossil Green Hall",
  kind: "building" as const, offCampus: false, day: "Mon" as const,
  startMinutes: 540, endMinutes: 630, dates: { start: null, end: null, raw: "" },
  instructor: { display: null, raw: "" }, async: false, tba: false, ...overrides,
});

const section = (term: string, courseCode: string, sectionCode: string, classNumbers: string[], day: Section["meetings"][number]["day"] = "Mon"): Section => ({
  id: `vsb:${term}:${courseCode}:${sectionCode}`, term, courseCode, sectionCode, classNumbers,
  option: null, instructor: { display: null, raw: "" }, seats: { open: 3, total: 40 },
  status: "open", rawStatus: "Open", session: { label: "16W", dates: { start: null, end: null, raw: "" } },
  components: [], meetings: [meeting({ day })], online: false, async: false, tba: false,
});

const csce1030 = section("spring-2027", "CSCE 1030", "001", ["10234"]);
const csce2110 = section("spring-2027", "CSCE 2110", "001", ["20111"], "Tue");
const math1710 = section("spring-2027", "MATH 1710", "001", ["30001"], "Wed");
// myUNT reuses class numbers from term to term: fall's 20111 is another section.
const fallCsce2110 = section("fall-2027", "CSCE 2110", "003", ["20111"], "Thu");
const allSections = [csce1030, csce2110, math1710, fallCsce2110];
const sectionsSource = { termSections: async (term: string) => allSections.filter((candidate) => candidate.term === term) };

async function extensionToken(userId: string) {
  // The shipped extension sends "main" to device/start (SCHEDULE_ID on edge).
  const pending = await grants.start({ clientKind: "extension", codeChallenge: pkceChallenge("v".repeat(43)), codeChallengeMethod: "S256", scheduleId: "main" });
  await grants.approve(pending.userCode, userId, "approve");
  return (await grants.exchange(pending.deviceCode, "v".repeat(43))).accessToken;
}

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function preview(token: string, term: string, classNumber: string) {
  const response = await http.preview(new Request(`${origin}/api/v1/extension/preview/${term}/${classNumber}`, { headers: bearer(token) }), { term, classNumber });
  expect(response.status).toBe(200);
  return (await response.json()) as { scheduleId: string; optionId: string; revision: number; conflict: string; details: string[] };
}

async function add(token: string, command: Record<string, unknown>) {
  const response = await http.commands(new Request(`${origin}/api/v1/extension/commands`, {
    method: "POST", headers: { ...bearer(token), "content-type": "application/json" }, body: JSON.stringify(command),
  }));
  return { status: response.status, body: await response.json() };
}

/** The add the panel sends when the student confirms a preview (worker-controller.ts on edge). */
const confirmed = (shown: { scheduleId: string; optionId: string; revision: number }, operationId: string = crypto.randomUUID()) => ({
  command: "add-option", operationId, scheduleId: shown.scheduleId, optionId: shown.optionId, expectedRevision: shown.revision,
});

/** What Week shows for the user and term: the web planner's sync over the real /api/v1 handlers, signed in by cookie. */
function week(userId: string, term: string) {
  const authorize = createV1Auth(grants, async () => ({ user: { id: userId, emailVerified: true }, session: { securityGeneration: 0 } }));
  const handlers = documentHandlers({ repository: repo, authorize, limit: async () => null, origin, available: true });
  const fetchImpl = async (input: string, init?: RequestInit) => {
    const request = new Request(new URL(input, origin), init);
    const path = new URL(request.url).pathname;
    if (path === "/api/v1/sync") return handlers.pull(request);
    const document = /^\/api\/v1\/documents\/([^/]+)$/.exec(path);
    if (document && request.method === "GET") return handlers.get(request, { params: Promise.resolve({ id: decodeURIComponent(document[1]) }) });
    throw new Error(`The web planner asked for ${request.method} ${path}, which this test doesn't serve.`);
  };
  return webPlannerView(httpSyncIO(userId, () => fetchImpl), userId, term);
}

const receipts = async (operationId: string) =>
  (await pool.query("SELECT count(*)::int AS n FROM receipts WHERE operation_id = $1", [operationId])).rows[0].n as number;

describe.skipIf(!url)("extension routes on Postgres", () => {
  beforeAll(async () => {
    if (!url || !/^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)) throw new Error("Live tests require localhost Postgres.");
    pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${namespace} -c timezone=Pacific/Kiritimati` });
    await pool.query(`CREATE SCHEMA ${namespace}`);
    const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      await pool.query((await readFile(`drizzle/${tag}.sql`, "utf8")).replaceAll('"public".', `"${namespace}".`));
    }
    await pool.query(`INSERT INTO "user" (id, name, email, email_verified) VALUES
      ('alice', 'Alice', 'alice@example.invalid', true),
      ('bob', 'Bob', 'bob@example.invalid', true),
      ('carol', 'Carol', 'carol@example.invalid', true),
      ('dana', 'Dana', 'dana@example.invalid', true),
      ('erin', 'Erin', 'erin@example.invalid', true)`);
    database = drizzle(pool, { schema });
    repo = documentRepository(database);
    // The production store the routes use, built over the live database.
    store = extensionStore(database);
    grants = createDeviceGrants(postgresDeviceStore(database));
    http = createExtensionHttp({ grants, store, sections: sectionsSource, origin, extensionOrigins: [] });
    // Alice's spring Main, as the web planner saved it, already picks another
    // course: jsonb re-sorts object keys on the way through Postgres, so a
    // rebuilt-byte replay check would refuse a genuine retry from here on.
    await repo.write("alice", bytes(write({
      documentId: springMain, operationId: "seed-1",
      body: { ...schedule, courses: ["MATH 1710"], selectedSections: { "MATH 1710": math1710.id } },
    })), springMain);
  });

  afterAll(async () => {
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`); }
      finally { await pool.end(); }
    }
  });

  test("an add for spring-2027 appears in the Main Week shows for spring-2027", async () => {
    const token = await extensionToken("alice");
    const shown = await preview(token, "spring-2027", "10234");
    expect(shown).toMatchObject({ scheduleId: "main", optionId: extensionOptionId(csce1030), revision: 1, conflict: "clear" });
    const added = await add(token, confirmed(shown, "live-op-1"));
    expect(added).toEqual({ status: 200, body: { kind: "receipt", operationId: "live-op-1", committedRevision: 2 } });
    expect(await repo.get("alice", springMain)).toMatchObject({
      revision: 2,
      body: { courses: ["MATH 1710", "CSCE 1030"], selectedSections: { "MATH 1710": math1710.id, "CSCE 1030": csce1030.id } },
    });
    const shownInWeek = await week("alice", "spring-2027");
    expect(shownInWeek.planned.toSorted()).toEqual(["CSCE 1030", "MATH 1710"]);
    expect(shownInWeek.picks).toMatchObject({ "CSCE 1030": csce1030.id });
  });

  test("a repeated operation id returns the original receipt and writes nothing", async () => {
    const token = await extensionToken("alice");
    const command = { command: "add-option", operationId: "live-op-1", scheduleId: "main", optionId: extensionOptionId(csce1030), expectedRevision: 1 };
    // The schedule already carries the MATH 1710 pick, so the committed bytes
    // and a rebuild differ in jsonb key order: the replay answers from the
    // committed effect, not from the bytes.
    expect(await add(token, command)).toEqual({ status: 200, body: { kind: "receipt", operationId: "live-op-1", committedRevision: 2 } });
    expect((await repo.get("alice", springMain)).revision).toBe(2);
    expect(await receipts("live-op-1")).toBe(1);
  });

  test("a reused operation id with a different command is refused, not acknowledged", async () => {
    const token = await extensionToken("alice");
    const reused = await add(token, { command: "add-option", operationId: "live-op-1", scheduleId: "main", optionId: extensionOptionId(csce2110), expectedRevision: 1 });
    expect(reused).toEqual({ status: 409, body: { kind: "rejection", operationId: "live-op-1", reason: "forbidden" } });
    expect((await repo.get("alice", springMain)).revision).toBe(2);
  });

  test("a stale expected revision is a typed rejection, never an overwrite", async () => {
    const token = await extensionToken("alice");
    const stale = await add(token, { command: "add-option", operationId: "live-op-2", scheduleId: "main", optionId: extensionOptionId(csce2110), expectedRevision: 5 });
    expect(stale).toEqual({ status: 409, body: { kind: "rejection", operationId: "live-op-2", reason: "stale-revision" } });
    expect(await store.receipt("alice", "live-op-2")).toBeNull();
    expect((await repo.get("alice", springMain)).revision).toBe(2);
  });

  test("an add for a term the planner doesn't plan is refused and creates no Main for it", async () => {
    const token = await extensionToken("alice");
    const shown = await preview(token, "fall-2027", "20111");
    expect(shown).toMatchObject({ conflict: "unknown", revision: 0 });
    expect(shown.details).toEqual(["UNTangle plans only Spring 2027 for now. This class search is Fall 2027."]);
    const refused = await add(token, { command: "add-option", operationId: "fall-op-1", scheduleId: "main", optionId: extensionOptionId(fallCsce2110), expectedRevision: 0 });
    expect(refused).toEqual({ status: 403, body: { kind: "rejection", operationId: "fall-op-1", reason: "forbidden" } });
    await expect(repo.get("alice", fallMain)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await receipts("fall-op-1")).toBe(0);
    expect((await repo.get("alice", springMain)).revision).toBe(2);
  });

  test("two first adds to one term at once create one Main: one commits, the other is stale", async () => {
    const token = await extensionToken("erin");
    const shown = await preview(token, "spring-2027", "10234");
    expect(shown.revision).toBe(0);
    const [a, b] = await Promise.all([add(token, confirmed(shown, "erin-op-a")), add(token, confirmed(shown, "erin-op-b"))]);
    expect([a.status, b.status].toSorted()).toEqual([200, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    expect(await receipts(loser.body.operationId)).toBe(0);
    expect(await repo.get("erin", springMain)).toMatchObject({ revision: 1, body: { selectedSections: { "CSCE 1030": csce1030.id } } });

    // Two copies of one command at once get one receipt between them.
    const next = await preview(token, "spring-2027", "20111");
    const command = confirmed(next, "erin-op-c");
    const [c1, c2] = await Promise.all([add(token, command), add(token, command)]);
    expect(c1).toEqual({ status: 200, body: { kind: "receipt", operationId: "erin-op-c", committedRevision: 2 } });
    expect(c2).toEqual(c1);
    expect(await receipts("erin-op-c")).toBe(1);
    expect((await repo.get("erin", springMain)).revision).toBe(2);
  });

  test("a new account's first add creates Main, and the grant reaches only its own account", async () => {
    const token = await extensionToken("bob");
    const shown = await preview(token, "spring-2027", "20111");
    expect(shown).toMatchObject({ revision: 0, conflict: "clear" });
    expect(shown.details[0]).toBe("Your Spring 2027 plan in UNTangle is empty.");
    const created = await add(token, confirmed(shown, "bob-op-1"));
    expect(created).toEqual({ status: 200, body: { kind: "receipt", operationId: "bob-op-1", committedRevision: 1 } });
    expect(await repo.get("bob", springMain)).toMatchObject({
      revision: 1,
      body: { ...schedule, courses: ["CSCE 2110"], selectedSections: { "CSCE 2110": csce2110.id } },
    });
    expect(await receipts("bob-op-1")).toBe(1);
    expect((await week("bob", "spring-2027")).picks).toEqual({ "CSCE 2110": csce2110.id });
    // Alice's Main and Week are untouched by Bob's add.
    expect((await repo.get("alice", springMain)).revision).toBe(2);
    expect((await week("alice", "spring-2027")).picks["CSCE 2110"]).toBeUndefined();
  });

  test("a grant approved before its account had any Main adds to the Main the web planner made later", async () => {
    // Grants bound "main" before Main was a role, and before any document by
    // that name existed; the binding never named a document.
    const token = await extensionToken("carol");
    await repo.write("carol", bytes(write({ documentId: springMain, operationId: "carol-web-1" })), springMain);
    const shown = await preview(token, "spring-2027", "10234");
    expect(shown.revision).toBe(1);
    expect((await add(token, confirmed(shown))).body).toMatchObject({ kind: "receipt", committedRevision: 2 });
    expect((await week("carol", "spring-2027")).picks).toEqual({ "CSCE 1030": csce1030.id });
  });

  test("preferences are the ones for the institution asked for", async () => {
    const prefs = (institutionId: string) => ({
      institutionId, goal: "compact",
      constraints: {
        earliestStart: null, latestEnd: null, daysOff: [], blocked: [], maxCredits: null,
        walkingBufferMinutes: null, excludedSections: [], openSeatsOnly: false, otherSites: false,
      },
      weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
    });
    // "a-prefs" sorts first by id, so an unfiltered query would return it.
    await repo.write("alice", bytes(write({ documentId: "a-prefs", operationId: "prefs-1", kind: "preferences", body: prefs("other-school") })), "a-prefs");
    await repo.write("alice", bytes(write({ documentId: "b-prefs", operationId: "prefs-2", kind: "preferences", body: prefs("unt") })), "b-prefs");
    expect(String((await store.preferences("alice", "unt"))?.institutionId)).toBe("unt");
    expect(String((await store.preferences("alice", "other-school"))?.institutionId)).toBe("other-school");
    expect(await store.preferences("alice", "nowhere")).toBeNull();
  });

  test("a deleted Main reads as an empty plan, and the next add creates a new one where Week finds it", async () => {
    const token = await extensionToken("dana");
    await repo.write("dana", bytes(write({ documentId: springMain, operationId: "dana-web-1" })), springMain);
    const before = await preview(token, "spring-2027", "10234");
    await repo.write("dana", bytes(write({ documentId: springMain, operationId: "dana-web-2", baseRevision: 1, body: null })), springMain);
    // The preview from before the deletion is stale; it never resurrects the deleted id.
    expect((await add(token, confirmed(before))).body).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    const after = await preview(token, "spring-2027", "10234");
    expect(after.revision).toBe(0);
    expect(after.details[0]).toBe("Your Spring 2027 plan in UNTangle is empty.");
    expect((await add(token, confirmed(after))).body).toMatchObject({ kind: "receipt", committedRevision: 1 });
    expect(await repo.get("dana", `${springMain}-2`)).toMatchObject({ body: { name: "Main", selectedSections: { "CSCE 1030": csce1030.id } } });
    expect((await week("dana", "spring-2027")).picks).toEqual({ "CSCE 1030": csce1030.id });
  });
});
