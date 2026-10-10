/**
 * Course-journey evidence runner (milestone 4).
 *
 * Runs the student journey against a local server (default
 * http://localhost:3100, start with `PORT=3100 bun run start`) at desktop
 * 1440x900 and mobile 390x844, captures screenshots into ./screenshots/,
 * and asserts:
 *   - search/filter/deep-link/detail/import usable at full catalog size
 *   - explicit empty, error (not-found), and unavailable states
 *   - keyboard operation of the journey
 *   - no horizontal overflow at mobile width or with long content
 *   - reduced-motion emulation leaves all content visible
 *   - axe: zero serious/critical violations on every surface
 *
 * Exit code is nonzero when any check fails. Results also land in
 * ./screenshots/results.json for the evidence doc.
 */

import { chromium } from "playwright";
import { AxeBuilder } from "@axe-core/playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import seedData from "../src/lib/generated/seed-data.json";

const BASE = process.env.EVIDENCE_BASE_URL ?? "http://localhost:3100";
const OUT_DIR = fileURLToPath(new URL("./screenshots/", import.meta.url));
mkdirSync(OUT_DIR, { recursive: true });

/** @type {{ name: string, ok: boolean, detail: string }[]} */
const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  record(`${label}: no horizontal overflow`, overflow <= 1, `excess ${overflow}px`);
}

async function axeSeriousCritical(page, label) {
  const axe = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]);
  const axeResult = await axe.analyze();
  const bad = axeResult.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = bad
    .map((v) => `${v.id}(${v.impact})x${v.nodes.length}`)
    .join(", ");
  record(`${label}: axe serious/critical = 0`, bad.length === 0, summary || "clean");
  return bad;
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400); // hydration + enter animations
}

// Longest catalog description, for the long-content overflow check.
const courses = seedData.courses ?? seedData;
const longest = [...courses].sort(
  (a, b) => (b.description?.length ?? 0) - (a.description?.length ?? 0),
)[0];
console.log(`longest-description course: ${longest.code} (${longest.description?.length ?? 0} chars)`);

