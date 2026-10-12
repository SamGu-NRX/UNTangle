#!/usr/bin/env bun
/** M5 browser evidence: planner save lifecycle, guest persistence, cross-tab
 * conflicts, denied-storage honesty, keyboard export, stale-section restore
 * warnings, reduced motion, and mobile overflow — over the production build. */
import { chromium } from "playwright";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

// Paths default to the original sandbox layout; override them to run elsewhere.
const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3100";
const OUT = process.env.UNTANGLE_M5_OUT ?? "/home/user/work/untangle-plan-library/output/playwright/planner-m5";
const REPORT = process.env.UNTANGLE_M5_REPORT ?? "/home/user/work/e2e/untangle-planner-m5-report.json";
const AXE_PATH = process.env.UNTANGLE_AXE_PATH ?? "/home/user/work/e2e/node_modules/axe-core/axe.min.js";
mkdirSync(OUT, { recursive: true });

const results = { startedAt: new Date().toISOString(), checks: [], notes: [], axe: [] };
const check = (name, passed, detail) => {
  results.checks.push({ name, passed: !!passed, detail: detail ?? null });
  console.log(`check ${name}: ${passed ? "PASS" : "FAIL"}${detail ? ` (${detail})` : ""}`);
};
const note = (m) => { results.notes.push(m); console.log(`note: ${m}`); };
const shoot = async (page, name) => {
  await page.screenshot({ path: `${OUT}/${name}`, animations: "disabled" });
  console.log(`shot: ${name}`);
};
const axeSource = readFileSync(AXE_PATH, "utf8");
// Any serious or critical violation fails the run; minor and moderate ones
// are recorded in the report.
const axeScan = async (page, label) => {
  await page.addScriptTag({ content: axeSource });
  const r = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const v = r.violations.map((x) => `${x.id} (${x.impact}) x${x.nodes.length}`);
  const blocking = r.violations.filter((x) => x.impact === "serious" || x.impact === "critical");
  results.axe.push({ label, passes: r.passes.length, violations: v });
  console.log(`axe [${label}]: ${r.passes.length} passes, ${r.violations.length} violations${v.length ? ` :: ${v.join(", ")}` : ""}`);
  check(`axeNoSeriousOrCritical: ${label}`, blocking.length === 0, blocking.map((x) => x.id).join(", ") || null);
};

const bodyText = (page) => page.evaluate(() => document.body.innerText);
const activeOptimization = (page) =>
  page.evaluate(() => {
    const label = (row) => (row?.textContent ?? "").trim().split("\n")[0].trim();
    const rows = [...document.querySelectorAll(".opt-row")];
    const hit = rows.find(
      (r) => r.dataset.active === "true" || r.getAttribute("aria-pressed") === "true" || /\bactive\b/.test(r.className),
    );
    return hit ? label(hit) : null;
  });
const listOptimizations = (page) =>
  page.evaluate(() => {
    const label = (row) => (row?.textContent ?? "").trim().split("\n")[0].trim();
    return [...document.querySelectorAll(".opt-row")].map(label).filter(Boolean);
  });

async function pickPair(page) {
  const active = await activeOptimization(page);
  const labels = await listOptimizations(page);
  const free = labels.filter((l) => l !== active);
  if (free.length < 2) throw new Error(`need two inactive options, have: ${labels.join(", ")} (active: ${active})`);
  return [free[0], free[1]];
}

async function clickOptimization(page, label) {
  for (let i = 0; i < 4; i++) {
    try {
      await page.locator(".opt-row", { hasText: label }).first().click({ timeout: 4000 });
      const deadline = Date.now() + 1200;
      while (Date.now() < deadline) {
        if ((await activeOptimization(page)) === label) return;
        await page.waitForTimeout(120);
      }
    } catch {
      /* retry */
    }
  }
  throw new Error(`clickOptimization failed for "${label}"`);
}

