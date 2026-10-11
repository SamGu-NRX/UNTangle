/**
 * Journey and probe helpers for the persistence-faults suite.
 *
 * Every helper drives the app black-box through the UI, using the roles and
 * accessible-name templates pinned in evals/CONTRACT.md. Nothing here imports
 * application code. Probes for contract-required UI are deliberately
 * generous (substring accessible-name matching): if the app exposes anything
 * that plausibly IS the element, the probe finds it and the case is judged
 * against what the app actually shows.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Locator, Page, Response } from "@playwright/test";
import type { SuiteContext } from "../suite-kit";

/** The planner persistence API (POST saves, GET loads for registered users). */
const PLANNER_API = /\/api\/planner\/?(\?.*)?$/;

/** A course with no prerequisites, so its status buttons are never locked. */
export const COURSE_PRIMARY = "ANTH 1010";
/** Second unlocked course for the newer-tab edit in the cross-tab cases. */
export const COURSE_SECONDARY = "ANTH 1150";
/** Third unlocked course for the stale-tab edit in the conflict case. */
export const COURSE_STALE = "ANTH 2300";
/** Major chosen whenever the app prompts for one (fresh planner state). */
export const MAJOR_NAME = "Computer Science";

export interface Persona {
  email: string;
  password: string;
  name: string;
}

