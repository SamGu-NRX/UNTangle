/**
 * The signed-in planner's documents, through @untangle/sync.
 *
 * The planner works on one schedule, one academic record and one preferences
 * document (lib/planner-documents.ts). An edit goes into this device's store
 * first, in one local transaction with its pending write, then out to
 * /api/v1 one write per document at a time; the engine retries a write with
 * the same operation id until its receipt arrives.
 *
 * Reading and writing the planner's view run in one queue; pulls and sends
 * run beside it, and the engine serializes each document. A save compares
 * the stored body with the one the planner last read: when another tab, or
 * a merged pull, changed it since, the save is settled the way a server
 * conflict is (resolveConflict), with this tab's edit as "mine".
 */
import {
  equal,
  resolveConflict,
  SyncEngine,
  syncStatus,
  type AcademicQuestion,
  type Body,
  type LocalDocument,
  type LocalStore,
  type PushResult,
  type RemoteDocument,
  type SyncIO,
  type SyncStatus,
} from "@untangle/sync";
import {
  AcademicRecordBodySchema,
  ScheduleBodySchema,
  type AcademicRecordBody,
  type DocumentKind,
} from "../../../../packages/contracts/src/documents";
import { ACCOUNT_HEADER } from "../../../../packages/contracts/src/sync";
import {
  firstDocumentId,
  joinPlanner,
  MAIN_SCHEDULE_NAME,
  plannerKinds,
  rebase,
  splitPlanner,
  type PlannerBodies,
  type PlannerKind,
  type StoredBodies,
} from "@/lib/planner-documents";
import type { PlannerState, SchedulePreferences } from "@/lib/types";

/* ---------- HTTP ---------- */

export type PullOutcome = { kind: "list"; list: unknown } | { kind: "signed-out" } | { kind: "unavailable" };
export type PlannerSyncIO = SyncIO & { pullList(): Promise<PullOutcome> };
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function refusal(response: Response): Promise<{ code: string | null; revision: number | null }> {
  try {
    const body = (await response.json()) as { code?: unknown; revision?: unknown };
    return {
      code: typeof body.code === "string" ? body.code : null,
      revision: typeof body.revision === "number" ? body.revision : null,
    };
  } catch {
    return { code: null, revision: null };
  }
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * The engine's transport over /api/v1 for one account, and the pull list.
 * Every request names the account (ACCOUNT_HEADER), so the server refuses it
 * once the browser's session belongs to someone else. `fetchImpl` is read on
 * each call.
 */
export function httpSyncIO(account: string, fetchImpl: () => FetchLike = () => globalThis.fetch): PlannerSyncIO {
  const send: FetchLike = (input, init) => fetchImpl()(input, { ...init, headers: { ...init?.headers, [ACCOUNT_HEADER]: account } });
  const getDocument = (documentId: string) => send(`/api/v1/documents/${encodeURIComponent(documentId)}`, { cache: "no-store" });
  return {
    operationId: () => crypto.randomUUID(),
    sha256: async (bytes) => hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bytes))),

    async push(_userId, bytes): Promise<PushResult> {
      const write = JSON.parse(bytes) as { documentId: string; kind: DocumentKind };
      const response = await send(`/api/v1/documents/${encodeURIComponent(write.documentId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: bytes,
      });
      if (response.ok) return { kind: "receipt", receipt: await response.json() };
      if (response.status === 401) return { kind: "needs-sign-in" };
      const { code, revision } = await refusal(response);
      const deleted = (at: number): RemoteDocument => ({ documentId: write.documentId, kind: write.kind, revision: at, schemaVersion: 1, body: null });
      if (code === "DOCUMENT_DELETED" && revision !== null) return { kind: "conflict", latest: deleted(revision) };
      if (code === "REVISION_CONFLICT" && revision !== null) {
        const latest = await getDocument(write.documentId);
        if (latest.ok) return { kind: "conflict", latest: await latest.json() };
        // A stale write to a deleted document conflicts on its revision before the deletion is checked.
        if (latest.status === 404) return { kind: "conflict", latest: deleted(revision) };
        throw new Error(`The server couldn't return the newer document: ${latest.status}`);
      }
      // The write itself is wrong (its body, kind, size or operation id); sending the same bytes again can't help.
      if (response.status < 500 && response.status !== 408 && response.status !== 429) {
        throw new WriteRefusedError(write.documentId, response.status, code);
      }
      // Busy or down: the engine keeps the write and sends the same bytes again later.
      throw new Error(`The server couldn't take a document write: ${response.status} ${code ?? "without a code"}`);
    },

    async fetch(_userId, documentId) {
      const response = await getDocument(documentId);
      if (!response.ok) throw new Error(`The server could not return a document: ${response.status}`);
      return (await response.json()) as RemoteDocument;
    },

    async pullList() {
      let response: Response;
      try {
        response = await send("/api/v1/sync", { cache: "no-store" });
      } catch {
        return { kind: "unavailable" };
      }
      if (response.status === 401) return { kind: "signed-out" };
      if (!response.ok) return { kind: "unavailable" };
      return { kind: "list", list: await response.json() };
    },
  };
}

