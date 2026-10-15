/**
 * The extension routes against an in-memory store with the document-sync
 * decision logic real writes use. Pins: every preview verdict (clear, conflict
 * by course and by busy block, each unknown reason), the add-command path
 * (receipt, same-command replay, reused-operation refusal, stale revision,
 * pinned lock), and the boundary (extension grants only, bound schedule only,
 * origin rules, no cookie credentials, revoked tokens). Every success and
 * rejection body is fed through the extension client's own guards, copied in
 * extension-api-guards.ts.
 */
import { describe, expect, test } from "bun:test";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createExtensionHttp } from "@/server/extension/http";
import type { ExtensionStore } from "@/server/extension/commands";
import { parseWrite, SyncError, decideWrite, type CurrentDocument } from "@/lib/document-sync/decision";
import { extensionPreviewSchema, extensionAddReplySchema } from "@/server/extension/extension-api";
import { extensionOptionId, parseExtensionOptionId, sectionMatchesOptionId } from "@/server/extension/option-id";
import { DocumentSchema, type Document, type PreferencesBody } from "../../../packages/contracts/src/documents";
import type { Receipt } from "../../../packages/contracts/src/sync";
import type { Section } from "@/lib/sections/model";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { isAddReply, isPreview } from "./extension-api-guards";

const origin = "https://untangle.example";
const extension = `chrome-extension://${"a".repeat(32)}`;
const scheduleId = "sched-main-1";
const term = "spring-2027";

const meeting = (overrides: Partial<Section["meetings"][number]> = {}) => ({
  room: "F151", buildingCode: null, buildingId: null, buildingName: "Fossil Green Hall",
  kind: "building" as const, offCampus: false, day: "Mon" as const,
  startMinutes: 540, endMinutes: 630, dates: { start: null, end: null, raw: "" },
  instructor: { display: null, raw: "" }, async: false, tba: false, ...overrides,
});

const section = (courseCode: string, sectionCode: string, classNumbers: string[], meetings: Section["meetings"]): Section => ({
  id: `vsb:${term}:${courseCode}:${sectionCode}`, term, courseCode, sectionCode, classNumbers,
  option: null, instructor: { display: null, raw: "" }, seats: { open: 3, total: 40 },
  status: "open", rawStatus: "Open", session: { label: "16W", dates: { start: null, end: null, raw: "" } },
  components: [], meetings, online: false, async: false, tba: meetings.some(m => m.tba),
});

const csce1030 = section("CSCE 1030", "001", ["10234"], [meeting()]);
const csce2110 = section("CSCE 2110", "001", ["20111"], [meeting({ startMinutes: 570, endMinutes: 660 })]);
const csce2110Later = section("CSCE 2110", "002", ["20112"], [meeting({ day: "Tue", startMinutes: 570, endMinutes: 660 })]);
const engrTba = section("ENGR 1000", "001", ["30100"], [meeting({ tba: true, day: null, startMinutes: null, endMinutes: null })]);
const sections = [csce1030, csce2110, csce2110Later, engrTba];

const scheduleBody = (overrides: Record<string, unknown> = {}) => ({
  institutionId: "unt", termId: term, name: "Main", courses: ["CSCE 1030"],
  selectedSections: { "CSCE 1030": csce1030.id }, lockedSections: {}, autoPlanned: [], lastAuto: null,
  ...overrides,
});

const preferences = (blocked: unknown[] = []): PreferencesBody => ({
  institutionId: "unt" as PreferencesBody["institutionId"], goal: "compact",
  constraints: {
    earliestStart: null, latestEnd: null, daysOff: [], blocked: blocked as PreferencesBody["constraints"]["blocked"],
    maxCredits: null, walkingBufferMinutes: null, excludedSections: [], openSeatsOnly: false, otherSites: false,
  },
  weights: { fewerDays: 0, compact: 0, mornings: 0, evenings: 0, walking: 0, rating: 0 },
});

