/**
 * Mounts the real PlannerProvider under happy-dom for behavior tests.
 *
 * - `installDom()` / `removeDom()` put happy-dom globals in place for one test
 *   file and take them away again, so files that assert "no window" (SSR
 *   paths) still see none.
 * - `@/lib/auth-client` is replaced with a session store the test drives
 *   through `setSession`; components re-render on change, like better-auth.
 * - `FakeDocumentServer` answers `/api/v1` with the real handlers and write
 *   decision over in-memory tables; `PersistedDocumentStore` stands in for
 *   IndexedDB and survives a remount, as the browser's store survives a reload.
 *
 * `mountPlanner().get()` always returns the latest rendered context value,
 * never a snapshot from the first render.
 */
import { mock } from "bun:test";
import { Window } from "happy-dom";
import { act, useSyncExternalStore } from "react";
import { TestClock } from "./test-clock";
import { identityKey, MemoryStore, parseStoreState, type Identity, type LocalStore, type StoreState } from "@untangle/sync";
import type { DocumentKind } from "../../../packages/contracts/src/documents";
import { PullListSchema, type Receipt, type Write } from "../../../packages/contracts/src/sync";
import { decideWrite, parseWrite, SyncError } from "@/lib/document-sync/decision";
import { documentHandlers } from "@/lib/document-sync/handlers";
import { legacyDocuments } from "@/lib/document-sync/legacy-migration";
import { defaultSchedulePreferences } from "@/lib/planner";
import { firstDocumentId, joinPlanner, splitPlanner, type PlannerBodies } from "@/lib/planner-documents";
import { planningTerm } from "@/lib/planner-sections";
import type { DocumentRepository } from "@/lib/document-sync/repository";
import { DeviceGrantError } from "@/server/auth/device-grants";
import type { SectionStore } from "@/lib/section-store";
import type { PlannerState } from "@/lib/types";

type TestUser = { id: string; email: string; name: string };
type SessionValue = {
  data: { user: TestUser; session: { id: string } } | null;
  isPending: boolean;
  error: { message: string; status: number; statusText: string } | null;
};

let session: SessionValue = { data: null, isPending: false, error: null };
const sessionListeners = new Set<() => void>();
let sessionCounter = 0;

export function setSession(user: TestUser | null, sessionId?: string) {
  sessionCounter += 1;
  session = user
    ? { data: { user, session: { id: sessionId ?? `session-${sessionCounter}` } }, isPending: false, error: null }
    : { data: null, isPending: false, error: null };
  sessionListeners.forEach((listener) => listener());
}

export function failSessionLookup(status: number): void {
  session = {
    data: null,
    isPending: false,
    error: { message: "Session lookup failed", status, statusText: status === 0 ? "Network error" : "Server error" },
  };
  sessionListeners.forEach((listener) => listener());
}

/** The lookup has not answered yet, as on a page's first load and in its server render. */
export function pendSessionLookup(): void {
  session = { data: null, isPending: true, error: null };
  sessionListeners.forEach((listener) => listener());
}

type SignOutResult = { data: unknown; error: { message: string; status: number } | null };
let signOutImpl: () => Promise<SignOutResult> = async () => ({ data: { success: true }, error: null });
/** Replaces what `authClient.signOut()` does; `resetSignOut` restores a successful sign-out. */
export function setSignOut(impl: () => Promise<SignOutResult>): void {
  signOutImpl = impl;
}
export function resetSignOut(): void {
  signOutImpl = async () => ({ data: { success: true }, error: null });
}

mock.module("@/lib/auth-client", () => ({
  authClient: {
    signOut: () => signOutImpl(),
    useSession: () =>
      useSyncExternalStore(
        (listener) => {
          sessionListeners.add(listener);
          return () => sessionListeners.delete(listener);
        },
        () => session,
        () => session,
      ),
  },
}));

