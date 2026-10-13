/**
 * Mounts the real PlannerProvider under happy-dom for behavior tests.
 *
 * - `installDom()` / `removeDom()` put happy-dom globals in place for one test
 *   file and take them away again, so files that assert "no window" (SSR
 *   paths) still see none.
 * - `@/lib/auth-client` is replaced with a session store the test drives
 *   through `setSession`; components re-render on change, like better-auth.
 * - `FakePlannerServer` answers `/api/planner` with the same contract as
 *   `src/app/api/planner/route.ts`: revisions, 409 on a stale base revision,
 *   428 without one, 401 when told the session is gone.
 *
 * `mountPlanner().get()` always returns the latest rendered context value,
 * never a snapshot from the first render.
 */
import { mock } from "bun:test";
import { Window } from "happy-dom";
import { useSyncExternalStore } from "react";
import type { SectionStore } from "@/lib/section-store";
import type { PlannerState } from "@/lib/types";

type TestUser = { id: string; email: string; name: string };
type SessionValue = {
  data: { user: TestUser; session: { id: string } } | null;
  isPending: boolean;
  error: null;
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

mock.module("@/lib/auth-client", () => ({
  authClient: {
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
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

let installed: { win: Window; previous: Map<string, unknown> } | null = null;

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
  installed = null;
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function waitFor(predicate: () => boolean, label: string, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }
    await sleep(20);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/* ---------- fake /api/planner ---------- */

type StoredRow = { state: PlannerState; revision: number };

export type RecordedPost = { body: PlannerState; baseRevision: string | null; status: number };

type Deferred = { promise: Promise<void>; release: () => void };

function deferred(): Deferred {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

export class FakePlannerServer {
  row: StoredRow | null = null;
  persistent = true;
  /** Responds 401 to every request while false. */
  sessionValid = true;
  /** Next POSTs answer with these statuses (500, "drop" for a dropped connection), then normal service resumes. */
  failNextPosts: Array<number | "drop"> = [];
  /** When set, the next POST waits for `release()` before it is processed. */
  private gate: Deferred | null = null;
  /** When set, the next GET waits for `release()` before it is answered. */
  private getGate: Deferred | null = null;
  gets = 0;
  /** POSTs that reached the server, including ones still held at a gate. */
  postsStarted = 0;
  posts: RecordedPost[] = [];

  holdNextPost(): () => void {
    const gate = deferred();
    this.gate = gate;
    return gate.release;
  }

  holdNextGet(): () => void {
    const gate = deferred();
    this.getGate = gate;
    return gate.release;
  }

  /** Another tab or device writes directly. */
  writeElsewhere(state: PlannerState) {
    this.row = { state, revision: (this.row?.revision ?? 0) + 1 };
  }

  readonly fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (!url.includes("/api/planner")) {
      return new Response("not found", { status: 404 });
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") {
      this.gets += 1;
      const getGate = this.getGate;
      this.getGate = null;
      if (getGate) {
        await getGate.promise;
      }
      if (!this.sessionValid) {
        return json({ error: "Unauthorized" }, 401);
      }
      return json({
        state: this.persistent ? (this.row?.state ?? null) : null,
        revision: this.persistent ? (this.row?.revision ?? 0) : 0,
        persistent: this.persistent,
      });
    }

    this.postsStarted += 1;
    const gate = this.gate;
    this.gate = null;
    if (gate) {
      await gate.promise;
    }
    const headers = new Headers(init?.headers);
    const baseRevision = headers.get("X-Planner-Base-Revision");
    const body = JSON.parse(String(init?.body)) as PlannerState;
    const record = (status: number) => {
      this.posts.push({ body, baseRevision, status });
    };

    const failure = this.failNextPosts.shift();
    if (failure === "drop") {
      record(0);
      throw new TypeError("Failed to fetch");
    }
    if (typeof failure === "number") {
      record(failure);
      return json({ error: "injected failure" }, failure);
    }
    if (!this.sessionValid) {
      record(401);
      return json({ error: "Unauthorized" }, 401);
    }
    if (baseRevision === null || !/^\d+$/.test(baseRevision)) {
      record(428);
      return json({ error: "missing base revision" }, 428);
    }
    if (!this.persistent) {
      record(200);
      return json({ state: null, persistent: false });
    }
    const currentRevision = this.row?.revision ?? 0;
    if (Number(baseRevision) !== currentRevision) {
      record(409);
      return json({ error: "conflict", state: this.row?.state ?? null, revision: currentRevision }, 409);
    }
    this.row = { state: body, revision: currentRevision + 1 };
    record(200);
    return json({ state: body, revision: this.row.revision, persistent: true });
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/* ---------- mounting ---------- */

type PlannerModule = typeof import("@/components/planner-provider");
export type PlannerValue = ReturnType<PlannerModule["usePlanner"]>;

/**
 * Renders without `act`: the provider's state changes arrive from fetch
 * promises and timers, so tests poll the live value with `waitFor` instead.
 * `extra` renders additional UI (e.g. the persistence panel) inside the provider.
 */
export async function mountPlanner(extra?: () => React.ReactNode, store?: SectionStore) {
  const mod = await import("@/components/planner-provider");
  const sectionStore = store ?? (await import("@/lib/section-store")).sampleSectionStore;
  const React = await import("react");
  const { createRoot } = await import("react-dom/client");

  let latest: PlannerValue | null = null;
  function Probe() {
    latest = mod.usePlanner();
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  root.render(
    React.createElement(
      mod.PlannerProvider,
      // Sections answer at once from the bundled samples unless a test passes a store (section-store.test.ts).
      { sectionStore },
      React.createElement(mod.ToastProvider, null, React.createElement(Probe), extra ? extra() : null),
    ),
  );
  await waitFor(() => latest !== null, "first render");

  const get = (): PlannerValue => {
    if (!latest) {
      throw new Error("planner probe has not rendered");
    }
    return latest;
  };

  /** Runs a planner action against the current value and lets React render it. */
  const run = async (action: (planner: PlannerValue) => void) => {
    action(get());
    await sleep(10);
  };

  const unmount = async () => {
    root.unmount();
    container.remove();
    await sleep(10);
  };

  return { get, run, unmount, container };
}

/** Lets the debounced save (350 ms) fire and any resulting request settle. */
export const flushSaves = (ms = 500) => sleep(ms);