/** The server answered a write with a refusal that the same bytes would get again. */
export class WriteRefusedError extends Error {
  constructor(readonly documentId: string, readonly status: number, readonly code: string | null) {
    super(`The server refused a document write: ${status} ${code ?? "without a code"}`);
    this.name = "WriteRefusedError";
  }
}

/* ---------- which documents the planner shows ---------- */

export type PlannerSnapshot = {
  /** The document each kind is read from and saved to. A kind with no live document gets an unused id. */
  ids: Record<PlannerKind, string>;
  drafts: StoredBodies;
  /** The documents' local compare-and-set tokens; 0 for one not stored yet. */
  generations: Record<PlannerKind, number>;
  documents: Record<PlannerKind, LocalDocument | null>;
};

/**
 * The document of a kind the planner uses: a live one (with a draft, which
 * during a conflict is the unsent side), preferring the kind's first id; a
 * schedule must also be this term's Main. With none live, the first id that
 * this device has never stored, because a deleted id is never reused.
 */
function pick(documents: readonly LocalDocument[], kind: PlannerKind, termId: string): { id: string; document: LocalDocument | null } {
  const first = kind === "schedule" ? firstDocumentId.schedule(termId) : firstDocumentId[kind];
  const live = documents
    .filter((document) => document.kind === kind && document.draft !== null)
    .filter((document) => {
      if (kind !== "schedule") return true;
      const body = document.draft as PlannerBodies["schedule"];
      return body.termId === termId && body.name === MAIN_SCHEDULE_NAME;
    })
    .sort((a, b) => (a.documentId === first ? -1 : b.documentId === first ? 1 : a.documentId.localeCompare(b.documentId)));
  if (live[0]) return { id: live[0].documentId, document: live[0] };
  const stored = new Set<string>(documents.map((document) => document.documentId));
  let id = first;
  for (let n = 2; stored.has(id); n++) id = `${first}-${n}`;
  return { id, document: null };
}

export function plannerSnapshot(documents: readonly LocalDocument[], termId: string): PlannerSnapshot {
  const picked = Object.fromEntries(plannerKinds.map((kind) => [kind, pick(documents, kind, termId)])) as Record<
    PlannerKind,
    ReturnType<typeof pick>
  >;
  const each = <T,>(read: (entry: ReturnType<typeof pick>) => T) =>
    Object.fromEntries(plannerKinds.map((kind) => [kind, read(picked[kind])])) as Record<PlannerKind, T>;
  return {
    ids: each((entry) => entry.id),
    drafts: each((entry) => entry.document?.draft ?? null) as StoredBodies,
    generations: each((entry) => entry.document?.generation ?? 0),
    documents: each((entry) => entry.document),
  };
}

/* ---------- conflicts and status ---------- */

