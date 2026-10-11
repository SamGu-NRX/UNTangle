/**
 * honesty — DOM-level assertions for the harness honesty rules.
 *
 * One case per rule:
 *   1. rmp-labels-when-unavailable — RateMyProfessors-stub labels visible and
 *      accurate when ratings are unavailable (the harness blocks RMP at the
 *      network boundary — evals/rmp-block.ts).
 *   2. sample-data-notice — the sample-data notice on the courses page.
 *   3. stale-rating-notice — unavailable/stale rating data is signaled, never
 *      silently blank.
 *   4. unverified-savings-disclaimer — plans state savings honestly.
 *   5. no-fabricated-precision — no fabricated precise numbers presented as
 *      verified (e.g. a claimed "100% certain" optimal schedule).
 */
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, CaseSpec, SuiteContext } from "../suite-kit";
import { openCase, screenshot, settle } from "./ui-browser";
import { activate, courseRow, expectDetailNot404, missingElement, PLANS } from "./ui-contract";
import type { Page } from "playwright";

const CASES: CaseSpec[] = [
  { id: "honesty/rmp-labels-when-unavailable", title: "RMP stub labels visible and accurate when ratings are unavailable" },
  { id: "honesty/sample-data-notice", title: "Sample-data notice on the courses page" },
  { id: "honesty/stale-rating-notice", title: "Unavailable/stale rating data is signaled on the detail page" },
  { id: "honesty/unverified-savings-disclaimer", title: "Unverified-savings disclaimers on plans" },
  { id: "honesty/no-fabricated-precision", title: "No fabricated precise numbers presented as verified" },
];

/** Navigate courses → the first CSCE row's detail page, failing precisely on a 404. */
async function openFirstDetail(ctx: SuiteContext): Promise<{ page: Page; code: string }> {
  const cb = await openCase(ctx.frontendOrigin, "desktop");
  await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
  await cb.page.waitForURL("**/courses", { timeout: 30_000 });
  await settle(cb.page);

  await cb.page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
  await cb.page.waitForTimeout(700);
  // The code element per the /courses contract is the row's meta span; the
  // row's full text starts with the title, whose own "(COSC 1306)" mention
  // would match first and name a course no row's meta carries.
  const firstMeta = cb.page.locator("article.course-row").first().locator(".course-row__meta");
  const meta = (await firstMeta.textContent({ timeout: 10_000 }).catch(() => null)) ?? "";
  const code = meta.match(/^\s*([A-Z]{2,4}\s?\d{4})\b/)?.[1];
  if (!code) throw new Error(`honesty case could not read a course code from the first course row after search (first meta: ${meta.slice(0, 80) || "none"})`);

  await activate(cb.page, courseRow(cb.page, code).getByRole("link", { name: "Details" }).first());
  await cb.page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(cb.page, cb.page.url());
  return { page: cb.page, code };
}

