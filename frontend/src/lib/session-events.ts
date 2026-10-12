/**
 * Session expiry events, local stand-in for the account PR (#19).
 *
 * #19 ships `frontend/src/lib/session-events.ts` with the first three exports
 * below and the same signatures; integration replaces this file with that one.
 * The planner only calls those three. `notifySessionRestored` exists here so
 * tests (and this stub's own users) can fire the restore event; #19 owns how a
 * restore is detected in the real app.
 */

type Listener = () => void;

const expiredListeners = new Set<Listener>();
const restoredListeners = new Set<Listener>();

function emit(listeners: Set<Listener>) {
  // Copy first: a listener may unsubscribe while the event is being delivered.
  [...listeners].forEach((listener) => listener());
}

export function notifySessionExpired(): void {
  emit(expiredListeners);
}

export function onSessionExpired(cb: () => void): () => void {
  expiredListeners.add(cb);
  return () => {
    expiredListeners.delete(cb);
  };
}

export function onSessionRestored(cb: () => void): () => void {
  restoredListeners.add(cb);
  return () => {
    restoredListeners.delete(cb);
  };
}

/** Stub-only: #19 decides when a session counts as restored. */
export function notifySessionRestored(): void {
  emit(restoredListeners);
}
