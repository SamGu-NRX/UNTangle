#!/usr/bin/env node
/**
 * Map v2 browser journey through the normal /map route, at 1440x900 and
 * 390x844, against a production build (`next start`).
 *
 * The day comes from a guest plan written to localStorage before the page
 * loads: four sample sections on Monday (ENV, GAB, GATE, and Discovery Park,
 * which is off campus), chosen so GAB -> GATE has a 10-minute break and a
 * longer walk. Sections are synthetic samples.
 *
 * Checks: walkway legs with minutes and source; wheel, keyboard and button
 * zoom; drag pan; selecting a stop in the list flies to it and selects its
 * pin; selecting a pin selects its row; a leg can be selected; the tight
 * transfer is flagged; the off-campus stop is listed as not on the map with
 * its reason; reduced motion keeps the camera flat; axe finds no serious or
 * critical violations. Any failed check exits 1.
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_OUT (screenshots, video, report),
 * UNTANGLE_E2E_MODULES (a node_modules with playwright and axe-core).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3217";
const OUT = process.env.UNTANGLE_OUT;
const MODULES = process.env.UNTANGLE_E2E_MODULES;
if (!OUT || !MODULES) {
  console.error("Set UNTANGLE_OUT and UNTANGLE_E2E_MODULES");
  process.exit(2);
}
const require = createRequire(join(MODULES, "noop.js"));
const { chromium } = require("playwright");
const AXE = readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
mkdirSync(OUT, { recursive: true });

const report = { startedAt: new Date().toISOString(), base: BASE, checks: [], axe: [] };
const check = (name, passed, detail = null) => {
  report.checks.push({ name, passed: Boolean(passed), detail });
  console.log(`${passed ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const pause = (page, ms) => page.waitForTimeout(ms);
const shoot = (page, name) => page.screenshot({ path: join(OUT, name) });

/* ---------- the sample day ---------- */

const sections = {
  "ANTH 3700": "anth-3700-002", // Mon 9:30-10:50, ENV
  "ANTH 1010": "anth-1010-003", // Mon 12:00-12:50, GAB
  "BIOL 1720": "biol-1720-016", // Mon 13:00-13:50, GATE
  "BMEN 1400": "bmen-1400-001", // Mon 14:30-15:50, Discovery Park (off campus)
};
const plannerDoc = {
  storeSchemaVersion: 1,
  revision: 1,
  savedAt: new Date().toISOString(),
  state: {
    courseStatuses: {
      // The bundled default has MATH 1710 in progress; mark it done so the day holds only these four.
      "MATH 1710": "completed",
      ...Object.fromEntries(Object.keys(sections).map((code) => [code, "inProgress"])),
    },
    selectedSections: sections,
    lockedSections: {},
    optimization: "clusterMorning",
    activeDay: "Mon",
    selectedMajor: "other",
    transcriptRecords: [],
    updatedAt: new Date().toISOString(),
  },
};

async function seed(context) {
  await context.addInitScript((doc) => {
    if (!window.localStorage.getItem("untangle.planner-state.v1")) {
      window.localStorage.setItem("untangle.planner-state.v1", JSON.stringify(doc));
    }
  }, plannerDoc);
}

/* ---------- page helpers ---------- */

const camera = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('[data-testid="campus-map"]');
    if (!el?.dataset.center) return null;
    const [lat, lng] = el.dataset.center.split(",").map(Number);
    return { zoom: Number(el.dataset.zoom), pitch: Number(el.dataset.pitch), lat, lng };
  });

async function settle(page, ms = 900) {
  // Camera moves are 250-500 ms; give the moveend handler time to record.
  await pause(page, ms);
}

async function openMap(page) {
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
  await page.locator(".mv-stop").nth(3).waitFor({ timeout: 30000 });
  await page.locator('[data-testid="campus-map"][data-ready="true"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.mv-leg[data-route="walk"]').length >= 2, null, {
    timeout: 20000,
  });
  // Let tiles and labels arrive before judging or photographing the map.
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await settle(page, 1200);
}