const DOM_KEYS = [
  "window",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "Storage",
  "StorageEvent",
  "HTMLElement",
  "Element",
  "Node",
  "Text",
  "DocumentFragment",
  "Event",
  "CustomEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "MutationObserver",
  "IntersectionObserver",
  "ResizeObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

let installed: { win: Window; previous: Map<string, unknown> } | null = null;
// Taken before the test clock replaces it.
const realSetTimeout = globalThis.setTimeout;
const clock = new TestClock();
let clockInstalled = false;

async function settle(action: () => void = () => {}) {
  const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const previous = scope.IS_REACT_ACT_ENVIRONMENT;
  scope.IS_REACT_ACT_ENVIRONMENT = true;
  try {
    await act(async () => { action(); });
  } finally {
    if (previous === undefined) delete scope.IS_REACT_ACT_ENVIRONMENT;
    else scope.IS_REACT_ACT_ENVIRONMENT = previous;
  }
}

export function installDom(): Window {
  if (installed) {
    return installed.win;
  }
  const win = new Window({ url: "http://localhost:3000/schedule" });
  const scope = globalThis as unknown as Record<string, unknown>;
  const previous = new Map<string, unknown>();
  for (const key of DOM_KEYS) {
    previous.set(key, scope[key]);
    const value = key === "window" ? win : (win as unknown as Record<string, unknown>)[key];
    scope[key] = typeof value === "function" && !/^[A-Z]/.test(key) ? value.bind(win) : value;
  }
  installed = { win, previous };
  return win;
}

export function removeDom() {
  if (!installed) {
    return;
  }
  const scope = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of installed.previous) {
    if (value === undefined) {
      delete scope[key];
    } else {
      scope[key] = value;
    }
  }
  installed.win.close();
  if (clockInstalled) {
    clock.restore();
    clockInstalled = false;
  }
  installed = null;
}

// The WebMCP transition-ordering tests mount their own roots without act.
// Keep their real scheduler and sleeps; only mountPlanner installs the clock.
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const advanceTime = (ms: number) => {
  if (!clockInstalled) throw new Error("advanceTime requires mountPlanner's test clock");
  return clock.advance(ms, settle);
};

export async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4000) {
  if (!clockInstalled) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return;
      await sleep(20);
    }
    throw new Error(`timed out waiting for: ${label}`);
  }
  await settle();
  for (let elapsed = 0; elapsed <= timeoutMs; elapsed += 20) {
    // A real millisecond: Web Crypto's SHA-256 (the sync engine's write hash)
    // settles on the runtime's own thread pool, not as a microtask.
    await new Promise((resolve) => realSetTimeout(resolve, 1));
    await settle();
    if (predicate()) return;
    if (elapsed < timeoutMs) await advanceTime(Math.min(20, timeoutMs - elapsed));
  }
  throw new Error(`timed out waiting for: ${label} after ${timeoutMs} ms of test time`);
}

/* ---------- fake /api/v1 ---------- */

type Deferred = { promise: Promise<void>; release: () => void };