async function rawClickUntilActive(page, label) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.locator(".opt-row", { hasText: label }).first().click();
    const deadline = Date.now() + 700;
    while (Date.now() < deadline) {
      if ((await activeOptimization(page)) === label) return;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  throw new Error(`raw click on "${label}" never activated the row`);
}

// The save-state label must read exactly "Saved". Matching the word "saved"
// anywhere on the page also matched "Not saved…" and "Not saved yet".
const saveLabel = (page) =>
  page.evaluate(
    () => document.querySelector('[role="status"][aria-label="Save state"] strong')?.textContent?.trim() ?? null,
  );
async function waitForSavedStatus(page, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await saveLabel(page)) === "Saved") return true;
    await page.waitForTimeout(250);
  }
  return false;
}

async function clickSaveIfPresent(page) {
  try {
    const btn = page.getByRole("button", { name: /save/i }).first();
    await btn.waitFor({ state: "visible", timeout: 2500 });
    await btn.click({ timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

async function waitForConflict(pages, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const p of pages) {
      if (await p.evaluate(() => /conflict/i.test(document.body.innerText))) return p;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no tab showed the conflict dialog");
}

async function adoptNewerInDialog(page) {
  const buttons = page.getByRole("button");
  const n = await buttons.count();
  const texts = await Promise.all([...Array(n)].map((_, i) => buttons.nth(i).innerText().catch(() => "")));
  const adoptIdx = texts.findIndex((t) => /use their|use the newer|use newer|load their|adopt/i.test(t));
  const target = adoptIdx >= 0 ? buttons.nth(adoptIdx) : buttons.nth(n - 1);
  note(`conflict resolution button: "${(adoptIdx >= 0 ? texts[adoptIdx] : texts[n - 1] ?? "").trim()}"`);
  await target.click();
}

const browser = await chromium.launch();

// Scenario 1-3: guest save/round-trip, clean-tab adoption, cross-tab conflict
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const pageA = await ctx.newPage();
  const pageB = await ctx.newPage();
  await pageA.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await pageB.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await pageA.waitForTimeout(900);
  await shoot(pageA, "schedule-desktop-before-save.png");

  const [guestChoice] = await pickPair(pageA);
  await clickOptimization(pageA, guestChoice);
  await clickSaveIfPresent(pageA);
  check("guestSaveAcknowledged", await waitForSavedStatus(pageA));
  await pageA.reload({ waitUntil: "networkidle" });
  await pageA.waitForTimeout(600);
  check("guestSaveSurvivesReload", (await activeOptimization(pageA)) === guestChoice);
  await shoot(pageA, "schedule-desktop-after-reload.png");

  await pageB.getByText(/newer/i).first().waitFor({ timeout: 8000 }).catch(() => {});
  let cleanAdopted = false;
  {
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if ((await activeOptimization(pageB)) === guestChoice) { cleanAdopted = true; break; }
      await pageB.waitForTimeout(250);
    }
  }
  check("cleanTabAdoptsNewerVersion", cleanAdopted, `choice=${guestChoice}`);
  await shoot(pageB, "schedule-clean-tab-notice.png");

  const stageAndResolve = async () => {
    await pageA.reload({ waitUntil: "networkidle" });
    await pageB.reload({ waitUntil: "networkidle" });
    await waitForSavedStatus(pageA);
    await waitForSavedStatus(pageB);
    await pageA.waitForTimeout(900);
    const [aLabel, bLabel] = await pickPair(pageA);
    await rawClickUntilActive(pageA, aLabel);
    await rawClickUntilActive(pageB, bLabel);
    return waitForConflict([pageA, pageB], 12000).then((p) => ({ p, aLabel }));
  };

  let conflict = null;
  for (let attempt = 1; attempt <= 3 && !conflict; attempt++) {
    try {
      conflict = await stageAndResolve();
    } catch (e) {
      note(`conflict attempt ${attempt}: ${e.message}`);
      if (attempt === 3) throw e;
    }
  }
  check("crossTabConflictDialogShown", !!conflict);
  await shoot(conflict.p, "schedule-conflict-dialog.png");
  await adoptNewerInDialog(conflict.p);
  await pageA.waitForTimeout(900);
  const optA = await activeOptimization(pageA);
  const optB = await activeOptimization(pageB);
  check("conflictResolutionAdoptsNewer", optA === conflict.aLabel && optB === conflict.aLabel, `A=${optA} B=${optB}`);
  check("conflictVersionsMatchAcrossTabs", !!optA && optA === optB);
  await shoot(pageA, "schedule-conflict-resolved.png");
  await axeScan(pageA, "desktop: schedule after conflict resolution");
  await ctx.close();
}

// Scenario 4: denied storage — honest status, export still offered
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("quota", "QuotaExceededError"); };
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const [choice] = await pickPair(page);
  await clickOptimization(page, choice);
  let honest = false;
  const deadline = Date.now() + 6000;
  while (Date.now() < deadline) {
    const t = await bodyText(page);
    if (/not being saved|storage.*(unavailable|full|denied)|couldn.?t save|cannot save|won.?t be saved/i.test(t)) { honest = true; break; }
    await page.waitForTimeout(300);
  }
  check("deniedStorageHonestStatus", honest);
  const exportOffered = await page.getByRole("button", { name: /export/i }).first().isVisible().catch(() => false);
  check("deniedStorageExportOffered", exportOffered);
  await shoot(page, "schedule-storage-denied.png");
  await ctx.close();
}

