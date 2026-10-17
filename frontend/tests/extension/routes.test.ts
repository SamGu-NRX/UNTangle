/**
 * The extension routes against an in-memory store with the document-sync
 * decision logic real writes use. Pins: every preview verdict (clear, conflict
 * by course and by busy block, each unknown reason), the add-command path
 * (receipt, same-command replay, reused-operation refusal, stale revision,
 * pinned lock), which Main a preview or add uses (the term's, picked as the
 * web planner picks it, created by a first add), and the boundary (extension
 * grants bound to the Main role only, origin rules, no cookie credentials,
 * revoked tokens). Every success and rejection body is fed through the
 * extension client's own guards, copied in extension-api-guards.ts. The
 * Postgres path runs in postgres-live.test.ts.
 */
import { describe, expect, test } from "bun:test";
import { createDeviceGrants, pkceChallenge } from "@/server/auth/device-grants";
import { createExtensionHttp } from "@/server/extension/http";
import type { ExtensionStore } from "@/server/extension/commands";
import { parseWrite, SyncError, decideWrite, type CurrentDocument } from "@/lib/document-sync/decision";
import { extensionPreviewSchema, extensionAddReplySchema } from "@/server/extension/extension-api";
import { extensionOptionId, parseExtensionOptionId, sectionMatchesOptionId } from "@/server/extension/option-id";
import { plannedTerms } from "@/server/extension/main-schedule";
import { termDates } from "@/lib/planner-sections";
import { DocumentSchema, type Document, type DocumentKind, type PreferencesBody } from "../../../packages/contracts/src/documents";
import type { Receipt } from "../../../packages/contracts/src/sync";
import type { Section } from "@/lib/sections/model";
import { vsbSectionId } from "@/lib/sections/vsb";
import type { RemoteDocument } from "@untangle/sync";
import { splitPlanner } from "@/lib/planner-documents";
import { defaultSchedulePreferences, getInitialPlannerState } from "@/lib/planner";
import type { PlannerSyncIO } from "@/lib/sync/planner-sync";
import type { StoredDocumentEntry } from "@/server/extension/main-schedule";
import { MemoryDeviceStore } from "../device-grants/memory-store";
import { isAddReply, isPreview } from "./extension-api-guards";
import { webPlannerView } from "./web-planner";

const origin = "https://untangle.example";
const extension = `chrome-extension://${"a".repeat(32)}`;
/** What the extension sends to device/start and in every command: the Main role. */
const role = "main";
const term = "spring-2027";
/** The web planner's id for spring-2027's Main (firstDocumentId.schedule). */
const mainId = "main-unt-spring-2027";

const meeting = (overrides: Partial<Section["meetings"][number]> = {}) => ({
  room: "F151", buildingCode: null, buildingId: null, buildingName: "Fossil Green Hall",
  kind: "building" as const, offCampus: false, day: "Mon" as const,
  startMinutes: 540, endMinutes: 630, dates: { start: null, end: null, raw: "" },
  instructor: { display: null, raw: "" }, async: false, tba: false, ...overrides,
});