async function axe(page, label) {
  await page.addScriptTag({ content: AXE });
  const result = await page.evaluate(() => window.axe.run(document, { resultTypes: ["violations"] }));
  const all = result.violations.map(
    (v) => `${v.id} (${v.impact}) x${v.nodes.length}: ${v.nodes.slice(0, 4).map((n) => n.target.join(" ")).join("; ")}`,
  );
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  report.axe.push({ label, violations: all });
  check(`axe zero serious/critical: ${label}`, blocking.length === 0, all.join(" | ") || null);
}

const near = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
/** Holds a settled state on screen so the desktop recording is watchable; it changes no check. */
const beat = (page) => pause(page, 1800);

/* ---------- desktop ---------- */

async function desktop(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: join(OUT, "video-tmp"), size: { width: 1440, height: 900 } },
  });
  await seed(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await openMap(page);
  await shoot(page, "desktop-01-day.png");
  await beat(page);

  const stops = await page.locator(".mv-stop").evaluateAll((els) =>
    els.map((el) => ({ key: el.dataset.stopKey, placement: el.dataset.placement, text: el.textContent })),
  );
  check("desktop: four Monday classes listed in time order", stops.length === 4 && /ANTH 3700/.test(stops[0].text), stops.map((s) => s.text.slice(0, 12)).join(", "));

  const walks = await page.locator('.mv-leg[data-route="walk"]').evaluateAll((els) => els.map((el) => el.textContent));
  check(
    "desktop: walkway legs show minutes, distance and source",
    walks.length >= 2 && walks.every((text) => /\d+ min · [\d.]+ (mi|ft)/.test(text) && /via campus walkways/.test(text)),
    walks.join(" | "),
  );
  check("desktop: a walk leg has a leave-by time", walks.some((text) => /Leave by \d{1,2}:\d{2} (AM|PM)/.test(text)));

  const pins = await page.locator(".mv-pin").count();
  check("desktop: one numbered pin per mapped building", pins === 3, `${pins} pins`);

  const tight = page.locator('.mv-leg[data-transfer="late"], .mv-leg[data-transfer="tight"]');
  const tightText = (await tight.first().textContent().catch(() => "")) ?? "";
  check("desktop: tight transfer flagged", (await tight.count()) >= 1 && /longer than the break|Tight transfer/.test(tightText), tightText);
  check(
    "desktop: summary counts the tight transfer",
    /1 tight transfer/.test((await page.locator(".mv-summary__line").textContent()) ?? ""),
  );

  const unresolved = page.locator('.mv-stop[data-placement="unresolved"]');
  const unresolvedText = (await unresolved.first().textContent().catch(() => "")) ?? "";
  check(
    "desktop: off-campus stop listed as not on map, with its reason",
    (await unresolved.count()) === 1 && /Not on map/.test(unresolvedText) && /off the main campus/.test(unresolvedText),
    unresolvedText,
  );
  check(
    "desktop: legs touching the off-campus stop say there is no route",
    (await page.locator('.mv-leg[data-route="no-route"]').count()) === 1,
  );
  const attribution = (await page.locator(".maplibregl-ctrl-attrib").textContent()) ?? "";
  check(
    "desktop: attribution credits OpenStreetMap contributors and OpenFreeMap",
    /OpenStreetMap contributors/.test(attribution) && /OpenFreeMap/.test(attribution) && /OpenMapTiles/.test(attribution),
    attribution.trim(),
  );

  // Zoom: wheel, keyboard, button. Pan: drag.
  const mapBox = await page.locator('[data-testid="campus-map"]').boundingBox();
  const mapPoint = { x: mapBox.x + mapBox.width * 0.68, y: mapBox.y + mapBox.height * 0.5 };
  let before = await camera(page);
  await page.mouse.move(mapPoint.x, mapPoint.y);
  await page.mouse.wheel(0, -500);
  await settle(page, 1200);
  let after = await camera(page);
  check("desktop: wheel zooms in", after.zoom > before.zoom + 0.3, `${before.zoom} -> ${after.zoom}`);
  await shoot(page, "desktop-02-wheel-zoom.png");
  await beat(page);

  before = after;
  await page.locator(".maplibregl-canvas").focus();
  await page.keyboard.press("Minus");
  await settle(page);
  after = await camera(page);
  check("desktop: keyboard minus zooms out", after.zoom < before.zoom - 0.3, `${before.zoom} -> ${after.zoom}`);

  before = after;
  await page.getByRole("button", { name: "Zoom in" }).click();
  await settle(page);
  after = await camera(page);
  check("desktop: zoom-in button zooms in", after.zoom > before.zoom + 0.5, `${before.zoom} -> ${after.zoom}`);

  before = after;
  await page.mouse.move(mapPoint.x, mapPoint.y);
  await page.mouse.down();
  await page.mouse.move(mapPoint.x - 180, mapPoint.y + 90, { steps: 12 });
  await page.mouse.up();
  await settle(page, 1200);
  after = await camera(page);
  await beat(page);
  check("desktop: drag pans the map", !near(after.lng, before.lng, 1e-5) && !near(after.lat, before.lat, 1e-5), `${before.lat},${before.lng} -> ${after.lat},${after.lng}`);

  // Show the whole day again, then select from the list.
  await page.getByRole("button", { name: "Show the whole day" }).click();
  await settle(page, 1000);
  const gabRow = page.locator(".mv-stop").nth(1);
  const gabKey = await gabRow.getAttribute("data-stop-key");
  await gabRow.click();
  await settle(page, 1400);
  after = await camera(page);
  const gabPin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^2$/ }) });
  check("desktop: selecting a row selects its pin", (await gabPin.getAttribute("data-selected")) === "true");
  check("desktop: selecting a row flies in and tilts", after.zoom > 17 && after.pitch > 30, `zoom ${after.zoom}, pitch ${after.pitch}`);
  check("desktop: selected row is marked", (await gabRow.getAttribute("aria-pressed")) === "true", gabKey);
  await shoot(page, "desktop-03-stop-selected.png");
  await beat(page);

  // Select from the map: zoom out (the selection stays) until GATE is in view, then tap its pin.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page, 500);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page, 900);
  check("desktop: zooming out keeps the selection", (await gabRow.getAttribute("aria-pressed")) === "true");
  const gatePin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^3$/ }) });
  await gatePin.click();
  await settle(page, 1400);
  const gateRow = page.locator(".mv-stop").nth(2);
  check("desktop: selecting a pin selects its row", (await gateRow.getAttribute("aria-pressed")) === "true");
  check("desktop: the previous row is no longer selected", (await gabRow.getAttribute("aria-pressed")) === "false");
  await shoot(page, "desktop-04-pin-selected.png");
  await beat(page);

  // Select the tight leg.
  await page.locator('.mv-leg[data-transfer="late"] .mv-leg__card, .mv-leg[data-transfer="tight"] .mv-leg__card').first().click();
  await settle(page, 1400);
  after = await camera(page);
  check(
    "desktop: selecting a leg frames it flat",
    after.pitch < 1 && (await page.locator('.mv-leg__card[data-selected="true"]').count()) === 1,
    `pitch ${after.pitch}`,
  );
  await shoot(page, "desktop-05-leg-selected.png");
  await beat(page);

  await page.keyboard.press("Escape");
  await settle(page, 400);
  check("desktop: Escape clears the selection", (await page.locator('[aria-pressed="true"].mv-stop, [data-selected="true"].mv-leg__card').count()) === 0);

  // Days switch with the segmented control.
  await page.getByRole("radio", { name: /^Tuesday/ }).click();
  await settle(page, 600);
  await beat(page);
  check("desktop: an empty day says so", /No classes on Tuesday/.test((await page.locator(".mv-panel__body").textContent()) ?? ""));
  await page.getByRole("radio", { name: /^Monday/ }).click();
  await page.locator(".mv-stop").nth(3).waitFor();
  await settle(page, 1200);

  await axe(page, "desktop /map");

  await page.emulateMedia({ media: "print" });
  await pause(page, 300);
  check("desktop print: the map is hidden and the itinerary remains", (await page.locator(".mv-canvas").isHidden()) && (await page.locator(".mv-stop").first().isVisible()));
  await page.screenshot({ path: join(OUT, "desktop-06-print.png"), fullPage: true });
  await page.emulateMedia({ media: "screen" });
  await pause(page, 1500);

  check("desktop: no uncaught page errors", errors.length === 0, errors.join(" | ") || null);
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(OUT, "desktop-journey.webm"));
}

