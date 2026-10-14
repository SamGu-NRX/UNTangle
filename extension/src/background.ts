/**
 * The MV3 service worker. It owns every network call, each with
 * credentials: "include" so the browser attaches the student's existing
 * UNTangle session; the worker never reads cookies itself and never touches
 * credentials. It also computes conflict verdicts (the planner and sections
 * data live here) and answers the popup's status request.
 */
import { SCHEDULE_NAME, UNTANGLE_ORIGIN } from "./config";
import { GradesClient } from "./lib/grades-client";
import { PlannerClient, type SessionCache } from "./lib/planner-client";
import { SectionsClient, type CourseSectionsOutcome } from "./lib/sections-client";
import { conflictsWithScheduled, extractScheduled, type ScheduledMeeting } from "./lib/conflicts";
import type {
  AddResult,
  ConflictVerdict,
  ExtensionMessage,
  FactsResult,
  GradesVerdict,
  ParsedSectionRow,
  SessionState,
  StatusResult,
} from "./shared/messages";

/** chrome.storage.session behind the same async surface the tests use. */
function chromeSessionCache(): SessionCache {
  return {
    get: key =>
      new Promise(resolve => {
        chrome.storage.session.get([key], items => resolve(items[key]));
      }),
    set: (key, value) =>
      new Promise(resolve => {
        chrome.storage.session.set({ [key]: value }, () => resolve());
      }),
  };
}

const cache = chromeSessionCache();
// fetch rejects with "Illegal invocation" when called as a method of the
// client; bind it to the worker's global object once.
const boundFetch = fetch.bind(globalThis);
const plannerClient = new PlannerClient(boundFetch, UNTANGLE_ORIGIN);
const sectionsClient = new SectionsClient(boundFetch, UNTANGLE_ORIGIN, cache);
const gradesClient = new GradesClient(boundFetch, UNTANGLE_ORIGIN, cache);

const SESSION_CACHE_KEY = "planner:session";
const ORIGIN_CACHE_KEY = "untangle:origin";

async function rememberSession(session: SessionState): Promise<void> {
  await cache.set(SESSION_CACHE_KEY, session);
  await cache.set(ORIGIN_CACHE_KEY, UNTANGLE_ORIGIN);
}

/** The conflict verdict for one row, or an honest "cannot tell". */
async function conflictVerdict(row: ParsedSectionRow): Promise<ConflictVerdict> {
  const loaded = await plannerClient.load();
  if (!loaded.ok) {
    await rememberSession(loaded.status === 401 ? "signed-out" : "unreachable");
    return { kind: "unknown", reason: "schedule-unavailable" };
  }
  await rememberSession("signed-in");

  const selectedSections: Record<string, string> = loaded.snapshot.state?.selectedSections ?? {};
  // No empty-plan shortcut here: a row with no usable meeting times must
  // answer "cannot check" even when nothing is scheduled, never a clean bill.
  const scheduled: ScheduledMeeting[] = [];
  for (const [courseCode, sectionId] of Object.entries(selectedSections)) {
    const outcome: CourseSectionsOutcome = await sectionsClient.forCourse(row.term, courseCode);
    if (!outcome.ok) return { kind: "unknown", reason: "schedule-unavailable" };
    const extracted = extractScheduled(outcome.result, sectionId);
    if (!extracted) return { kind: "unknown", reason: "schedule-unavailable" };
    if (!extracted.complete) return { kind: "unknown", reason: "schedule-time-missing" };
    scheduled.push(...extracted.meetings);
  }
  return conflictsWithScheduled(row, scheduled);
}

async function gradesVerdict(row: ParsedSectionRow): Promise<GradesVerdict> {
  if (row.instructorRaw === null) return { kind: "no-match", reason: "no instructor listed" };
  return gradesClient.historyForInstructor(row.instructorRaw, row.courseSubject, row.courseNumber);
}

async function handleFacts(row: ParsedSectionRow): Promise<FactsResult> {
  const [conflict, grades] = await Promise.all([conflictVerdict(row), gradesVerdict(row)]);
  return { type: "facts/result", rowId: row.rowId, conflict, grades };
}

async function handleAdd(row: ParsedSectionRow): Promise<AddResult> {
  const outcome = await plannerClient.addToMain(row);
  // Session state updates only from outcomes that observed an authenticated
  // planner response: not-found and failed never reached one and must not
  // overwrite a known signed-out or unreachable state.
  const observed: SessionState | null =
    outcome === "signed-out"
      ? "signed-out"
      : outcome === "added" || outcome === "already-scheduled" || outcome === "conflict-write"
        ? "signed-in"
        : null;
  if (observed !== null) await cache.set(SESSION_CACHE_KEY, observed);
  return { type: "add/result", rowId: row.rowId, outcome };
}

async function handleStatus(): Promise<StatusResult> {
  const cached = (await cache.get(SESSION_CACHE_KEY)) as SessionState | undefined;
  if (cached) {
    return { type: "status/result", session: cached, origin: UNTANGLE_ORIGIN, schedule: SCHEDULE_NAME };
  }
  const loaded = await plannerClient.load();
  const session: SessionState = loaded.ok ? "signed-in" : loaded.status === 401 ? "signed-out" : "unreachable";
  await rememberSession(session);
  return { type: "status/result", session, origin: UNTANGLE_ORIGIN, schedule: SCHEDULE_NAME };
}

function isFactsRequest(message: unknown): message is Extract<ExtensionMessage, { type: "facts/request" }> {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "facts/request";
}

function isAddRequest(message: unknown): message is Extract<ExtensionMessage, { type: "add/request" }> {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "add/request";
}

function isStatusRequest(message: unknown): message is Extract<ExtensionMessage, { type: "status/request" }> {
  return typeof message === "object" && message !== null && (message as { type?: unknown }).type === "status/request";
}

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isStatusRequest(message)) {
    void handleStatus().then(sendResponse);
    return true;
  }
  if (isFactsRequest(message)) {
    void handleFacts(message.row)
      .then(sendResponse)
      .catch(() =>
        sendResponse({
          type: "facts/result",
          rowId: message.row.rowId,
          conflict: { kind: "unknown", reason: "schedule-unavailable" },
          grades: { kind: "unavailable", message: "The UNTangle worker hit an unexpected error." },
        } satisfies FactsResult),
      );
    return true;
  }
  if (isAddRequest(message)) {
    void handleAdd(message.row)
      .then(sendResponse)
      .catch(() => sendResponse({ type: "add/result", rowId: message.row.rowId, outcome: "failed" } satisfies AddResult));
    return true;
  }
  return false;
});
