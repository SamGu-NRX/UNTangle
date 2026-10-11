/**
 * a11y-polish — accessibility and polish checks per main page.
 *
 * 12 cases: axe-core scans for seven main pages (serious+critical = 0 bar),
 * keyboard-only completion of the core path, a visible focus indicator,
 * prefers-reduced-motion emulation, no horizontal overflow at 390x844, and
 * informative alt/aria on images and icons. axe is injected from the harness,
 * never from the target.
 */
import { defineSuite } from "../suite-kit";
import type { CaseOutcome, CaseSpec, SuiteContext } from "../suite-kit";
import { closeCase, openCase, screenshot, settle } from "./ui-browser";
import type { CaseBrowser } from "./ui-browser";
import { activate, courseRow, expectDetailNot404 } from "./ui-contract";
import { runAxe } from "./ui-axe";

type PageKey = "home" | "courses" | "detail" | "instructor" | "schedule" | "map" | "auth";

const SCAN_PAGES: PageKey[] = ["home", "courses", "detail", "instructor", "schedule", "map", "auth"];

const CASES: CaseSpec[] = [
  ...SCAN_PAGES.map((key) => ({ id: `a11y/axe-${key}`, title: `axe scan (serious+critical = 0) — ${key} page` })),
  { id: "a11y/keyboard-core-path", title: "Keyboard-only completion of courses → detail → schedule" },
  { id: "a11y/focus-indicator", title: "Visible focus indicator on a focused control" },
  { id: "a11y/reduced-motion", title: "prefers-reduced-motion respected (no long-running animations)" },
  { id: "a11y/no-horizontal-overflow-mobile", title: "No horizontal overflow at 390x844" },
  { id: "a11y/image-icon-labeling", title: "Informative alt/aria on images and icons" },
];

function parseScanId(caseId: string): PageKey {
  const match = caseId.match(/^a11y\/axe-([a-z-]+)$/);
  const key = match?.[1] as PageKey | undefined;
  if (!key || !SCAN_PAGES.includes(key)) throw new Error(`a11y: unrecognized case id ${caseId}`);
  return key;
}

/** Read the first searched course code from /courses (already landed there). */
async function firstSearchedCode(page: CaseBrowser["page"]): Promise<string> {
  // The code element per the /courses contract is the row's meta span; the
  // row's full text starts with the title, whose own "(COSC 1301)" mention
  // would match first and name a course no row's meta carries.
  const firstMeta = page.locator("article.course-row").first().locator(".course-row__meta");
  const meta = (await firstMeta.textContent({ timeout: 10_000 }).catch(() => null)) ?? "";
  const code = meta.match(/^\s*([A-Z]{2,4}\s?\d{4})\b/)?.[1];
  if (!code) throw new Error(`a11y case could not read a course code after search (first meta: ${meta.slice(0, 80) || "none"})`);
  return code;
}