/** A store with the real write decision logic and plain in-memory tables. */
class MemoryExtensionStore implements ExtensionStore {
  #documents = new Map<string, { kind: string; revision: number; institutionId: string; deleted: boolean; body: unknown }>();
  #receipts = new Map<string, Receipt>();
  preferencesBody: PreferencesBody | null = null;

  seed(documentId: string, body: unknown) { this.#documents.set(documentId, { kind: "schedule", revision: 1, institutionId: "unt", deleted: false, body }); }

  async getDocument(userId: string, documentId: string): Promise<Document> {
    const document = this.#documents.get(documentId);
    if (!document) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
    return DocumentSchema.parse({ documentId, kind: document.kind, revision: document.revision, schemaVersion: 1, body: document.body });
  }

  async preferences(userId: string, institutionId: string) {
    return this.preferencesBody?.institutionId === institutionId ? this.preferencesBody : null;
  }

  async receipt(userId: string, operationId: string) { return this.#receipts.get(operationId) ?? null; }

  async write(userId: string, bytes: Uint8Array, documentId: string): Promise<Receipt> {
    const { write, writeSha256 } = parseWrite(bytes);
    const document = this.#documents.get(documentId);
    const current: CurrentDocument | null = document
      ? { kind: document.kind as "schedule", revision: document.revision, institutionId: document.institutionId, deleted: document.deleted }
      : null;
    const decision = decideWrite({ write, writeSha256, receipt: this.#receipts.get(write.operationId) ?? null, current });
    if (decision.kind === "replay") return decision.receipt;
    if (decision.kind !== "document") throw new SyncError(409, "KIND_MISMATCH", "Versions are created through the app.");
    this.#documents.set(documentId, {
      kind: write.kind, revision: decision.revision, institutionId: decision.institutionId, deleted: false, body: decision.body,
    });
    const receipt: Receipt = { userId, operationId: write.operationId, writeSha256, committedRevision: decision.revision };
    this.#receipts.set(write.operationId, receipt);
    return receipt;
  }
}

function setup(options: { sections: Section[] | null; scheduleBody: unknown | null; preferences?: PreferencesBody | null } = { sections, scheduleBody: scheduleBody() }) {
  const grants = createDeviceGrants(new MemoryDeviceStore());
  const store = new MemoryExtensionStore();
  if (options.scheduleBody) store.seed(scheduleId, options.scheduleBody);
  if (options.preferences !== undefined) store.preferencesBody = options.preferences;
  const http = createExtensionHttp({ grants, store, sections: { termSections: async () => options.sections }, origin, extensionOrigins: [extension] });
  let account = "alice";
  async function issue(clientKind: "extension" | "mobile" = "extension") {
    const start = clientKind === "extension"
      ? { clientKind, codeChallenge: pkceChallenge("v".repeat(43)), codeChallengeMethod: "S256" as const, scheduleId }
      : { clientKind, codeChallenge: pkceChallenge("v".repeat(43)), codeChallengeMethod: "S256" as const };
    const pending = await grants.start(start);
    await grants.approve(pending.userCode, account, "approve");
    return (await grants.exchange(pending.deviceCode, "v".repeat(43))).accessToken;
  }
  const previewUrl = (t = term, classNumber = "10234") => `${origin}/api/v1/extension/preview/${t}/${classNumber}`;
  const preview = (token: string | null, url = previewUrl(), extraHeaders: Record<string, string> = {}) =>
    http.preview(new Request(url, { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...extraHeaders } }), { term: url.split("/")[7] ?? term, classNumber: url.split("/")[8] ?? "10234" });
  const add = (token: string, body: unknown) =>
    http.commands(new Request(`${origin}/api/v1/extension/commands`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body),
    }));
  return { grants, store, http, issue, preview, previewUrl, add, asAccount: (id: string) => { account = id; } };
}

const addCommand = (overrides: Record<string, unknown> = {}) => ({
  command: "add-option", operationId: "op-1", scheduleId, optionId: extensionOptionId(csce2110Later) as string,
  expectedRevision: 1, ...overrides,
});