/**
 * A document the student has to settle. `base` is the body both sides
 * started from and `latest` the other side's, null when it deleted the
 * document. The student's side is the planner's current edit, so edits made
 * while the notice is open are part of it.
 */
export type OpenConflict = {
  kind: PlannerKind;
  documentId: string;
  /** "server": another device; "local": another tab of this browser. */
  source: "server" | "local";
  base: Body | null;
  latest: Body | null;
};

/**
 * The state the student sees: the worst among the planner's documents; null
 * when nothing is stored yet. The engine marks a write unconfirmed before it
 * is sent, so a write this tab is sending right now reads as waiting.
 */
export function plannerStatus(userId: string, snapshot: PlannerSnapshot, conflict: OpenConflict | null, sending: ReadonlySet<string>): SyncStatus | null {
  if (conflict) return "Resolve conflict";
  const user = { kind: "user", id: userId } as const;
  const statuses = plannerKinds.flatMap((kind) => {
    const document = snapshot.documents[kind];
    if (!document) return [];
    const status = syncStatus(user, document);
    return [status === "Save not confirmed (retrying)" && sending.has(document.documentId) ? "Waiting to sync" : status];
  });
  const order: SyncStatus[] = ["Resolve conflict", "Needs sign-in", "Save not confirmed (retrying)", "Waiting to sync", "Synced"];
  return order.find((status) => statuses.includes(status)) ?? (statuses.length ? "Saved on this device" : null);
}

/** The server holds documents this build can't read, as an open tab after a release does. */
export class ClientOutdatedError extends Error {
  constructor(cause: unknown) {
    super("UNTangle was updated. Reload to keep editing.", { cause });
    this.name = "ClientOutdatedError";
  }
}

/* ---------- the controller ---------- */

export type RefreshOutcome = "synced" | "signed-out" | "unavailable";
/** The planner's plan and preferences now. Operations call it after their awaits, so they never act on a stale copy. */
export type PlannerRead = () => { state: PlannerState; preferences: SchedulePreferences };
export type PlannerView = { state: PlannerState; preferences: SchedulePreferences };
export type ConflictChoice =
  | { kind: "use-latest" }
  /** The student's side: written over the latest (academic answers), or as a new document when the latest is a deletion. */
  | { kind: "keep"; body: Body };

const isParseError = (error: unknown) => error instanceof Error && error.name === "ZodError";

export class PlannerSync {
  private readonly engine: SyncEngine;
  private queue: Promise<unknown> = Promise.resolve();
  /** A conflict another tab caused. The engine has no record of it, so it lives only in this tab. */
  private localConflict: OpenConflict | null = null;
  /** Documents whose write this tab is sending now. */
  private readonly sending = new Set<string>();
  /** Documents whose waiting write the server refused for good; they aren't sent again until a reload. */
  private readonly refused = new Set<string>();
  /** Set when the planner retires this identity; from then on nothing reaches the network. */
  private closed = false;
  private readonly io: PlannerSyncIO;
  /** Each kind's document as the planner last read or wrote it. Null drafts until the first read. */
  private seen: { drafts: StoredBodies } = { drafts: { "academic-record": null, schedule: null, preferences: null } };
  /** The planner, read as documents, at that moment. A save writes the change from here. */
  private base: PlannerBodies;

  constructor(
    store: LocalStore,
    readonly userId: string,
    readonly termId: string,
    io: PlannerSyncIO,
    /** What the planner shows before any document is read. Edits made on top of it are saved like another tab's. */
    initial: PlannerView,
  ) {
    // The browser sends whichever session cookie is current, so after a sign-out or an account switch a
    // request from this instance could act as the next student. Every request checks first.
    const open = <A extends unknown[], R>(call: (...args: A) => Promise<R>) => (...args: A): Promise<R> => {
      if (this.closed) return Promise.reject(new Error("This account's sync has closed."));
      return call(...args);
    };
    const push = open(io.push);
    this.io = {
      ...io,
      push: (userId, bytes) =>
        push(userId, bytes).catch((error: unknown) => {
          if (error instanceof WriteRefusedError) {
            console.error(error);
            this.refused.add(error.documentId);
          }
          throw error;
        }),
      fetch: open(io.fetch),
      pullList: open(io.pullList),
    };
    this.engine = new SyncEngine(store, { kind: "user", id: userId }, this.io);
    this.base = splitPlanner(initial.state, initial.preferences, termId);
  }

