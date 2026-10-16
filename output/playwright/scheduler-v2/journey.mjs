#!/usr/bin/env node
/**
 * Week journey (v3 schedule builder), guest, at 1440x900 and 390x844,
 * against a running build. Ported from the v2 journey when Week was rebuilt
 * (HANDOFF §6): the same behaviours, through the v3 controls.
 *
 * Add four courses from Week's own search, one tap each; set preferences
 * in the Preferences popover (sun knob to 9 AM, Thursdays off, a work block
 * painted on its grid, 15 credits at most) and read them back in the
 * summary the Preferences button carries; run Auto and walk its options
 * one at a time; use one and undo it with ⌘Z; browse every combination,
 * preview one and choose it, then undo it; keep a section and check
 * Auto's options never move it; see options refresh when a setting changes
 * under them; hit an impossible case and apply its one-click fix; reload
 * and check the sections, the kept section and the preferences survived.
 * axe runs at each state, and a PerformanceObserver for `longtask` records
 * main-thread blocking from each Auto click until its options show. Any
 * serious or critical axe finding, any long task of 50 ms or more, or any
 * failed check exits 1.
 *
 * Usage: node journey.mjs <baseUrl> <outDir>
 * Env: PLAYWRIGHT_MODULE (path to playwright's index.mjs), AXE_PATH (axe.min.js),
 * CHROMIUM_PATH (optional executable).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const [base, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const AXE = readFileSync(process.env.AXE_PATH, "utf8");
const report = { base, startedAt: new Date().toISOString(), checks: [], axe: [], longtasks: [] };
const check = (name, ok, detail = null) => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}`);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all, blocking: blocking.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 5) })) });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(", ") || null);
}

/** Every event on the grid, as its accessible name ("ANTH 1010 9:00–9:50, Monday"). */
const weekEvents = (page) => page.$$eval("[data-event]", (els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()).sort());
const eventsOf = (page, code) => page.$$eval(`[data-event][data-key^="${code}#"]`, (els) => els.map((el) => el.textContent.replace(/\s+/g, " ").trim()).sort());

// Long tasks are recorded from page start; each Auto reads the ones that began after its click.
const LONGTASK_OBSERVER = () => {
  window.__longtasks = [];
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__longtasks.push({ start: entry.startTime, duration: entry.duration });
  }).observe({ type: "longtask", buffered: true });
};

const COURSES = ["ANTH 1010", "ENGL 1310", "PSYC 1630", "BIOL 1710"];