function deferred(): Deferred {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

type StoredDocument = { kind: DocumentKind; revision: number; institutionId: string; body: unknown; deleted: boolean };
/** A write as sent; ids are plain strings so tests can compare them with literals. */
type SentWrite = Omit<Write, "documentId" | "operationId"> & { documentId: string; operationId: string };
export type RecordedPut = { write: SentWrite; status: number | "dropped" };

/**
 * The document routes as the server runs them: the real handlers and the
 * real write decision (receipts, revisions, deletions), over in-memory
 * tables instead of Postgres, plus the legacy row's one-time migration.
 * The signed-in user is the test session's.
 */
export class FakeDocumentServer {
  readonly documents = new Map<string, StoredDocument>();
  readonly receipts = new Map<string, Receipt>();
  /** Legacy planner_state rows by user; the first pull or write moves them into documents. */
  readonly legacy = new Map<string, PlannerState>();
  readonly migrated = new Set<string>();
  /** Responds 401 to every request while false. */
  sessionValid = true;
  /** Next PUTs: a status to answer, "drop" before the commit, or "lost" after it (the response never arrives). */
  failNextPuts: Array<number | "drop" | "lost"> = [];
  private putGate: Deferred | null = null;
  private pullGate: Deferred | null = null;
  pulls = 0;
  puts: RecordedPut[] = [];
  putsStarted = 0;

  private key(userId: string, documentId: string) {
    return `${userId}\u0000${documentId}`;
  }

  holdNextPut(): () => void {
    this.putGate = deferred();
    return this.putGate.release;
  }

  holdNextPull(): () => void {
    this.pullGate = deferred();
    return this.pullGate.release;
  }

  document(userId: string, documentId: string): StoredDocument | undefined {
    return this.documents.get(this.key(userId, documentId));
  }

  /** Another device writes a document: a new revision, with no receipt here. */
  writeElsewhere(userId: string, documentId: string, kind: DocumentKind, body: unknown) {
    const current = this.document(userId, documentId);
    this.documents.set(this.key(userId, documentId), {
      kind,
      revision: (current?.revision ?? 0) + 1,
      institutionId: "unt",
      body,
      deleted: false,
    });
  }

  /** Another device saves this plan: each of its documents gets a new revision. */
  seedPlan(userId: string, state: PlannerState, preferences = defaultSchedulePreferences(state.optimization)) {
    const bodies = splitPlanner(state, preferences, planningTerm.id);
    this.writeElsewhere(userId, firstDocumentId["academic-record"], "academic-record", bodies["academic-record"]);
    this.writeElsewhere(userId, firstDocumentId.schedule(planningTerm.id), "schedule", bodies.schedule);
    this.writeElsewhere(userId, firstDocumentId.preferences, "preferences", bodies.preferences);
  }

  /** The user's plan as the planner reads their documents; null when they have none. */
  plan(userId: string): PlannerState | null {
    const read = <T,>(documentId: string) => {
      const stored = this.document(userId, documentId);
      return stored && !stored.deleted ? (stored.body as T) : null;
    };
    const bodies = {
      "academic-record": read<PlannerBodies["academic-record"]>(firstDocumentId["academic-record"]),
      schedule: read<PlannerBodies["schedule"]>(firstDocumentId.schedule(planningTerm.id)),
      preferences: read<PlannerBodies["preferences"]>(firstDocumentId.preferences),
    };
    return Object.values(bodies).some((body) => body !== null) ? joinPlanner(bodies, "Mon").state : null;
  }

  /** Another device deletes a document, leaving its tombstone. */
  deleteElsewhere(userId: string, documentId: string) {
    const current = this.document(userId, documentId);
    if (!current) throw new Error(`No document ${documentId} to delete`);
    this.documents.set(this.key(userId, documentId), { ...current, revision: current.revision + 1, body: null, deleted: true });
  }

  private migrate(userId: string) {
    if (this.migrated.has(userId)) return;
    const row = this.legacy.get(userId);
    if (row) {
      for (const document of legacyDocuments(row)) {
        if (!this.document(userId, document.documentId)) {
          this.documents.set(this.key(userId, document.documentId), { kind: document.kind, revision: 1, institutionId: "unt", body: document.body, deleted: false });
        }
      }
    }
    this.migrated.add(userId);
  }

  private readonly repository: DocumentRepository = {
    write: async (userId, bytes, documentId) => {
      const { write, writeSha256 } = parseWrite(bytes);
      if (write.documentId !== documentId) throw new SyncError(400, "ID_MISMATCH", "The URL and write must name the same document.");
      this.migrate(userId);
      const receipt = this.receipts.get(this.key(userId, write.operationId)) ?? null;
      const stored = this.document(userId, documentId);
      const decision = decideWrite({ write, writeSha256, receipt, current: stored ? { kind: stored.kind, revision: stored.revision, institutionId: stored.institutionId, deleted: stored.deleted } : null });
      if (decision.kind === "replay") return decision.receipt;
      if (decision.kind === "version") throw new Error("The fake server stores no versions.");
      this.documents.set(this.key(userId, documentId), { kind: write.kind, revision: decision.revision, institutionId: decision.institutionId, body: decision.body, deleted: decision.deleted });
      const committed = { userId, operationId: write.operationId, writeSha256, committedRevision: decision.revision };
      this.receipts.set(this.key(userId, write.operationId), committed);
      return committed;
    },
    get: async (userId, documentId) => {
      this.migrate(userId);
      const stored = this.document(userId, documentId);
      if (!stored || stored.deleted) throw new SyncError(404, "NOT_FOUND", "The document does not exist.");
      // Unparsed: a newer server returns fields this build's contracts don't know.
      return { documentId, kind: stored.kind, revision: stored.revision, schemaVersion: 1, body: stored.body } as Awaited<ReturnType<DocumentRepository["get"]>>;
    },
    pull: async (userId) => {
      this.migrate(userId);
      const prefix = this.key(userId, "");
      return PullListSchema.parse(
        [...this.documents.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key, stored]) => ({ documentId: key.slice(prefix.length), kind: stored.kind, revision: stored.revision, deleted: stored.deleted })),
      );
    },
    listVersions: async () => ({ versions: [], nextPage: null }),
  };

  /** False answers like a deployment without document storage (503). */
  available = true;

  private get handlers() {
    return this.handlersFor(this.available);
  }

  private handlersFor = (available: boolean) => documentHandlers({
    repository: this.repository,
    authorize: async () => {
      const userId = session.data?.user.id;
      if (!userId || !this.sessionValid) throw new DeviceGrantError("unauthorized", 401);
      return { userId, source: "browser" };
    },
    limit: async () => null,
    origin: "http://localhost:3000",
    available,
  });

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost:3000");
    const method = (init?.method ?? "GET").toUpperCase();
    // The browser adds Origin to a same-origin PUT.
    const request = new Request(url, { ...init, headers: { ...Object.fromEntries(new Headers(init?.headers)), origin: "http://localhost:3000" } });
    if (url.pathname === "/api/v1/sync" && method === "GET") {
      this.pulls += 1;
      const gate = this.pullGate;
      this.pullGate = null;
      if (gate) await gate.promise;
      return this.handlers.pull(request);
    }
    const match = /^\/api\/v1\/documents\/([^/]+)$/.exec(url.pathname);
    if (!match) return new Response("not found", { status: 404 });
    const context = { params: Promise.resolve({ id: decodeURIComponent(match[1]) }) };
    if (method === "GET") return this.handlers.get(request, context);
    this.putsStarted += 1;
    const gate = this.putGate;
    this.putGate = null;
    if (gate) await gate.promise;
    const write = JSON.parse(String(init?.body)) as SentWrite;
    const failure = this.failNextPuts.shift();
    if (failure === "drop") {
      this.puts.push({ write, status: "dropped" });
      throw new TypeError("Failed to fetch");
    }
    if (typeof failure === "number") {
      this.puts.push({ write, status: failure });
      return Response.json({ error: "injected failure" }, { status: failure });
    }
    const response = await this.handlers.put(request, context);
    this.puts.push({ write, status: failure === "lost" ? "dropped" : response.status });
    if (failure === "lost") throw new TypeError("Failed to fetch");
    return response;
  };
}