/** Parses a route response through the extension client's own guards: the
 * client rejects any response these fail, so the routes must never send one. */
const readPreview = async (response: Response) => {
  const body: unknown = await response.json();
  expect(isPreview(body)).toBe(true);
  return extensionPreviewSchema.parse(body);
};
const readAddReply = async (response: Response) => {
  const body: unknown = await response.json();
  expect(isAddReply(body)).toBe(true);
  return extensionAddReplySchema.parse(body);
};

describe("extension previews", () => {
  test("a clear section states the meeting, seats and the revision it checked", async () => {
    const h = setup();
    const response = await h.preview(await h.issue());
    expect(response.status).toBe(200);
    const preview = await readPreview(response);
    expect(preview.conflict).toBe("clear");
    expect(preview.title).toBe("CSCE 1030");
    expect(String(preview.optionId)).toBe(extensionOptionId(csce1030) as string);
    expect(preview.revision).toBe(1);
    expect(preview.meetings?.[0]).toEqual({ days: "Mon", time: "9:00 AM to 10:30 AM", room: "F151" });
    expect(preview.details.some(detail => detail.includes("3 of 40 seats"))).toBe(true);
  });

  test("an overlap with a picked course and with a busy block is a conflict naming both", async () => {
    const busy = [{ id: "work", label: "Work shift", day: "Tue" as const, start: 575, end: 600 }];
    const h = setup({
      sections,
      scheduleBody: scheduleBody({ courses: ["CSCE 1030", "CSCE 2110"], selectedSections: { "CSCE 1030": csce1030.id, "CSCE 2110": csce2110.id } }),
      preferences: preferences(busy),
    });
    const token = await h.issue();
    // CSCE 2110 section 001 overlaps CSCE 1030 on Monday...
    const withCourse = await readPreview(await h.preview(token, h.previewUrl(term, "20111")));
    expect(withCourse.conflict).toBe("conflict");
    expect(withCourse.clashes).toEqual([{ kind: "course", name: "CSCE 1030", when: "Mon 9:30 AM to 10:30 AM" }]);
    // ...and section 002 overlaps the Tuesday busy block only.
    const withBusy = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(withBusy.conflict).toBe("conflict");
    expect(withBusy.clashes).toEqual([{ kind: "busy", name: "Work shift", when: "Tue 9:35 AM to 10:00 AM" }]);
  });

  test("unknown verdicts name why: missing section, no schedule, term mismatch, TBA, stale pick", async () => {
    const hMissing = setup({ sections, scheduleBody: null });
    const noSchedule = await readPreview(await hMissing.preview(await hMissing.issue()));
    expect(noSchedule.conflict).toBe("unknown");
    expect(noSchedule.unknownReason).toBe("schedule-unavailable");
    expect(noSchedule.details.join(" ")).toContain("Sign in");

    const hNotFound = setup({ sections, scheduleBody: null });
    const unknownClass = await readPreview(await hNotFound.preview(await hNotFound.issue(), hNotFound.previewUrl(term, "99999")));
    expect(unknownClass.conflict).toBe("unknown");
    expect(unknownClass.unknownReason).toBe("schedule-unavailable");
    expect(unknownClass.details.join(" ")).toContain("99999");

    const hTerm = setup({ sections, scheduleBody: scheduleBody({ termId: "fall-2027" }) });
    const otherTerm = await readPreview(await hTerm.preview(await hTerm.issue()));
    expect(otherTerm.conflict).toBe("unknown");
    expect(otherTerm.unknownReason).toBe("schedule-unavailable");
    expect(otherTerm.details.join(" ")).toContain("fall-2027");

    const hTba = setup({ sections, scheduleBody: scheduleBody() });
    const tba = await readPreview(await hTba.preview(await hTba.issue(), hTba.previewUrl(term, "30100")));
    expect(tba.conflict).toBe("unknown");
    expect(tba.unknownReason).toBe("no-set-time");

    const hStale = setup({
      sections,
      scheduleBody: scheduleBody({ courses: ["CSCE 1030", "MATH 2000"], selectedSections: { "CSCE 1030": csce1030.id, "MATH 2000": "vsb:old:pick" } }),
    });
    const stalePick = await readPreview(await hStale.preview(await hStale.issue()));
    expect(stalePick.conflict).toBe("unknown");
    expect(stalePick.unknownReason).toBe("schedule-time-missing");
    expect(stalePick.details.join(" ")).toContain("MATH 2000");

    const hDown = setup({ sections: null, scheduleBody: null });
    const down = await readPreview(await hDown.preview(await hDown.issue()));
    expect(down.conflict).toBe("unknown");
    expect(down.unknownReason).toBe("schedule-unavailable");
  });

  test("a section already picked in Main says so", async () => {
    const h = setup();
    const preview = await readPreview(await h.preview(await h.issue()));
    expect(preview.inSchedule).toBe(true);
  });

  test("first- and second-half 8-week sections at one time never clash, and dated busy blocks bite only in their weeks", async () => {
    const firstHalf = { start: "2027-01-11", end: "2027-03-05", raw: "" };
    const secondHalf = { start: "2027-03-15", end: "2027-05-07", raw: "" };
    const hist = section("HIST 2610", "001", ["41001"], [meeting({ dates: firstHalf })]);
    const psci = section("PSCI 1040", "001", ["41002"], [meeting({ dates: secondHalf })]);
    const psciFull = section("PSCI 1040", "002", ["41003"], [meeting()]);
    // Monday 2027-03-15, inside the second half only.
    const busy = [{ id: "exam", label: "Exam", day: "Mon" as const, start: 540, end: 600, dates: [{ start: "2027-03-15", end: "2027-03-15" }] }];
    const h = setup({
      sections: [hist, psci, psciFull],
      scheduleBody: scheduleBody({ courses: ["HIST 2610"], selectedSections: { "HIST 2610": hist.id } }),
      preferences: preferences(busy),
    });
    const token = await h.issue();
    const halves = await readPreview(await h.preview(token, h.previewUrl(term, "41002")));
    expect(halves.clashes).toEqual([{ kind: "busy", name: "Exam", when: "Mon 9:00 AM to 10:00 AM" }]);
    // A full-term section meets during the first half, so it clashes with HIST 2610 and the exam both.
    const full = await readPreview(await h.preview(token, h.previewUrl(term, "41003")));
    expect(full.clashes).toEqual([
      { kind: "course", name: "HIST 2610", when: "Mon 9:00 AM to 10:30 AM" },
      { kind: "busy", name: "Exam", when: "Mon 9:00 AM to 10:00 AM" },
    ]);
    // HIST 2610 ends before the exam's week.
    const h2 = setup({ sections: [hist], scheduleBody: scheduleBody({ courses: [], selectedSections: {} }), preferences: preferences(busy) });
    expect((await readPreview(await h2.preview(await h2.issue(), h2.previewUrl(term, "41001")))).conflict).toBe("clear");
  });

  test("another section of a course already in Main is checked as its replacement, not against itself", async () => {
    const csce1030Other = section("CSCE 1030", "002", ["10235"], [meeting()]);
    const h = setup({ sections: [...sections, csce1030Other], scheduleBody: scheduleBody() });
    const preview = await readPreview(await h.preview(await h.issue(), h.previewUrl(term, "10235")));
    expect(preview.conflict).toBe("clear");
    expect(preview.inSchedule).toBe(false);
    // A pick of the same course that the term data no longer lists is replaced too, so it leaves no unknown.
    const stale = setup({
      sections: [...sections, csce1030Other],
      scheduleBody: scheduleBody({ selectedSections: { "CSCE 1030": "vsb:old:pick" } }),
    });
    expect((await readPreview(await stale.preview(await stale.issue(), stale.previewUrl(term, "10235")))).conflict).toBe("clear");
    // A pinned pick can't be replaced by add-option, and the preview says so.
    const pinned = setup({
      sections: [...sections, csce1030Other],
      scheduleBody: scheduleBody({ lockedSections: { "CSCE 1030": csce1030.id } }),
    });
    const pinnedPreview = await readPreview(await pinned.preview(await pinned.issue(), pinned.previewUrl(term, "10235")));
    expect(pinnedPreview.details).toContain("Main pins another CSCE 1030 section. Unpin it in UNTangle to switch.");
  });

  test("a class number shared by several options names the option it is the primary component of", async () => {
    const component = (classNumber: string, role: "primary" | "required-linked") => ({
      id: classNumber, classNumber, sectionCode: role === "primary" ? "001" : "101", role,
      instructor: { display: null, raw: "" }, seats: { open: 3, total: 40 }, meetings: [meeting()],
    });
    // Listed first: lecture 50001 with the linked 50100. Second: 50100 is its own primary.
    const linked = { ...section("BIOL 1710", "001", ["50001", "50100"], [meeting()]), components: [component("50001", "primary"), component("50100", "required-linked")] };
    const primary = { ...section("BIOL 1720", "001", ["50100"], [meeting()]), components: [component("50100", "primary")] };
    const h = setup({ sections: [linked, primary], scheduleBody: scheduleBody({ courses: [], selectedSections: {} }) });
    const preview = await readPreview(await h.preview(await h.issue(), h.previewUrl(term, "50100")));
    expect(preview.title).toBe("BIOL 1720");
    expect(String(preview.optionId)).toBe(extensionOptionId(primary) as string);
  });

  test("a midnight end reads AM, a meeting without a day is not Monday, and an empty busy label reads Busy", async () => {
    const late = section("MUAG 1000", "001", ["60001"], [meeting({ day: "Thu", startMinutes: 1320, endMinutes: 1440 })]);
    const online = section("MUAG 1001", "001", ["60002"], [meeting({ async: true, day: null, startMinutes: null, endMinutes: null })]);
    const busy = [{ id: "blank", label: "  ", day: "Thu" as const, start: 1380, end: 1440 }];
    const h = setup({ sections: [...sections, late, online], scheduleBody: scheduleBody(), preferences: preferences(busy) });
    const token = await h.issue();
    const night = await readPreview(await h.preview(token, h.previewUrl(term, "60001")));
    expect(night.meetings?.[0]?.time).toBe("10:00 PM to 12:00 AM");
    expect(night.clashes).toEqual([{ kind: "busy", name: "Busy", when: "Thu 11:00 PM to 12:00 AM" }]);
    expect((await readPreview(await h.preview(token, h.previewUrl(term, "60002")))).meetings?.[0]?.days).toBe("Online");
    expect((await readPreview(await h.preview(token, h.previewUrl(term, "30100")))).meetings?.[0]?.days).toBe("TBA");
  });

  test("busy blocks come only from the preferences of Main's institution", async () => {
    const busy = [{ id: "work", label: "Work shift", day: "Mon" as const, start: 540, end: 600 }];
    const h = setup({ sections, scheduleBody: scheduleBody(), preferences: { ...preferences(busy), institutionId: "other-school" as PreferencesBody["institutionId"] } });
    expect((await readPreview(await h.preview(await h.issue()))).conflict).toBe("clear");
  });
});