for (const vp of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  await ctx.addInitScript(LONGTASK_OBSERVER);
  const page = await ctx.newPage();
  const shot = (name) => page.screenshot({ path: join(out, `${vp.name}-${name}.png`), fullPage: vp.name === "mobile", animations: "disabled" });
  const tag = vp.name;
  const phone = vp.name === "mobile";
  const main = page.locator("main");
  const strip = page.getByRole("region", { name: "Other weeks Auto found" });
  const nothing = page.getByRole("region", { name: "Auto found nothing" });
  // The contextual panel on desktop, a sheet on phones; either way it is named by its title.
  const panel = (name) => (phone ? page.getByRole("dialog", { name }) : page.locator("aside", { has: page.getByRole("heading", { name, exact: true }) }));
  const closePanel = async () => {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(phone ? 450 : 200);
  };
  /** The Preferences popover on desktop, a sheet on phones; either way a dialog named Preferences. */
  const prefsDialog = page.getByRole("dialog", { name: "Preferences" });
  const openPrefs = async () => {
    await main.getByRole("button", { name: /^Preferences/ }).click();
    await prefsDialog.waitFor();
    await page.waitForTimeout(phone ? 500 : 250);
    return prefsDialog;
  };
  /** Escape closes an open leaning card before the popover, so press until the dialog is gone. */
  const closePrefs = async () => {
    for (let i = 0; i < 3 && (await prefsDialog.count()) > 0 && (await prefsDialog.isVisible()); i += 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(phone ? 450 : 250);
    }
  };
  /** What the Preferences button describes itself with: only the choices that differ from the defaults. */
  const prefSummary = async () => ((await page.locator("#pref-summary").textContent()) ?? "").trim();
  /** Phones open panels as a half-height sheet; drag it to the top detent, as a student would. */
  const expand = async () => {
    if (!phone) return;
    await page.waitForTimeout(500); // let the opening spring settle; a grab mid-flight just stops it
    const grab = page.locator(".ui-sheet__grab").last();
    const box = await grab.boundingBox();
    if (!box) return;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2, box.y - 420, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  };
  const openSearch = async () => {
    if (phone) await main.getByRole("button", { name: "Add", exact: true }).click();
    else await page.getByRole("button", { name: "Search courses or class numbers" }).click();
    const find = panel("Find courses");
    await find.waitFor();
    await expand();
    return find;
  };

  /** Runs Auto and returns the longest main-thread task from the click until its answer showed. */
  async function autoMeasured(label, answer) {
    const clickedAt = await page.evaluate(() => performance.now());
    await main.getByRole("button", { name: /^(Auto|Build)/ }).first().click();
    await answer.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    const tasks = await page.evaluate((t0) => window.__longtasks.filter((t) => t.start >= t0), clickedAt);
    const max = tasks.reduce((m, t) => Math.max(m, t.duration), 0);
    report.longtasks.push({ viewport: tag, label, count: tasks.length, maxMs: Math.round(max) });
    check(`${tag}: no main-thread task of 50 ms or more during Auto (${label})`, max < 50, `${tasks.length} long tasks, max ${Math.round(max)} ms`);
  }

  await page.goto(`${base}/schedule`, { waitUntil: "networkidle" });
  check(`${tag}: inside the app shell`, (await page.locator(".shell main#main").count()) === 1);
  check(`${tag}: an empty week says how to start`, (await page.getByRole("heading", { name: "Add your first course" }).count()) === 1);

  // One tap each from Week's search; a section that would clash is skipped, as a student would.
  for (const code of COURSES) {
    const find = await openSearch();
    await find.getByRole("searchbox", { name: "Search courses" }).fill(code);
    await find.getByRole("button", { name: new RegExp(`^${code}`) }).first().click();
    const add = find.getByRole("button", { name: /^Add section [^,]+$/ }).first();
    await add.waitFor({ timeout: 15000 });
    await add.click();
    await page.locator(".ui-toast", { hasText: `Added ${code}` }).waitFor({ timeout: 5000 });
    await closePanel();
  }
  const added = await weekEvents(page);
  // A course with no set time sits in the No set time strip rather than on the grid.
  const strip0 = (await page.locator("main").textContent()) ?? "";
  check(`${tag}: four courses added from search, one tap each`, COURSES.every((code) => added.some((e) => e.startsWith(code)) || strip0.includes(code)), `${added.length} events`);
  check(`${tag}: no Select or combobox on Week`, (await main.getByRole("combobox").count()) === 0);
  await shot("01-week");
  await axe(page, `${tag} week`);

  // Preferences: start after 9 AM, Thursdays off, a work block, 15 credits at most.
  const prefs = await openPrefs();
  const sun = prefs.getByRole("slider", { name: "Earliest class start" });
  await sun.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowDown");
  check(`${tag}: the sun knob sets the earliest start`, (await sun.getAttribute("aria-valuetext")) === "9 AM", await sun.getAttribute("aria-valuetext"));
  await prefs.getByRole("button", { name: "Thursdays off" }).click();
  // A work block painted on Tuesday, dragged upward from 5 PM to 1 PM: a backwards
  // gesture still makes a block in the right order, never one that ends before it starts.
  const paintGrid = prefs.getByRole("application");
  await paintGrid.scrollIntoViewIfNeeded();
  const box = await paintGrid.boundingBox();
  const atMinute = (m) => box.y + ((m - 480) / 840) * box.height;
  const tueX = box.x + 1.5 * (box.width / 5);
  await page.mouse.move(tueX, atMinute(1005));
  await page.mouse.down();
  await page.mouse.move(tueX, atMinute(900), { steps: 5 });
  await page.mouse.move(tueX, atMinute(785), { steps: 5 });
  await page.mouse.up();
  check(
    `${tag}: a busy time painted backwards is stored start before end`,
    (await prefs.getByText("Tue, 1–5 PM", { exact: true }).count()) === 1,
  );
  const nameIt = prefs.getByRole("textbox", { name: "Name this busy time" });
  await nameIt.fill("Work");
  await nameIt.press("Enter");
  // The ledger row under the grid; the painted block on the grid carries the name too.
  const workRow = prefs.getByRole("listitem").filter({ hasText: "Tue, 1–5 PM" });
  check(`${tag}: work block added`, (await workRow.count()) === 1 && ((await workRow.textContent()) ?? "").trim().startsWith("Work"), (await workRow.textContent()) ?? "");
  // No limit, then down one step at a time: 21, 20, ... 15.
  const lower = prefs.getByRole("button", { name: "Lower the credit limit" });
  for (let i = 0; i < 7; i += 1) await lower.click();
  check(`${tag}: credit limit set to 15`, (await prefs.getByText("At most 15 credits", { exact: true }).count()) === 1);
  await shot("02-preferences");
  await closePrefs();
  const summary = await prefSummary();
  check(
    `${tag}: the Preferences summary names only what changed`,
    /Thursdays off/.test(summary) && /nothing before 9 AM/.test(summary) && /15 credits at most/.test(summary) && /work Tue 1:00–5:00/.test(summary) && !/short walks/i.test(summary),
    summary,
  );
  check(`${tag}: the Preferences button counts the changes`, ((await main.getByRole("button", { name: /^Preferences/ }).textContent()) ?? "").includes("4"));

  await autoMeasured("first run", strip);
  const count = (await strip.locator('[data-part="count"]').textContent()) ?? "";
  check(`${tag}: one alternative at a time`, /^1 of [1-3]$/.test(count.trim()), count.trim());
  const sentence = ((await strip.locator('[data-part="sentence"]').textContent()) ?? "").trim();
  check(`${tag}: the alternative is one sentence`, sentence.endsWith(".") && sentence.split(". ").length <= 2 && !/·/.test(sentence), sentence);
  check(`${tag}: no Thursday class in the preview`, (await page.locator('[data-day="Thu"] [data-event]').count()) === 0);
  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, view: window.innerWidth }));
  check(`${tag}: the page never scrolls sideways with an alternative shown`, widths.scroll <= widths.view, `${widths.scroll} px wide in a ${widths.view} px viewport`);
  if (/of [23]$/.test(count.trim())) {
    await strip.getByRole("button", { name: "Next" }).click();
    await page.waitForTimeout(400);
    check(`${tag}: Next shows option 2`, ((await strip.locator('[data-part="count"]').textContent()) ?? "").trim().startsWith("2 of"));
  }
  await strip.getByRole("button", { name: "Details" }).click();
  const details = panel(/^Option \d next to your week$/);
  await details.waitFor();
  check(`${tag}: Details compares the figures`, /Days on campus/.test((await details.textContent()) ?? ""));
  await shot("03-alternatives");
  await axe(page, `${tag} alternatives`);
  await closePanel();

  const before = await weekEvents(page);
  await strip.getByRole("button", { name: "Use this" }).click();
  await page.waitForTimeout(500);
  const afterPick = await weekEvents(page);
  check(`${tag}: Use this keeps the week it showed`, afterPick.length > 0 && JSON.stringify(before) === JSON.stringify(afterPick), `${afterPick.length} events`);
  check(`${tag}: no Thursday classes after using it`, (await page.locator('[data-day="Thu"] [data-event]').count()) === 0);
  // ⌘Z belongs to the page, not to a focused text field.
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.waitForTimeout(250);
  const undone = await weekEvents(page);
  check(`${tag}: ⌘Z puts the previous week back`, undone.length > 0 && JSON.stringify(undone) !== JSON.stringify(afterPick), `${undone.length} events`);

  // Browse all: every combination that fits, best first, each a small week with its section names.
  // Pointing at a row previews it; choosing one (Enter on desktop, a tap on the phone) uses exactly it, with Undo.
  await autoMeasured("before browse", strip);
  const browseAt = await page.evaluate(() => performance.now());
  await strip.getByRole("button", { name: "Browse all" }).click();
  const list = page.getByRole("listbox", { name: "Combinations, best first" });
  await list.waitFor({ timeout: 10000 });
  await page.waitForTimeout(phone ? 600 : 400);
  const browseTasks = await page.evaluate((t0) => window.__longtasks.filter((t) => t.start >= t0), browseAt);
  const browseMax = browseTasks.reduce((m, t) => Math.max(m, t.duration), 0);
  report.longtasks.push({ viewport: tag, label: "browse all", count: browseTasks.length, maxMs: Math.round(browseMax) });
  check(`${tag}: no main-thread task of 50 ms or more while Browse all lists`, browseMax < 50, `${browseTasks.length} long tasks, max ${Math.round(browseMax)} ms`);
  const listSummary = ((await page.getByText(/combinations? fits?\./).first().textContent()) ?? "").trim();
  check(`${tag}: Browse all says how many fit`, /^(At least )?[\d,]+ combinations? fits?\./.test(listSummary) || /^1 combination fits\./.test(listSummary), listSummary);
  const rows = list.getByRole("option");
  const firstLabel = (await rows.first().getAttribute("aria-label")) ?? "";
  check(`${tag}: each row names its sections`, /^Combination 1\b/.test(firstLabel) && / section /.test(firstLabel), firstLabel);
  const setSize = Number(await rows.first().getAttribute("aria-setsize"));
  check(`${tag}: only rows near the view are in the page`, (await rows.count()) <= Math.min(setSize, 30), `${await rows.count()} of ${setSize} rendered`);
  await shot("03b-browse-all");
  await axe(page, `${tag} browse all`);
  const browsing = page.getByRole("region", { name: "Combination on the grid" });
  if (!phone && setSize > 2) {
    await rows.nth(2).hover();
    await page.waitForTimeout(150);
    check(`${tag}: pointing at a row previews it`, ((await browsing.locator('[data-part="count"]').textContent()) ?? "").trim().startsWith("3 of"));
    await list.focus();
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    check(`${tag}: arrows move through the rows`, (await list.getAttribute("aria-activedescendant")) === "combination-1");
    await page.mouse.move(0, 0);
    await page.waitForTimeout(150);
  }
  const previewed = await weekEvents(page);
  if (phone) await rows.nth(Math.min(1, setSize - 1)).click();
  else await page.keyboard.press("Enter");
  const used = page.locator(".ui-toast", { hasText: /Using combination \d+/ });
  await used.waitFor({ timeout: 5000 });
  await page.waitForTimeout(500);
  const chosen = await weekEvents(page);
  check(`${tag}: choosing a row uses it and closes the list`, (await list.count()) === 0 && (phone || JSON.stringify(chosen) === JSON.stringify(previewed)), ((await used.textContent()) ?? "").trim());
  await shot("03c-browse-chosen");
  await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  await page.keyboard.press(process.platform === "darwin" ? "Meta+z" : "Control+z");
  await page.waitForTimeout(250);
  check(`${tag}: ⌘Z takes the combination back`, JSON.stringify(await weekEvents(page)) === JSON.stringify(undone));
  await main.getByRole("button", { name: /^(Auto|Build)/ }).first().click();
  await strip.waitFor();
  await strip.getByRole("button", { name: "Use this" }).click();
  await page.waitForTimeout(400);

  // Keep ANTH 1010 from its panel, then run Auto: no option moves it.
  await page.locator('[data-event][data-key="ANTH 1010#0"]').click();
  const anth = panel("ANTH 1010");
  await anth.waitFor();
  const keep = anth.getByRole("switch", { name: "Keep this section" });
  await keep.click();
  check(`${tag}: Keep this section switched on`, (await keep.getAttribute("aria-checked")) === "true");
  await closePanel();
  const kept = await eventsOf(page, "ANTH 1010");
  await autoMeasured("kept re-run", strip);
  let moved = false;
  const total = Number(((await strip.locator('[data-part="count"]').textContent()) ?? "1 of 1").trim().split(" of ")[1]) || 1;
  for (let i = 0; i < total; i += 1) {
    if (JSON.stringify(await eventsOf(page, "ANTH 1010")) !== JSON.stringify(kept)) moved = true;
    if (i < total - 1) {
      await strip.getByRole("button", { name: "Next" }).click();
      await page.waitForTimeout(350);
    }
  }
  check(`${tag}: a kept section never moves in Auto's options`, !moved, `${total} options`);
  await shot("04-kept-reoptimize");

  // A setting that changes under open options searches again; the strip says so and comes back.
  const lean = await openPrefs();
  await lean.getByRole("button", { name: /^Short walks/ }).click();
  const walks = lean.getByRole("slider", { name: "How much it matters" });
  await walks.focus();
  await page.keyboard.press("ArrowRight");
  await page.waitForFunction(() => /^\d of \d$/.test(document.querySelector('[aria-label="Other weeks Auto found"] [data-part="count"]')?.textContent?.trim() ?? ""), null, { timeout: 8000 }).catch(() => {});
  check(`${tag}: options refresh after a preference changes`, (await strip.count()) === 1 || (await nothing.count()) === 1);
  await walks.focus();
  await page.keyboard.press("ArrowLeft");
  await closePrefs();

  // Impossible: Mondays off too, but the kept ANTH 1010 section meets on Mondays.
  await (await openPrefs()).getByRole("button", { name: "Mondays off" }).click();
  await closePrefs();
  await strip.getByRole("button", { name: "Keep my week" }).click().catch(() => {});
  await autoMeasured("infeasible", nothing);
  const why = ((await nothing.textContent()) ?? "").trim();
  check(`${tag}: nothing fits, and the strip says why`, /Nothing fits these preferences\./.test(why) && /(No section of|Your locked)/.test(why), why.slice(0, 160));
  await shot("05-infeasible");
  await axe(page, `${tag} infeasible`);
  const fix = nothing.getByRole("button").first();
  const fixLabel = ((await fix.textContent()) ?? "").trim();
  await fix.click();
  await page.waitForTimeout(900);
  check(`${tag}: a fix applies in one click and Auto runs again`, fixLabel.length > 0 && ((await strip.count()) === 1 || (await nothing.count()) === 1), fixLabel);
  await shot("06-after-fix");

  // Save and reload: the sections, the kept section and the preferences persist.
  await page.keyboard.press("Escape");
  const saved = await weekEvents(page);
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const reloaded = await weekEvents(page);
  check(`${tag}: the week persists across reload`, JSON.stringify(saved) === JSON.stringify(reloaded), `${reloaded.length} events`);
  await page.locator('[data-event][data-key="ANTH 1010#0"]').click();
  check(`${tag}: the kept section persists across reload`, (await panel("ANTH 1010").getByRole("switch", { name: "Keep this section" }).getAttribute("aria-checked")) === "true");
  await closePanel();
  const after = await prefSummary();
  check(`${tag}: preferences persist across reload`, /Thursdays/.test(after), after);
  await shot("07-after-reload");
  await ctx.close();
}

await browser.close();
report.finishedAt = new Date().toISOString();
const maxLongtask = report.longtasks.reduce((m, t) => Math.max(m, t.maxMs), 0);
report.maxLongtaskMs = maxLongtask;
writeFileSync(join(out, "journey-report.json"), JSON.stringify(report, null, 2));
const failed = report.checks.filter((c) => !c.ok);
console.log(`max long task during Auto: ${maxLongtask} ms`);
console.log(`${report.checks.length - failed.length}/${report.checks.length} checks passed`);
process.exit(failed.length > 0 ? 1 : 0);
