import { normalizePlannerState } from "@/lib/planner";
import type { PlannerState } from "@/lib/types";

/**
 * Guest planner-state store — localStorage durability for signed-out users.
 *
 * The planner's working schedule for a guest lives in localStorage (it must
 * survive a reload, which sessionStorage does not). This store implements the
 * planner's durability rules for that document:
 *
 * - every write is versioned with a monotonic `revision`, so two tabs can
 *   tell "newer" from "older" instead of last-write-wins silently;
 * - unreadable stored bytes are quarantined byte-for-byte under a unique key
 *   (never overwritten by a later quarantine) and the library restarts
 *   empty with a notice that names the quarantine location — the notice never
 *   claims the data was recovered;
 * - when storage is denied (disabled, private mode, blocked), reads and
 *   writes return structured failures so the UI can keep edits in memory and
 *   warn persistently;
 * - cross-tab changes are observable through a `storage`-event subscription,
 *   so the provider can show a conflict instead of overwriting either side.
 *
 * The store never throws for caller-visible failures.
 */

export const PLANNER_STATE_STORE_KEY = "untangle.planner-state.v1";
export const PLANNER_STATE_STORE_SCHEMA_VERSION = 1;
const QUARANTINE_PREFIX = "untangle.planner-state.corrupt-";

export type PlannerStoreFailure = {
  kind:
    | "storageUnavailable"
    | "corruptDataUnpreserved"
    | "quotaExceeded"
    | "invalidDocument";
  message: string;
  quarantinedTo?: string;
};

/** A newer document another tab wrote while this tab had it loaded. */
export type PlannerStoreIncoming = {
  revision: number;
  state: PlannerState | null;
  savedAt: string | null;
};

export type PlannerStoreRead =
  | {
      ok: true;
      state: PlannerState | null;
      revision: number;
      savedAt: string | null;
      notices: PlannerStoreFailure[];
    }
  | { ok: false; failure: PlannerStoreFailure };

export type PlannerStoreWrite =
  | { ok: true; revision: number; savedAt: string }
  | { ok: false; failure: PlannerStoreFailure }
  /** Another tab wrote a newer revision since this tab's base; nothing was written. */
  | { ok: false; conflict: true; incoming: PlannerStoreIncoming };

export type PlannerStoreDocument = {
  storeSchemaVersion: typeof PLANNER_STATE_STORE_SCHEMA_VERSION;
  revision: number;
  savedAt: string;
  state: PlannerState;
};

export type PlannerStore = {
  /** True when localStorage is usable at all. */
  readonly available: boolean;
  read(): PlannerStoreRead;
  /**
   * Write the working state. `baseRevision` is the revision this tab last
   * loaded or wrote; when storage now holds a newer revision the write is
   * refused with the incoming document so the caller can arbitrate.
   */
  write(state: PlannerState, baseRevision: number): PlannerStoreWrite;
  /** Silent best-effort mirror write (used as a registered-user backup); never conflicts. */
  writeMirror(state: PlannerState): void;
  subscribe(listener: () => void): () => void;
  /** Keys of quarantined corrupt documents, oldest first. */
  listQuarantined(): string[];
  /** Raw quarantined bytes, intact, for manual recovery. */
  readQuarantined(key: string): string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyState(): PlannerState | null {
  return null;
}

function defaultStorage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const storage = window.localStorage;
    const probeKey = `${PLANNER_STATE_STORE_KEY}.probe`;
    storage.setItem(probeKey, "1");
    storage.removeItem(probeKey);
    return storage;
  } catch {
    return null;
  }
}