/* ---------- phone ---------- */

async function phone(browser) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  await seed(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMap(page);

  const sheet = page.locator(".mv-sheet");
  check("phone: itinerary is a bottom sheet at half height", (await sheet.getAttribute("data-detent")) === "half");
  await shoot(page, "phone-01-half.png");

  const pin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^1$/ }) });
  await pin.tap();
  await settle(page, 1400);
  check("phone: tapping a pin selects its row", (await page.locator(".mv-stop").first().getAttribute("aria-pressed")) === "true");
  const pinBox = await pin.boundingBox();
  const sheetBox = await sheet.boundingBox();
  check("phone: the selected pin sits above the sheet", pinBox && sheetBox && pinBox.y + pinBox.height < sheetBox.y, `pin bottom ${pinBox && pinBox.y + pinBox.height}, sheet top ${sheetBox?.y}`);
  await shoot(page, "phone-02-pin-selected.png");

  // Drag the sheet by its header: up to full, then down to peek.
  const header = page.locator(".mv-sheet__header");
  const drag = async (dy) => {
    const box = await header.boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + 30;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y + dy, { steps: 14 });
    await page.mouse.up();
    await settle(page, 700);
  };
  await drag(-320);
  check("phone: dragging up opens the sheet to full", (await sheet.getAttribute("data-detent")) === "full");
  await page.locator('.mv-stop[data-placement="unresolved"]').scrollIntoViewIfNeeded();
  check("phone: off-campus stop is listed at full height", await page.locator('.mv-stop[data-placement="unresolved"]').isVisible());
  await shoot(page, "phone-03-full.png");
  await drag(700);
  check("phone: dragging down collapses the sheet to peek", (await sheet.getAttribute("data-detent")) === "peek");
  await shoot(page, "phone-04-peek.png");

  const before = await camera(page);
  const mapBox = await page.locator('[data-testid="campus-map"]').boundingBox();
  await page.mouse.move(mapBox.x + 200, mapBox.y + 260);
  await page.mouse.down();
  await page.mouse.move(mapBox.x + 120, mapBox.y + 330, { steps: 10 });
  await page.mouse.up();
  await settle(page, 1000);
  const after = await camera(page);
  check("phone: map pans while the sheet is at peek", !near(after.lat, before.lat, 1e-5), `${before.lat} -> ${after.lat}`);

  await axe(page, "phone /map");
  check("phone: no uncaught page errors", errors.length === 0, errors.join(" | ") || null);
  await context.close();
}

/* ---------- reduced motion ---------- */

async function reducedMotion(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await seed(context);
  const page = await context.newPage();
  await openMap(page);
  await page.locator(".mv-stop").nth(1).click();
  await settle(page, 400);
  const state = await camera(page);
  check("reduced motion: choosing a stop jumps there flat", state.zoom > 17 && state.pitch < 1, `zoom ${state.zoom}, pitch ${state.pitch}`);
  await context.close();
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await desktop(browser);
  await phone(browser);
  await reducedMotion(browser);
} catch (error) {
  check("journey ran to completion", false, error.stack ?? String(error));
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
const failed = report.checks.filter((c) => !c.passed);
report.summary = `${report.checks.length - failed.length}/${report.checks.length} checks passed`;
writeFileSync(join(OUT, "journey-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(report.summary);
process.exit(failed.length === 0 ? 0 : 1);
