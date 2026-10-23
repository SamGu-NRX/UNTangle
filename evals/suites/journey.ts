/**
 * journey — the seven contract journeys (evals/CONTRACT.md), each for the
 * guest persona and a SYNTHETIC registered persona, each at 1440x900 and
 * 390x844: 7 × 2 × 2 = 28 cases.
 *
 * r2 brings the suite to the FULL student journey. The case ids and the
 * persona × viewport matrix are unchanged from round 1; three journeys were
 * deepened so the whole workflow is exercised through the contract's roles
 * and accessible names:
 *
 *   build  — add a section to the working schedule (REQUIRED
 *            `Add {COURSE} section {NNN}` on /courses/[subject]/[number]),
 *            lock it (REQUIRED `Lock {COURSE} section {NNN}` with
 *            `aria-pressed`), then run the optimizer (REQUIRED
 *            `Optimize schedule` on /schedule) and read the rendered plan.
 *   save   — save, RELOAD, and compare the EXACT persisted state: the full
 *            persisted plan is captured before the reload straight from the
 *            app's real storage (sessionStorage `untangle-planner-state` for
 *            the guest; for the registered persona the `/api/planner` payload
 *            AND the `planner_state` row via ctx.databaseUrl) and
 *            deep-compared after the reload — every field, not a spot check.
 *            Then the REQUIRED `Save state` region, `Print schedule` (the
 *            print intent is observed), and `Download .ics` (the download is
 *            captured and parsed as an iCalendar file) are exercised.
 *   plan   — save a NAMED plan on /plans, diverge the working schedule,
 *            reload, and RESTORE through the confirm dialog (`Restore this
 *            plan` / `Cancel`); the restored schedule must equal the saved
 *            plan, not the divergence.
 *   map    — unchanged flow, hardened: every day tab must carry
 *            `aria-selected` (contract: /map) and a clicked day must become
 *            the selected one before the route-leg assertions run.
 *
 * discover, instructor and auth are the round-1 journeys, unchanged.
 *
 * Journeys drive the real UI through accessible names/roles from the contract.
 * Where the contract marks an element REQUIRED but this head does not expose
 * it, the case FAILS and its note names exactly which contract element was
 * missing — that is the honest expected-fail on a baseline head.
 * not-applicable is used only when a persona prerequisite cannot exist.
 */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { Client } from "pg";
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, CaseSpec, SuiteContext } from "../suite-kit";
import { closeTrackedCases, openCase, screenshot, settle } from "./ui-browser";
import type { ViewportName } from "./ui-browser";
import { signIn, signOut, syntheticPersona, signUp } from "./ui-persona";
import type { SyntheticPersona } from "./ui-persona";
import {
  activate,
  activateCoursesAndOpenSchedule,
  chooseMajorIfOpen,
  courseCodeAt,
  courseRow,
  escapeRegExp,
  expectDetailNot404,
  markCourseTaking,
  missingElement,
  PLANS,
  waitForFilteredRows,
} from "./ui-contract";
import type { Locator, Page } from "playwright";

type PersonaName = "guest" | "registered";
type JourneyName = "discover" | "instructor" | "build" | "save" | "plan" | "map" | "auth";

const JOURNEYS: JourneyName[] = ["discover", "instructor", "build", "save", "plan", "map", "auth"];
const PERSONAS: PersonaName[] = ["guest", "registered"];
const VIEWPORTS: ViewportName[] = ["desktop", "mobile"];

/** The app's guest planner storage (frontend/src/lib/planner.ts). */
const PLANNER_STORAGE_KEY = "untangle-planner-state";
/** The planner persistence API (registered persona): POST saves, GET loads. */
const PLANNER_API = /\/api\/planner\/?(\?.*)?$/;

function parseCaseId(caseId: string): { journey: JourneyName; persona: PersonaName; viewport: ViewportName } {
  const match = caseId.match(/^journey\/([a-z]+)-(\w+)-(desktop|mobile)$/);
  if (!match || match[1] === undefined || match[2] === undefined || match[3] === undefined) {
    throw new Error(`journey: unrecognized case id ${caseId}`);
  }
  const journey = match[1] as JourneyName;
  const persona = match[2] as PersonaName;
  if (!JOURNEYS.includes(journey) || !PERSONAS.includes(persona)) {
    throw new Error(`journey: unrecognized case id ${caseId}`);
  }
  return { journey, persona, viewport: match[3] as ViewportName };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeFileName(caseId: string): string {
  return caseId.replace(/[^a-z0-9-]+/gi, "_");
}

// ---------------------------------------------------------------------------
// Exact persisted-state comparison
// ---------------------------------------------------------------------------

interface FieldDiff {
  path: string;
  detail: string;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function summarizeValue(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Every differing JSON path between two parsed persisted documents. */
function deepDiff(before: unknown, after: unknown, path: string, out: FieldDiff[]): FieldDiff[] {
  if (Object.is(before, after)) return out;
  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      out.push({ path: path || "<root>", detail: `array length ${before.length} → ${after.length}` });
    }
    const shared = Math.min(before.length, after.length);
    for (let i = 0; i < shared; i += 1) deepDiff(before[i], after[i], `${path}[${i}]`, out);
    return out;
  }
  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of Array.from(keys).sort()) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in before)) out.push({ path: childPath, detail: "missing before, present after" });
      else if (!(key in after)) out.push({ path: childPath, detail: "present before, missing after" });
      else deepDiff(before[key], after[key], childPath, out);
    }
    return out;
  }
  out.push({ path: path || "<root>", detail: `${summarizeValue(before)} → ${summarizeValue(after)}` });
  return out;
}

const UPDATED_AT_PATH = /(^|\.)updatedAt$/;

/**
 * `updatedAt` is save metadata, not plan content: the provider re-saves the
 * freshly hydrated state after a reload, so a timestamp-only delta is
 * disclosed rather than treated as lost data. Any other path differing is a
 * durability failure.
 */
