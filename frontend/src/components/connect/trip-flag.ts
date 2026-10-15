/**
 * A tab-only note that the student left for myUNT to get the PDF. On a
 * phone that trip can reload this page; the import page then comes back
 * with "Use the downloaded PDF" leading instead of starting over. It is a
 * flag, no transcript data, and it lives only while the trip is
 * outstanding: set when myUNT opens, consumed when the page restores from
 * it, cleared when a file is chosen or dropped and when the page is left.
 */
export const TRIP_KEY = "untangle.connect.trip";

type FlagStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** sessionStorage, or nothing where storage is denied (private modes, sandboxed frames). */
function store(): FlagStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readTripFlag(storage: FlagStore | null = store()): boolean {
  try {
    return storage?.getItem(TRIP_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTripFlag(storage: FlagStore | null = store()) {
  try {
    storage?.setItem(TRIP_KEY, "1");
  } catch {
    // Storage denied: the page still works, it just won't survive a reload.
  }
}

export function clearTripFlag(storage: FlagStore | null = store()) {
  try {
    storage?.removeItem(TRIP_KEY);
  } catch {
    // As above.
  }
}