  /** One operation at a time; a failed one doesn't stop the next. */
  private run<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }

  /**
   * For network work. It runs beside the queue, so an edit reaches this
   * device's outbox while an earlier write is still in flight; the engine
   * serializes each document itself. The contracts are strict, so a body or
   * kind this build doesn't know fails to parse; writing anything back would
   * drop what it couldn't read, so the caller stops and asks for a reload. A
   * parse failure anywhere else is this build's own bug.
   */
  private async readServer<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw isParseError(error) ? new ClientOutdatedError(error) : error;
    }
  }

  private async current(): Promise<PlannerSnapshot> {
    return plannerSnapshot((await this.engine.read()).documents, this.termId);
  }

  private split(view: PlannerView): PlannerBodies {
    return splitPlanner(view.state, view.preferences, this.termId);
  }

  /**
   * The plan the documents hold, to show. Null when the planner has edits
   * not saved yet: those are saved first, and the next call shows the result.
   * `force` shows the documents anyway, after a conflict is settled.
   */
  adopt(read: PlannerRead, { force = false } = {}): Promise<PlannerView | null> {
    return this.run(async () => {
      const snapshot = await this.current();
      const now = read();
      if (!force && !equal(this.split(now), this.base)) return null;
      const view = joinPlanner(snapshot.drafts, now.state.activeDay);
      this.seen = { drafts: snapshot.drafts };
      this.base = this.split(view);
      return view;
    });
  }

  /** Pulls the server's list, fetches what changed and sends what is waiting. */
  refresh(): Promise<RefreshOutcome> {
    return this.readServer(async () => {
      const pulled = await this.io.pullList();
      if (pulled.kind !== "list") return pulled.kind;
      try {
        await this.engine.pull(pulled.list);
      } catch (error) {
        if (isParseError(error)) throw error;
        return "unavailable";
      }
      await this.drainNow();
      return "synced";
    });
  }

  /** Sends waiting writes until each is confirmed or stuck. */
  drain(): Promise<void> {
    return this.readServer(() => this.drainNow());
  }

  private async drainNow(): Promise<void> {
    for (let round = 0; round < 100; round++) {
      const waiting = (await this.engine.read()).documents.filter(
        (document) => document.pending.length && document.delivery.kind !== "conflict" && !this.refused.has(document.documentId),
      );
      let progressed = false;
      for (const document of waiting) {
        if (this.closed) return;
        this.sending.add(document.documentId);
        try {
          await this.engine.syncNext(document.documentId);
        } finally {
          this.sending.delete(document.documentId);
        }
        const after = (await this.engine.read()).documents.find((item) => item.documentId === document.documentId);
        if (after?.pending[0]?.write.operationId !== document.pending[0].write.operationId) progressed = true;
      }
      // An unconfirmed write waits for the next trigger: a timer, focus, coming back online.
      if (!progressed) return;
    }
  }

  /**
   * The body the planner's view started from: the document it last read, or,
   * before it has read one, its own starting values (so an edit made before
   * the first read changes only what it touched).
   */
  private started(kind: PlannerKind): Body {
    return this.seen.drafts[kind] ?? this.base[kind];
  }

  /** The planner's side of a document: its change since it last read the document, applied to that document. */
  private mine(kind: PlannerKind, after: PlannerBodies): Body {
    return rebase(this.started(kind), this.base[kind], after[kind]) as Body;
  }

  /**
   * Saves the planner's edit into this device's outbox. Only kinds the edit
   * changed are written, each as the planner's change applied to the stored
   * body (rebase), so fields the planner never read go back unchanged. When
   * the stored body changed since the planner read it (another tab, a merged
   * pull), the edit is settled the way a server conflict is. A document with
   * an open conflict is skipped; its edit stays on screen until the student
   * settles it.
   */
  save(read: PlannerRead): Promise<void> {
    return this.run(async () => {
      const after = this.split(read());
      for (const kind of plannerKinds) {
        if (equal(this.base[kind], after[kind]) || this.localConflict?.kind === kind) continue;
        const mine = this.mine(kind, after);
        // Another tab can write between this read and the engine's own; the engine refuses, and this reads again.
        for (let attempt = 0; ; attempt++) {
          const current = await this.current();
          const document = current.documents[kind];
          if (document?.delivery.kind === "conflict") break;
          let body: Body = mine;
          if (!equal(document?.draft ?? null, this.seen.drafts[kind])) {
            const resolution = resolveConflict(kind, this.started(kind), mine, document?.draft ?? null);
            if (resolution.kind !== "merged") {
              this.localConflict = { kind, documentId: current.ids[kind], source: "local", base: this.started(kind), latest: document?.draft ?? null };
              break;
            }
            body = resolution.body as Body;
          }
          try {
            await this.engine.save({ documentId: current.ids[kind], kind, body, expectedGeneration: current.generations[kind] });
          } catch (error) {
            if (attempt < 2 && error instanceof Error && error.message.startsWith("Local document changed")) continue;
            throw error;
          }
          this.seen.drafts = { ...this.seen.drafts, [kind]: body };
          this.base = { ...this.base, [kind]: after[kind] };
          break;
        }
      }
    });
  }

  /** The sync state to show, and the conflict to settle with the student's side as it is now. */
  status(read: PlannerRead): Promise<{
    status: SyncStatus | null;
    conflict: (OpenConflict & { mine: Body }) | null;
    unsynced: boolean;
    /** The server refused a waiting write for good. */
    refused: boolean;
    /** The planner has no edit that isn't in this device's store yet. */
    clean: boolean;
    /** The open conflict's document has edits only this tab holds: another tab's conflict, or edits since it opened. */
    conflictUnsaved: boolean;
  }> {
    return this.run(async () => {
      const state = await this.engine.read();
      const snapshot = plannerSnapshot(state.documents, this.termId);
      const conflict = this.openConflict(snapshot);
      const after = this.split(read());
      return {
        status: plannerStatus(this.userId, snapshot, conflict, this.sending),
        conflict: conflict && { ...conflict, mine: this.mine(conflict.kind, after) },
        unsynced: state.documents.some((document) => document.pending.length > 0),
        refused: state.documents.some((document) => document.pending.length > 0 && this.refused.has(document.documentId)),
        clean: equal(after, this.base),
        conflictUnsaved: conflict !== null && (conflict.source === "local" || !equal(after[conflict.kind], this.base[conflict.kind])),
      };
    });
  }

  /** Another tab's conflict first, then the server's. */
  private openConflict(snapshot: PlannerSnapshot): OpenConflict | null {
    if (this.localConflict) return this.localConflict;
    for (const kind of plannerKinds) {
      const document = snapshot.documents[kind];
      if (document?.delivery.kind === "conflict") {
        return { kind, documentId: document.documentId, source: "server", base: document.pending[0]?.baseBody ?? null, latest: document.delivery.latest.body };
      }
    }
    return null;
  }

  /** Settles a conflict `status` returned, then shows the documents. */
  resolve(conflict: OpenConflict, choice: ConflictChoice, read: PlannerRead): Promise<PlannerView> {
    const settled = this.run(async () => {
      const document = (await this.engine.read()).documents.find((item) => item.documentId === conflict.documentId);
      const overwrite = choice.kind === "keep" && conflict.latest !== null;
      if (conflict.source === "local") {
        this.localConflict = null;
        if (overwrite && document) {
          await this.engine.save({ documentId: document.documentId, kind: conflict.kind, body: choice.body, expectedGeneration: document.generation });
          return;
        }
      } else {
        if (document?.delivery.kind !== "conflict") throw new Error("That conflict was already settled.");
        if (overwrite) {
          await this.engine.resolve(document.documentId, document.generation, { kind: "write", body: choice.body });
          return;
        }
        await this.engine.resolve(document.documentId, document.generation, { kind: "use-latest" });
      }
      if (choice.kind === "keep") {
        // The latest is a deletion, and a deleted id is never brought back: the student's side becomes a new document.
        const fresh = await this.current();
        await this.engine.save({ documentId: fresh.ids[conflict.kind], kind: conflict.kind, body: choice.body, expectedGeneration: 0 });
      }
    });
    return settled.then(() => this.adopt(read, { force: true }) as Promise<PlannerView>);
  }

  /** Stops all network work for good; this device's store is left as it is. */
  close(): void {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Deletes this account's documents from this device; waiting writes go too only with `discardPending`. */
  clearLocalData(discardPending: boolean): Promise<void> {
    return this.run(() => this.engine.clearLocalData({ discardPending }));
  }
}