function partitionDiffs(diffs: FieldDiff[]): { durable: FieldDiff[]; timestampOnly: FieldDiff[] } {
  return {
    durable: diffs.filter((diff) => !UPDATED_AT_PATH.test(diff.path)),
    timestampOnly: diffs.filter((diff) => UPDATED_AT_PATH.test(diff.path)),
  };
}

function formatDiffs(diffs: FieldDiff[], cap = 6): string {
  const head = diffs.slice(0, cap).map((diff) => `${diff.path}: ${diff.detail}`);
  const more = diffs.length > cap ? `; +${diffs.length - cap} more (see evidence)` : "";
  return `${head.join("; ")}${more}`;
}

/** The plan fields the app persists (API payload shape; DB row maps onto it). */
interface PersistedPlanSnapshot {
  courseStatuses: unknown;
  selectedSections: unknown;
  optimization: unknown;
  activeDay: unknown;
  selectedMajor: unknown;
  transcriptRecords: unknown;
  routeStops: unknown;
  updatedAt: unknown;
}

function asPersistedPlanSnapshot(value: unknown, label: string): PersistedPlanSnapshot {
  if (!isPlainObject(value)) {
    throw new Error(`${label} is not an object (got ${typeof value})`);
  }
  return {
    courseStatuses: value.courseStatuses,
    selectedSections: value.selectedSections,
    optimization: value.optimization,
    activeDay: value.activeDay,
    selectedMajor: value.selectedMajor,
    transcriptRecords: value.transcriptRecords,
    routeStops: value.routeStops,
    updatedAt: value.updatedAt,
  };
}

function writeJsonEvidence(ctx: SuiteContext, name: string, payload: unknown): string {
  mkdirSync(ctx.runDir, { recursive: true });
  const file = `${ctx.runDir}/journey__${name}.json`;
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

// ---------------------------------------------------------------------------
// Real-storage readers
// ---------------------------------------------------------------------------

/** The guest persona's full persisted plan, read from the app's own storage. */
async function readGuestPersistedPlan(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.sessionStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, PLANNER_STORAGE_KEY);
}

/**
 * The guest write is debounced (350ms in the planner provider); wait until two
 * reads agree so the capture cannot race the write.
 */
async function readGuestPersistedPlanSettled(page: Page): Promise<unknown> {
  const deadline = Date.now() + 15_000;
  let previous = await readGuestPersistedPlan(page);
  await sleep(1_000);
  for (;;) {
    const current = await readGuestPersistedPlan(page);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
    if (Date.now() > deadline) return current;
    await sleep(500);
  }
}

/** The registered persona's persisted plan as the app's own API serves it. */
async function readRegisteredApiState(page: Page): Promise<unknown> {
  const payload = (await page.evaluate(async () => {
    const response = await fetch("/api/planner", { cache: "no-store" });
    if (!response.ok) {
      return { httpStatus: response.status, state: null as unknown };
    }
    return (await response.json()) as unknown;
  })) as { httpStatus?: number; state?: unknown };
  if (payload.httpStatus !== undefined) {
    throw new Error(`GET /api/planner returned HTTP ${payload.httpStatus}`);
  }
  return payload.state;
}

function rowToSnapshot(row: Record<string, unknown>): PersistedPlanSnapshot {
  return {
    courseStatuses: row.courseStatuses,
    selectedSections: row.selectedSections,
    optimization: row.optimization,
    activeDay: row.activeDay,
    selectedMajor: row.selectedMajor,
    transcriptRecords: row.transcriptRecords,
    routeStops: row.routeStops,
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : row.updatedAt,
  };
}