/** Open the named page (guest persona) at desktop size. */
async function openScanPage(ctx: SuiteContext, key: PageKey): Promise<CaseBrowser> {
  const cb = await openCase(ctx.frontendOrigin, "desktop");
  switch (key) {
    case "home":
      break;
    case "courses":
      await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
      await cb.page.waitForURL("**/courses", { timeout: 30_000 });
      await settle(cb.page);
      break;
    case "detail": {
      await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
      await cb.page.waitForURL("**/courses", { timeout: 30_000 });
      await settle(cb.page);
      await cb.page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
      await cb.page.waitForTimeout(700);
      const code = await firstSearchedCode(cb.page);
      await activate(cb.page, courseRow(cb.page, code).getByRole("link", { name: "Details" }).first());
      await cb.page.waitForURL("**/courses/**", { timeout: 20_000 });
      await expectDetailNot404(cb.page, cb.page.url());
      break;
    }
    case "instructor": {
      await activate(cb.page, cb.page.getByRole("link", { name: "Continue as guest" }));
      await cb.page.waitForURL("**/courses", { timeout: 30_000 });
      await settle(cb.page);
      await cb.page.getByRole("textbox", { name: "Search courses" }).fill("CSCE");
      await cb.page.waitForTimeout(700);
      const code = await firstSearchedCode(cb.page);
      await activate(cb.page, courseRow(cb.page, code).getByRole("link", { name: "Details" }).first());
      await cb.page.waitForURL("**/courses/**", { timeout: 20_000 });
      await expectDetailNot404(cb.page, cb.page.url());
      await activate(cb.page, cb.page.locator("a.detail-row").first());
      await cb.page.waitForURL("**/instructors/**", { timeout: 20_000 });
      await settle(cb.page);
      break;
    }
    case "schedule":
    case "map":
    case "auth":
      await cb.page.goto(`${ctx.frontendOrigin}/${key}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await settle(cb.page, 1000);
      break;
  }
  return cb;
}

async function runAxeCase(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const key = parseScanId(caseId);
  const cb = await openScanPage(ctx, key);
  const scan = await runAxe(cb.page);
  await screenshot(cb.page, ctx.runDir, caseId);
  await closeCase(cb);

  const found = scan.seriousOrWorse.length;
  const summary = scan.seriousOrWorse.map((v) => `${v.id}(${v.impact}x${v.nodes.length})`).join(", ");
  if (found > 0) {
    return {
      status: "fail",
      measured: `${found} serious+critical violations: ${summary}`,
      note: `axe impact counts ${JSON.stringify(scan.countsByImpact)}`,
    };
  }
  return { status: "pass", measured: `0 serious+critical; impact counts ${JSON.stringify(scan.countsByImpact)}` };
}

/** Keyboard-only: focus every step; no pointer events anywhere. */
async function runKeyboardCorePath(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop");
  await settle(cb.page);
  // Landing → courses via keyboard.
  const continueGuest = cb.page.getByRole("link", { name: "Continue as guest" });
  await continueGuest.focus({ timeout: 10_000 });
  await cb.page.keyboard.press("Enter");
  await cb.page.waitForURL("**/courses", { timeout: 30_000 });
  await settle(cb.page);

  // Courses → first Details link via keyboard.
  const code = await firstSearchedCode(cb.page);
  const details = courseRow(cb.page, code).getByRole("link", { name: "Details" }).first();
  await details.focus({ timeout: 10_000 });
  await cb.page.keyboard.press("Enter");
  await cb.page.waitForURL("**/courses/**", { timeout: 20_000 });
  await expectDetailNot404(cb.page, cb.page.url());

  // Detail → schedule via the nav (keyboard focus + Enter).
  const scheduleNav = cb.page.getByRole("link", { name: "Schedule", exact: true }).first();
  await scheduleNav.focus({ timeout: 10_000 });
  await cb.page.keyboard.press("Enter");
  await cb.page.waitForURL("**/schedule", { timeout: 20_000 });
  await screenshot(cb.page, ctx.runDir, caseId);
  await closeCase(cb);
  return { status: "pass", measured: "courses → detail → schedule completed with keyboard only" };
}

async function runFocusIndicator(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop", "/courses");
  await settle(cb.page);
  const search = cb.page.getByRole("textbox", { name: "Search courses" });
  await search.focus({ timeout: 10_000 });
  const style = await search.evaluate((el) => {
    const computed = getComputedStyle(el);
    return {
      outlineWidth: computed.outlineWidth,
      outlineStyle: computed.outlineStyle,
      boxShadow: computed.boxShadow,
    };
  });
  await screenshot(cb.page, ctx.runDir, caseId);
  await closeCase(cb);

  const visibleOutline =
    (style.outlineStyle !== "none" && style.outlineWidth !== "0px") || (style.boxShadow !== "none" && style.boxShadow !== "");
  if (!visibleOutline) {
    return {
      status: "fail",
      measured: JSON.stringify(style),
      note: "focused search control has no visible focus indicator (outline/box-shadow all none)",
    };
  }
  return { status: "pass", measured: `outline ${style.outlineStyle} ${style.outlineWidth}; boxShadow ${style.boxShadow.slice(0, 40)}` };
}

async function runReducedMotion(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop");
  await cb.page.emulateMedia({ reducedMotion: "reduce" });
  await cb.page.goto(`${ctx.frontendOrigin}/courses`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(cb.page, 1500);
  const running = await cb.page.evaluate(() => {
    return document
      .getAnimations()
      .filter((animation) => {
        const timing = animation.effect?.getTiming();
        const duration = typeof timing?.duration === "number" ? timing.duration : 0;
        const iterations = timing?.iterations ?? 1;
        return (duration > 200 || iterations === Infinity) && animation.playState === "running";
      }).length;
  });
  await screenshot(cb.page, ctx.runDir, caseId);
  await closeCase(cb);

  if (running > 0) {
    return {
      status: "fail",
      measured: `${running} long-running animations under prefers-reduced-motion: reduce`,
      note: "the page must respect reduced motion",
    };
  }
  return { status: "pass", measured: "0 long-running animations under prefers-reduced-motion: reduce" };
}

async function runNoHorizontalOverflow(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const failures: string[] = [];
  for (const path of ["/courses", "/schedule", "/map"]) {
    const cb = await openCase(ctx.frontendOrigin, "mobile", path);
    await settle(cb.page, 800);
    const overflow = await cb.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    await screenshot(cb.page, ctx.runDir, `${caseId}-${path.replace(/\//g, "")}`);
    await closeCase(cb);
    if (overflow.scrollWidth > overflow.clientWidth) {
      failures.push(`${path}: scrollWidth ${overflow.scrollWidth} > clientWidth ${overflow.clientWidth}`);
    }
  }
  if (failures.length > 0) {
    return { status: "fail", measured: failures.join("; "), note: "horizontal overflow at 390x844" };
  }
  return { status: "pass", measured: "no horizontal overflow at 390x844 on /courses, /schedule, /map" };
}

async function runImageIconLabeling(ctx: SuiteContext, caseId: string): Promise<CaseOutcome> {
  const cb = await openCase(ctx.frontendOrigin, "desktop", "/courses");
  await settle(cb.page);
  const labeling = await cb.page.evaluate(() => {
    const problems: string[] = [];
    for (const img of Array.from(document.querySelectorAll("img"))) {
      const alt = img.getAttribute("alt");
      if (alt === null) problems.push(`img without alt: ${img.src.slice(0, 60)}`);
      else if (alt.trim() === "" && img.getAttribute("role") !== "presentation" && img.getAttribute("aria-hidden") !== "true") {
        problems.push(`img with empty alt not marked decorative: ${img.src.slice(0, 60)}`);
      }
    }
    for (const icon of Array.from(document.querySelectorAll("svg"))) {
      const labelled =
        icon.getAttribute("aria-label") !== null || icon.getAttribute("aria-hidden") === "true" || icon.querySelector("title") !== null;
      if (!labelled) problems.push("svg icon without aria-label/aria-hidden/title");
    }
    return problems;
  });
  await screenshot(cb.page, ctx.runDir, caseId);
  await closeCase(cb);

  if (labeling.length > 0) {
    return { status: "fail", measured: `${labeling.length} labeling problems`, note: labeling.slice(0, 5).join("; ") };
  }
  return { status: "pass", measured: "all images have alt; icons are labelled or hidden" };
}

export default defineSuite({
  name: "a11y-polish",
  describe(): CaseSpec[] {
    return CASES;
  },
  async run(caseId, ctx): Promise<CaseOutcome> {
    try {
      if (caseId.startsWith("a11y/axe-")) return await runAxeCase(ctx, caseId);
      switch (caseId) {
        case "a11y/keyboard-core-path":
          return await runKeyboardCorePath(ctx, caseId);
        case "a11y/focus-indicator":
          return await runFocusIndicator(ctx, caseId);
        case "a11y/reduced-motion":
          return await runReducedMotion(ctx, caseId);
        case "a11y/no-horizontal-overflow-mobile":
          return await runNoHorizontalOverflow(ctx, caseId);
        case "a11y/image-icon-labeling":
          return await runImageIconLabeling(ctx, caseId);
        default:
          throw new Error(`a11y: unrecognized case id ${caseId}`);
      }
    } catch (error) {
      return { status: "fail", note: `case threw: ${error instanceof Error ? error.message : String(error)}` };
    }
  },
  caseTimeoutMs: 240_000,
});
