/**
 * M4 browser evidence for the UNTangle saved-plan library (/plans).
 * Runs against the production build served at 127.0.0.1:3100. No real user
 * data: the working schedule is the app's own seeded default state; the saved
 * plan library is browser-local to the fresh contexts created here, and every
 * context saves its plan through the real UI.
 *
 * Evidence: desktop + mobile screenshots, axe-core scans, keyboard walk,
 * export round-trip, unsupported-version import rejection, drift fixture,
 * console-error capture. Report JSON lands in /home/user/work/e2e/.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const axeSource = readFileSync("/home/user/work/e2e/node_modules/axe-core/axe.js", "utf8");
const BASE = "http://127.0.0.1:3100";
const OUT = "/home/user/work/untangle-plan-library/output/playwright/plans-m4";
const REPORT = "/home/user/work/e2e/untangle-plans-m4-report.json";
const PLAN_NAME = "M4 evidence draft";

mkdirSync(OUT, { recursive: true });

const results = {
  startedAt: new Date().toISOString(),
  base: BASE,
  screenshots: [],
  axe: [],
  checks: {},
  consoleErrors: [],
  notes: [],
};

const browser = await chromium.launch();

async function newPage(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => results.consoleErrors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error") results.consoleErrors.push(m.text());
  });
  return { ctx, page };
}

async function axeScan(page, label) {
  await page.addScriptTag({ content: axeSource });
  const axe = await page.evaluate(() =>
    window.axe.run(document, { resultTypes: ["violations", "incomplete"] }),
  );
  const entry = {
    label,
    violations: axe.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.length,
      sample: v.nodes.slice(0, 3).map((n) => n.target.join(" ")),
    })),
    incomplete: axe.incomplete.map((v) => ({ id: v.id, nodes: v.nodes.length })),
    passes: axe.passes.length,
  };
  results.axe.push(entry);
  console.log(`axe [${label}]: ${entry.passes} passes, ${entry.violations.length} violations`);
  for (const v of entry.violations) {
    console.log(`  VIOLATION ${v.impact ?? "?"} ${v.id} x${v.nodes}: ${(v.sample ?? []).join(" | ")}`);
  }
  return entry;
}

async function shoot(page, file) {
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  results.screenshots.push(file);
  console.log(`shot: ${file}`);
}

/** Saves a plan through the real UI (fresh contexts start with an empty library). */
async function saveViaUi(page, name) {
  const nameInput = page.getByPlaceholder("e.g. Fall finals week");
  // The hydration swap (loading → ready) can detach nodes mid-action; retry.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await nameInput.waitFor({ state: "attached", timeout: 3000 });
      await nameInput.scrollIntoViewIfNeeded();
      await nameInput.fill(name);
      await page.getByRole("button", { name: "Save current schedule" }).click();
      await page.getByText(name).first().waitFor({ timeout: 5000 });
      return;
    } catch (e) {
      if (attempt === 2) throw e;
      await page.waitForTimeout(600);
    }
  }
}