/** The registered persona's persisted plan, read from the database itself. */
async function readRegisteredDbRow(databaseUrl: string, email: string): Promise<PersistedPlanSnapshot | null> {
  const client = new Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT p.course_statuses AS "courseStatuses",
              p.selected_sections AS "selectedSections",
              p.optimization, p.active_day AS "activeDay",
              p.selected_major AS "selectedMajor",
              p.transcript_records AS "transcriptRecords",
              p.route_stops AS "routeStops",
              p.updated_at AS "updatedAt"
         FROM planner_state p
         JOIN "user" u ON u.id = p.user_id
        WHERE u.email = $1`,
      [email],
    );
    const row = (result.rows[0] ?? null) as Record<string, unknown> | null;
    return row === null ? null : rowToSnapshot(row);
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Wait until the planner provider's debounced save has landed for the last
 * edit. Registered: the durable step is the planner API POST. Guest: the
 * sessionStorage write, observed stable.
 */
async function waitForSettledSave(page: Page, persona: PersonaName): Promise<void> {
  if (persona === "registered") {
    await page
      .waitForResponse((response) => PLANNER_API.test(response.url()) && response.request().method() === "POST", {
        timeout: 20_000,
      })
      .catch(() => null);
    await sleep(400);
    return;
  }
  await readGuestPersistedPlanSettled(page);
}

// ---------------------------------------------------------------------------
// Shared case plumbing
// ---------------------------------------------------------------------------

interface EnteredCase {
  page: Page;
  /** Set for the registered persona; the synthetic account the case drives. */
  account: SyntheticPersona | null;
}

/** Shared case entry: fresh browser, correct persona sign-in state, on /courses. */
async function enter(ctx: SuiteContext, persona: PersonaName, viewport: ViewportName): Promise<EnteredCase> {
  const cb = await openCase(ctx.frontendOrigin, viewport);
  if (persona === "guest") {
    await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
    await cb.page.waitForURL("**/courses", { timeout: 30_000 });
    await settle(cb.page);
    await chooseMajorIfOpen(cb.page);
    return { page: cb.page, account: null };
  }
  const account = syntheticPersona();
  await signUp(cb.page, account, ctx.frontendOrigin);
  // Sign-up leaves the user on /auth, whose shell has no step nav — go direct.
  await cb.page.goto(`${ctx.frontendOrigin}/courses`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(cb.page);
  await chooseMajorIfOpen(cb.page);
  return { page: cb.page, account };
}

async function landOnCourses(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<Page> {
  void caseId;
  return (await enter(ctx, persona, viewport)).page;
}

/** First code visible after a department search — read only after the filter applied. */
async function firstSearchedCode(page: Page, term: string): Promise<string> {
  await waitForFilteredRows(page, term);
  // The code element per the /courses contract is the row's meta span; the
  // row's full text carries the title's own code mentions and butt-joined
  // status labels, which defeat a boundary-anchored scan.
  const text = (await page.locator("article.course-row").first().locator(".course-row__meta").textContent({ timeout: 5_000 }).catch(() => null)) ?? "";
  const code = text.match(new RegExp(`^\\s*(${escapeRegExp(term.toUpperCase())}\\s?\\d{4})\\b`))?.[1];
  if (!code) throw new Error(`search for "${term}" never showed a matching first course row (first meta: ${text.slice(0, 80) || "none"})`);
  return code;
}

/** The course codes of the calendar events currently rendered on /schedule. */
async function renderedEventCodes(page: Page): Promise<string[]> {
  const events = page.getByRole("button", { name: /\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/ });
  const count = await events.count();
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    // Contract: an event button's text content is "{COURSE} {START} – {END}
    // {PROFESSOR}", in that order — the code leads the accessible name.
    const text = (await events.nth(i).textContent({ timeout: 5_000 }).catch(() => null)) ?? "";
    const code = text.match(/^\s*([A-Z]{2,4}\s?\d{4})\b/)?.[1];
    if (code) codes.push(code);
  }
  return Array.from(new Set(codes));
}

async function attributeBecomes(page: Page, locator: Locator, attr: string, want: string, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await locator.getAttribute(attr, { timeout: 2_000 }).catch(() => null);
    if (value === want) return true;
    if (Date.now() > deadline) return false;
    await page.waitForTimeout(250);
  }
}

/**
 * The contract's `Add {COURSE} section {NNN}` build-control name template as
 * a RegExp: `nnn` is a three-digit group — \\d{3} for the shape probe,
 * (\\d{3}) to capture the number out of an existing button's name.
 */
function addSectionName(code: string, nnn: string): RegExp {
  return new RegExp("^Add " + escapeRegExp(code) + " section " + nnn + "$");
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

/** discover: landing → courses → search → open a course detail → read catalog. */
async function runDiscover(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const code = await firstSearchedCode(page, "CSCE"); // discover searches CSCE
  await activate(page, courseRow(page, code).getByRole("link", { name: "Details" }).first());
  await page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(page, page.url());

  // Contract: the grade summary is a `region`-like div whose ACCESSIBLE NAME
  // is "Course grade summary" — the target exposes it as aria-label on
  // div.detail-stats (page.tsx:40), not as text content, so a text matcher
  // can never resolve it. Look the surface up by accessible name, the same
  // way the map journey resolves its `Route legs` region.
  const gradeSummary = await missingElement(
    page.locator('[aria-label="Course grade summary"]').first(),
    "'Course grade summary' region (contract: /courses/[subject]/[number])",
  );
  if (!gradeSummary.present) return { status: "fail", note: gradeSummary.reason };

  await screenshot(page, ctx.runDir, caseId);
  return { status: "pass", measured: `discovered ${code} and read its detail page` };
}

/** instructor: discover flow → follow an instructor link → instructor page. */
async function runInstructor(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const code = await firstSearchedCode(page, "CSCE"); // instructor searches CSCE
  await activate(page, courseRow(page, code).getByRole("link", { name: "Details" }).first());
  await page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(page, page.url());

  const instructorLink = page.locator("a.detail-row").first();
  const linkVisible = await instructorLink.isVisible({ timeout: 10_000 }).catch(() => false);
  if (!linkVisible) {
    return { status: "fail", note: "instructor journey: no a.detail-row instructor link on the course detail page" };
  }
  await activate(page, instructorLink);
  await page.waitForURL("**/instructors/**", { timeout: 20_000 });
  await settle(page);

  // Contract line 91: the grade summary is a `region`-like div whose
  // ACCESSIBLE NAME is "Instructor grade summary" — the target exposes it as
  // aria-label on div.detail-stats (instructors/[id]/page.tsx:45), not as
  // text content, so a text matcher can never resolve it. Same defect class
  // as the discover journey's course grade summary probe.
  const summary = await missingElement(
    page.locator('[aria-label="Instructor grade summary"]').first(),
    "'Instructor grade summary' region (contract: /instructors/[id])",
  );
  if (!summary.present) return { status: "fail", note: summary.reason };

  // REQUIRED by contract: ratings-unavailable status notice naming the instructor.
  const unavailable = await missingElement(
    page.locator("[role='status']").filter({ hasText: /unavailable/i }).first(),
    "ratings-unavailable `status` notice naming the instructor (contract: /instructors/[id], required)",
  );
  await screenshot(page, ctx.runDir, caseId);
  if (!unavailable.present) return { status: "fail", note: unavailable.reason };
  return { status: "pass", measured: "instructor page rendered with grade summary and unavailable-ratings notice" };
}

/**
 * build — the BUILD → OPTIMIZE leg of the student journey, targeted to the
 * surfaces the head under test actually exposes.
 *
 * Opens a prerequisite-free course's detail page (ANTH 1010: zero
 * prerequisite edges in the bundled catalog), probes the contract-REQUIRED
 * build controls (`Add {COURSE} section {NNN}` / `Lock {COURSE} section
 * {NNN}` — by name template, since {NNN} is only knowable from a section
 * chooser), then builds the working schedule through the /courses row status
 * buttons (exposed @ all four heads): the ANTH course plus one CSCE course
 * marked Taking. On /schedule the REQUIRED `Optimize schedule` button and the
 * REQUIRED `aria-pressed` state of the active optimization option are probed,
 * and the rendered plan is read.
 *
 * Surfaces the contract only pins to other heads are NOT asserted here: the
 * planner-actions section (`Plan this course` heading, `Planner status for
 * {COURSE}` group, `Section choice for {COURSE}` radiogroup) is exposed
 * @ #7 (1fa6bb7) only, which is not an ancestor of the r2 target d42166f —
 * the round-2 draft's over-assertion of it measured the wrong head. When a
 * REQUIRED probe does not resolve, the case collects it and fails at the end
 * naming every missing element (the honest baseline verdict), with what the
 * leg did build as the note's context.
 */
async function runBuild(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);

  await page.getByRole("textbox", { name: "Search courses" }).fill("ANTH");
  const code = await firstSearchedCode(page, "ANTH"); // prerequisite-free course
  await activate(page, courseRow(page, code).getByRole("link", { name: "Details" }).first());
  await page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(page, page.url());

  // Contract-REQUIRED build controls, probed by their name templates. {NNN}
  // (the chosen section's number) is only knowable from a section chooser —
  // a #7-only surface this head does not carry — so the probe matches the
  // template's shape and, when the button exists, takes {NNN} from the
  // button's own accessible name. Absent probes are collected, not fatal:
  // the case measures the whole leg before its verdict.
  const absent: string[] = [];
  const addButton = page.getByRole("button", { name: addSectionName(code, "\\d{3}") }).first();
  const add = await missingElement(
    addButton,
    `\`Add ${code} section {NNN}\` button (contract: /courses/[subject]/[number], required)`,
  );
  let sectionNumber: string | null = null;
  if (add.present) {
    const label = ((await addButton.textContent({ timeout: 5_000 }).catch(() => null)) ?? "").trim();
    sectionNumber = label.match(addSectionName(code, "(\\d{3})"))?.[1] ?? null;
    if (sectionNumber === null) {
      return {
        status: "fail",
        note: `\`Add ${code} section {NNN}\` button exposed an unparsable name "${label.slice(0, 60)}" (contract: /courses/[subject]/[number], required)`,
      };
    }
    await activate(page, addButton);
  } else {
    absent.push(`Add ${code} section {NNN}`);
  }

  if (sectionNumber !== null) {
    // REQUIRED: lock the added section (pin it), state via aria-pressed.
    const lockButton = page.getByRole("button", { name: `Lock ${code} section ${sectionNumber}` }).first();
    const lock = await missingElement(
      lockButton,
      `\`Lock ${code} section ${sectionNumber}\` button (contract: /courses/[subject]/[number], required)`,
    );
    if (lock.present) {
      await activate(page, lockButton);
      const lockPressed = await attributeBecomes(page, lockButton, "aria-pressed", "true", 6_000);
      if (!lockPressed) {
        return {
          status: "fail",
          note: `\`Lock ${code} section ${sectionNumber}\` did not report \`aria-pressed="true"\` after activation (contract: /courses/[subject]/[number], required)`,
        };
      }
    } else {
      absent.push(`Lock ${code} section {NNN}`);
    }
  }
  // The build action this head exposes for course status: the /courses row
  // status buttons (contract: /courses, exposed @ all four heads). Mark the
  // ANTH course Taking from its row, then a CSCE course, then on to /schedule.
  await activate(page, page.getByRole("link", { name: "← Courses" }).first());
  await page.waitForURL("**/courses", { timeout: 20_000 });
  await settle(page);
  await page.getByRole("textbox", { name: "Search courses" }).fill("ANTH");
  await waitForFilteredRows(page, "ANTH");
  await markCourseTaking(page, code);

  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  const scheduleCodes = await activateCoursesAndOpenSchedule(page, 1, "CSCE");
  await settle(page, 1200);

  // REQUIRED: run the optimizer explicitly.
  const optimizeButton = page.getByRole("button", { name: "Optimize schedule" }).first();
  const optimize = await missingElement(
    optimizeButton,
    "`Optimize schedule` button (contract: /schedule, required)",
  );
  if (optimize.present) {
    await activate(page, optimizeButton);
    await settle(page, 900);
  } else {
    absent.push("Optimize schedule");
  }

  const options = page.getByRole("button", { name: /Cluster mornings|Cluster nights|Compact days|Minimize walking|Strong professors/ });
  const optionCount = await options.count();
  // REQUIRED: the active optimization option reports its state via aria-pressed.
  let pressedOptionFound = false;
  for (let i = 0; i < optionCount; i += 1) {
    if ((await options.nth(i).getAttribute("aria-pressed", { timeout: 2_000 }).catch(() => null)) === "true") {
      pressedOptionFound = true;
      break;
    }
  }
  if (optionCount > 0 && !pressedOptionFound) {
    absent.push("optimization-option `aria-pressed` state (contract: /schedule, required)");
  }

  const events = await page.getByRole("button", { name: /\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/ }).count();
  const eventCodes = await renderedEventCodes(page);
  await screenshot(page, ctx.runDir, caseId);

  if (optionCount < 5) return { status: "fail", note: `expected 5 optimization option buttons on /schedule, found ${optionCount}` };
  const built = Array.from(new Set([code, ...scheduleCodes]));
  if (absent.length === 0) {
    // Compliant head: every required build control resolved — the built
    // schedule must actually show the built courses.
    if (events === 0) {
      return { status: "fail", note: `no calendar event buttons rendered on /schedule after building the working schedule for ${built.join(", ")}` };
    }
    const missingEvents = built.filter((c) => !eventCodes.includes(c));
    if (missingEvents.length > 0) {
      return {
        status: "fail",
        note: `the working schedule did not reflect the build actions: no calendar event for ${missingEvents.join(", ")} (events: ${eventCodes.join(", ") || "none"})`,
      };
    }
    return {
      status: "pass",
      measured: `built ${built.join(", ")} (${events} events incl. ${eventCodes.join(", ")}); ${optionCount} options with aria-pressed state`,
    };
  }
  return {
    status: "fail",
    note: `the build leg ran through this head's exposed surfaces (marked ${built.join(", ")} taking; ${optionCount} options; ${events} events rendered), but contract-REQUIRED build surfaces are absent: ${absent.join("; ")}`,
  };
}

