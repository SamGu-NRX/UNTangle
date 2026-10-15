import {
  buildSavedPlanSnapshot,
  validateSavedPlanPayload,
} from "@/lib/plan-library/snapshot";
import type { SectionReferenceReport } from "@/lib/plan-library/snapshot";
import type { SavedPlanSnapshot, SavedPlanSource } from "@/lib/plan-library/snapshot-types";
import type { PlannerState } from "@/lib/types";

/**
 * Local saved-plan library — a localStorage-backed store of plan snapshots.
 *
 * Robustness contract (the store never throws for caller-visible failures):
 * - storage disabled or inaccessible → structured `storageUnavailable` failure;
 * - a corrupt or unrecognizable store document → quarantined byte-for-byte
 *   under a separate key and the library restarts empty, with a visible
 *   `corruptDataRecovered` notice — data is preserved, never silently dropped;
 * - a record this schema version cannot read → kept in the document's
 *   `unreadable` list and re-preserved on every write, with a notice;
 * - storage full → structured `quotaExceeded` failure; existing data intact;
 * - cross-tab concurrent writes → every mutation re-reads the current document
 *   and applies on top of it; a residual race between the freshness re-check
 *   and `setItem` is documented (localStorage has no compare-and-swap), and
 *   the UI additionally listens to `storage` events to stay current.
 */

export const LEGACY_SAVED_PLANS_STORE_KEY = "untangle.saved-plans.v1";
// Views create a library store before the planner has prepared an identity,
// so its storage checks use a key that holds no one's data.
const STORAGE_PROBE_KEY = "untangle.storage-probe";
export const SAVED_PLANS_STORE_KEY = `${LEGACY_SAVED_PLANS_STORE_KEY}:guest`;

export function savedPlansKey(userId: string | null): string {
  return userId === null ? SAVED_PLANS_STORE_KEY : `${LEGACY_SAVED_PLANS_STORE_KEY}:user:${encodeURIComponent(userId)}`;
}

// The library view keeps its store across account changes. Until the provider
// confirms an identity, browser-backed stores refuse reads and writes.
let browserIdentity: string | null | undefined;
let browserIdentityToken = Symbol("saved-plan identity");
export function getSavedPlanIdentity(): string | null | undefined {
  return browserIdentity;
}
export function setSavedPlanIdentity(userId: string | null | undefined): void {
  browserIdentity = userId;
  browserIdentityToken = Symbol("saved-plan identity");
  // The live library read performs migration so its notice reaches the view.
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVED_PLANS_CHANGED_EVENT));
}

export function clearSavedPlansIdentity(userId: string | null): void {
  if (typeof window === "undefined") return;
  const prefix = identityQuarantinePrefix(userId);
  try {
    const storage = window.localStorage;
    storage.removeItem(savedPlansKey(userId));
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Cleanup cannot access storage while the browser denies it.
  }
}

function identityQuarantinePrefix(userId: string | null): string {
  return `${QUARANTINE_PREFIX}${userId === null ? "guest" : `user:${encodeURIComponent(userId)}`}:`;
}
/** Fired on window after every successful library write in this tab. */
export const SAVED_PLANS_CHANGED_EVENT = "untangle:saved-plans-changed";
export const SAVED_PLANS_STORE_SCHEMA_VERSION = 1;
const QUARANTINE_PREFIX = "untangle.saved-plans.corrupt-";
const MAX_FRESHNESS_ATTEMPTS = 3;

/** Quarantine keys are unique per event: a same-millisecond collision must
 * never overwrite an earlier quarantine (that would destroy stored bytes). */
function newQuarantineKey(prefix: string): string {
  const unique =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  return `${prefix}${Date.now()}-${unique}`;
}

export type SavedPlanStoreFailure = {
  kind:
    | "storageUnavailable"
    | "identityChanged"
    | "corruptDataRecovered"
    | "quotaExceeded"
    | "invalidPayload"
    | "planNotFound";
  message: string;
  quarantinedTo?: string;
};