/* ---------- settling a conflict ---------- */

/** The questions an academic-record conflict asks, one per course (or major, catalog year, transcript row) both sides changed. */
export function academicQuestions(conflict: OpenConflict & { mine: Body }): AcademicQuestion[] {
  if (conflict.kind !== "academic-record" || conflict.latest === null) return [];
  const resolution = resolveConflict("academic-record", conflict.base, conflict.mine, conflict.latest);
  return resolution.kind === "academic-record" ? resolution.questions : [];
}

/**
 * The record with each question answered: "latest" keeps the other side's
 * value, "mine" this side's. Everything without a question is already
 * settled per course by the three-way merge.
 */
export function answerAcademicQuestions(
  conflict: OpenConflict & { mine: Body },
  answers: ReadonlyArray<"latest" | "mine">,
): AcademicRecordBody {
  const resolution = resolveConflict("academic-record", conflict.base, conflict.mine, conflict.latest);
  if (resolution.kind === "merged") return AcademicRecordBodySchema.parse(resolution.body);
  if (resolution.kind !== "academic-record") throw new Error("Only an academic-record conflict has questions.");
  const mine = AcademicRecordBodySchema.parse(conflict.mine);
  const latest = AcademicRecordBodySchema.parse(conflict.latest);
  const body = structuredClone(resolution.body);
  resolution.questions.forEach((question, index) => {
    const side = answers[index] === "mine" ? "mine" : "latest";
    if (question.kind === "course") {
      const facts = question[side === "mine" ? "local" : "latest"];
      const statuses = Object.entries(body.courseStatuses).filter(([code]) => code !== question.course);
      if (facts.status !== null) statuses.push([question.course, facts.status]);
      body.courseStatuses = Object.fromEntries(statuses);
      body.manualCredit = body.manualCredit.filter((code) => code !== question.course).concat(facts.manualCredit ? [question.course] : []);
      body.transcriptRecords = body.transcriptRecords.filter((row) => row.code !== question.course).concat(facts.records);
    } else if (question.kind === "major") {
      body.major = side === "mine" ? question.local : question.latest;
    } else if (question.kind === "catalogId") {
      body.catalogId = side === "mine" ? question.local : question.latest;
    } else {
      const row = (side === "mine" ? mine : latest).transcriptRecords.find((record) => record.id === question.id);
      body.transcriptRecords = body.transcriptRecords.filter((record) => record.id !== question.id).concat(row ? [row] : []);
    }
  });
  return AcademicRecordBodySchema.parse(body);
}

/** How many courses a schedule's two sides plan or pick differently. */
export function scheduleDifference(mine: Body | null, latest: Body | null): number {
  const read = (body: Body | null) => (body === null ? null : ScheduleBodySchema.parse(body));
  const a = read(mine), b = read(latest);
  const courses = new Set([...(a?.courses ?? []), ...(b?.courses ?? [])]);
  return [...courses].filter((code) => !a?.courses.includes(code) || !b?.courses.includes(code) || a.selectedSections[code] !== b.selectedSections[code]).length;
}
