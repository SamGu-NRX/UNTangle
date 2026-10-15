import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { schema } from "@/lib/db/schema";
import { documentRepository, type DocumentRepository } from "@/lib/document-sync/repository";
import { documentHandlers } from "@/lib/document-sync/handlers";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { postgresDeviceStore } from "@/server/auth/device-postgres";
import { createV1Auth } from "@/server/auth/v1-auth";
import { bytes, schedule, versionBody, write } from "./fixtures";

// Same opt-in as auth/rate-limit live tests; only a disposable schema on localhost.
const url = process.env.RATE_LIMIT_TEST_DATABASE_URL;
const namespace = `document_sync_test_${crypto.randomUUID().replaceAll("-", "")}`;
let pool: Pool;
let repo: DocumentRepository;

function put(id: string, overrides: Parameters<typeof write>[0] = {}, userId = "alice") {
  return repo.write(userId, bytes({ ...write(), documentId: id, operationId: crypto.randomUUID(), ...overrides }), id);
}

describe.skipIf(!url)("document sync on Postgres", () => {
  beforeAll(async () => {
    if (!url || !/^(localhost|127\.0\.0\.1)$/.test(new URL(url).hostname)) throw new Error("Live tests require localhost Postgres.");
    pool = new Pool({ connectionString: url, max: 8, options: `-c search_path=${namespace} -c timezone=Pacific/Kiritimati` });
    await pool.query(`CREATE SCHEMA ${namespace}`);
    const journal: { entries: { tag: string }[] } = JSON.parse(await readFile("drizzle/meta/_journal.json", "utf8"));
    for (const { tag } of journal.entries) {
      await pool.query((await readFile(`drizzle/${tag}.sql`, "utf8")).replaceAll('"public".', `"${namespace}".`));
    }
    await pool.query(`INSERT INTO "user" (id, name, email, email_verified) VALUES
      ('alice', 'Alice', 'alice@example.invalid', true), ('bob', 'Bob', 'bob@example.invalid', true)`);
    repo = documentRepository(drizzle(pool, { schema }));
  });
  afterAll(async () => {
    if (pool) {
      try { await pool.query(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`); }
      finally { await pool.end(); }
    }
  });

  test("lost response and concurrent retries return the same receipt, even after later edits", async () => {
    const payload = bytes(write({ documentId: "retry", operationId: "retry-op" }));
    const [first, retry] = await Promise.all([repo.write("alice", payload, "retry"), repo.write("alice", payload, "retry")]);
    expect(first).toEqual(retry);
    expect(first).toMatchObject({ userId: "alice", operationId: "retry-op", committedRevision: 1 });
    await put("retry", { baseRevision: 1, body: { ...schedule, name: "Later" } });
    expect(await repo.write("alice", payload, "retry")).toEqual(first);
    expect(await repo.get("alice", "retry")).toMatchObject({ revision: 2, body: { name: "Later" } });
    expect((await pool.query("SELECT count(*)::int AS n FROM receipts WHERE operation_id = 'retry-op'")).rows).toEqual([{ n: 1 }]);
  });

  test("an operation id cannot acknowledge a changed write or a differently serialized write", async () => {
    const original = write({ documentId: "reused", operationId: "reused-op" });
    await repo.write("alice", bytes(original), "reused");
    for (const changed of [{ ...original, body: { ...schedule, name: "Different" } }, { ...original, documentId: "reused-other" }, { ...original, baseRevision: 1 }]) {
      await expect(repo.write("alice", bytes(changed), changed.documentId)).rejects.toMatchObject({ code: "OPERATION_REUSED", status: 409 });
    }
    await expect(repo.write("alice", new TextEncoder().encode(JSON.stringify(original) + " "), "reused")).rejects.toMatchObject({ code: "OPERATION_REUSED" });
    expect(await repo.get("alice", "reused")).toMatchObject({ revision: 1, body: { name: "Main" } });
  });

  test("stale base revision conflicts and does not store a receipt", async () => {
    await put("stale");
    await expect(put("stale", { operationId: "stale-op" })).rejects.toMatchObject({ code: "REVISION_CONFLICT", status: 409, revision: 1 });
    expect((await pool.query("SELECT count(*)::int AS n FROM receipts WHERE operation_id = 'stale-op'")).rows).toEqual([{ n: 0 }]);
    expect(await repo.get("alice", "stale")).toMatchObject({ revision: 1 });
  });

  for (const baseRevision of [0, 1]) test(`two concurrent writes from revision ${baseRevision} leave one winner`, async () => {
    const id = `race-${baseRevision}`;
    if (baseRevision) await put(id);
    const results = await Promise.allSettled([
      put(id, { baseRevision, body: { ...schedule, name: "A" } }),
      put(id, { baseRevision, body: { ...schedule, name: "B" } }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toMatchObject([{ reason: { code: "REVISION_CONFLICT", status: 409 } }]);
    const winner = results[0].status === "fulfilled" ? "A" : "B";
    expect(await repo.get("alice", id)).toMatchObject({ revision: baseRevision + 1, body: { name: winner } });
  });

  test("one operation racing on two documents commits only one", async () => {
    const results = await Promise.allSettled([put("op-race-a", { operationId: "op-race" }), put("op-race-b", { operationId: "op-race" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toMatchObject([{ reason: { code: "OPERATION_REUSED" } }]);
    expect((await repo.pull("alice")).filter((d) => d.documentId.startsWith("op-race-"))).toHaveLength(1);
  });

  test("kind changes and invalid bodies fail before changing the document", async () => {
    await put("kind");
    await expect(put("kind", { baseRevision: 1, kind: "academic-record" })).rejects.toMatchObject({ code: "KIND_MISMATCH" });
    await expect(put("kind", { baseRevision: 1, body: {} })).rejects.toMatchObject({ code: "INVALID_BODY" });
    await expect(put("bad-first", { body: {} })).rejects.toMatchObject({ code: "INVALID_BODY" });
    await expect(repo.get("alice", "bad-first")).rejects.toMatchObject({ status: 404 });
    expect(await repo.get("alice", "kind")).toMatchObject({ revision: 1, kind: "schedule" });
  });

  test("deletion keeps a tombstone and receipt and refuses a stale offline edit", async () => {
    await put("deleted");
    const deletion = bytes(write({ documentId: "deleted", operationId: "delete-op", baseRevision: 1, body: null }));
    const receipt = await repo.write("alice", deletion, "deleted");
    expect(receipt.committedRevision).toBe(2);
    expect(await repo.write("alice", deletion, "deleted")).toEqual(receipt);
    expect((await repo.pull("alice")).find((d) => d.documentId === "deleted")).toMatchObject({ documentId: "deleted", kind: "schedule", revision: 2, deleted: true });
    await expect(repo.get("alice", "deleted")).rejects.toMatchObject({ status: 404 });
    await expect(put("deleted", { baseRevision: 1 })).rejects.toMatchObject({ code: "REVISION_CONFLICT", revision: 2 });
    await expect(put("deleted", { baseRevision: 2 })).rejects.toMatchObject({ code: "DOCUMENT_DELETED", revision: 2 });
    await expect(put("deleted", { baseRevision: 2, body: null })).rejects.toMatchObject({ code: "DOCUMENT_DELETED", revision: 2 });
    expect((await repo.pull("alice")).find((d) => d.documentId === "deleted")).toMatchObject({ revision: 2, deleted: true });
  });

  test("versions are create-only, with database enforcement and a shared document id namespace", async () => {
    const original = bytes(write({ documentId: "immutable", operationId: "version-op", kind: "version", body: versionBody() }));
    const receipt = await repo.write("alice", original, "immutable");
    expect(await repo.write("alice", original, "immutable")).toEqual(receipt);
    await expect(put("immutable", { kind: "version", body: versionBody() })).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    for (const body of [null, versionBody()]) {
      await expect(put("immutable", { kind: "version", baseRevision: 1, body })).rejects.toMatchObject({ code: "INVALID_WRITE" });
    }
    await expect(put("immutable", { baseRevision: 1 })).rejects.toMatchObject({ code: "KIND_MISMATCH" });
    await expect(pool.query("UPDATE versions SET reason = 'import' WHERE id = 'immutable'")).rejects.toThrow("append-only");
    await expect(pool.query("DELETE FROM versions WHERE id = 'immutable'")).rejects.toThrow("append-only");
    expect(await repo.get("alice", "immutable")).toMatchObject({ kind: "version", revision: 1, body: { reason: "before-auto" } });
    expect((await repo.pull("alice")).some((d) => d.documentId === "immutable")).toBe(false);
    await put("not-a-version");
    await expect(put("not-a-version", { kind: "version", body: versionBody() })).rejects.toMatchObject({ code: "KIND_MISMATCH" });
  });

  test("versions page newest first without skipping ties, filtered by schedule", async () => {
    // Fixed equal timestamps exercise the id tiebreaker at the page boundary.
    for (let i = 0; i < 52; i++) {
      const id = `page-${String(i).padStart(2, "0")}`;
      await pool.query("INSERT INTO versions (user_id, id, institution_id, schedule_id, reason, body, created_at) VALUES ($1,$2,'unt','paged','before-auto',$3,$4)",
        ["alice", id, JSON.stringify(versionBody("paged")), "2026-01-01T00:00:00.123Z"]);
    }
    await put("newest", { kind: "version", body: versionBody("paged") });
    const first = await repo.listVersions("alice", "paged", null);
    expect(first.versions.map((v) => String(v.documentId))).toEqual(["newest", ...Array.from({ length: 49 }, (_, i) => `page-${String(51 - i).padStart(2, "0")}`)]);
    expect(first.nextPage).not.toBeNull();
    const second = await repo.listVersions("alice", "paged", first.nextPage);
    expect(second.versions.map((v) => String(v.documentId))).toEqual(["page-02", "page-01", "page-00"]);
    expect(second.versions[0].createdAt).toBe("2026-01-01T00:00:00.123Z");
    expect(second.nextPage).toBeNull();
  });

  test("another user's documents, receipts and versions are invisible", async () => {
    await put("private", { operationId: "shared-op" });
    await put("private-version", { kind: "version", body: versionBody("private") });
    await expect(repo.get("bob", "private")).rejects.toMatchObject({ status: 404 });
    await expect(repo.get("bob", "private-version")).rejects.toMatchObject({ status: 404 });
    expect(await repo.pull("bob")).toEqual([]);
    expect(await repo.listVersions("bob", null, null)).toEqual({ versions: [], nextPage: null });
    expect(await put("private", { operationId: "shared-op", body: { ...schedule, name: "Bob" } }, "bob")).toMatchObject({ userId: "bob", committedRevision: 1 });
    expect(await repo.get("alice", "private")).toMatchObject({ body: { name: "Main" } });
    expect(await repo.get("bob", "private")).toMatchObject({ body: { name: "Bob" } });
  });

  test("receipt failure rolls back the document and retry can commit", async () => {
    await pool.query(`CREATE FUNCTION fail_test_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.operation_id = 'rollback-op' THEN RAISE EXCEPTION 'test receipt failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_test_receipt BEFORE INSERT ON receipts FOR EACH ROW EXECUTE FUNCTION fail_test_receipt()`);
    const payload = bytes(write({ documentId: "rollback", operationId: "rollback-op" }));
    try {
      await expect(repo.write("alice", payload, "rollback")).rejects.toThrow();
      await expect(repo.get("alice", "rollback")).rejects.toMatchObject({ status: 404 });
    } finally { await pool.query("DROP TRIGGER fail_test_receipt ON receipts"); }
    expect(await repo.write("alice", payload, "rollback")).toMatchObject({ committedRevision: 1 });
  });

  test("missing users cannot write, and account deletion can cascade append-only versions", async () => {
    await expect(put("missing", {}, "nobody")).rejects.toMatchObject({ status: 401 });
    await pool.query(`INSERT INTO "user" (id, name, email) VALUES ('erase', 'E', 'erase@example.invalid')`);
    await put("erase-version", { kind: "version", body: versionBody() }, "erase");
    await pool.query(`DELETE FROM "user" WHERE id = 'erase'`);
    expect((await pool.query("SELECT count(*)::int AS n FROM versions WHERE user_id = 'erase'")).rows).toEqual([{ n: 0 }]);
    expect(await repo.get("alice", "immutable")).toMatchObject({ kind: "version" });
  });

  test("HTTP handlers return contracts and a conflict without exposing another user's document", async () => {
    const authorize = createV1Auth(createDeviceGrants(postgresDeviceStore(drizzle(pool, { schema }))), async () => ({ user: { id: "alice", emailVerified: true } }));
    const handlers = documentHandlers({ repository: repo, authorize, origin: "http://localhost:3000", available: true });
    const context = { params: Promise.resolve({ id: "http" }) };
    const request = () => new Request("http://localhost:3000/api/v1/documents/http", { method: "PUT", headers: { origin: "http://localhost:3000", "content-type": "application/json" }, body: JSON.stringify(write({ documentId: "http", operationId: crypto.randomUUID() })) });
    const saved = await handlers.put(request(), context);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ userId: "alice", committedRevision: 1 });
    const conflict = await handlers.put(request(), context);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "REVISION_CONFLICT", revision: 1 });
    const loaded = await handlers.get(new Request("http://localhost:3000/api/v1/documents/http"), context);
    expect(await loaded.json()).toMatchObject({ documentId: "http", kind: "schedule", revision: 1, schemaVersion: 1, body: schedule });
    expect(loaded.headers.get("cache-control")).toBe("no-store");
  });

  test("device bearer tokens read and write their own user's documents through Postgres grants", async () => {
    let time = Date.now();
    const grants = createDeviceGrants(postgresDeviceStore(drizzle(pool, { schema })), () => time);
    // The browser session is bob's: a response as alice proves the token chose the user.
    const handlers = documentHandlers({ repository: repo, origin: "http://localhost:3000", available: true,
      authorize: createV1Auth(grants, async () => ({ user: { id: "bob", emailVerified: true } })) });
    const verifier = "d".repeat(43);
    async function issue(userId: string, clientKind: "mobile" | "extension" = "mobile") {
      const common = { codeChallenge: pkceChallenge(verifier), codeChallengeMethod: "S256" as const };
      const pending = await grants.start(clientKind === "mobile" ? { ...common, clientKind } : { ...common, clientKind, scheduleId: "device-doc" });
      await grants.approve(pending.userCode, userId, "approve", await grants.readSecurityGeneration(userId));
      return grants.exchange(pending.deviceCode, verifier);
    }
    const context = { params: Promise.resolve({ id: "device-doc" }) };
    const bearer = (token: string, extra: Record<string, string> = {}) => ({ authorization: `Bearer ${token}`, ...extra });
    const put = (headers: Record<string, string>) => new Request("http://localhost:3000/api/v1/documents/device-doc", { method: "PUT",
      headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(write({ documentId: "device-doc", operationId: crypto.randomUUID() })) });
    const get = (headers: Record<string, string>) => new Request("http://localhost:3000/api/v1/documents/device-doc", { headers });
    const pull = (headers: Record<string, string>) => new Request("http://localhost:3000/api/v1/sync", { headers });

    const alice = await issue("alice");
    const saved = await handlers.put(put(bearer(alice.accessToken)), context);
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ userId: "alice", committedRevision: 1 });
    expect(await (await handlers.get(get(bearer(alice.accessToken)), context)).json()).toMatchObject({ documentId: "device-doc", revision: 1 });
    expect((await (await handlers.pull(pull(bearer(alice.accessToken)))).json() as { documentId: string }[]).some((d) => d.documentId === "device-doc")).toBe(true);
    expect((await handlers.versions(new Request("http://localhost:3000/api/v1/versions", { headers: bearer(alice.accessToken) }))).status).toBe(200);

    const bob = await issue("bob");
    expect((await handlers.get(get(bearer(bob.accessToken)), context)).status).toBe(404);
    expect((await (await handlers.pull(pull(bearer(bob.accessToken)))).json() as { documentId: string }[]).some((d) => d.documentId === "device-doc")).toBe(false);

    const extension = await issue("alice", "extension");
    for (const response of [await handlers.get(get(bearer(extension.accessToken)), context), await handlers.put(put(bearer(extension.accessToken)), context)]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "insufficient_scope" });
    }
    const ambiguous = await handlers.get(get(bearer(alice.accessToken, { cookie: "better-auth.session_token=x" })), context);
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toMatchObject({ code: "ambiguous_credentials" });

    const rotated = await grants.refresh(alice.refreshToken);
    expect((await handlers.get(get(bearer(rotated.accessToken)), context)).status).toBe(200);
    await grants.revoke(rotated.accessToken);
    for (const token of [alice.accessToken, rotated.accessToken]) {
      const refused = await handlers.get(get(bearer(token)), context);
      expect(refused.status).toBe(401);
      expect(await refused.text()).not.toContain(token);
    }
    const second = await issue("alice");
    await grants.bumpSecurityGeneration("alice");
    expect((await handlers.put(put(bearer(second.accessToken)), context)).status).toBe(401);
    expect((await handlers.get(get(bearer(bob.accessToken)), context)).status).toBe(404);
    time += 5 * 60_000;
    expect((await handlers.pull(pull(bearer(bob.accessToken)))).status).toBe(401);
    expect(await repo.get("alice", "device-doc")).toMatchObject({ revision: 1 });
  });
});