describe("extension add-option commands", () => {
  test("adds the option as the course's pick and commits one receipt", async () => {
    const h = setup();
    const token = await h.issue();
    const response = await h.add(token, addCommand());
    expect(response.status).toBe(200);
    const reply = await readAddReply(response);
    if (reply.kind !== "receipt") throw new Error(`expected a receipt, got ${reply.kind}`);
    expect(`${reply.operationId}`).toBe("op-1");
    expect(reply.committedRevision).toBe(2);
    const document = await h.store.getDocument("alice", scheduleId);
    expect(document.body).toMatchObject({
      courses: ["CSCE 1030", "CSCE 2110"],
      selectedSections: { "CSCE 1030": csce1030.id, "CSCE 2110": csce2110Later.id },
    });
  });

  test("a retry of the same command returns the original receipt without writing", async () => {
    const h = setup();
    const token = await h.issue();
    const first = await h.add(token, addCommand());
    expect(first.status).toBe(200);
    const second = await h.add(token, addCommand());
    expect(second.status).toBe(200);
    expect(await readAddReply(second)).toEqual(await readAddReply(first));
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(2);
  });

  test("an operation id reused for a different command is refused, not acknowledged", async () => {
    const h = setup();
    const token = await h.issue();
    const first = await h.add(token, addCommand());
    expect(first.status).toBe(200);
    // Same operation id, different option, while the schedule still stands at
    // the committed revision: the rebuilt bytes cannot match, and the reply is
    // the client's own forbidden rejection — never the first command's receipt.
    const reused = await h.add(token, addCommand({ optionId: extensionOptionId(csce2110) as string }));
    expect(reused.status).toBe(409);
    const reusedReply = await readAddReply(reused);
    if (reusedReply.kind !== "rejection") throw new Error(`expected a rejection, got ${reusedReply.kind}`);
    expect(reusedReply.reason).toBe("forbidden");
    // A reuse whose expected revision doesn't fit the receipt's commit is the
    // same refusal: the receipt committed one past the original command's
    // expected revision, not this one's.
    const reusedRevision = await h.add(token, addCommand({ expectedRevision: 99 }));
    expect(reusedRevision.status).toBe(409);
    const reusedRevisionReply = await readAddReply(reusedRevision);
    if (reusedRevisionReply.kind !== "rejection") throw new Error(`expected a rejection, got ${reusedRevisionReply.kind}`);
    expect(reusedRevisionReply.reason).toBe("forbidden");
    // The original command's commit stands untouched.
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(2);
  });

  test("a retry while the term data is unavailable is 503, so the extension retries again", async () => {
    const options = { sections: sections as Section[] | null, scheduleBody: scheduleBody() as unknown };
    const h = setup(options);
    const token = await h.issue();
    const first = await readAddReply(await h.add(token, addCommand()));
    options.sections = null;
    const unavailable = await h.add(token, addCommand());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "unavailable" });
    options.sections = sections;
    expect(await readAddReply(await h.add(token, addCommand()))).toEqual(first);
  });

  test("unavailable term data is 503, not a not-found verdict", async () => {
    const h = setup({ sections: null, scheduleBody: scheduleBody() });
    const response = await h.add(await h.issue(), addCommand());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
  });

  test("a write that lands between the read and the commit is never overwritten", async () => {
    const h = setup();
    const token = await h.issue();
    const store = h.store as unknown as { getDocument: (userId: string, documentId: string) => Promise<Document> };
    const original = store.getDocument.bind(h.store);
    // The command reads revision 1; a pin is saved on the web as revision 2;
    // the command expects revision 2, so the compare-and-set alone would pass.
    store.getDocument = async (userId, documentId) => {
      const read = await original(userId, documentId);
      await h.store.write("alice", new TextEncoder().encode(JSON.stringify({
        operationId: "web-pin", documentId: scheduleId, kind: "schedule", baseRevision: 1, schemaVersion: 1,
        body: scheduleBody({ lockedSections: { "CSCE 1030": csce1030.id } }),
      })), scheduleId);
      return read;
    };
    const response = await h.add(token, addCommand({ expectedRevision: 2 }));
    store.getDocument = original;
    expect(response.status).toBe(409);
    expect(await readAddReply(response)).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    expect((await h.store.getDocument("alice", scheduleId)).body).toMatchObject({ lockedSections: { "CSCE 1030": csce1030.id } });
  });

  test("a retry answered after the schedule moved returns the original receipt", async () => {
    const h = setup();
    const token = await h.issue();
    const first = await h.add(token, addCommand());
    expect(first.status).toBe(200);
    const originalReply = await readAddReply(first);
    // The student edits Main on the web: the schedule moves past the revision
    // the add committed, and the extension's response was lost in between.
    await h.store.write(
      "alice",
      new TextEncoder().encode(
        JSON.stringify({
          operationId: "web-edit-1", documentId: scheduleId, kind: "schedule", baseRevision: 2, schemaVersion: 1,
          body: scheduleBody({ name: "Main (edited on the web)" }),
        }),
      ),
      scheduleId,
    );
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(3);
    // The retry is the same command: answered with the original receipt, and
    // nothing is written again.
    const retry = await h.add(token, addCommand());
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReply);
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(3);
  });

  test("a storage failure is 503, never a not-found verdict", async () => {
    const h = setup();
    const token = await h.issue();
    const store = h.store as unknown as { getDocument: () => Promise<Document> };
    const original = store.getDocument;
    store.getDocument = async () => {
      throw new SyncError(503, "CONNECTION_FAILED", "The database is unreachable.");
    };
    const response = await h.add(token, addCommand());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    store.getDocument = original;
    expect(await h.store.receipt("alice", "op-1")).toBeNull();
  });

  test("a schedule deleted between the read and the write is not-found", async () => {
    const h = setup();
    const token = await h.issue();
    const store = h.store as unknown as { write: () => Promise<Receipt> };
    const original = store.write;
    store.write = async () => {
      throw new SyncError(409, "DOCUMENT_DELETED", "This document was deleted. Save it as a new document.", 1);
    };
    const response = await h.add(token, addCommand());
    expect(response.status).toBe(422);
    const reply = await readAddReply(response);
    if (reply.kind !== "rejection") throw new Error(`expected a rejection, got ${reply.kind}`);
    expect(reply.reason).toBe("not-found");
    store.write = original;
  });

  test("a retry after adding onto a schedule that already has picks returns the original receipt", async () => {
    // Postgres stores bodies as jsonb, which re-sorts object keys, so once the
    // schedule carries another course's pick the rebuilt write bytes can never
    // reproduce the receipt's hash. The replay verifies the committed effect:
    // the command's option is the pick recorded for its course.
    const h = setup({
      sections,
      scheduleBody: scheduleBody({ courses: ["MATH 1710"], selectedSections: { "MATH 1710": "vsb:spring-2027:MATH 1710:001" } }),
    });
    const token = await h.issue();
    const add = addCommand({ optionId: extensionOptionId(csce1030) as string });
    const first = await h.add(token, add);
    expect(first.status).toBe(200);
    const originalReply = await readAddReply(first);
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(2);
    const retry = await h.add(token, add);
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReply);
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(2);
  });

  test("a stale expected revision is a typed rejection, never an overwrite", async () => {
    const h = setup();
    const token = await h.issue();
    await h.add(token, addCommand()); // schedule is now revision 2
    const stale = await h.add(token, addCommand({ operationId: "op-2", expectedRevision: 1 }));
    expect(stale.status).toBe(409);
    const reply = await readAddReply(stale);
    if (reply.kind !== "rejection") throw new Error(`expected a rejection, got ${reply.kind}`);
    expect(reply.reason).toBe("stale-revision");
    // The operation stays uncommitted, so a fresh preview then reconfirm works.
    expect(await h.store.receipt("alice", "op-2")).toBeNull();
  });

  test("a pinned pick and a foreign institution are forbidden", async () => {
    const locked = setup({
      sections,
      scheduleBody: scheduleBody({
        courses: ["CSCE 1030", "CSCE 2110"],
        selectedSections: { "CSCE 1030": csce1030.id, "CSCE 2110": csce2110.id },
        lockedSections: { "CSCE 2110": csce2110.id },
      }),
    });
    const lockedReply = await locked.add(await locked.issue(), addCommand());
    expect(lockedReply.status).toBe(403);
    const lockedBody = await readAddReply(lockedReply);
    if (lockedBody.kind !== "rejection") throw new Error(`expected a rejection, got ${lockedBody.kind}`);
    expect(lockedBody.reason).toBe("forbidden");

    const foreign = setup({ sections, scheduleBody: scheduleBody({ institutionId: "ut" }) });
    const foreignReply = await foreign.add(await foreign.issue(), addCommand());
    expect(foreignReply.status).toBe(403);
    const foreignBody = await readAddReply(foreignReply);
    if (foreignBody.kind !== "rejection") throw new Error(`expected a rejection, got ${foreignBody.kind}`);
    expect(foreignBody.reason).toBe("forbidden");
  });

  test("an unknown option id is not-found and keeps the operation uncommitted", async () => {
    const h = setup();
    const response = await h.add(await h.issue(), addCommand({ optionId: "CSCE1030-99999" }));
    expect(response.status).toBe(422);
    const reply = await readAddReply(response);
    if (reply.kind !== "rejection") throw new Error(`expected a rejection, got ${reply.kind}`);
    expect(reply.reason).toBe("not-found");
    expect((await h.store.getDocument("alice", scheduleId)).revision).toBe(1);
  });
});