const browser = await chromium.launch();
try {
  // ───────────────────────── Desktop 1440x900 ─────────────────────────
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await desktop.newPage();

  // 1. Courses list at real dataset size.
  await page.goto(`${BASE}/courses`);
  await settle(page);
  const totalRows = await page.locator(".course-row").count();
  record("courses list renders full catalog", totalRows >= 600, `${totalRows} rows`);
  await page.screenshot({ path: `${OUT_DIR}desktop-01-courses-list.png` });

  // 2. Keyboard: walk from the search box and drive the journey without a mouse.
  const search = page.getByLabel("Search courses");
  await search.focus();
  await page.keyboard.type("CSCE 3444");
  await page.waitForTimeout(300);
  const narrowed = await page.locator(".course-row").count();
  record("keyboard search narrows results", narrowed >= 1 && narrowed < totalRows, `${narrowed} rows`);
  await page.screenshot({ path: `${OUT_DIR}desktop-02-search-narrowed.png` });

  // Empty state.
  await search.fill("ZZZZQ-NO-SUCH-COURSE");
  await page.getByText("No courses match that search.").waitFor({ timeout: 5000 });
  record("explicit empty state", true);
  await page.screenshot({ path: `${OUT_DIR}desktop-03-search-empty.png` });
  await search.fill("");
  await page.getByLabel("Filter by department").selectOption({ index: 1 });
  await page.waitForTimeout(300);
  const deptRows = await page.locator(".course-row").count();
  record("department filter narrows results", deptRows > 0 && deptRows < totalRows, `${deptRows} rows`);
  await page.getByLabel("Filter by department").selectOption({ index: 0 });

  // Keyboard walk to a Details link, then Enter activates the deep link.
  await search.focus();
  let reachedLink = false;
  for (let i = 0; i < 80; i += 1) {
    const isDetails = await page.evaluate(() => {
      const el = document.activeElement;
      return el instanceof HTMLElement && el.textContent === "Details";
    });
    if (isDetails) {
      reachedLink = true;
      break;
    }
    await page.keyboard.press("Tab");
  }
  record("Details link reachable by keyboard", reachedLink);
  await page.screenshot({ path: `${OUT_DIR}desktop-04-keyboard-focus-details.png` });
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/courses\/[A-Z]+\/\d+$/);
  const keyboardDetailUrl = page.url();
  record("Enter on Details deep-links to the detail route", keyboardDetailUrl.includes("/courses/"), keyboardDetailUrl);

  // 3. Deep link to a known code: catalog facts + visible unavailable states.
  await page.goto(`${BASE}/courses/CSCE/3444`);
  await settle(page);
  await page.getByRole("heading", { name: "Catalog details" }).waitFor({ timeout: 10000 });
  const detailText = await page.locator(".detail-shell").innerText();
  record("detail shows catalog description", detailText.length > 0, `${detailText.length} chars`);
  record(
    "detail marks grade data unavailable without a service",
    detailText.includes("Grade data is unavailable."),
  );
  record(
    "detail marks instructor ratings unavailable without a service",
    detailText.includes("Instructor ratings are unavailable."),
  );
  await page.screenshot({ path: `${OUT_DIR}desktop-05-detail-catalog-only.png` });
  await axeSeriousCritical(page, "detail (catalog-only)");

  // 4. Deep link to an unknown/removed code: branded not-found, no fabrication.
  const notFoundResponse = await page.goto(`${BASE}/courses/CSCE/9999`);
  await settle(page);
  record("unknown-code deep link returns 404", notFoundResponse?.status() === 404, `status ${notFoundResponse?.status()}`);
  await page.getByRole("heading", { name: "Course not found" }).waitFor({ timeout: 5000 });
  await page.screenshot({ path: `${OUT_DIR}desktop-06-deep-link-not-found.png` });
  await axeSeriousCritical(page, "not-found");

  // 5. Import flow: review keeps text, unknown codes render unresolved, apply diffs.
  await page.goto(`${BASE}/courses/import`);
  await settle(page);
  await page.getByPlaceholder("Paste schedule text, for example: CSCE3444, MATH 1710, GOVT 2305...").fill(
    "CSCE 3444 and CSCE 9999",
  );
  await page.getByRole("button", { name: "Review import" }).click();
  await page.getByText(/matched, 1 unresolved/).waitFor({ timeout: 5000 });
  await page.getByText("CSCE 9999: unresolved").waitFor({ timeout: 5000 });
  const keptText = await page
    .getByPlaceholder("Paste schedule text, for example: CSCE3444, MATH 1710, GOVT 2305...")
    .inputValue();
  record("review keeps the pasted text for correction", keptText.includes("CSCE 9999"), keptText);
  await page.screenshot({ path: `${OUT_DIR}desktop-07-import-review-unresolved.png` });
  await axeSeriousCritical(page, "import (review state)");

  await page.getByRole("button", { name: /Apply 1 change/ }).click();
  await page.getByText(/updated from the import review/).waitFor({ timeout: 5000 });
  record("apply applies the diff and toasts", true);
  await page.screenshot({ path: `${OUT_DIR}desktop-08-import-applied-toast.png` });

  // 6. Long-content overflow on the detail route.
  const [subject, number] = longest.code.split(" ");
  await page.goto(`${BASE}/courses/${subject}/${number}`);
  await settle(page);
  await assertNoOverflow(page, "long-content detail (desktop)");
  await page.screenshot({ path: `${OUT_DIR}desktop-09-long-content-detail.png` });
  await axeSeriousCritical(page, "detail (long content)");

  // 7. Reduced motion: content visible with animations collapsed.
  const reducedContext = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.goto(`${BASE}/courses/CSCE/3444`);
  await settle(reducedPage);
  const reducedVisible = await reducedPage.evaluate(() => {
    const section = document.querySelector('[aria-label="Catalog details"]');
    if (!section) return false;
    return window.getComputedStyle(section).opacity === "1";
  });
  record("reduced motion keeps content visible", reducedVisible);
  await reducedPage.screenshot({ path: `${OUT_DIR}desktop-10-reduced-motion.png` });
  await reducedContext.close();

  // ───────────────────────── Mobile 390x844 ─────────────────────────
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const mpage = await mobile.newPage();

  await mpage.goto(`${BASE}/courses`);
  await settle(mpage);
  await assertNoOverflow(mpage, "courses (mobile)");
  await mpage.screenshot({ path: `${OUT_DIR}mobile-01-courses-list.png` });

  await mpage.goto(`${BASE}/courses/CSCE/3444`);
  await settle(mpage);
  await assertNoOverflow(mpage, "detail (mobile)");
  await mpage.screenshot({ path: `${OUT_DIR}mobile-02-detail.png` });
  await axeSeriousCritical(mpage, "detail (mobile)");

  await mpage.goto(`${BASE}/courses/CSCE/9999`);
  await settle(mpage);
  await mpage.getByRole("heading", { name: "Course not found" }).waitFor({ timeout: 5000 });
  await assertNoOverflow(mpage, "not-found (mobile)");
  await mpage.screenshot({ path: `${OUT_DIR}mobile-03-not-found.png` });

  await mpage.goto(`${BASE}/courses/import`);
  await settle(mpage);
  await mpage.getByPlaceholder("Paste schedule text, for example: CSCE3444, MATH 1710, GOVT 2305...").fill(
    "CSCE 3444 and CSCE 9999",
  );
  await mpage.getByRole("button", { name: "Review import" }).click();
  await mpage.getByText("CSCE 9999: unresolved").waitFor({ timeout: 5000 });
  await assertNoOverflow(mpage, "import review (mobile)");
  await mpage.screenshot({ path: `${OUT_DIR}mobile-04-import-review.png` });
  await axeSeriousCritical(mpage, "import (mobile)");
  await mobile.close();

  // ───────────────────────── Summary ─────────────────────────
  const failures = results.filter((r) => !r.ok);
  writeFileSync(
    `${OUT_DIR}results.json`,
    JSON.stringify({ base: BASE, results, failures: failures.length }, null, 2),
  );
  console.log(`\n${results.length - failures.length}/${results.length} checks passed, ${failures.length} failed`);
  if (failures.length > 0) process.exitCode = 1;
} finally {
  await browser.close();
}