// Scenario 5: keyboard reaches export and downloads a plan file
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) {
    await page.keyboard.press("Tab");
    reached = await page.evaluate(() => {
      const el = document.activeElement;
      return el?.tagName === "BUTTON" && /export/i.test(el.textContent ?? "");
    });
  }
  check("keyboardReachesExport", reached);
  if (reached) {
    try {
      const dl = page.waitForEvent("download", { timeout: 6000 });
      await page.keyboard.press("Enter");
      await dl;
      check("keyboardExportDownloadsPlan", true);
    } catch {
      check("keyboardExportDownloadsPlan", false, "no download event");
    }
  } else {
    check("keyboardExportDownloadsPlan", false, "export never focused");
  }
  await ctx.close();
}

// Scenario 6: plans library — stale-section restore warnings end to end
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const [choice] = await pickPair(page);
  await clickOptimization(page, choice);

  // Library entries are created on /plans via the named-save form.
  await page.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await page.locator("#save-plan-name").waitFor({ timeout: 8000 });
  await page.locator("#save-plan-name").fill("M5 guest plan");
  await page.getByRole("button", { name: "Save current schedule" }).click();
  await page.getByText("M5 guest plan").first().waitFor({ timeout: 6000 });
  const planName = "M5 guest plan";
  check("planListedFromGuestSave", true, planName);
  const card = page.locator("li", { hasText: planName }).first();
  const dl = page.waitForEvent("download", { timeout: 6000 });
  await card.getByRole("button", { name: "Export", exact: true }).click();
  const download = await dl;
  const exportPath = `/tmp/${download.suggestedFilename() || "plan-export.json"}`;
  await download.saveAs(exportPath);

  const payload = JSON.parse(readFileSync(exportPath, "utf8"));
  payload.name = "M5 stale draft";
  payload.state = payload.state ?? {};
  payload.state.selectedSections = {
    ...(payload.state.selectedSections ?? {}),
    "MATH-FAKE-001": "STALE-SECTION-0000",
  };
  const doctoredPath = "/tmp/stale-plan.json";
  writeFileSync(doctoredPath, JSON.stringify(payload, null, 2));

  await page.getByLabel("Import a saved-plan JSON file").setInputFiles(doctoredPath);
  await page.getByText("M5 stale draft").first().waitFor({ timeout: 5000 });
  check("importedStalePlanListed", true);

  const staleCard = page.locator("li", { hasText: "M5 stale draft" });
  await staleCard.getByRole("button", { name: "Preview restore" }).click();
  await page.getByRole("button", { name: "Restore this plan" }).waitFor({ timeout: 5000 });
  const previewText = await bodyText(page);
  check("restorePreviewWarnsStale", previewText.includes("will not carry over") && previewText.includes("saved section"));
  await shoot(page, "restore-preview-warnings.png");
  await axeScan(page, "desktop: restore preview with warnings");

  await page.getByRole("button", { name: "Restore this plan" }).click();
  await page.waitForURL(/\/schedule/, { timeout: 8000 });
  await page.waitForTimeout(700);
  const afterText = await bodyText(page);
  check("restoreSkipsStaleReferences", afterText.includes("no longer resolve and were skipped"));
  await shoot(page, "schedule-after-stale-restore.png");
  await ctx.close();
}

