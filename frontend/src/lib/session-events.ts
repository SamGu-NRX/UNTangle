// Cross-component session-expiry signaling, owned by the account shell.
//
// The planner provider (PR #8's task) calls notifySessionExpired() when an
// authenticated request comes back 401 and subscribes onSessionRestored() to
// retry its parked save. The account shell owns the dialog that reacts to the
// expiry event and emits the restore event once the user has signed back in
// in place. No component needs to know about any other.

export type SessionEventHandler = () => void;

const expiredHandlers = new Set<SessionEventHandler>();
const restoredHandlers = new Set<SessionEventHandler>();

/** Announce that the session ended; the shell shows the expiry dialog. */
export function notifySessionExpired(): void {
  for (const handler of [...expiredHandlers]) handler();
}

/** Announce that the user signed back in; listeners retry parked work. */
export function notifySessionRestored(): void {
  for (const handler of [...restoredHandlers]) handler();
}

/** Subscribe to expiry notices. Returns an unsubscribe function. */
export function onSessionExpired(handler: SessionEventHandler): () => void {
  expiredHandlers.add(handler);
  return () => {
    expiredHandlers.delete(handler);
  };
}

/** Subscribe to restore notices. Returns an unsubscribe function. */
export function onSessionRestored(handler: SessionEventHandler): () => void {
  restoredHandlers.add(handler);
  return () => {
    restoredHandlers.delete(handler);
  };
}

type SessionProbe = { user?: unknown } | null;

/**
 * Poll better-auth's existing get-session route until a user is present,
 * then emit the restore event. Returns whether the session came back.
 * Injectable fetch and delay keep this unit-testable without a DOM or
 * real timers. 150 attempts at 2s covers a five-minute email round-trip.
 */
export async function pollForSessionRestored(
  options: {
    fetchLike?: typeof fetch;
    intervalMs?: number;
    maxAttempts?: number;
    delay?: (ms: number) => Promise<void>;
  } = {},
): Promise<boolean> {
  const fetchLike = options.fetchLike ?? fetch;
  const intervalMs = options.intervalMs ?? 2000;
  const maxAttempts = options.maxAttempts ?? 150;
  const delay =
    options.delay ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetchLike("/api/auth/get-session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      const probe = (await response.json().catch(() => null)) as SessionProbe;
      if (probe && typeof probe === "object" && probe.user) {
        notifySessionRestored();
        return true;
      }
    }
    if (attempt < maxAttempts - 1) {
      await delay(intervalMs);
    }
  }
  return false;
}

/** The expiry overlay belongs on app pages only, never on auth or /dev. */
export function isExemptPath(pathname: string | null): boolean {
  return pathname === "/sign-in" || (pathname?.startsWith("/dev") ?? false);
}