/** This browser's document store, kept between mounts like IndexedDB: each write is stored as the bytes IndexedDB would hold. */
export class PersistedDocumentStore implements LocalStore {
  private readonly records = new Map<string, string>();
  private readonly locks = new MemoryStore();

  async read(identity: Identity): Promise<StoreState> {
    const raw = this.records.get(identityKey(identity));
    return parseStoreState(raw === undefined ? undefined : JSON.parse(raw), identity);
  }

  /** While true, every write fails, as when the browser's storage is full. */
  refuseWrites = false;

  async transact<T>(identity: Identity, change: (state: StoreState) => T): Promise<T> {
    if (this.refuseWrites) throw new Error("QuotaExceededError");
    const state = await this.read(identity);
    const result = change(state);
    if (result instanceof Promise) throw new Error("A sync storage transaction callback must be synchronous.");
    this.records.set(identityKey(identity), JSON.stringify({ format: 1, state }));
    return result === undefined ? result : structuredClone(result);
  }

  exclusive<T>(identity: Identity, documentId: string, work: () => Promise<T>): Promise<T> {
    return this.locks.exclusive(identity, documentId, work);
  }

  /** What is stored for a user, as the planner's engine reads it. */
  stored(userId: string): Promise<StoreState> {
    return this.read({ kind: "user", id: userId });
  }
}

