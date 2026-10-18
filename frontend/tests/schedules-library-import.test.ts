/**
 * The library page's "Open a schedule file" (importScheduleFile, the function
 * schedules-client.tsx calls) against the browser's identity-scoped store:
 * a file that finishes reading after the account changes lands nowhere.
 */
import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { installDom, removeDom } from "./ui/dom";

beforeAll(() => installDom());
afterAll(() => removeDom());
beforeEach(() => window.localStorage.clear());

async function setUp() {
  const store = await import("@/lib/saved-plans/store");
  const { importScheduleFile } = await import("@/components/schedules-library/view-model");
  const { getInitialPlannerState } = await import("@/lib/planner");
  store.setSavedPlanIdentity(null);
  const library = store.createSavedPlanStore();
  const saved = library.savePlan({ state: getInitialPlannerState(), name: "Guest copy" });
  if (!saved.ok) throw new Error(saved.failure.message);
  const fileText = JSON.stringify(saved.value);
  const names = (userId: string | null) => {
    store.setSavedPlanIdentity(userId);
    const read = library.list();
    return read.ok ? read.doc.plans.map((plan) => plan.name) : [];
  };
  return { store, library, importScheduleFile, fileText, names };
}

/** A file whose text arrives only when `release` is called, like a slow disk read. */
function slowFile(text: string) {
  let release = () => {};
  const ready = new Promise<void>((resolve) => (release = resolve));
  return { file: { text: () => ready.then(() => text) }, release: () => release() };
}

test("a file that finishes reading after a sign-in is dropped from both libraries", async () => {
  const { store, library, importScheduleFile, fileText, names } = await setUp();
  const { file, release } = slowFile(fileText);
  const pending = importScheduleFile(library, file);
  store.setSavedPlanIdentity("user-b");
  release();
  expect(await pending).toMatchObject({ ok: false, kind: "identityChanged" });
  expect(names("user-b")).toEqual([]);
  expect(names(null)).toEqual(["Guest copy"]);
});

test("with no change of account, the same file is added", async () => {
  const { library, importScheduleFile, fileText, names } = await setUp();
  const { file, release } = slowFile(fileText);
  const pending = importScheduleFile(library, file);
  release();
  // The library already has a copy by that name, so the file comes in numbered (PR #62 review).
  expect(await pending).toEqual({ ok: true, name: "Guest copy 2" });
  expect(names(null)).toEqual(["Guest copy 2", "Guest copy"]);
});

test("a file that isn't JSON says so", async () => {
  const { library, importScheduleFile } = await setUp();
  expect(await importScheduleFile(library, { text: async () => "not json" })).toMatchObject({ ok: false, kind: "notJson" });
});