/* ---------------- desktop: save via keyboard, compare, export ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await shoot(page, "plans-desktop-initial.png");

  // Keyboard walk: focus the name input, fill, Tab to Save, Enter.
  const nameInput = page.getByPlaceholder("e.g. Fall finals week");
  await nameInput.click();
  await nameInput.fill(PLAN_NAME);
  await page.keyboard.press("Tab");
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
  results.checks.keyboardTabReachesSaveButton = focused === "Save current schedule";
  await page.keyboard.press("Enter");
  await page.getByText(PLAN_NAME).first().waitFor({ timeout: 5000 });
  results.checks.savedPlanListed = await page.getByText(PLAN_NAME).first().isVisible();
  await shoot(page, "plans-desktop-after-save.png");

  // Compare panel
  await page.getByRole("button", { name: "Compare with working schedule" }).click();
  await page.waitForTimeout(200);
  const comparePanel = page.locator("[id^=plan-compare-]").first();
  results.checks.comparePanelVisible = await comparePanel.isVisible().catch(() => false);
  const compareText = await page.locator("body").innerText();
  results.checks.compareShowsNoChanges =
    compareText.includes("fields match the working schedule") &&
    !compareText.includes("differ");
  await shoot(page, "compare-open-desktop.png");
  await axeScan(page, "desktop: compare open");
  await page.getByRole("button", { name: "Hide comparison" }).click();

  // Export through the UI download path, then parse the file.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }),
    page.getByRole("button", { name: "Export", exact: true }).click(),
  ]);
  const exportPath = `${OUT}/exported-plan.json`;
  await download.saveAs(exportPath);
  const exported = JSON.parse(readFileSync(exportPath, "utf8"));
  results.checks.exportSchemaVersion = exported.schemaVersion;
  results.checks.exportName = exported.name;
  results.checks.exportFileName = download.suggestedFilename();

  // Restore preview on the unchanged working schedule (no drift expected).
  await page.getByRole("button", { name: "Preview restore" }).click();
  await page.waitForTimeout(200);
  const previewText = await page.locator("body").innerText();
  results.checks.previewListsSteps = previewText.includes("Restore this plan");
  results.checks.previewNoDrift = !previewText.includes("changed since this plan was saved");
  await shoot(page, "restore-preview-desktop.png");
  await axeScan(page, "desktop: restore preview open");
  await page.getByRole("button", { name: "Cancel" }).click();
  await ctx.close();
}

/* ---------------- drift: patch working state, preview shows drift, restore ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await saveViaUi(page, PLAN_NAME);

  // Fixture: take the app's own captured working state from the exported plan,
  // flip the optimization preference, and load it through the app's
  // sessionStorage rehydration contract.
  const exported = JSON.parse(readFileSync(`${OUT}/exported-plan.json`, "utf8"));
  const savedOptimization = exported.state.optimization;
  const driftedOptimization = savedOptimization === "compact" ? "clusterNight" : "compact";
  const state = { ...exported.state, optimization: driftedOptimization };
  const key = "untangle-planner-state";
  await page.evaluate(
    ([k, v]) => window.sessionStorage.setItem(k, v),
    [key, JSON.stringify(state)],
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  await page.getByText(PLAN_NAME).first().waitFor({ timeout: 5000 });

  await page.getByRole("button", { name: "Preview restore" }).click();
  await page.waitForTimeout(200);
  const previewText = await page.locator("body").innerText();
  results.checks.previewShowsDrift = previewText.includes("changed since this plan was saved");
  await shoot(page, "restore-preview-drift-desktop.png");

  // Confirm the restore: the working preference returns to the saved one.
  // The provider persists on a 350ms debounce — poll rather than read once.
  await page.getByRole("button", { name: "Restore this plan" }).click();
  let restored = null;
  for (let attempt = 0; attempt < 10 && !restored; attempt++) {
    await page.waitForTimeout(350);
    const current = await page.evaluate(
      (k) => JSON.parse(window.sessionStorage.getItem(k) ?? "null"),
      key,
    );
    if (current) {
      restored = current;
      if (current.optimization === savedOptimization) break;
    }
  }
  results.checks.restoreAppliedPreference = restored
    ? restored.optimization === savedOptimization
    : false;
  await shoot(page, "plans-desktop-after-restore.png");
  await ctx.close();
}

/* ---------------- import: unsupported version rejected ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const exported = JSON.parse(readFileSync(`${OUT}/exported-plan.json`, "utf8"));
  const doctored = { ...exported, schemaVersion: 999 };
  const doctoredPath = "/home/user/work/e2e/m4-doctored-plan.json";
  writeFileSync(doctoredPath, JSON.stringify(doctored));

  await page.getByLabel("Import a saved-plan JSON file").setInputFiles(doctoredPath);
  await page.waitForTimeout(400);
  const bodyText = await page.locator("body").innerText();
  results.checks.importUnsupportedVersionRejected =
    bodyText.toLowerCase().includes("unsupported") || bodyText.toLowerCase().includes("schema");
  results.checks.doctoredPlanNotListed =
    (await page.getByText("M4 evidence draft").first().isVisible().catch(() => false)) === false;
  await shoot(page, "import-rejected-desktop.png");
  await ctx.close();
}

/* ---------------- archive / duplicate / rename ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await saveViaUi(page, PLAN_NAME);

  await page.getByRole("button", { name: "Duplicate" }).click();
  await page.waitForTimeout(300);
  const dupText = await page.locator("body").innerText();
  results.checks.duplicateListed = /M4 evidence draft \(copy|Copy of M4 evidence draft/i.test(dupText);

  // Two plans exist now (the original plus its copy) — scope to the first card.
  await page.getByRole("button", { name: "Archive" }).first().click();
  await page.waitForTimeout(300);
  results.checks.archivedBadge = await page.getByText("Archived", { exact: true }).first().isVisible().catch(() => false);
  await shoot(page, "archived-desktop.png");

  await page.getByRole("button", { name: "Reopen" }).click();
  await page.waitForTimeout(300);
  results.checks.reopened = !(await page.getByText("Archived", { exact: true }).first().isVisible().catch(() => false));

  const renameInput = page.getByLabel(/^Rename /).first();
  await renameInput.fill("M4 renamed plan");
  await renameInput.press("Enter");
  await page.waitForTimeout(300);
  results.checks.renamed = await page.getByText("M4 renamed plan").first().isVisible().catch(() => false);
  await shoot(page, "renamed-desktop.png");
  await ctx.close();
}

/* ---------------- mobile: full flow + overflow + axe ---------------- */
{
  const { ctx, page } = await newPage({ width: 390, height: 844 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  await shoot(page, "plans-mobile-initial.png");

  await saveViaUi(page, "Mobile draft");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  results.checks.mobileHorizontalOverflowPx = overflow;
  await shoot(page, "plans-mobile-after-save.png");

  await page.getByRole("button", { name: "Preview restore" }).click();
  await page.waitForTimeout(200);
  await shoot(page, "restore-preview-mobile.png");
  await axeScan(page, "mobile: restore preview open");
  await page.getByRole("button", { name: "Cancel" }).click();
  await page.waitForTimeout(400);

  await axeScan(page, "mobile: plans list");
  await ctx.close();
}

/* ---------------- reduced motion: preview opens with reduce ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 }, { reducedMotion: "reduce" });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await saveViaUi(page, PLAN_NAME);
  await page.getByRole("button", { name: "Preview restore" }).click();
  await page.waitForTimeout(200);
  results.checks.reducedMotionPreviewOpens = await page
    .getByRole("button", { name: "Restore this plan" })
    .isVisible();
  await shoot(page, "restore-preview-reduced-motion.png");
  await ctx.close();
}

/* ---------------- desktop list axe (fresh empty context) ---------------- */
{
  const { ctx, page } = await newPage({ width: 1440, height: 900 });
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  await axeScan(page, "desktop: plans list (fresh context)");
  await ctx.close();
}

await browser.close();

results.finishedAt = new Date().toISOString();
writeFileSync(REPORT, JSON.stringify(results, null, 2));
console.log(`\nreport: ${REPORT}`);
console.log(`screenshots: ${OUT}`);
const failed = Object.entries(results.checks).filter(
  ([k, v]) => typeof v === "boolean" && !v,
);
console.log(failed.length ? `FAILED CHECKS: ${failed.map(([k]) => k).join(", ")}` : "all boolean checks passed");
console.log(`console errors: ${results.consoleErrors.length}`);