async function runRmpLabels(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const { page, code } = await openFirstDetail(ctx);
  // The harness blocks RMP at the network boundary; the stub must say so.
  const noMatch = await missingElement(
    page.getByText(/No RateMyProfessors match yet/i).first(),
    "'No RateMyProfessors match yet' stub label (contract: /courses/[subject]/[number], RMP blocked)",
  );
  const naShown = await page.getByText(/^\s*N\/A\s*$/).first().isVisible({ timeout: 6_000 }).catch(() => false);
  // Course rows may also carry a "No RMP" badge.
  await page.goto(`${ctx.frontendOrigin}/courses`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  const rowNoRmp = await page.getByText(/No RMP/i).first().isVisible({ timeout: 6_000 }).catch(() => false);
  await screenshot(page, ctx.runDir, caseId);

  if (!noMatch.present && !naShown && !rowNoRmp) {
    return {
      status: "fail",
      note: "RMP is blocked at the network boundary but no honest unavailable label was found (no 'No RateMyProfessors match yet', no 'N/A', no 'No RMP' row badge)",
    };
  }
  return { status: "pass", measured: `unavailable-rating stub visible for ${code} (noMatch=${noMatch.present}, n/a=${naShown}, rowBadge=${rowNoRmp})` };
}

async function runSampleDataNotice(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop", "/courses");
  await settle(cb.page);
  // REQUIRED by contract: a status named "Sample data notice" whose text says sample.
  const notice = await missingElement(
    cb.page.locator("[role='status']").filter({ hasText: /sample/i }).first(),
    "`status` named 'Sample data notice' with sample wording (contract: /courses, required)",
  );
  await screenshot(cb.page, ctx.runDir, caseId);
  if (!notice.present) return { status: "fail", note: notice.reason };
  return { status: "pass", measured: "sample-data status notice present on /courses" };
}

async function runStaleRatingNotice(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const { page } = await openFirstDetail(ctx);
  // The detail page must signal unavailable grade/rating data with status
  // notices (contract: /courses/[subject]/[number] unavailable states), never
  // silently blank regions.
  const gradeUnavailable = await missingElement(
    page.getByText(/Grade data unavailable|Grade records unavailable/i).first(),
    "'Grade data unavailable' / 'Grade records unavailable' status (contract: /courses/[subject]/[number])",
  );
  const ratingsUnavailable = await missingElement(
    page.locator("[role='status']").filter({ hasText: /unavailable/i }).first(),
    "ratings-unavailable `status` notice (contract: /courses/[subject]/[number])",
  );
  await screenshot(page, ctx.runDir, caseId);

  if (!gradeUnavailable.present || !ratingsUnavailable.present) {
    const absent = [gradeUnavailable, ratingsUnavailable].filter((probe) => !probe.present);
    return {
      status: "fail",
      note: `Stale/unavailable-data signaling missing: ${absent.map((probe) => (probe.present ? "" : probe.reason)).filter(Boolean).join("; ")}`,
    };
  }
  return { status: "pass", measured: "grade and rating unavailability signaled with status notices" };
}

async function runUnverifiedSavings(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop", PLANS);
  const response = await cb.page.goto(`${ctx.frontendOrigin}${PLANS}`, { waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => null);
  await settle(cb.page);
  const status = response?.status() ?? 0;
  await screenshot(cb.page, ctx.runDir, caseId);

  if (response === null || status >= 400) {
    return { status: "fail", note: `Required contract surface absent: ${PLANS} returned HTTP ${status} — no plans page to assert disclaimers on (contract: /plans)` };
  }
  const disclaimer = await missingElement(
    cb.page.getByText(/unverified|estimate|not verified|may not save/i).first(),
    "unverified-savings disclaimer on /plans (binding honesty rule)",
  );
  if (!disclaimer.present) return { status: "fail", note: disclaimer.reason };
  return { status: "pass", measured: "savings on /plans carry an unverified/estimate disclaimer" };
}

async function runNoFabricatedPrecision(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop", "/schedule");
  await settle(cb.page, 1200);
  const bodyText = (await cb.page.locator("body").textContent({ timeout: 10_000 }).catch(() => "")) ?? "";
  await screenshot(cb.page, ctx.runDir, caseId);

  const fabricated = bodyText.match(/(100% (?:certain|accurate|verified))|(guaranteed (?:optimal|savings))|(perfect schedule)/i);
  if (fabricated) {
    return { status: "fail", note: `/schedule claims verified precision it cannot have: "${fabricated[0]}"` };
  }
  return { status: "pass", measured: "no fabricated precise numbers presented as verified on /schedule" };
}

export default defineSuite({
  name: "honesty",
  describe(): CaseSpec[] {
    return CASES;
  },
  async run(caseId, ctx): Promise<CaseOutcome> {
    switch (caseId) {
      case "honesty/rmp-labels-when-unavailable":
        return runRmpLabels(ctx, caseId);
      case "honesty/sample-data-notice":
        return runSampleDataNotice(ctx, caseId);
      case "honesty/stale-rating-notice":
        return runStaleRatingNotice(ctx, caseId);
      case "honesty/unverified-savings-disclaimer":
        return runUnverifiedSavings(ctx, caseId);
      case "honesty/no-fabricated-precision":
        return runNoFabricatedPrecision(ctx, caseId);
      default:
        throw new Error(`honesty: unrecognized case id ${caseId}`);
    }
  },
  caseTimeoutMs: 240_000,
});
