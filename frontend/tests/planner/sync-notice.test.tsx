/**
 * The academic-record questions dialog, rendered in the real provider over
 * the real /api/v1 handlers (test-dom.ts).
 */
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from "bun:test";
import * as fixtures from "../../../packages/contracts/tests/fixtures";
import {
  FakeDocumentServer,
  installDom,
  mountPlanner,
  removeDom,
  resetDocumentStore,
  setSession,
  waitFor,
} from "./test-dom";

const user = { id: "student-1", email: "student@my.unt.edu", name: "Student" };
const RECORD = "academic-record-unt";
let server: FakeDocumentServer;
let previousFetch: typeof fetch;
const mounted: Array<() => Promise<void>> = [];

beforeAll(() => {
  installDom();
});
afterAll(() => {
  removeDom();
});
beforeEach(() => {
  window.localStorage.clear();
  resetDocumentStore();
  server = new FakeDocumentServer();
  previousFetch = globalThis.fetch;
  globalThis.fetch = server.fetch as typeof fetch;
  setSession(user);
});
afterEach(async () => {
  while (mounted.length) await mounted.pop()!();
  globalThis.fetch = previousFetch;
  setSession(null);
});

type Record = typeof fixtures.academicRecord;

test("a question that appears while the dialog is open can be answered This device, and that answer is saved", async () => {
  const { SyncNotice } = await import("@/components/sync-notice");
  const React = await import("react");
  server.legacy.set(user.id, fixtures.savedPlan);
  const planner = await mountPlanner(() => React.createElement(SyncNotice));
  mounted.push(planner.unmount);
  await waitFor(() => planner.get().hydrated && planner.get().plannerState.selectedMajor === "cs", "migrated plan shown");

  // Offline, this device marks CSCE 2100 done; meanwhile another device marks it taking now and changes the major.
  server.failNextPuts = Array.from({ length: 50 }, () => "drop" as const);
  await planner.run((p) => p.setCourseStatus("CSCE 2100", "completed"));
  await waitFor(() => planner.get().saveState.label === "Save not confirmed (retrying)", "waiting");
  const theirs = server.document(user.id, RECORD)!.body as Record;
  server.writeElsewhere(user.id, RECORD, "academic-record", { ...theirs, major: "math", courseStatuses: { ...theirs.courseStatuses, "CSCE 2100": "inProgress" } });
  server.failNextPuts = [];
  await planner.run(() => window.dispatchEvent(new Event("focus")));
  await waitFor(() => planner.get().syncConflict?.kind === "academic-record", "conflict");

  // A button that can load also holds its hidden loading label, so match the start of its text.
  const button = (name: string) => [...document.querySelectorAll("button")].find((element) => element.textContent?.trim().startsWith(name))!;
  const legends = () => [...document.querySelectorAll(".sync-question legend")].map((legend) => legend.textContent);
  await planner.run(() => button("Choose what to keep").click());
  await waitFor(() => legends().length === 1, "one question");
  expect(legends()).toEqual(["CSCE 2100"]);

  // While the dialog is open, this device changes the major too: a second question appears.
  await planner.run((p) => p.setSelectedMajor("ce"));
  await waitFor(() => legends().length === 2, "the major question appears");
  expect(legends()).toEqual(["CSCE 2100", "Major"]);

  const major = [...document.querySelectorAll(".sync-question")].find((fieldset) => fieldset.querySelector("legend")?.textContent === "Major")!;
  const thisDevice = major.querySelectorAll<HTMLInputElement>("input[type=radio]")[1];
  await planner.run(() => thisDevice.click());
  expect(thisDevice.checked).toBe(true);

  await planner.run(() => button("Save choices").click());
  await waitFor(() => planner.get().saveState.label === "Synced", "answers saved");
  const record = server.document(user.id, RECORD)!.body as Record;
  // The major answered "This device"; CSCE 2100 left at the other device's value.
  expect([record.major, record.courseStatuses["CSCE 2100"]]).toEqual(["ce", "inProgress"]);
});