function quarantineKey(): string {
  // Date.now() alone can collide when two quarantines land in the same
  // millisecond (two corrupting tabs); the random suffix keeps every
  // quarantine intact — overwriting one would destroy stored bytes.
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${QUARANTINE_PREFIX}${Date.now()}-${unique}`;
}

function parseDocument(raw: string): {
  doc: PlannerStoreDocument | null;
  notice: PlannerStoreFailure | null;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      doc: null,
      notice: {
        kind: "invalidDocument",
        message: "Your saved schedule was stored in a format this version cannot read.",
      },
    };
  }

  if (
    !isRecord(parsed) ||
    parsed.storeSchemaVersion !== PLANNER_STATE_STORE_SCHEMA_VERSION ||
    typeof parsed.revision !== "number" ||
    !isRecord(parsed.state)
  ) {
    return {
      doc: null,
      notice: {
        kind: "invalidDocument",
        message: "Your saved schedule was stored in a format this version cannot read.",
      },
    };
  }

  const savedAt = typeof parsed.savedAt === "string" ? parsed.savedAt : null;
  return {
    doc: {
      storeSchemaVersion: PLANNER_STATE_STORE_SCHEMA_VERSION,
      revision: parsed.revision,
      savedAt: savedAt ?? new Date(0).toISOString(),
      state: normalizePlannerState(parsed.state as PlannerState),
    },
    notice: null,
  };
}

export function createPlannerStateStore(storage?: Storage | null): PlannerStore {
  const resolvedStorage = storage === undefined ? defaultStorage() : storage;
  let available = resolvedStorage !== null;
  if (resolvedStorage) {
    try {
      resolvedStorage.getItem(PLANNER_STATE_STORE_KEY);
    } catch {
      available = false;
    }
  }

  function readRaw(): { failed: true } | { failed: false; raw: string | null } {
    if (!resolvedStorage) {
      return { failed: true };
    }
    try {
      return { failed: false, raw: resolvedStorage.getItem(PLANNER_STATE_STORE_KEY) };
    } catch {
      return { failed: true };
    }
  }

  function quarantine(raw: string): { quarantinedTo?: string; unpreserved?: string } {
    if (!resolvedStorage) {
      return { unpreserved: "Browser storage is unavailable, so the unreadable bytes could not be kept." };
    }
    const key = quarantineKey();
    try {
      resolvedStorage.setItem(key, raw);
      return { quarantinedTo: key };
    } catch {
      return {
        unpreserved:
          "Browser storage refused the write, so the unreadable bytes could not be kept.",
      };
    }
  }

  const store: PlannerStore = {
    get available() {
      return available;
    },

    read() {
      const rawRead = readRaw();
      if (rawRead.failed) {
        return {
          ok: false,
          failure: {
            kind: "storageUnavailable",
            message: "Browser storage is unavailable, so your schedule cannot be stored.",
          },
        };
      }

      if (rawRead.raw === null) {
        return { ok: true, state: emptyState(), revision: 0, savedAt: null, notices: [] };
      }

      const parsed = parseDocument(rawRead.raw);
      if (!parsed.doc) {
        // Corrupt bytes: quarantine them intact before anything overwrites
        // them, then restart empty. The notice names the quarantine location
        // and never claims the schedule was recovered.
        const kept = quarantine(rawRead.raw);
        const location = kept.quarantinedTo
          ? ` The stored bytes were kept intact at ${kept.quarantinedTo}.`
          : ` ${kept.unpreserved ?? "The stored bytes could not be kept."}`;
        return {
          ok: true,
          state: emptyState(),
          revision: 0,
          savedAt: null,
          notices: [
            {
              kind: kept.quarantinedTo ? "invalidDocument" : "corruptDataUnpreserved",
              message: `Your saved schedule could not be read (corrupt storage). You are starting from an empty schedule; nothing was recovered.${location}`,
              quarantinedTo: kept.quarantinedTo,
            },
          ],
        };
      }

      return {
        ok: true,
        state: parsed.doc.state,
        revision: parsed.doc.revision,
        savedAt: parsed.doc.savedAt,
        notices: [],
      };
    },

    write(state, baseRevision) {
      if (!available) {
        return {
          ok: false,
          failure: {
            kind: "storageUnavailable",
            message: "Browser storage is unavailable, so your schedule cannot be stored.",
          },
        };
      }

      const storage = resolvedStorage;
      if (!storage) {
        return {
          ok: false,
          failure: {
            kind: "storageUnavailable",
            message: "Browser storage is unavailable, so your schedule cannot be stored.",
          },
        };
      }

      const rawRead = readRaw();
      if (rawRead.failed) {
        return {
          ok: false,
          failure: {
            kind: "storageUnavailable",
            message: "Browser storage is unavailable, so your schedule cannot be stored.",
          },
        };
      }

      let currentRevision = 0;
      let incoming: PlannerStoreIncoming | null = null;
      if (rawRead.raw !== null) {
        const parsed = parseDocument(rawRead.raw);
        if (!parsed.doc) {
          // The document became corrupt between reads (another tab wrote bad
          // bytes): quarantine before anything can overwrite it, then write
          // fresh — the quarantined bytes stay intact either way.
          quarantine(rawRead.raw);
        } else {
          currentRevision = parsed.doc.revision;
          if (currentRevision > baseRevision) {
            incoming = {
              revision: parsed.doc.revision,
              state: parsed.doc.state,
              savedAt: parsed.doc.savedAt,
            };
          }
        }
      }

      if (incoming) {
        return { ok: false, conflict: true, incoming };
      }

      const savedAt = new Date().toISOString();
      const doc: PlannerStoreDocument = {
        storeSchemaVersion: PLANNER_STATE_STORE_SCHEMA_VERSION,
        revision: currentRevision + 1,
        savedAt,
        state: normalizePlannerState(state),
      };
      try {
        storage.setItem(PLANNER_STATE_STORE_KEY, JSON.stringify(doc));
      } catch {
        return {
          ok: false,
          failure: {
            kind: "quotaExceeded",
            message:
              "Browser storage is full, so your schedule was not stored. Export it as a file to keep it.",
          },
        };
      }
      return { ok: true, revision: doc.revision, savedAt };
    },

    writeMirror(state) {
      if (!resolvedStorage) {
        return;
      }
      try {
        const rawRead = readRaw();
        let currentRevision = 0;
        if (!rawRead.failed && rawRead.raw !== null) {
          const parsed = parseDocument(rawRead.raw);
          if (parsed.doc) {
            currentRevision = parsed.doc.revision;
          }
        }
        const doc: PlannerStoreDocument = {
          storeSchemaVersion: PLANNER_STATE_STORE_SCHEMA_VERSION,
          revision: currentRevision + 1,
          savedAt: new Date().toISOString(),
          state: normalizePlannerState(state),
        };
        resolvedStorage.setItem(PLANNER_STATE_STORE_KEY, JSON.stringify(doc));
      } catch {
        // Best-effort mirror: a failure here never blocks the server save.
      }
    },

    subscribe(listener) {
      if (typeof window === "undefined") {
        return () => {};
      }
      const handler = (event: StorageEvent) => {
        if (event.key === null || event.key === PLANNER_STATE_STORE_KEY) {
          listener();
        }
      };
      window.addEventListener("storage", handler);
      return () => {
        window.removeEventListener("storage", handler);
      };
    },

    listQuarantined() {
      if (!resolvedStorage) {
        return [];
      }
      const keys: string[] = [];
      try {
        for (let index = 0; index < resolvedStorage.length; index += 1) {
          const key = resolvedStorage.key(index);
          if (key && key.startsWith(QUARANTINE_PREFIX)) {
            keys.push(key);
          }
        }
      } catch {
        return [];
      }
      return keys.sort();
    },

    readQuarantined(key) {
      if (!resolvedStorage || !key.startsWith(QUARANTINE_PREFIX)) {
        return null;
      }
      try {
        return resolvedStorage.getItem(key);
      } catch {
        return null;
      }
    },
  };

  return store;
}
