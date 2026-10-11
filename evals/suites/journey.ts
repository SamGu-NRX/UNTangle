/**
 * journey — the seven contract journeys (evals/CONTRACT.md), each for the
 * guest persona and a SYNTHETIC registered persona, each at 1440x900 and
 * 390x844: 7 × 2 × 2 = 28 cases.
 *
 * Journeys drive the real UI through accessible names/roles from the contract.
 * Where the contract marks an element REQUIRED but this head does not expose
 * it, the case FAILS and its note names exactly which contract element was
 * missing — that is the honest expected-fail on a baseline head.
 * not-applicable is used only when a persona prerequisite cannot exist.
 */
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, CaseSpec, SuiteContext } from "../suite-kit";
import { openCase, screenshot, settle } from "./ui-browser";
import type { ViewportName } from "./ui-browser";
import { signIn, signOut, syntheticPersona, signUp } from "./ui-persona";
import type { SyntheticPersona } from "./ui-persona";
import {
  activate,
  activateCoursesAndOpenSchedule,
  chooseMajorIfOpen,
  courseRow,
  expectDetailNot404,
  missingElement,
  PLANS,
} from "./ui-contract";
import type { Page } from "playwright";

type PersonaName = "guest" | "registered";
type JourneyName = "discover" | "instructor" | "build" | "save" | "plan" | "map" | "auth";

const JOURNEYS: JourneyName[] = ["discover", "instructor", "build", "save", "plan", "map", "auth"];
const PERSONAS: PersonaName[] = ["guest", "registered"];
const VIEWPORTS: ViewportName[] = ["desktop", "mobile"];

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

/** Shared case entry: fresh browser, correct persona sign-in state, on /courses. */
async function enter(
  ctx: SuiteContext,
  persona: PersonaName,
  viewport: ViewportName,
): Promise<Page> {
  const cb = await openCase(ctx.frontendOrigin, viewport);
  if (persona === "guest") {
    await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
    await cb.page.waitForURL("**/courses", { timeout: 30_000 });
    await settle(cb.page);
    await chooseMajorIfOpen(cb.page);
    return cb.page;
  }
  const account = syntheticPersona();
  await signUp(cb.page, account, ctx.frontendOrigin);
  await activate(cb.page, cb.page.getByRole("link", { name: "Courses", exact: true }).first());
  await cb.page.waitForURL("**/courses", { timeout: 30_000 });
  await settle(cb.page);
  await chooseMajorIfOpen(cb.page);
  return cb.page;
}