/** Synthetic persona per the journey rules: eval-persist+<random>@my.unt.edu. */
export function newPersona(): Persona {
  const suffix = randomBytes(6).toString("hex");
  return {
    email: `eval-persist+${suffix}@my.unt.edu`,
    password: `pv-${randomBytes(8).toString("hex")}`,
    name: `Eval Persist ${suffix}`,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Writes the case's evidence JSON next to the runner's preflight logs. */
export function writeEvidence(ctx: SuiteContext, caseId: string, payload: unknown): string {
  mkdirSync(ctx.runDir, { recursive: true });
  const file = path.join(ctx.runDir, `persistence-faults__${caseId}.json`);
  writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

/** Best-effort screenshot; a capture failure is disclosed, never swallowed silently. */
export async function snap(page: Page, ctx: SuiteContext, caseId: string, label: string): Promise<string | null> {
  try {
    const file = path.join(ctx.runDir, `persistence-faults__${caseId}__${label}.png`);
    await page.screenshot({ path: file });
    return file;
  } catch (error) {
    console.error(`[persistence-faults] screenshot ${caseId}/${label} failed: ${(error as Error).message}`);
    return null;
  }
}

/** Collects uncaught page errors so cases can disclose them as observed facts. */
export function collectPageErrors(page: Page): { messages: string[] } {
  const messages: string[] = [];
  page.on("pageerror", (error) => {
    messages.push(error.message.slice(0, 300));
  });
  return { messages };
}

// ---------------------------------------------------------------------------
// Auth journeys (UI-driven, per CONTRACT.md /auth)
// ---------------------------------------------------------------------------

/** Signs up a fresh synthetic persona through the UI; resolves once signed in. */
export async function registerPersonaThroughUi(page: Page, origin: string): Promise<Persona> {
  const persona = newPersona();
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use password instead" }).click();
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill(persona.name);
  await page.getByLabel("Email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  await page.locator("form").getByRole("button", { name: "Create account", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
  return persona;
}

/** Password sign-in for an existing persona; resolves once signed in. */
export async function signInThroughUi(page: Page, origin: string, persona: Persona): Promise<void> {
  await page.goto(`${origin}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Use password instead" }).click();
  await page.getByLabel("Email", { exact: true }).fill(persona.email);
  await page.getByLabel("Password", { exact: true }).fill(persona.password);
  await page.locator("form").getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ state: "visible", timeout: 30_000 });
}

/** Signs out through the nav and waits for the redirect to the landing page. */
export async function signOutThroughUi(page: Page, origin: string): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(`${origin}/`, { timeout: 20_000 }).catch(() => undefined);
}

/** Guest entry from the landing page. */
export async function continueAsGuest(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: "Continue as guest" }).click();
  await page.waitForURL(/\/courses\/?$/, { timeout: 20_000 });
}

// ---------------------------------------------------------------------------
// Planner journeys
// ---------------------------------------------------------------------------

/**
 * Loads /courses as a registered user and waits until the planner state
 * hydration GET has landed. Also waits for the hydration-triggered debounced
 * save (the provider writes the freshly loaded state back ~350ms after
 * hydration), so the next armed save-waiter can only match a deliberate edit.
 */
export async function gotoRegisteredCourses(page: Page, origin: string): Promise<void> {
  const writeback = page
    .waitForResponse((response) => PLANNER_API.test(response.url()) && response.request().method() === "POST", {
      timeout: 20_000,
    })
    .catch(() => null);
  const hydration = page.waitForResponse(
    (response) => PLANNER_API.test(response.url()) && response.request().method() === "GET",
    { timeout: 20_000 },
  );
  await page.goto(`${origin}/courses`, { waitUntil: "domcontentloaded" });
  await hydration;
  await writeback;
  await page.locator("article.course-row").first().waitFor({ state: "visible", timeout: 20_000 });
}

/**
 * Loads /courses as a guest and waits for the hydration signal (the
 * major-selection modal opens exactly when the provider has finished
 * hydrating a fresh planner). Storage-denied sessions still open it: the
 * hydration read failure is caught by the app and leaves the default state.
 */
export async function gotoGuestCourses(page: Page, origin: string): Promise<void> {
  await page.goto(`${origin}/courses`, { waitUntil: "domcontentloaded" });
  await page.getByText("Choose your major").waitFor({ state: "visible", timeout: 10_000 }).catch(() => undefined);
  await page.locator("article.course-row").first().waitFor({ state: "visible", timeout: 20_000 });
  await sleep(600);
}

/**
 * Answers the major-selection modal when it is up (fresh planner state).
 * For registered sessions the confirm triggers a planner save, which is
 * awaited so later save-waiters can only match deliberate edits.
 */
export async function chooseMajorIfPrompted(page: Page, opts: { registered: boolean }): Promise<boolean> {
  const modalLabel = page.getByText("Choose your major");
  if (!(await modalLabel.isVisible().catch(() => false))) {
    return false;
  }
  await page.getByRole("button", { name: MAJOR_NAME }).first().click();
  if (opts.registered) {
    const save = page.waitForResponse(
      (response) => PLANNER_API.test(response.url()) && response.request().method() === "POST",
      { timeout: 20_000 },
    );
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await save;
  } else {
    await page.getByRole("button", { name: "Confirm", exact: true }).click();
    await sleep(500);
  }
  return true;
}

/** Escapes a course code for use inside a RegExp. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (ch) => `\\${ch}`);
}
/**
 * The one course row whose CODE LINE names the course (the "ANTH 2300 · 3 cr"
 * meta line). Other rows can mention the same code in prerequisites or
 * cross-list text, so a plain hasText filter strict-matches several rows;
 * anchoring on the code-line pattern keeps the locator unique.
 */
export function plannerRow(page: Page, courseCode: string): Locator {
  return page.locator("article.course-row", {
    has: page.getByText(new RegExp(`${escapeRegExp(courseCode)}\\s*·`)),
  });
}

/**
 * Marks a course "Done" from its /courses row (the row's exact-name status
 * button, not the "Mark {COURSE} as done" toggle). For registered sessions
 * the planner save fired by the edit is awaited and its response returned.
 * For guest sessions the debounced sessionStorage write is given time to land.
 */
export async function markCourseDone(
  page: Page,
  courseCode: string,
  opts: { registered: boolean },
): Promise<{ rowCompleted: boolean; saveResponse: Response | null }> {
  const row = plannerRow(page, courseCode);
  await row.scrollIntoViewIfNeeded();
  const save = opts.registered
    ? page
        .waitForResponse(
          (response) => PLANNER_API.test(response.url()) && response.request().method() === "POST",
          { timeout: 20_000 },
        )
        .catch(() => null)
    : null;
  await row.getByRole("button", { name: "Done", exact: true }).click();
  const saveResponse = save ? await save : null;
  if (!opts.registered) {
    await sleep(900); // 350ms debounce + storage write
  }
  const rowCompleted = await rowCompletedBecomes(page, courseCode, true, 5_000);
  return { rowCompleted, saveResponse };
}

/** Polls the course row's data-completed attribute until it matches `want`. */
export async function rowCompletedBecomes(
  page: Page,
  courseCode: string,
  want: boolean,
  timeoutMs = 5_000,
): Promise<boolean> {
  const row = plannerRow(page, courseCode);
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await row.getAttribute("data-completed");
    if ((value === "true") === want) {
      return true;
    }
    await sleep(150);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Contract probes (evals/CONTRACT.md — required-but-absent elements on this head)
// ---------------------------------------------------------------------------

export interface ContractProbes {
  /** role="status" region named "Save state" (the save lifecycle carrier). */
  saveStateRegionCount: number;
  saveStateText: string | null;
  /** Standalone body-text lines exactly acknowledging "Saved". */
  savedAcknowledgmentLines: string[];
  /** Body-text lines that look like failure/retry feedback. */
  failureIndications: string[];
  retrySaveButtonCount: number;
  exportScheduleButtonCount: number;
  conflictDialogCount: number;
  keepMyEditsButtonCount: number;
  useNewerVersionButtonCount: number;
  takenNewerNoticeCount: number;
  keptAtNoticeCount: number;
  recoveredClaimCount: number;
}

/** Counts every contract element this suite's rules depend on, generously matched. */
export async function probeContractElements(page: Page): Promise<ContractProbes> {
  const saveStateRegion = page.getByRole("status", { name: "Save state" });
  const saveCount = await saveStateRegion.count();
  const saveText = saveCount > 0 ? ((await saveStateRegion.first().textContent()) ?? "").trim() : null;
  const bodyText = (await page.locator("body").innerText()).slice(0, 20_000);
  const lines = bodyText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return {
    saveStateRegionCount: saveCount,
    saveStateText: saveText,
    savedAcknowledgmentLines: [...new Set(lines.filter((line) => /^saved\.?$/i.test(line)))].slice(0, 3),
    failureIndications: [
      ...new Set(
        lines.filter((line) =>
          /(\bfailed\b|\berror\b|\bretry\b|\bnot saved\b|saving failed|something went wrong|couldn't|could not)/i.test(
            line,
          ),
        ),
      ),
    ].slice(0, 8),
    retrySaveButtonCount: await page.getByRole("button", { name: "Retry save" }).count(),
    exportScheduleButtonCount: await page.getByRole("button", { name: "Export schedule" }).count(),
    conflictDialogCount: await page.getByRole("alertdialog", { name: "Unsaved changes conflict" }).count(),
    keepMyEditsButtonCount: await page.getByRole("button", { name: "Keep my edits" }).count(),
    useNewerVersionButtonCount: await page.getByRole("button", { name: "Use the newer version" }).count(),
    takenNewerNoticeCount: await page.getByText("Loaded newer version from another tab").count(),
    keptAtNoticeCount: await page.getByText(/kept at/i).count(),
    recoveredClaimCount: await page.getByText(/recovered/i).count(),
  };
}

/** Fresh browser context (+ first page) for one case's persona session. */
export async function openSession(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}