export type SavedPlanStoreDoc = {
  storeSchemaVersion: typeof SAVED_PLANS_STORE_SCHEMA_VERSION;
  revision: number;
  plans: SavedPlanSnapshot[];
  /** Records present in storage that this schema version cannot read. */
  unreadable: Array<{ reason: string; record: unknown }>;
};

export type StoreReadResult =
  | { ok: true; doc: SavedPlanStoreDoc; notices: SavedPlanStoreFailure[] }
  | { ok: false; failure: SavedPlanStoreFailure };

export type StoreWriteResult<T> =
  | { ok: true; value: T; doc: SavedPlanStoreDoc; notices: SavedPlanStoreFailure[] }
  | { ok: false; failure: SavedPlanStoreFailure };

export type ImportPlanResult =
  | { ok: true; snapshot: SavedPlanSnapshot; references: SectionReferenceReport }
  | { ok: false; failure: SavedPlanStoreFailure };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function emptyDoc(): SavedPlanStoreDoc {
  return {
    storeSchemaVersion: SAVED_PLANS_STORE_SCHEMA_VERSION,
    revision: 0,
    plans: [],
    unreadable: [],
  };
}

function defaultStorage(): Storage | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const storage = window.localStorage;
    storage.setItem(STORAGE_PROBE_KEY, "1");
    storage.removeItem(STORAGE_PROBE_KEY);
    return storage;
  } catch {
    return null;
  }
}

function parseDoc(raw: string | null): { doc: SavedPlanStoreDoc; notice: SavedPlanStoreFailure | null } {
  if (raw === null) {
    return { doc: emptyDoc(), notice: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      doc: emptyDoc(),
      notice: {
        kind: "corruptDataRecovered",
        message: "Saved-plan storage held unreadable data; it was quarantined and the library restarted empty.",
      },
    };
  }

  if (!isRecord(parsed) || typeof parsed.revision !== "number" || !Array.isArray(parsed.plans)) {
    return {
      doc: emptyDoc(),
      notice: {
        kind: "corruptDataRecovered",
        message: "Saved-plan storage held an unrecognized document; it was quarantined and the library restarted empty.",
      },
    };
  }

  const unreadable: SavedPlanStoreDoc["unreadable"] = [];
  const plans: SavedPlanSnapshot[] = [];
  (parsed.plans as unknown[]).forEach((record) => {
    const validation = validateSavedPlanPayload(record);
    if (validation.ok) {
      plans.push(validation.snapshot);
    } else {
      unreadable.push({ reason: validation.reason, record });
    }
  });

  // Carry forward unreadable records persisted by earlier writes so they stay
  // visible instead of disappearing on the next library read.
  if (Array.isArray(parsed.unreadable)) {
    (parsed.unreadable as unknown[]).forEach((entry) => {
      if (isRecord(entry) && typeof entry.reason === "string" && "record" in entry) {
        unreadable.push({ reason: entry.reason, record: entry.record });
      }
    });
  }

  const doc: SavedPlanStoreDoc = {
    storeSchemaVersion: SAVED_PLANS_STORE_SCHEMA_VERSION,
    revision: parsed.revision,
    plans,
    unreadable,
  };
  return {
    doc,
    notice: unreadable.length
      ? {
          kind: "corruptDataRecovered",
          message: `${unreadable.length} saved-plan record(s) could not be read with this version and are kept (not lost) in the library's unreadable list.`,
        }
      : null,
  };
}

export type SavedPlanStore = {
  /** True when localStorage is usable at all. */
  readonly available: boolean;
  list(): StoreReadResult;
  /** Quarantined unreadable documents: bytes kept from failed reads, listed
   * newest-first. Lets the UI tell the user where the kept bytes live and
   * proves quarantine preserved them rather than silently discarding. */
  listQuarantined(): Array<{ key: string; size: number }>;
  /** Raw quarantined bytes for a key (null when missing or unreadable). */
  readQuarantined(key: string): string | null;
  savePlan(input: { state: PlannerState; name?: string; now?: Date }): StoreWriteResult<SavedPlanSnapshot>;
  renamePlan(planId: string, name: string): StoreWriteResult<SavedPlanSnapshot>;
  duplicatePlan(planId: string, now?: Date): StoreWriteResult<SavedPlanSnapshot>;
  setPlanArchived(planId: string, archived: boolean, now?: Date): StoreWriteResult<SavedPlanSnapshot>;
  /** Capture before async work, then pass to importPlan to refuse account changes. */
  captureIdentity(): symbol;
  importPlan(raw: unknown, now?: Date, identityToken?: symbol): ImportPlanResult;
};