const section = (courseCode: string, sectionCode: string, classNumbers: string[], meetings: Section["meetings"], sectionTerm = term): Section => ({
  id: vsbSectionId(sectionTerm, courseCode, classNumbers), term: sectionTerm, courseCode, sectionCode, classNumbers,
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

/** A store with the real write decision logic and plain in-memory tables, for one account. */
class MemoryExtensionStore implements ExtensionStore {
  #documents = new Map<string, { kind: DocumentKind; revision: number; institutionId: string; deleted: boolean; body: unknown }>();
  #receipts = new Map<string, Receipt>();
  preferencesBody: PreferencesBody | null = null;

  seed(documentId: string, body: unknown) { this.#documents.set(documentId, { kind: "schedule", revision: 1, institutionId: "unt", deleted: false, body }); }

  /** A schedule another device deleted, leaving its tombstone. */
  seedDeleted(documentId: string) { this.#documents.set(documentId, { kind: "schedule", revision: 2, institutionId: "unt", deleted: true, body: null }); }

  async documents(): Promise<StoredDocumentEntry[]> {
    return [...this.#documents].map(([documentId, document]) => ({
      documentId, kind: document.kind, revision: document.revision,
      body: document.kind === "schedule" && !document.deleted ? document.body : null,
    }));
  }

  /** The document as GET /api/v1/documents/:id returns it; a test reads through this. */
  async getDocument(userId: string, documentId: string): Promise<Document> {
    const document = this.#documents.get(documentId);
    if (!document || document.deleted) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
    return DocumentSchema.parse({ documentId, kind: document.kind, revision: document.revision, schemaVersion: 1, body: document.body });
  }

  /** The web planner's transport over these tables: the pull list and document reads, as /api/v1 serves them. */
  syncIO(): PlannerSyncIO {
    return {
      operationId: () => crypto.randomUUID(),
      sha256: async () => { throw new Error("The web planner only reads in these tests."); },
      push: async () => { throw new Error("The web planner only reads in these tests."); },
      fetch: async (userId, documentId) => (await this.getDocument(userId, documentId)) as RemoteDocument,
      pullList: async () => ({
        kind: "list",
        list: [...this.#documents].map(([documentId, document]) => ({ documentId, kind: document.kind, revision: document.revision, deleted: document.deleted })),
      }),
    };
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
      kind: write.kind, revision: decision.revision, institutionId: decision.institutionId, deleted: decision.deleted, body: decision.body,
    });
    const receipt: Receipt = { userId, operationId: write.operationId, writeSha256, committedRevision: decision.revision };
    this.#receipts.set(write.operationId, receipt);
    return receipt;
  }
}

type SetupOptions = {
  /** Every term's sections; a term's request gets those whose term it is. Null while the term files are down. */
  sections: Section[] | null;
  /** Spring 2027's Main, seeded at the web planner's id; null for an account with no Main. */
  scheduleBody: unknown | null;
  preferences?: PreferencesBody | null;
};

function setup(options: SetupOptions = { sections, scheduleBody: scheduleBody() }) {
  const grants = createDeviceGrants(new MemoryDeviceStore());
  const store = new MemoryExtensionStore();
  if (options.scheduleBody) store.seed(mainId, options.scheduleBody);
  if (options.preferences !== undefined) store.preferencesBody = options.preferences;
  /** Every term whose section data a route asked for. */
  const sectionReads: string[] = [];
  const termSections = async (t: string) => {
    sectionReads.push(t);
    return options.sections?.filter((candidate) => candidate.term === t) ?? null;
  };
  const http = createExtensionHttp({ grants, store, sections: { termSections }, origin, extensionOrigins: [extension] });
  let account = "alice";
  async function issue(clientKind: "extension" | "mobile" = "extension", scheduleId = role) {
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
  return { grants, store, http, issue, preview, previewUrl, add, sectionReads, asAccount: (id: string) => { account = id; } };
}

const addCommand = (overrides: Record<string, unknown> = {}) => ({
  command: "add-option", operationId: "op-1", scheduleId: role, optionId: extensionOptionId(csce2110Later) as string,
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

  test("unknown verdicts name why: missing section, TBA, stale pick, term data down", async () => {
    const hNotFound = setup({ sections, scheduleBody: null });
    const unknownClass = await readPreview(await hNotFound.preview(await hNotFound.issue(), hNotFound.previewUrl(term, "99999")));
    expect(unknownClass.conflict).toBe("unknown");
    expect(unknownClass.unknownReason).toBe("schedule-unavailable");
    expect(unknownClass.details.join(" ")).toContain("99999");

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

  test("every term the planner plans has dates, so no planned term is checked against another term's", () => {
    expect(plannedTerms.length).toBeGreaterThan(0);
    for (const planned of plannedTerms) expect(termDates[planned.id]).toBeDefined();
  });

  test("a class search for a term the planner doesn't plan names the term it does plan, and reads nothing", async () => {
    const fall = section("CSCE 1030", "001", ["10234"], [meeting()], "fall-2026");
    const h = setup({ sections: [...sections, fall], scheduleBody: scheduleBody() });
    let documentReads = 0;
    const store = h.store as unknown as { documents: (userId: string) => Promise<StoredDocumentEntry[]> };
    const documents = store.documents.bind(h.store);
    store.documents = async (userId) => { documentReads++; return documents(userId); };
    const preview = await readPreview(await h.preview(await h.issue(), h.previewUrl("fall-2026", "10234")));
    expect(preview).toMatchObject({ conflict: "unknown", unknownReason: "schedule-unavailable", revision: 0, title: "10234" });
    expect(preview.details).toEqual(["UNTangle plans Spring 2027 right now; this class search is Fall 2026."]);
    expect(documentReads).toBe(0);
    expect(h.sectionReads).toEqual([]);
  });

  test("a course clashing with many meetings is one row, leaving room for busy clashes", async () => {
    const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
    const allWeek = section("PHYS 1710", "001", ["70001"], days.map((day) => meeting({ day, startMinutes: 480, endMinutes: 720 })));
    // 13 meetings, every one inside PHYS 1710's mornings.
    const busyWeek = section("PHYS 1730", "001", ["70002"], [
      ...days.map((day) => meeting({ day, startMinutes: 540, endMinutes: 600 })),
      ...days.slice(0, 6).map((day) => meeting({ day, startMinutes: 600, endMinutes: 660 })),
    ]);
    const busy = [{ id: "gym", label: "Gym", day: "Sun" as const, start: 540, end: 560 }];
    const h = setup({
      sections: [allWeek, busyWeek],
      scheduleBody: scheduleBody({ courses: ["PHYS 1710"], selectedSections: { "PHYS 1710": allWeek.id } }),
      preferences: preferences(busy),
    });
    const preview = await readPreview(await h.preview(await h.issue(), h.previewUrl(term, "70002")));
    expect(preview.clashes).toEqual([
      { kind: "course", name: "PHYS 1710", when: "Mon 9:00 AM to 10:00 AM" },
      { kind: "busy", name: "Gym", when: "Sun 9:00 AM to 9:20 AM" },
    ]);
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
    const document = await h.store.getDocument("alice", mainId);
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
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
  });

  test("an operation id reused for a different command is refused, not acknowledged", async () => {
    const h = setup();
    const token = await h.issue();
    const first = await h.add(token, addCommand());
    expect(first.status).toBe(200);
    // Same operation id, different option, while the schedule still stands at
    // the committed revision: the option does not match the stored pick, so
    // the reply is forbidden, never the first command's receipt.
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
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
  });

  test("a retry after the committed section leaves the term data returns the original receipt", async () => {
    const options = { sections, scheduleBody: scheduleBody() };
    const h = setup(options);
    const token = await h.issue();
    const committed = await h.add(token, addCommand());
    expect(committed.status).toBe(200);
    const originalReceipt = await readAddReply(committed);
    expect(originalReceipt).toMatchObject({ kind: "receipt", committedRevision: 2 });
    // The response was lost before the section disappeared from the term file.
    options.sections = sections.filter(candidate => candidate.id !== csce2110Later.id);
    const retry = await h.add(token, addCommand());
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReceipt);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
    expect(h.sectionReads).toEqual([term]);
  });

  test("a retry while the term data is unavailable returns the original receipt", async () => {
    const options: SetupOptions = { sections, scheduleBody: scheduleBody() };
    const h = setup(options);
    const token = await h.issue();
    const committed = await h.add(token, addCommand());
    expect(committed.status).toBe(200);
    const originalReceipt = await readAddReply(committed);
    expect(originalReceipt).toMatchObject({ kind: "receipt", committedRevision: 2 });
    options.sections = null;
    const retry = await h.add(token, addCommand());
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReceipt);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
    expect(h.sectionReads).toEqual([term]);
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
    const store = h.store as unknown as { documents: (userId: string) => Promise<StoredDocumentEntry[]> };
    const original = store.documents.bind(h.store);
    // The command reads revision 1; a pin is saved on the web as revision 2;
    // the command expects revision 2, so the compare-and-set alone would pass.
    store.documents = async (userId) => {
      const read = await original(userId);
      await h.store.write("alice", new TextEncoder().encode(JSON.stringify({
        operationId: "web-pin", documentId: mainId, kind: "schedule", baseRevision: 1, schemaVersion: 1,
        body: scheduleBody({ lockedSections: { "CSCE 1030": csce1030.id } }),
      })), mainId);
      return read;
    };
    const response = await h.add(token, addCommand({ expectedRevision: 2 }));
    store.documents = original;
    expect(response.status).toBe(409);
    expect(await readAddReply(response)).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    expect((await h.store.getDocument("alice", mainId)).body).toMatchObject({ lockedSections: { "CSCE 1030": csce1030.id } });
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
          operationId: "web-edit-1", documentId: mainId, kind: "schedule", baseRevision: 2, schemaVersion: 1,
          body: scheduleBody({ name: "Main (edited on the web)" }),
        }),
      ),
      mainId,
    );
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(3);
    // The retry is the same command: answered with the original receipt, and
    // nothing is written again.
    const retry = await h.add(token, addCommand());
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReply);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(3);
  });

  test("a storage failure is 503, never a not-found verdict", async () => {
    const h = setup();
    const token = await h.issue();
    const store = h.store as unknown as { documents: () => Promise<StoredDocumentEntry[]> };
    const original = store.documents;
    store.documents = async () => {
      throw new SyncError(503, "CONNECTION_FAILED", "The database is unreachable.");
    };
    const response = await h.add(token, addCommand());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "unavailable" });
    expect((await h.preview(token)).status).toBe(503);
    store.documents = original;
    expect(await h.store.receipt("alice", "op-1")).toBeNull();
  });

  test("a Main deleted between the read and the write is a stale revision, so the student sees a fresh preview", async () => {
    const h = setup();
    const token = await h.issue();
    const store = h.store as unknown as { documents: (userId: string) => Promise<StoredDocumentEntry[]> };
    const original = store.documents.bind(h.store);
    // The command reads Main at revision 1; the web deletes it before the commit.
    store.documents = async (userId) => {
      const read = await original(userId);
      await h.store.write("alice", new TextEncoder().encode(JSON.stringify({
        operationId: "web-delete", documentId: mainId, kind: "schedule", baseRevision: 1, schemaVersion: 1, body: null,
      })), mainId);
      return read;
    };
    const response = await h.add(token, addCommand());
    store.documents = original;
    expect(response.status).toBe(409);
    expect(await readAddReply(response)).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    expect(await h.store.receipt("alice", "op-1")).toBeNull();
    // The fresh preview reads an empty plan; the deleted id never comes back.
    const fresh = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(fresh.revision).toBe(0);
    await expect(h.store.getDocument("alice", mainId)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  test("a retry whose Main was deleted and made again since returns the original receipt", async () => {
    const h = setup();
    const token = await h.issue();
    const original = await readAddReply(await h.add(token, addCommand()));
    expect(original).toMatchObject({ kind: "receipt", committedRevision: 2 });
    // The response was lost. On the web, the student deletes Main, and the
    // planner makes a new one at the next id, which reaches revision 2
    // without the extension's pick.
    const put = (operationId: string, documentId: string, baseRevision: number, body: unknown) =>
      h.store.write("alice", new TextEncoder().encode(JSON.stringify({ operationId, documentId, kind: "schedule", baseRevision, schemaVersion: 1, body })), documentId);
    await put("web-delete", mainId, 2, null);
    await put("web-new-1", `${mainId}-2`, 0, scheduleBody());
    await put("web-new-2", `${mainId}-2`, 1, scheduleBody({ courses: [], selectedSections: {} }));
    const retry = await h.add(token, addCommand());
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(original);
    expect((await h.store.getDocument("alice", `${mainId}-2`)).revision).toBe(2);
  });

  test("a copy of the command that commits after this one's receipt lookup is answered with its receipt", async () => {
    const h = setup();
    const token = await h.issue();
    const first = await readAddReply(await h.add(token, addCommand()));
    // The second copy looked for a receipt just before the first committed, so
    // it reads Main one revision past the one it expects.
    const store = h.store as unknown as { receipt: (userId: string, operationId: string) => Promise<Receipt | null> };
    const receipt = store.receipt.bind(h.store);
    let lookups = 0;
    store.receipt = async (userId, operationId) => (lookups++ === 0 ? null : receipt(userId, operationId));
    const copy = await h.add(token, addCommand());
    store.receipt = receipt;
    expect(copy.status).toBe(200);
    expect(await readAddReply(copy)).toEqual(first);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
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
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
    const retry = await h.add(token, add);
    expect(retry.status).toBe(200);
    expect(await readAddReply(retry)).toEqual(originalReply);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(2);
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

  test("an unknown option id, or one without a term, is not-found and keeps the operation uncommitted", async () => {
    const h = setup();
    const token = await h.issue();
    // An earlier build's previews named options without their term.
    for (const optionId of [`${term}-CSCE1030-99999`, "CSCE2110-20112"]) {
      const response = await h.add(token, addCommand({ operationId: crypto.randomUUID(), optionId }));
      expect(response.status).toBe(422);
      const reply = await readAddReply(response);
      if (reply.kind !== "rejection") throw new Error(`expected a rejection, got ${reply.kind}`);
      expect(reply.reason).toBe("not-found");
    }
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(1);
  });
});

/** The add the panel sends when the student confirms a preview: its schedule, option and revision, echoed (worker-controller.ts on edge). */
const confirmed = (preview: { scheduleId: string; optionId: string; revision: number }, operationId = crypto.randomUUID()) => ({
  command: "add-option", operationId, scheduleId: preview.scheduleId, optionId: preview.optionId, expectedRevision: preview.revision,
});

describe("which Main the extension uses", () => {
  test("an add for spring-2027 appears in the web planner's Main for spring-2027", async () => {
    const h = setup();
    const token = await h.issue();
    const preview = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(preview).toMatchObject({ scheduleId: role, revision: 1, conflict: "clear" });
    expect(await readAddReply(await h.add(token, confirmed(preview)))).toMatchObject({ kind: "receipt", committedRevision: 2 });
    const week = await webPlannerView(h.store.syncIO(), "alice", term);
    expect(week.planned.toSorted()).toEqual(["CSCE 1030", "CSCE 2110"]);
    expect(week.picks).toEqual({ "CSCE 1030": csce1030.id, "CSCE 2110": csce2110Later.id });
  });

  test("an add for a term the planner doesn't plan is refused and never makes or changes that term's Main", async () => {
    // myUNT gives fall-2027's CSCE 2110 the class number spring's section 002 has.
    const fallCsce2110 = section("CSCE 2110", "003", ["20112"], [meeting({ day: "Thu" })], "fall-2027");
    const h = setup({ sections: [...sections, fallCsce2110], scheduleBody: scheduleBody() });
    // A fall Main an older import left behind; Week doesn't show it.
    h.store.seed("main-unt-fall-2027", scheduleBody({ termId: "fall-2027", courses: ["MATH 1710"], selectedSections: {} }));
    const token = await h.issue();
    const preview = await readPreview(await h.preview(token, h.previewUrl("fall-2027", "20112")));
    expect(preview.details).toEqual(["UNTangle plans Spring 2027 right now; this class search is Fall 2027."]);
    for (const expectedRevision of [0, 1]) {
      const refused = await h.add(token, addCommand({ operationId: crypto.randomUUID(), optionId: extensionOptionId(fallCsce2110) as string, expectedRevision }));
      expect(refused.status).toBe(403);
      expect(await readAddReply(refused)).toMatchObject({ kind: "rejection", reason: "forbidden" });
    }
    expect(await h.store.getDocument("alice", "main-unt-fall-2027")).toMatchObject({ revision: 1, body: { courses: ["MATH 1710"] } });
    expect(await h.store.getDocument("alice", mainId)).toMatchObject({ revision: 1, body: scheduleBody() });
    // With no fall Main at all, nothing is created either.
    const fresh = setup({ sections: [...sections, fallCsce2110], scheduleBody: null });
    const refused = await fresh.add(await fresh.issue(), addCommand({ optionId: extensionOptionId(fallCsce2110) as string, expectedRevision: 0 }));
    expect(refused.status).toBe(403);
    expect((await fresh.store.documents()).map((entry) => entry.documentId)).toEqual([]);
  });

  test("a new account's preview says its plan is empty, and its first add creates Main as the web planner's first write would", async () => {
    const h = setup({ sections, scheduleBody: null });
    const token = await h.issue();
    const preview = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(preview).toMatchObject({ scheduleId: role, revision: 0, conflict: "clear", inSchedule: false });
    expect(preview.details[0]).toBe("Your Spring 2027 plan in UNTangle is empty.");

    const add = confirmed(preview, "op-first");
    const first = await readAddReply(await h.add(token, add));
    expect(first).toMatchObject({ kind: "receipt", committedRevision: 1 });
    const untouched = splitPlanner(getInitialPlannerState(), defaultSchedulePreferences("compact"), term).schedule;
    expect(await h.store.getDocument("alice", mainId)).toMatchObject({
      revision: 1,
      body: { ...untouched, courses: ["CSCE 2110"], selectedSections: { "CSCE 2110": csce2110Later.id } },
    });
    expect((await webPlannerView(h.store.syncIO(), "alice", term)).picks).toEqual({ "CSCE 2110": csce2110Later.id });

    // A retry is the original receipt; a second confirm of the same empty-plan preview is stale now that Main exists.
    expect(await readAddReply(await h.add(token, add))).toEqual(first);
    const again = await h.add(token, confirmed(preview));
    expect(again.status).toBe(409);
    expect(await readAddReply(again)).toMatchObject({ kind: "rejection", reason: "stale-revision" });
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(1);
  });

  test("a grant approved as \"main\" before Main was a role adds to the term's Main, not a document named main", async () => {
    // The extension has always sent "main" to device/start, so an older grant
    // stored the same value. An account could also hold a document with that
    // literal id, made by hand to get the extension working. Week reads the
    // planner's own id first, so the add goes there too.
    const h = setup();
    h.store.seed("main", scheduleBody({ courses: ["MATH 1710"], selectedSections: {} }));
    const token = await h.issue("extension", "main");
    const preview = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(await readAddReply(await h.add(token, confirmed(preview)))).toMatchObject({ kind: "receipt", committedRevision: 2 });
    expect((await h.store.getDocument("alice", mainId)).body).toMatchObject({ selectedSections: { "CSCE 2110": csce2110Later.id } });
    expect(await h.store.getDocument("alice", "main")).toMatchObject({ revision: 1, body: { courses: ["MATH 1710"] } });
    expect((await webPlannerView(h.store.syncIO(), "alice", term)).picks).toEqual({ "CSCE 1030": csce1030.id, "CSCE 2110": csce2110Later.id });
  });

  test("Main is the document the web planner picks: a replacement after a deletion, and a fresh id once none is live", async () => {
    const h = setup({ sections, scheduleBody: null });
    h.store.seedDeleted(mainId);
    // A saved copy for the term is not Main.
    h.store.seed("copy-1", scheduleBody({ name: "From this browser, Oct 14" }));
    const token = await h.issue();
    const empty = await readPreview(await h.preview(token, h.previewUrl(term, "20112")));
    expect(empty.revision).toBe(0);
    expect(empty.details[0]).toBe("Your Spring 2027 plan in UNTangle is empty.");
    // A deleted id is never reused, so the first add creates the next one.
    expect(await readAddReply(await h.add(token, confirmed(empty)))).toMatchObject({ kind: "receipt", committedRevision: 1 });
    expect((await h.store.getDocument("alice", `${mainId}-2`)).body).toMatchObject({ name: "Main", selectedSections: { "CSCE 2110": csce2110Later.id } });
    expect((await webPlannerView(h.store.syncIO(), "alice", term)).picks).toEqual({ "CSCE 2110": csce2110Later.id });

    // The live replacement is the Main every later preview and add reads.
    const next = await readPreview(await h.preview(token, h.previewUrl(term, "10234")));
    expect(next.revision).toBe(1);
    expect(await readAddReply(await h.add(token, confirmed(next)))).toMatchObject({ kind: "receipt", committedRevision: 2 });
    expect((await webPlannerView(h.store.syncIO(), "alice", term)).picks).toEqual({ "CSCE 2110": csce2110Later.id, "CSCE 1030": csce1030.id });
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

    // A grant bound to a document id rather than the Main role reads and adds nothing.
    const literal = await h.issue("extension", mainId);
    const literalPreview = await h.preview(literal);
    expect(literalPreview.status).toBe(401);
    expect((await literalPreview.json()).error).toBe("insufficient_scope");
    expect((await h.add(literal, addCommand({ scheduleId: mainId }))).status).toBe(401);
    expect((await h.store.getDocument("alice", mainId)).revision).toBe(1);
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
  test("the planner section id sorts class numbers without changing their component order", () => {
    const classNumbers = ["40221", "40220"];
    expect(vsbSectionId("spring-2027", "ACCT 3120", classNumbers)).toBe("vsb:spring-2027:ACCT 3120:40220+40221");
    expect(classNumbers).toEqual(["40221", "40220"]);
  });

  test("round-trip between the extension id and the term's sections", () => {
    const linked = section("ACCT 3120", "501", ["40220", "40221"], [meeting({ day: "Wed" })]);
    const id = extensionOptionId(linked);
    expect(id).toBe("spring-2027-ACCT3120-40220-40221");
    expect(parseExtensionOptionId(id as string)).toEqual({ term: "spring-2027", courseCode: "ACCT 3120", classNumbers: ["40220", "40221"] });
    expect(sectionMatchesOptionId(linked, id as string)).toBe(true);
    expect(sectionMatchesOptionId(csce1030, id as string)).toBe(false);
    // myUNT reuses class numbers across terms; the id tells the terms apart.
    const nextFall = section("ACCT 3120", "501", ["40220", "40221"], [meeting({ day: "Wed" })], "fall-2027");
    expect(sectionMatchesOptionId(nextFall, id as string)).toBe(false);
    // An earlier build's id, without the term, decodes to nothing.
    expect(parseExtensionOptionId("ACCT3120-40220-40221")).toBeNull();
    // Sample sections without class numbers get no extension id.
    expect(extensionOptionId(section("MATH 2000", "001", [], []))).toBeNull();
  });
});