let documentStore = new PersistedDocumentStore();
let documentStoreFails = false;
/** A fresh browser: no documents stored for anyone, a store that opens, and no browser-session cookie. */
export function resetDocumentStore(): PersistedDocumentStore {
  // The browser closed: session cookies are gone.
  document.cookie = "untangle_guest_session=; path=/; Max-Age=0";
  documentStore = new PersistedDocumentStore();
  documentStoreFails = false;
  return documentStore;
}
/** The browser refuses to open the document store, as IndexedDB can in some private modes. */
export function failDocumentStore(): void {
  documentStoreFails = true;
}
export const currentDocumentStore = () => documentStore;

/* ---------- mounting ---------- */

type PlannerModule = typeof import("@/components/planner-provider");
export type PlannerValue = ReturnType<PlannerModule["usePlanner"]>;

/**
 * Flushes React work with `act` without advancing the debounce clock.
 * `waitFor` advances test time only when React and fetch promises have settled.
 * `extra` renders additional UI (e.g. the persistence panel) inside the provider.
 * With `hydrate`, the tree is first rendered to HTML as a server would (no
 * effects, server snapshots), then hydrated; `recoverableErrors` collects
 * hydration mismatches.
 */
export async function mountPlanner(
  extra?: () => React.ReactNode,
  store?: SectionStore,
  strict = false,
  { hydrate = false }: { hydrate?: boolean } = {},
) {
  if (!clockInstalled) {
    clock.install();
    clockInstalled = true;
  }
  const mod = await import("@/components/planner-provider");
  const sectionStore = store ?? (await import("@/lib/section-store")).sampleSectionStore;
  const React = await import("react");
  const { createRoot, hydrateRoot } = await import("react-dom/client");

  let latest: PlannerValue | null = null;
  function Probe() {
    latest = mod.usePlanner();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const content = React.createElement(
    mod.PlannerProvider,
    // Sections answer at once from the bundled samples unless a test passes a store (section-store.test.ts).
    {
      sectionStore,
      documentStore: async () => {
        if (documentStoreFails) throw new Error("IndexedDB is unavailable.");
        return documentStore;
      },
    },
    React.createElement(mod.ToastProvider, null, React.createElement(Probe), extra ? extra() : null),
  );
  const tree = strict ? React.createElement(React.StrictMode, null, content) : content;
  const recoverableErrors: unknown[] = [];
  let serverHtml: string | null = null;
  let root!: import("react-dom/client").Root;
  if (hydrate) {
    const { renderToReadableStream } = await import("react-dom/server");
    const stream = await renderToReadableStream(tree);
    await stream.allReady;
    serverHtml = await new Response(stream).text();
    container.innerHTML = serverHtml;
    latest = null;
    await settle(() => {
      root = hydrateRoot(container, tree, { onRecoverableError: (error) => recoverableErrors.push(error) });
    });
  } else {
    root = createRoot(container);
    await settle(() => root.render(tree));
  }
  await waitFor(() => latest !== null, "first render");

  const get = (): PlannerValue => {
    if (!latest) {
      throw new Error("planner probe has not rendered");
    }
    return latest;
  };

  /** Runs a planner action against the current value and lets React render it. */
  const run = async (action: (planner: PlannerValue) => void) => {
    await settle(() => action(get()));
  };

  const unmount = async () => {
    await settle(() => root.unmount());
    container.remove();
  };

  return { get, run, unmount, container, recoverableErrors, serverHtml };
}

/** Lets the debounced save (350 ms) fire and any resulting request settle. */
export const flushSaves = (ms = 500) => advanceTime(ms);