describe("extension boundary", () => {
  test("extension grants only, and only against their bound schedule", async () => {
    const h = setup();
    const mobile = await h.issue("mobile");
    // Wrong kind and insufficient scope are 401: the extension answers them by
    // asking the student to sign in again. 403 is a command rejection only.
    const mobilePreview = await h.preview(mobile);
    expect(mobilePreview.status).toBe(401);
    expect((await mobilePreview.json()).error).toBe("insufficient_scope");
    expect((await h.add(mobile, addCommand({ scheduleId: "sched-other-1" }))).status).toBe(401);

    const token = await h.issue();
    const other = await h.add(token, addCommand({ scheduleId: "sched-other-1" }));
    expect(other.status).toBe(401);
    expect((await other.json()).error).toBe("insufficient_scope");
    expect(await h.store.getDocument("alice", scheduleId)).toBeTruthy();
  });

  test("credentials and origins follow the device routes", async () => {
    const h = setup();
    expect((await h.preview(null)).status).toBe(401);
    // A cookie alongside a token is refused, never resolved implicitly.
    const withCookie = await h.preview(await h.issue(), h.previewUrl(), { cookie: "better-auth.session=1" });
    expect(withCookie.status).toBe(400);
    // A different extension origin gets no CORS echo and no access: 400 with a
    // typed code, since 403 is a command rejection only.
    const foreign = await h.preview(null, h.previewUrl(), { origin: `chrome-extension://${"b".repeat(32)}` });
    expect(foreign.status).toBe(400);
    expect((await foreign.json()).error).toBe("forbidden_origin");
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    // The allowed extension origin gets the echo, with no credentials header.
    const allowed = await h.preview(null, h.previewUrl(), { origin: extension });
    expect(allowed.headers.get("access-control-allow-origin")).toBe(extension);
    expect(allowed.headers.get("access-control-allow-credentials")).toBeNull();
    expect(allowed.headers.get("vary")).toBe("Origin");
    // A malformed body is a typed 400, not a server error.
    expect((await h.add(await h.issue(), { command: "drop-everything" })).status).toBe(400);
  });

  test("a revoked token is 401 with a typed code, so the extension asks for sign-in", async () => {
    const h = setup();
    const token = await h.issue();
    await h.grants.revoke(token);
    const response = await h.preview(token);
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("invalid_token");
    expect((await h.add(token, addCommand())).status).toBe(401);
  });
});

describe("extension option ids", () => {
  test("round-trip between the extension id and the term's sections", () => {
    const linked = section("ACCT 3120", "501", ["40220", "40221"], [meeting({ day: "Wed" })]);
    const id = extensionOptionId(linked);
    expect(id).toBe("ACCT3120-40220-40221");
    expect(parseExtensionOptionId(id as string)).toEqual({ courseCode: "ACCT 3120", classNumbers: ["40220", "40221"] });
    expect(sectionMatchesOptionId(linked, id as string)).toBe(true);
    expect(sectionMatchesOptionId(csce1030, id as string)).toBe(false);
    // Sample sections without class numbers get no extension id.
    expect(extensionOptionId(section("MATH 2000", "001", [], []))).toBeNull();
  });
});