/**
 * save — the SAVE → RELOAD leg with the EXACT persisted-state comparison,
 * then the durability/export affordances.
 *
 * The full persisted plan is captured before the reload from the app's real
 * storage (guest: sessionStorage `untangle-planner-state`; registered: the
 * `/api/planner` payload AND the `planner_state` row via ctx.databaseUrl) and
 * deep-compared after the reload — every field path, not a spot check. A
 * timestamp-only `updatedAt` delta is disclosed, not treated as lost data.
 * The REQUIRED `Save state` region, `Print schedule` and `Download .ics`
 * are then exercised for real.
 */
async function runSave(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const entered = await enter(ctx, persona, viewport);
  const page = entered.page;
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const codes = await activateCoursesAndOpenSchedule(page, 2, "CSCE");
  await settle(page, 1200);
  if (codes.length === 0) {
    return { status: "fail", note: "save journey: no course could be marked Taking on /courses" };
  }

  // A deliberate edit ON /schedule (the optimization goal) so the saved plan
  // includes a schedule-page decision, then wait for the debounced save.
  const option = page.getByRole("button", { name: /Compact days/ }).first();
  if (await option.isVisible({ timeout: 6_000 }).catch(() => false)) {
    if (persona === "registered") {
      const save = page
        .waitForResponse((response) => PLANNER_API.test(response.url()) && response.request().method() === "POST", { timeout: 20_000 })
        .catch(() => null);
      await activate(page, option);
      await save;
      await sleep(400);
    } else {
      await activate(page, option);
      await readGuestPersistedPlanSettled(page);
    }
  } else {
    await waitForSettledSave(page, persona);
  }

  const evidenceBase = safeFileName(caseId);
  // Capture the FULL persisted plan before the reload.
  let guestBefore: unknown = null;
  let apiBefore: PersistedPlanSnapshot | null = null;
  let dbBefore: PersistedPlanSnapshot | null = null;
  if (persona === "guest") {
    guestBefore = await readGuestPersistedPlan(page);
    if (guestBefore === null) {
      return { status: "fail", note: `save journey: the app wrote no persisted plan to sessionStorage key "${PLANNER_STORAGE_KEY}" before the reload` };
    }
  } else {
    const account = entered.account;
    if (!account) return { status: "fail", note: "save journey: registered persona has no synthetic account" };
    const apiRaw = await readRegisteredApiState(page);
    if (apiRaw === null) {
      return { status: "fail", note: "save journey: GET /api/planner returned no persisted state before the reload (registered persistence did not record the plan)" };
    }
    apiBefore = asPersistedPlanSnapshot(apiRaw, "pre-reload /api/planner state");
    dbBefore = await readRegisteredDbRow(ctx.databaseUrl, account.email);
    if (dbBefore === null) {
      return {
        status: "fail",
        note: `save journey: no planner_state row exists for the synthetic registered persona before the reload (email ${account.email}) — registered persistence did not record the plan`,
      };
    }
  }
  writeJsonEvidence(ctx, `${evidenceBase}__persisted-before`, { persona, storage: persona === "guest" ? guestBefore : { api: apiBefore, db: dbBefore } });

  // Reload and let the hydration save settle before re-reading storage.
  if (persona === "registered") {
    const writeback = page
      .waitForResponse((response) => PLANNER_API.test(response.url()) && response.request().method() === "POST", { timeout: 30_000 })
      .catch(() => null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await writeback;
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await settle(page, 1500);
  // Registered: the hydration write-back was awaited above; only the guest's
  // debounced sessionStorage write needs a stability wait here.
  if (persona === "guest") await readGuestPersistedPlanSettled(page);

  // The reloaded plan must still drive the visible schedule.
  const eventsAfterReload = await page.getByRole("button", { name: /\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/ }).count();

  // Capture the full persisted plan after the reload.
  let guestAfter: unknown = null;
  let apiAfter: PersistedPlanSnapshot | null = null;
  let dbAfter: PersistedPlanSnapshot | null = null;
  if (persona === "guest") {
    guestAfter = await readGuestPersistedPlan(page);
    if (guestAfter === null) {
      return {
        status: "fail",
        note: `the persisted plan was gone from sessionStorage key "${PLANNER_STORAGE_KEY}" after the reload — the guest's saved plan did not survive`,
        evidencePath: writeJsonEvidence(ctx, `${evidenceBase}__persisted-after`, { persona, storage: null }),
      };
    }
  } else {
    const account = entered.account;
    if (!account) return { status: "fail", note: "save journey: registered persona has no synthetic account" };
    const apiRaw = await readRegisteredApiState(page);
    apiAfter = apiRaw === null ? null : asPersistedPlanSnapshot(apiRaw, "post-reload /api/planner state");
    dbAfter = await readRegisteredDbRow(ctx.databaseUrl, account.email);
  }
  writeJsonEvidence(ctx, `${evidenceBase}__persisted-after`, { persona, storage: persona === "guest" ? guestAfter : { api: apiAfter, db: dbAfter } });

  // EXACT comparison, not a spot check.
  const comparisons: Array<{ what: string; diffs: FieldDiff[] }> = [];
  if (persona === "guest") {
    comparisons.push({ what: "sessionStorage persisted plan", diffs: deepDiff(guestBefore, guestAfter, "", []) });
  } else {
    if (apiAfter === null) {
      return { status: "fail", note: "save journey: GET /api/planner returned no persisted state after the reload" };
    }
    if (dbAfter === null) {
      return { status: "fail", note: "save journey: the planner_state row for the synthetic registered persona disappeared after the reload" };
    }
    comparisons.push({ what: "/api/planner payload", diffs: deepDiff(apiBefore, apiAfter, "", []) });
    comparisons.push({ what: "planner_state row", diffs: deepDiff(dbBefore, dbAfter, "", []) });
    if (apiBefore !== null) {
      // The API's served plan and the database row must describe the same plan.
      comparisons.push({ what: "planner_state row vs /api/planner payload", diffs: deepDiff(dbAfter, apiAfter, "", []) });
    }
  }
  const evidencePath = writeJsonEvidence(ctx, `${evidenceBase}__persisted-diff`, {
    persona,
    comparisons: comparisons.map((comparison) => ({ what: comparison.what, diffs: comparison.diffs.map((diff) => `${diff.path}: ${diff.detail}`) })),
  });

  for (const comparison of comparisons) {
    const { durable, timestampOnly } = partitionDiffs(comparison.diffs);
    if (durable.length > 0) {
      return {
        status: "fail",
        note: `persisted state changed across reload (${comparison.what}): ${formatDiffs(durable)}`,
        evidencePath,
      };
    }
  }
  const timestampDeltas = comparisons.flatMap((comparison) => partitionDiffs(comparison.diffs).timestampOnly);
  const exactMatch = comparisons.every((comparison) => comparison.diffs.length === 0);

  // REQUIRED: the contract's save-state region acknowledging durability.
  const saveState = await missingElement(
    page.locator("[role='status'][aria-label='Save state']").first(),
    "`Save state` status region (contract: /schedule, required — durability acknowledgment)",
  );
  // REQUIRED: print and calendar export.
  const print = await missingElement(page.getByRole("button", { name: "Print schedule" }).first(), "`Print schedule` button (contract: /schedule, required)");
  const ics = await missingElement(page.getByRole("button", { name: "Download .ics" }).first(), "`Download .ics` button (contract: /schedule, required)");
  await screenshot(page, ctx.runDir, caseId);

  if (eventsAfterReload === 0) {
    return { status: "fail", note: "no calendar events rendered after the reload — the persisted plan did not drive the visible schedule", evidencePath };
  }

  const absent = [saveState, print, ics].filter((probe) => !probe.present);
  if (absent.length > 0) {
    return {
      status: "fail",
      note: `persisted state survived the reload exactly (${exactMatch ? "byte-exact" : `exact except updatedAt: ${formatDiffs(timestampDeltas)}`}), but the contract's durability/export surface is missing: ${absent
        .map((probe) => (probe.present ? "" : probe.reason))
        .filter(Boolean)
        .join("; ")}`,
      evidencePath,
    };
  }

  // Save-state text must be one of the contract's lifecycle values, and must
  // reach a terminal state (the hydration save may transiently show Saving…).
  const saveStateRegion = page.locator("[role='status'][aria-label='Save state']").first();
  const terminalPattern = /^(saved|not saved|saving failed)/i;
  let saveStateText = ((await saveStateRegion.textContent({ timeout: 5_000 }).catch(() => null)) ?? "").trim();
  const terminalDeadline = Date.now() + 10_000;
  while (!terminalPattern.test(saveStateText) && Date.now() < terminalDeadline) {
    await sleep(400);
    saveStateText = ((await saveStateRegion.textContent({ timeout: 5_000 }).catch(() => null)) ?? "").trim();
  }
  if (!terminalPattern.test(saveStateText)) {
    return {
      status: "fail",
      note: `\`Save state\` region shows "${saveStateText.slice(0, 60) || "no text"}" — not one of the contract's lifecycle values (Saved / Not saved… / Saving failed…)`,
      evidencePath,
    };
  }

  // Print: the button must actually trigger the print intent.
  await page.evaluate(() => {
    const w = window as { print?: () => void; __journeyPrintCalls?: number };
    w.__journeyPrintCalls = 0;
    w.print = () => {
      w.__journeyPrintCalls = (w.__journeyPrintCalls ?? 0) + 1;
    };
  });
  await activate(page, page.getByRole("button", { name: "Print schedule" }).first());
  const printCalls = await page.evaluate(() => (window as { __journeyPrintCalls?: number }).__journeyPrintCalls ?? -1);
  if (printCalls < 1) {
    return {
      status: "fail",
      note: "`Print schedule` button present but activating it did not invoke window.print — print intent unverified",
      evidencePath,
    };
  }

  // .ics: the button must produce a downloadable iCalendar file.
  const downloadPromise = page.waitForEvent("download", { timeout: 20_000 }).catch(() => null);
  await activate(page, page.getByRole("button", { name: "Download .ics" }).first());
  const download = await downloadPromise;
  if (!download) {
    return { status: "fail", note: "`Download .ics` button present but no download started within 20s", evidencePath };
  }
  const icsPath = `${ctx.runDir}/journey__${evidenceBase}__schedule.ics`;
  await download.saveAs(icsPath);
  const icsBody = readFileSync(icsPath, "utf8");
  const veventCount = (icsBody.match(/BEGIN:VEVENT/g) ?? []).length;
  if (!/^BEGIN:VCALENDAR/.test(icsBody) || !/END:VCALENDAR\s*$/.test(icsBody) || veventCount === 0) {
    return {
      status: "fail",
      note: `the downloaded file is not a valid iCalendar export (BEGIN:VCALENDAR ${icsBody.startsWith("BEGIN:VCALENDAR") ? "present" : "missing"}, ${veventCount} VEVENTs) — see evidence`,
      evidencePath: icsPath,
    };
  }

  return {
    status: "pass",
    measured: `persisted state survived the reload ${exactMatch ? "exactly (byte-exact)" : `except updatedAt (${formatDiffs(timestampDeltas, 1)})`}; save state "${saveStateText.slice(0, 20)}"; print intent invoked; .ics downloaded with ${veventCount} events for ${codes.join(", ")}`,
    evidencePath,
  };
}

/**
 * plan — the SAVE-NAMED-PLAN → RELOAD → RESTORE leg on /plans.
 *
 * Saves the working schedule as a named plan, deliberately diverges the
 * working schedule (a third course marked Taking), reloads, then restores the
 * plan through its confirm dialog (`Restore this plan` / `Cancel`). The
 * restored schedule must equal the saved plan — not the divergence.
 */
async function runPlan(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  await activateCoursesAndOpenSchedule(page, 2, "CSCE");
  await settle(page, 1200);
  const planEventCodes = await renderedEventCodes(page);
  if (planEventCodes.length === 0) {
    return { status: "fail", note: "plan journey: no calendar events rendered before saving the plan — nothing to restore" };
  }

  const response = await page.goto(`${ctx.frontendOrigin}${PLANS}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await settle(page);
  const status = response?.status() ?? 0;
  if (response === null || status >= 400) {
    return { status: "fail", note: `Required contract surface absent: ${PLANS} returned HTTP ${status} — missing saved-plan library page (contract: /plans)` };
  }

  const nameInput = page.getByLabel("Plan name (optional)").first();
  const nameField = await missingElement(nameInput, "`Plan name (optional)` input (contract: /plans)");
  if (!nameField.present) return { status: "fail", note: nameField.reason };
  const saveButton = page.getByRole("button", { name: "Save current schedule" }).first();
  const saveControl = await missingElement(saveButton, "`Save current schedule` button (contract: /plans)");
  if (!saveControl.present) return { status: "fail", note: saveControl.reason };

  const planName = `Journey restore ${Math.random().toString(36).slice(2, 8)}`;
  await nameInput.fill(planName);
  await activate(page, saveButton);

  // The saved plan must appear as a plan card with its own actions.
  const planCard = page.locator("li").filter({ hasText: planName }).first();
  const cardShown = await planCard.isVisible({ timeout: 15_000 }).catch(() => false);
  if (!cardShown) {
    return { status: "fail", note: `the saved plan "${planName}" did not appear in the /plans library within 15s (contract: /plans)` };
  }
  const exportButton = await missingElement(
    planCard.getByRole("button", { name: "Export" }).first(),
    "per-plan `Export` action (contract: /plans)",
  );
  if (!exportButton.present) return { status: "fail", note: exportButton.reason };
  await screenshot(page, ctx.runDir, `${caseId}-after-save`);

  // Diverge the working schedule from the saved plan: a third course Taking.
  await page.goto(`${ctx.frontendOrigin}/courses`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  await waitForFilteredRows(page, "CSCE");
  const divergenceCode = await courseCodeAt(page, 2);
  if (!divergenceCode) {
    return { status: "fail", note: "plan journey: could not diverge the working schedule — no third CSCE course row to mark Taking" };
  }
  await markCourseTaking(page, divergenceCode);
  if (persona === "registered") {
    // The durable step for the divergence edit is its planner API POST; give
    // the debounced write room to land before the reload.
    await sleep(1_200);
  } else {
    await readGuestPersistedPlanSettled(page);
  }

  // Reload, then restore the saved plan.
  if (persona === "registered") {
    const writeback = page
      .waitForResponse((response) => PLANNER_API.test(response.url()) && response.request().method() === "POST", { timeout: 30_000 })
      .catch(() => null);
    await page.reload({ waitUntil: "domcontentloaded" });
    await writeback;
  } else {
    await page.reload({ waitUntil: "domcontentloaded" });
  }
  await settle(page, 1500);
  // Registered: the hydration write-back was awaited above; only the guest's
  // debounced sessionStorage write needs a stability wait here.
  if (persona === "guest") await readGuestPersistedPlanSettled(page);

  await page.goto(`${ctx.frontendOrigin}${PLANS}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  const restoredCard = page.locator("li").filter({ hasText: planName }).first();
  if (!(await restoredCard.isVisible({ timeout: 15_000 }).catch(() => false))) {
    return { status: "fail", note: `the saved plan "${planName}" was gone from /plans after the reload (contract: /plans durability)` };
  }
  const restoreEntry = restoredCard.getByRole("button", { name: /restore/i }).first();
  const entryPresent = await missingElement(
    restoreEntry,
    `per-plan restore affordance opening the restore confirm dialog (contract: /plans)`,
  );
  if (!entryPresent.present) return { status: "fail", note: entryPresent.reason };

  await activate(page, restoreEntry);
  const dialog = page.getByRole("dialog").first();
  const dialogVisible = await dialog.isVisible({ timeout: 8_000 }).catch(() => false);
  const confirmButton = (dialogVisible ? dialog : page).getByRole("button", { name: "Restore this plan" }).first();
  const confirm = await missingElement(
    confirmButton,
    "restore confirm dialog with `Restore this plan` button (contract: /plans, required)",
  );
  if (!confirm.present) return { status: "fail", note: confirm.reason };
  const cancelButton = (dialogVisible ? dialog : page).getByRole("button", { name: "Cancel", exact: true }).first();
  const cancel = await missingElement(
    cancelButton,
    "restore confirm dialog with `Cancel` button (contract: /plans)",
  );
  if (!cancel.present) return { status: "fail", note: cancel.reason };

  // The preview must list what will change — never an empty confirmation.
  const previewText = (await dialog.textContent({ timeout: 5_000 }).catch(() => "")) ?? "";
  if (dialogVisible && previewText.trim().length < 10) {
    return { status: "fail", note: "the restore confirm dialog's preview is empty — the contract requires it to list exactly what will change (contract: /plans)" };
  }
  await screenshot(page, ctx.runDir, `${caseId}-restore-dialog`);

  // Both dialog controls work: Cancel dismisses, then the journey restores.
  await activate(page, cancelButton);
  await dialog.waitFor({ state: "hidden", timeout: 5_000 }).catch(() => null);
  if (await dialog.isVisible({ timeout: 1_000 }).catch(() => false)) {
    return { status: "fail", note: "`Cancel` did not dismiss the restore confirm dialog (contract: /plans)" };
  }
  await activate(page, restoreEntry);
  await activate(page, (dialogVisible ? dialog : page).getByRole("button", { name: "Restore this plan" }).first());
  await settle(page, 1200);

  // The restored working schedule must equal the saved plan, not the divergence.
  await page.goto(`${ctx.frontendOrigin}/schedule`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page, 1500);
  const restoredCodes = await renderedEventCodes(page);
  await screenshot(page, ctx.runDir, `${caseId}-after-restore`);

  const evidencePath = writeJsonEvidence(ctx, `${safeFileName(caseId)}__restore`, {
    planName,
    planEventCodes,
    divergenceCode,
    restoredCodes,
    dialogPreviewSample: previewText.slice(0, 400),
  });

  if (restoredCodes.length === 0) {
    return { status: "fail", note: "after restoring the plan, no calendar events render on /schedule", evidencePath };
  }
  const expected = [...planEventCodes].sort();
  const observed = [...restoredCodes].sort();
  if (observed.join("|") !== expected.join("|")) {
    return {
      status: "fail",
      note: `restored schedule does not equal the saved plan: expected events ${expected.join(", ")}, found ${observed.join(", ")}`,
      evidencePath,
    };
  }
  if (restoredCodes.includes(divergenceCode) && !planEventCodes.includes(divergenceCode)) {
    return {
      status: "fail",
      note: `restore did not revert the diverged edit: ${divergenceCode} (marked Taking after the save) is still in the working schedule`,
      evidencePath,
    };
  }
  return {
    status: "pass",
    measured: `plan "${planName}" saved, survived reload, restored through the confirm dialog; schedule back to ${expected.join(", ")}`,
    evidencePath,
  };
}

/** map: schedule two courses → generate map → view a day: day tabs and route legs. */
async function runMap(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const codes = await activateCoursesAndOpenSchedule(page, 2, "CSCE");
  await activate(page, page.getByRole("link", { name: "Generate map →" }).first());
  await page.waitForURL("**/map", { timeout: 30_000 });
  await settle(page, 1500); // map canvas + route resolution

  const tabs = page.getByRole("tablist").getByRole("tab");
  const tabCount = await tabs.count();
  // Contract: day tabs Mon–Fri WITH aria-selected. View a day = click a day
  // tab, it becomes the selected day, and the day's route content renders.
  let missingAriaSelected = 0;
  let selectedDayMoved = true;
  let legsSeen = false;
  for (let i = 0; i < tabCount; i++) {
    const tab = tabs.nth(i);
    if ((await tab.getAttribute("aria-selected", { timeout: 2_000 }).catch(() => null)) === null) {
      missingAriaSelected += 1;
    }
    if (legsSeen) continue;
    await tab.click();
    await settle(page, 900);
    if (!(await attributeBecomes(page, tab, "aria-selected", "true", 3_000))) {
      selectedDayMoved = false;
    }
    legsSeen = await page.locator('[aria-label="Route legs"]').isVisible().catch(() => false);
  }
  const routeLegs = await missingElement(
    page.locator('[aria-label="Route legs"]').first(),
    "'Route legs' region (contract: /map)",
  );
  await screenshot(page, ctx.runDir, caseId);

  if (tabCount < 5) return { status: "fail", note: `expected a 5-day tablist on /map, found ${tabCount} tabs` };
  if (missingAriaSelected > 0) {
    return { status: "fail", note: `${missingAriaSelected} of ${tabCount} day tabs expose no aria-selected state (contract: /map, required)` };
  }
  if (!selectedDayMoved) {
    return { status: "fail", note: "clicking a day tab did not make it the selected day (aria-selected stayed false — contract: /map)" };
  }
  if (!routeLegs.present) {
    return { status: "fail", note: `${routeLegs.reason} (no route legs/stops rendered for active courses ${codes.join(", ")})` };
  }
  return { status: "pass", measured: `5 day tabs with aria-selected; route legs rendered for ${codes.join(", ")}` };
}

/** auth: the auth page surface; registered personas do the full round trip. */
async function runAuth(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, viewport);
  await activate(cb.page, cb.page.getByRole("link", { name: "Sign in or create account" }));
  await cb.page.waitForURL("**/auth", { timeout: 30_000 });
  const h1 = (await cb.page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 10_000 }).catch(() => null)) ?? "";
  // Cold loads on a busy sandbox can hydrate /auth slowly; generous waits.
  await cb.page.getByLabel("UNT email").waitFor({ state: "visible", timeout: 40_000 });
  await cb.page.getByRole("link", { name: "Forgot password?" }).waitFor({ state: "visible", timeout: 20_000 });

  await cb.page.getByRole("button", { name: "Use password instead" }).click({ timeout: 15_000 });
  await cb.page.getByLabel("Password").waitFor({ state: "visible", timeout: 15_000 });
  await screenshot(cb.page, ctx.runDir, caseId);

  if (persona === "guest") {
    return { status: "pass", measured: `auth page rendered (h1: ${h1.slice(0, 40)}); password mode and reset link present` };
  }

  const account = syntheticPersona();
  await signUp(cb.page, account, ctx.frontendOrigin);
  if (!(await cb.page.getByRole("button", { name: "Sign out" }).isVisible({ timeout: 10_000 }).catch(() => false))) {
    return { status: "fail", note: "sign-up did not end in a signed-in state (no Sign out button)" };
  }
  await signOut(cb.page);
  if (await cb.page.getByRole("button", { name: "Sign out" }).isVisible({ timeout: 6_000 }).catch(() => false)) {
    return { status: "fail", note: "Sign out button still visible after signing out" };
  }
  await signIn(cb.page, account, ctx.frontendOrigin);
  await screenshot(cb.page, ctx.runDir, `${caseId}-roundtrip`);
  return { status: "pass", measured: "synthetic sign-up → auto sign-in → sign-out → sign-in all succeeded (synthetic-registered persona)" };
}

const RUNNERS: Record<JourneyName, (ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName) => Promise<CaseOutcome>> = {
  discover: runDiscover,
  instructor: runInstructor,
  build: runBuild,
  save: runSave,
  plan: runPlan,
  map: runMap,
  auth: runAuth,
};

export default defineSuite({
  name: "journey",
  describe(): CaseSpec[] {
    const cases: CaseSpec[] = [];
    for (const journey of JOURNEYS) {
      for (const persona of PERSONAS) {
        for (const viewport of VIEWPORTS) {
          cases.push({ id: `journey/${journey}-${persona}-${viewport}`, title: `${journey} journey — ${persona} persona @ ${viewport}` });
        }
      }
    }
    return cases;
  },
  async run(caseId, ctx): Promise<CaseOutcome> {
    const { journey, persona, viewport } = parseCaseId(caseId);
    try {
      return await RUNNERS[journey](ctx, caseId, persona, viewport);
    } catch (error) {
      return { status: "fail", note: `case threw: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      // A case that throws mid-entry (the planted-defect shape) must not leak
      // its browser — leaked transports keep run.ts alive past its scorecard.
      await closeTrackedCases();
    }
  },
  caseTimeoutMs: 480_000,
});