export function createSavedPlanStore(storage?: Storage | null, userId: string | null = null): SavedPlanStore {
  const identity = () => storage === undefined ? browserIdentity : userId;
  const storeKey = () => {
    const current = identity();
    return current === undefined ? null : savedPlansKey(current);
  };
  const quarantinePrefix = () => {
    const current = identity();
    return current === undefined ? null : identityQuarantinePrefix(current);
  };
  const resolvedStorage = storage === undefined ? defaultStorage() : storage;
  let migrationNotices: SavedPlanStoreFailure[] = [];
  let available = resolvedStorage !== null;
  if (resolvedStorage) {
    // A storage object can exist yet deny every access (private mode,
    // blocked permissions): probe once so `available` reflects reality.
    try {
      resolvedStorage.getItem(STORAGE_PROBE_KEY);
    } catch {
      available = false;
    }
  }

  function quarantine(raw: string): SavedPlanStoreFailure["quarantinedTo"] {
    if (!resolvedStorage) {
      return undefined;
    }
    const prefix = quarantinePrefix();
    if (!prefix) return undefined;
    const quarantineKey = newQuarantineKey(prefix);
    try {
      resolvedStorage.setItem(quarantineKey, raw);
      return quarantineKey;
    } catch {
      // Quarantine is best-effort; when it fails the notice must not claim
      // the bytes were kept — the caller reports the honest outcome.
      return undefined;
    }
  }

  type RawRead = { failed: false; raw: string | null } | { failed: true };

  function readRaw(): RawRead {
    if (!resolvedStorage) {
      return { failed: false, raw: null };
    }
    try {
      const key = storeKey();
      if (!key) return { failed: true };
      // Old libraries contain no account ownership evidence. Keep their bytes
      // outside every identity's recovery UI rather than assigning them by login.
      const legacy = resolvedStorage.getItem(LEGACY_SAVED_PLANS_STORE_KEY);
      if (legacy !== null) {
        resolvedStorage.setItem(newQuarantineKey(`${QUARANTINE_PREFIX}legacy-`), legacy);
        resolvedStorage.removeItem(LEGACY_SAVED_PLANS_STORE_KEY);
        migrationNotices = [{ kind: "corruptDataRecovered", message: "An older shared-browser library was quarantined because its owner could not be established." }];
      }
      return { failed: false, raw: resolvedStorage.getItem(key) };
    } catch {
      // Storage exists but is inaccessible (disabled, permission-denied):
      // that is a structured failure, not an empty library.
      return { failed: true };
    }
  }

  function storageUnavailableFailure(): SavedPlanStoreFailure {
    return {
      kind: "storageUnavailable",
      message: "Saved plans cannot be read or stored because browser storage is unavailable.",
    };
  }

  function readFromRaw(raw: string | null): StoreReadResult {
    if (raw !== null) {
      const parsed = parseDoc(raw);
      if (parsed.notice?.kind === "corruptDataRecovered" && parsed.doc.plans.length === 0) {
        const quarantinedTo = quarantine(raw);
        const notice: SavedPlanStoreFailure = {
          ...parsed.notice,
          // When the quarantine write failed, the message must not imply the
          // bytes were preserved. Name the location only when it exists.
          message: quarantinedTo
            ? parsed.notice.message
            : "Saved-plan storage held unreadable data; the library restarted empty, and the unreadable bytes could not be kept because storage refused the write.",
          quarantinedTo,
        };
        return { ok: true, doc: emptyDoc(), notices: [...migrationNotices, notice] };
      }
      return {
        ok: true,
        doc: parsed.doc,
        notices: [...migrationNotices, ...(parsed.notice ? [parsed.notice] : [])],
      };
    }
    return { ok: true, doc: emptyDoc(), notices: migrationNotices };
  }

  function writeDoc(doc: SavedPlanStoreDoc): SavedPlanStoreFailure | null {
    if (!resolvedStorage) {
      return {
        kind: "storageUnavailable",
        message: "Saved plans cannot be stored because browser storage is unavailable.",
      };
    }
    try {
      const key = storeKey();
      if (!key) return storageUnavailableFailure();
      resolvedStorage.setItem(key, JSON.stringify(doc));
      // `storage` events only reach other tabs; views in this tab (the plan
      // library while the top bar's "Save a copy" writes) hear this one.
      if (typeof window !== "undefined") window.dispatchEvent(new Event(SAVED_PLANS_CHANGED_EVENT));
      return null;
    } catch {
      return {
        kind: "quotaExceeded",
        message: "Browser storage is full; the saved plan was not stored. Export it as a file to keep it.",
      };
    }
  }

  function mutate<T>(
    mutator: (doc: SavedPlanStoreDoc) => { value: T } | null,
  ): StoreWriteResult<T> {
    if (!available) {
      return {
        ok: false,
        failure: {
          kind: "storageUnavailable",
          message: "Saved plans cannot be stored because browser storage is unavailable.",
        },
      };
    }

    let lastNotices: SavedPlanStoreFailure[] = [];
    for (let attempt = 0; attempt < MAX_FRESHNESS_ATTEMPTS; attempt += 1) {
      const rawRead = readRaw();
      if (rawRead.failed) {
        return { ok: false, failure: storageUnavailableFailure() };
      }
      const current = readFromRaw(rawRead.raw);
      if (!current.ok) {
        return current;
      }
      lastNotices = current.notices;

      // Freshness re-check: if storage changed since the read (another tab
      // won the race), re-read and re-apply instead of clobbering it.
      const rawBeforeWrite = readRaw();
      if (
        attempt + 1 < MAX_FRESHNESS_ATTEMPTS &&
        !rawBeforeWrite.failed &&
        rawBeforeWrite.raw !== rawRead.raw
      ) {
        continue;
      }

      const doc = current.doc;
      const applied = mutator(doc);
      if (!applied) {
        return {
          ok: false,
          failure: {
            kind: "planNotFound",
            message: "Saved plan not found in this library; it may have been changed in another tab.",
          },
        };
      }
      const nextDoc: SavedPlanStoreDoc = {
        ...doc,
        revision: doc.revision + 1,
        unreadable: doc.unreadable,
      };
      const failure = writeDoc(nextDoc);
      if (failure) {
        return { ok: false, failure };
      }
      return { ok: true, value: applied.value, doc: nextDoc, notices: lastNotices };
    }

    return {
      ok: false,
      failure: {
        kind: "storageUnavailable",
        message: "Saved-plan storage kept changing while the update was applied; try again.",
      },
    };
  }

  return {
    get available() { return available && storeKey() !== null; },
    listQuarantined() {
      if (!resolvedStorage) {
        return [];
      }
      const prefix = quarantinePrefix();
      if (!prefix) return [];
      const keys: Array<{ key: string; size: number }> = [];
      for (let index = resolvedStorage.length - 1; index >= 0; index -= 1) {
        let key: string | null = null;
        try {
          key = resolvedStorage.key(index);
        } catch {
          continue;
        }
        if (key && key.startsWith(prefix)) {
          try {
            keys.push({ key, size: (resolvedStorage.getItem(key) ?? "").length });
          } catch {
            keys.push({ key, size: 0 });
          }
        }
      }
      return keys;
    },

    readQuarantined(key: string) {
      const prefix = quarantinePrefix();
      if (!resolvedStorage || !prefix || !key.startsWith(prefix)) {
        return null;
      }
      try {
        return resolvedStorage.getItem(key);
      } catch {
        return null;
      }
    },

    list() {
      if (!available) {
        return { ok: false, failure: storageUnavailableFailure() };
      }
      const rawRead = readRaw();
      if (rawRead.failed) {
        return { ok: false, failure: storageUnavailableFailure() };
      }
      return readFromRaw(rawRead.raw);
    },

    savePlan({ state, name, now }) {
      return mutate((doc) => {
        const capturedName = name && name.trim().length > 0 ? name.trim() : defaultPlanName(now ?? new Date());
        const snapshot = buildSavedPlanSnapshot({
          state,
          name: capturedName,
          source: {
            kind: "workingState",
            detail: "Saved from the working schedule",
          },
          now,
        });
        doc.plans = [snapshot, ...doc.plans];
        return { value: snapshot };
      });
    },

    renamePlan(planId, name) {
      const trimmed = name.trim();
      if (!trimmed) {
        return {
          ok: false,
          failure: { kind: "invalidPayload", message: "A saved plan needs a non-empty name." },
        };
      }
      return mutate((doc) => {
        const plan = doc.plans.find((entry) => entry.planId === planId);
        if (!plan) {
          return null;
        }
        const renamed = { ...plan, name: trimmed };
        doc.plans = doc.plans.map((entry) => (entry.planId === planId ? renamed : entry));
        return { value: renamed };
      });
    },

    duplicatePlan(planId, now) {
      return mutate((doc) => {
        const plan = doc.plans.find((entry) => entry.planId === planId);
        if (!plan) {
          return null;
        }
        const duplicate = buildSavedPlanSnapshot({
          state: plan.state,
          name: nextCopyName(plan.name, doc.plans),
          source: {
            kind: "duplicate",
            detail: `Duplicated from “${plan.name}”`,
          },
          now,
        });
        doc.plans = [duplicate, ...doc.plans];
        return { value: duplicate };
      });
    },

    setPlanArchived(planId, archived, now) {
      return mutate((doc) => {
        const plan = doc.plans.find((entry) => entry.planId === planId);
        if (!plan) {
          return null;
        }
        const updated: SavedPlanSnapshot = {
          ...plan,
          archivedAt: archived ? (now ?? new Date()).toISOString() : null,
        };
        doc.plans = doc.plans.map((entry) => (entry.planId === planId ? updated : entry));
        return { value: updated };
      });
    },

    captureIdentity() {
      return browserIdentityToken;
    },

    importPlan(raw, now, identityToken) {
      if (identityToken !== undefined && identityToken !== browserIdentityToken) {
        return { ok: false, failure: { kind: "identityChanged", message: "The account changed while the file was loading. Choose the file again for this account." } };
      }
      if (!available) {
        return {
          ok: false,
          failure: {
            kind: "storageUnavailable",
            message: "Saved plans cannot be stored because browser storage is unavailable.",
          },
        };
      }
      const validation = validateSavedPlanPayload(raw);
      if (!validation.ok) {
        return {
          ok: false,
          failure: { kind: "invalidPayload", message: validation.reason },
        };
      }
      const importedAt = (now ?? new Date()).toISOString();
      const imported: SavedPlanSnapshot = {
        ...validation.snapshot,
        planId: crypto.randomUUID(),
        createdAt: importedAt,
        archivedAt: null,
        source: {
          kind: "import",
          detail: "Imported from a saved-plan file",
          capturedAt: importedAt,
        } satisfies SavedPlanSource,
      };
      const stored = mutate((doc) => {
        doc.plans = [imported, ...doc.plans];
        return { value: imported };
      });
      if (!stored.ok) {
        return stored;
      }
      return { ok: true, snapshot: imported, references: validation.references };
    },
  };
}

/**
 * Calls `listener` whenever the saved-plan library changes: after a write in
 * this tab, or a write to the same key from another tab. Returns the
 * unsubscribe function.
 */
export function subscribeSavedPlans(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === (browserIdentity === undefined ? SAVED_PLANS_STORE_KEY : savedPlansKey(browserIdentity))) listener();
  };
  window.addEventListener(SAVED_PLANS_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(SAVED_PLANS_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function defaultPlanName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `Plan ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

export function nextCopyName(name: string, plans: SavedPlanSnapshot[]): string {
  const existing = new Set(plans.map((plan) => plan.name));
  if (!existing.has(`${name} (copy)`)) {
    return `${name} (copy)`;
  }
  let counter = 2;
  while (existing.has(`${name} (copy ${counter})`)) {
    counter += 1;
  }
  return `${name} (copy ${counter})`;
}

export function exportPlanJson(snapshot: SavedPlanSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
