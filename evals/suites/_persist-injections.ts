/**
 * Fault-injection primitives for the persistence-faults suite.
 *
 * Injections happen ONLY at the boundaries the task allows:
 *   - the network boundary, via Playwright route interception (POST
 *     /api/planner answers 500 — the "save failed" fault);
 *   - the browser boundary, via init scripts (storage access denied) and
 *     direct storage mutation (corrupted stored plan bytes).
 *
 * Nothing here edits application code; every primitive drives a running page.
 *
 * Read-only observations this file relies on (frontend at this branch's head):
 *   - planner saves for registered users go through POST /api/planner
 *     (frontend/src/components/planner-provider.tsx);
 *   - guest planner state lives in sessionStorage under the key below
 *     (frontend/src/lib/planner.ts, plannerStorageKey).
 */

import type { Page, Route } from "@playwright/test";

/** Guest planner-state storage key (observed, read-only, planner.ts:39). */
export const PLANNER_STORAGE_KEY = "untangle-planner-state";

/** Matches the planner persistence API regardless of origin or query string. */
const PLANNER_API_PATTERN = /\/api\/planner\/?(\?.*)?$/;

export type SaveFaultMode = "http500";

export interface SaveInterception {
  /** How many planner-save requests this interception has answered with the fault. */
  interceptedCount: () => number;
  /** Removes the interception so later requests pass through. */
  stop: () => Promise<void>;
}

/**
 * Answers every POST /api/planner with an injected 500 while installed.
 * GETs (the load path) pass through untouched, so page reloads still see the
 * last durably-saved state.
 */
export async function failPlannerSaves(page: Page, mode: SaveFaultMode): Promise<SaveInterception> {
  if (mode !== "http500") {
    throw new Error(`unknown save-fault mode: ${mode}`);
  }
  let intercepted = 0;
  const handler = async (route: Route): Promise<void> => {
    const request = route.request();
    if (request.method() !== "POST" || !PLANNER_API_PATTERN.test(request.url())) {
      await route.continue();
      return;
    }
    intercepted += 1;
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "injected eval fault: planner save failed" }),
    });
  };
  await page.route(PLANNER_API_PATTERN, handler);
  return {
    interceptedCount: () => intercepted,
    stop: () => page.unroute(PLANNER_API_PATTERN, handler),
  };
}

/**
 * Init script that makes BOTH storage areas throw on access, the way a real
 * browser does when storage is blocked (SecurityError on the property read).
 * localStorage is denied per the durability rule; sessionStorage is denied
 * too because this head's guest planner path persists to sessionStorage —
 * denying only localStorage would leave the app's actual storage working and
 * the fault would not bind to the code under test.
 */
export function denyBrowserStorage(): void {
  const deny = (name: "localStorage" | "sessionStorage"): void => {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        throw new DOMException(`${name} access is denied (persistence-faults eval injection)`, "SecurityError");
      },
    });
  };
  deny("localStorage");
  deny("sessionStorage");
}

/** The raw stored plan bytes for the guest path, or null when absent. */
export async function readRawStoredPlan(page: Page): Promise<string | null> {
  return page.evaluate((key) => globalThis.sessionStorage.getItem(key), PLANNER_STORAGE_KEY);
}

export interface CorruptionResult {
  key: string;
  /** The intact bytes observed before corruption (null when nothing was stored). */
  rawBefore: string | null;
  /** The corrupted bytes written over them (null when there was nothing to corrupt). */
  corrupt: string | null;
}

/**
 * Overwrites the stored plan bytes with corrupted bytes (truncated JSON plus
 * non-JSON junk). The corruption is deterministic and the corrupted string is
 * unique, so a later storage-wide search can prove whether any copy of it —
 * a quarantine copy or otherwise — survived anywhere.
 */
export async function corruptStoredPlanBytes(page: Page): Promise<CorruptionResult> {
  return page.evaluate((key) => {
    const raw = globalThis.sessionStorage.getItem(key);
    if (raw === null) {
      return { key, rawBefore: null, corrupt: null };
    }
    const mangled = `${raw.slice(0, Math.floor(raw.length / 2))}\u0000\u00ff\u00ac{corrupted-not-json`;
    globalThis.sessionStorage.setItem(key, mangled);
    return { key, rawBefore: raw, corrupt: mangled };
  }, PLANNER_STORAGE_KEY);
}

/** Every key and value in both storage areas of the page's origin session. */
export async function dumpAllStorage(page: Page): Promise<{
  sessionStorage: Record<string, string>;
  localStorage: Record<string, string>;
}> {
  return page.evaluate(() => {
    const collect = (store: Storage): Record<string, string> => {
      const out: Record<string, string> = {};
      for (let i = 0; i < store.length; i += 1) {
        const key = store.key(i);
        if (key !== null) {
          out[key] = store.getItem(key) ?? "";
        }
      }
      return out;
    };
    return {
      sessionStorage: collect(globalThis.sessionStorage),
      localStorage: collect(globalThis.localStorage),
    };
  });
}