async function landOnCourses(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<Page> {
  void caseId;
  return enter(ctx, persona, viewport);
}

/** First code visible after searching, read from the row's own heading. */
async function firstSearchedCode(page: Page, what: string): Promise<string> {
  const firstRow = page.locator("article.course-row").first();
  const rowCode =
    (await firstRow.locator("h1, h2, h3, h4, [data-course-code]").first().textContent({ timeout: 10_000 }).catch(() => null)) ?? "";
  const code = rowCode.match(/\b[A-Z]{2,4}\s\d{4}\b/)?.[0];
  if (!code) {
    throw new Error(`${what} journey could not read a course code from the first course row after search`);
  }
  return code;
}

// ---------------------------------------------------------------------------
// Journeys
// ---------------------------------------------------------------------------

/** discover: landing → courses → search → open a course detail → read catalog. */
async function runDiscover(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const code = await firstSearchedCode(page, "discover");
  await activate(page, courseRow(page, code).getByRole("link", { name: "Details" }).first());
  await page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(page, page.url());

  const gradeSummary = await missingElement(
    page.getByText("Course grade summary").first(),
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
  const code = await firstSearchedCode(page, "instructor");
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

  const summary = await missingElement(
    page.getByText("Instructor grade summary").first(),
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

/** build: courses → mark two taking → Optimize → schedule renders plan. */
async function runBuild(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  await activateCoursesAndOpenSchedule(page, 2);
  await settle(page, 1200);

  // REQUIRED: explicit optimizer run button.
  const optimize = await missingElement(
    page.getByRole("button", { name: "Optimize schedule" }).first(),
    "`Optimize schedule` button (contract: /schedule, required)",
  );
  const options = page.getByRole("button", { name: /Cluster mornings|Cluster nights|Compact days|Minimize walking|Strong professors/ });
  const optionCount = await options.count();
  const events = await page.getByRole("button", { name: /\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/ }).count();
  await screenshot(page, ctx.runDir, caseId);

  if (!optimize.present) return { status: "fail", note: optimize.reason };
  if (optionCount < 5) return { status: "fail", note: `expected 5 optimization option buttons on /schedule, found ${optionCount}` };
  if (events === 0) return { status: "fail", note: "no calendar event buttons rendered on /schedule after optimizing two courses" };
  return { status: "pass", measured: `${optionCount} options, ${events} calendar events` };
}

/** save: make a planner edit, reload, and check the durability acknowledgment. */
async function runSave(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  await activateCoursesAndOpenSchedule(page, 2);
  await settle(page, 1200);

  // Durability probe: the edit must survive a reload.
  await page.reload({ waitUntil: "domcontentloaded" });
  await settle(page, 1500);
  const events = await page.getByRole("button", { name: /\d{1,2}:\d{2} [AP]M – \d{1,2}:\d{2} [AP]M/ }).count();
  const persisted = events > 0;

  // REQUIRED: the contract's save-state region acknowledging durability.
  const saveState = await missingElement(
    page.locator("[role='status'][aria-label='Save state']").first(),
    "`Save state` status region (contract: /schedule, required — durability acknowledgment)",
  );
  const print = await missingElement(page.getByRole("button", { name: "Print schedule" }).first(), "`Print schedule` button (contract: /schedule, required)");
  const ics = await missingElement(page.getByRole("button", { name: "Download .ics" }).first(), "`Download .ics` button (contract: /schedule, required)");
  await screenshot(page, ctx.runDir, caseId);

  if (!persisted) return { status: "fail", note: "planner edits did not survive a reload on this head (durability precondition failed)" };
  const absent = [saveState, print, ics].filter((probe) => !probe.present);
  if (absent.length > 0) {
    return {
      status: "fail",
      note: `Data persisted on this head, but the contract's durability acknowledgment is missing: ${absent
        .map((probe) => (probe.present ? "" : probe.reason))
        .filter(Boolean)
        .join("; ")}`,
    };
  }
  return { status: "pass", measured: "edits survived reload; Save state region acknowledged durability" };
}

/** plan: the saved-plan library page must exist and expose its surface. */
async function runPlan(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  const response = await page.goto(`${ctx.frontendOrigin}${PLANS}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await settle(page);
  const status = response?.status() ?? 0;
  await screenshot(page, ctx.runDir, caseId);

  if (response === null || status >= 400) {
    return { status: "fail", note: `Required contract surface absent: ${PLANS} returned HTTP ${status} — missing saved-plan library page (contract: /plans)` };
  }
  const saveButton = await missingElement(page.getByRole("button", { name: "Save current schedule" }).first(), "`Save current schedule` button (contract: /plans)");
  if (!saveButton.present) return { status: "fail", note: saveButton.reason };
  return { status: "pass", measured: `${PLANS} reachable with save affordances` };
}

/** map: schedule two courses → generate map → day tabs and route legs. */
async function runMap(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const page = await landOnCourses(ctx, caseId, persona, viewport);
  await page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await page.waitForTimeout(700);
  const codes = await activateCoursesAndOpenSchedule(page, 2);
  await activate(page, page.getByRole("link", { name: "Generate map →" }).first());
  await page.waitForURL("**/map", { timeout: 30_000 });
  await settle(page, 1500); // map canvas + route resolution

  const tabs = page.getByRole("tablist").getByRole("tab");
  const tabCount = await tabs.count();
  const routeLegs = await missingElement(page.getByText("Route legs").first(), "'Route legs' region (contract: /map)");
  await screenshot(page, ctx.runDir, caseId);

  if (tabCount < 5) return { status: "fail", note: `expected a 5-day tablist on /map, found ${tabCount} tabs` };
  if (!routeLegs.present) {
    return { status: "fail", note: `${routeLegs.reason} (no route legs/stops rendered for active courses ${codes.join(", ")})` };
  }
  return { status: "pass", measured: `5 day tabs; route legs rendered for ${codes.join(", ")}` };
}

/** auth: the auth page surface; registered personas do the full round trip. */
async function runAuth(ctx: SuiteContext, caseId: string, persona: PersonaName, viewport: ViewportName): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, viewport);
  await activate(cb.page, cb.page.getByRole("link", { name: "Sign in or create account" }));
  await cb.page.waitForURL("**/auth", { timeout: 30_000 });
  const h1 = (await cb.page.getByRole("heading", { level: 1 }).first().textContent({ timeout: 10_000 }).catch(() => null)) ?? "";
  // Cold loads on a busy sandbox can hydrate /auth slowly; generous waits.
  await cb.page.getByLabel("UNT email", { exact: true }).waitFor({ state: "visible", timeout: 40_000 });
  await cb.page.getByRole("link", { name: "Forgot password?" }).waitFor({ state: "visible", timeout: 20_000 });

  await cb.page.getByRole("button", { name: "Use password instead" }).click({ timeout: 15_000 });
  await cb.page.getByLabel("Password", { exact: true }).waitFor({ state: "visible", timeout: 15_000 });
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
    }
  },
  caseTimeoutMs: 240_000,
});