// Scenario 7: reduced motion — restore preview opens, conflict still surfaces
{
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    reducedMotion: "reduce",
  });
  const pageP = await ctx.newPage();
  await pageP.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await pageP.waitForTimeout(900);
  const [rmChoice] = await pickPair(pageP);
  await clickOptimization(pageP, rmChoice);

  await pageP.goto(`${BASE}/plans`, { waitUntil: "networkidle" });
  await pageP.locator("#save-plan-name").waitFor({ timeout: 8000 });
  await pageP.locator("#save-plan-name").fill("M5 RM plan");
  await pageP.getByRole("button", { name: "Save current schedule" }).click();
  await pageP.getByText("M5 RM plan").first().waitFor({ timeout: 6000 });
  const rmCard = pageP.locator("li", { hasText: "M5 RM plan" }).first();
  await rmCard.getByRole("button", { name: "Preview restore" }).click();
  await pageP.getByRole("button", { name: "Restore this plan" }).waitFor({ timeout: 5000 });
  check("reducedMotionPreviewOpens", true);
  await shoot(pageP, "reduced-motion-preview.png");
  await pageP.keyboard.press("Escape").catch(() => {});

  const pageA0 = await ctx.newPage();
  const pageB0 = await ctx.newPage();
  await pageA0.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await pageB0.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await pageA0.waitForTimeout(900);

  const rmStage = async () => {
    const [aLabel, bLabel] = await pickPair(pageA0);
    await rawClickUntilActive(pageA0, aLabel);
    await rawClickUntilActive(pageB0, bLabel);
    return waitForConflict([pageA0, pageB0], 12000).then((p) => ({ p, aLabel }));
  };
  let rmConflict = null;
  for (let attempt = 1; attempt <= 2 && !rmConflict; attempt++) {
    try {
      rmConflict = await rmStage();
    } catch (e) {
      note(`reduced-motion conflict attempt ${attempt}: ${e.message}`);
      if (attempt === 2) throw e;
      await pageA0.reload({ waitUntil: "networkidle" });
      await pageB0.reload({ waitUntil: "networkidle" });
      await pageA0.waitForTimeout(900);
    }
  }
  check("reducedMotionConflictOpens", !!rmConflict);
  await shoot(rmConflict.p, "reduced-motion-conflict.png");
  await ctx.close();
}

// Scenario 8: mobile 390x844 — schedule renders without horizontal overflow
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/schedule`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  check("mobileScheduleNoOverflow", scrollW <= 392, `scrollWidth=${scrollW}`);
  await shoot(page, "schedule-mobile.png");
  await axeScan(page, "mobile: schedule");
  await ctx.close();
}

await browser.close();

results.finishedAt = new Date().toISOString();
const failed = results.checks.filter((c) => !c.passed);
writeFileSync(REPORT, JSON.stringify(results, null, 2));
console.log(`SUMMARY ${results.checks.length - failed.length}/${results.checks.length} checks passed`);
if (failed.length) console.log(`FAILED: ${failed.map((f) => f.name).join(", ")}`);
process.exit(failed.length ? 1 : 0);
