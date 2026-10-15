#!/usr/bin/env node
/**
 * Day browser journey through the /map route (which lands on Day), at
 * 1440x900 and 390x844, against a production build (`next start`).
 *
 * The day comes from a guest plan written to localStorage before the page
 * loads: four sample sections on Monday (ENV, GAB, GATE, and Discovery Park,
 * which is off campus), chosen so GAB -> GATE has a 10-minute break and a
 * longer walk, and Kerr Hall as the starting point. The page's clock is
 * fixed at Monday 8:37 so Day opens on that Monday. Sections are synthetic
 * samples.
 *
 * Checks: the hero says when to leave the starting point; walk legs show
 * minutes and no distance or source; wheel, keyboard and button zoom; drag
 * pan; selecting a stop in the list flies to it and selects its pin;
 * selecting a pin selects its row; a leg can be selected and shows its
 * leave-by time; the tight transfer is flagged; the off-campus stop is
 * listed as not on the map with its reason; every stop and leg, once
 * selected, lands clear of the panel, sheet and controls; a selection from
 * the full sheet drops it to half first; reduced motion keeps the camera
 * flat; axe finds no serious or critical violations; with WebGL disabled the
 * page keeps the itinerary and says the map is unavailable.
 *
 * The map fidelity work (#56): the campus detail file loads; the credit line
 * names every source, in full at 1440, folded on a phone after the first
 * tap and reopened by (i); the spread-out sample day opens flat; the 3D
 * control tilts and flattens, instantly from the keyboard; a stop chosen
 * with 3D turned off stays flat, and a new day forgets that choice; under
 * reduced motion 3D is disabled with a description and pressing it keeps
 * the map flat.
 *
 * In this gap: GET /api/v1/events answers from fixtures/events-2026-10-12.json,
 * never the network. Its titles, places and links are real UNT calendar
 * events from the recorded directory feeds (tests/calendar-feeds/fixtures/
 * directory), moved onto the sample Monday so each lands on a case: two fit
 * the 70-minute break after ANTH 3700 (one tight on the way back), one has no
 * catalogue building, one can't get back to GAB in time, one overlaps
 * ANTH 3700, one is all day, one sits in the 10-minute break and one in the
 * break before Discovery Park. The checks: only the events that fit appear,
 * the first two show with the rest one press away, a selected event puts its
 * pin and walks on the map clear of the panel and opens to its event page,
 * the phone sheet drops to half to show it, and a failing feed leaves the
 * itinerary as it was. Any failed check exits 1.
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_OUT (screenshots, video, report),
 * UNTANGLE_E2E_MODULES (a node_modules with playwright and axe-core).
 */
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

const kerrHall = { name: "Kerr Hall", point: { lat: 33.2077137, lng: -97.1475024 } };

const EVENTS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "fixtures", "events-2026-10-12.json"), "utf8");

/** The events feed from the fixture, or failing with a 503 when `feed` is "down". */
async function stubEvents(context, feed = "up") {
  await context.route("**/api/v1/events?**", (route) =>
    feed === "up"
      ? route.fulfill({ status: 200, contentType: "application/json", body: EVENTS })
      : route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "unavailable" }) }),
  );
}

async function seed(context, feed = "up") {
  await stubEvents(context, feed);
  // Monday 12 October 2026, 8:37 local: Date is fixed, timers keep running.
  await context.clock.setFixedTime(new Date(2026, 9, 12, 8, 37));
  await context.addInitScript(({ doc, start }) => {
    // The planner reads the guest identity's store (#77).
    if (!window.localStorage.getItem("untangle.planner-state.v1:guest")) {
      window.localStorage.setItem("untangle.planner-state.v1:guest", JSON.stringify(doc));
      window.localStorage.setItem("untangle.day-start.v1", JSON.stringify(start));
    }
  }, { doc: plannerDoc, start: kerrHall });
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

/**
 * The camera once a stop's flight has landed (zoomed past 17), or after 6 s.
 * Under software WebGL a tilted flight's frames come slowly (13 to 87 frames
 * in 3 s on a dev server), and the camera is recorded only at moveend. A fixed
 * 1.4 s wait failed that way on PR #128's first CI run: the screenshot taken
 * right after the check shows the flight had landed by then.
 */
async function landed(page) {
  await page
    .waitForFunction(() => Number(document.querySelector('[data-testid="campus-map"]')?.dataset.zoom) > 17, null, { timeout: 6000 })
    .catch(() => undefined);
  await pause(page, 200);
  return camera(page);
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

/**
 * Whether the selection's places on the map (the stop's pin, or both ends
 * of a leg) are inside the map and clear of the panel, sheet, stepper and
 * controls. Returns null when clear, else what overlapped.
 */
async function targetBlocked(page, kind, key) {
  return page.evaluate(([kind, key]) => {
    const map = document.querySelector('[data-testid="campus-map"]').getBoundingClientRect();
    const covers = [".mv-panel", ".mv-sheet", ".mv-top", ".mv-controls", ".maplibregl-ctrl-bottom-right"]
      .flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => ({ selector, box: el.getBoundingClientRect() })))
      .filter(({ box }) => box.width > 0 && box.height > 0);
    const pinFor = (stopKey) => [...document.querySelectorAll(".mv-pin")].find((pin) => (pin.dataset.stopKeys ?? "").split("|").includes(stopKey));
    const ends =
      kind === "stop"
        ? [pinFor(key)]
        : kind === "event"
          ? [document.querySelector(".mv-event-pin")]
          : key.split(">").map((end) => (end === "start" ? document.querySelector(".mv-start-pin") : pinFor(end)));
    const problems = [];
    for (const el of ends) {
      if (!el) {
        problems.push("no marker");
        continue;
      }
      // The pin's tip (its building) and the middle of its disc both have to show.
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2;
      for (const y of [box.bottom, box.top + Math.min(14, box.height / 2)]) {
        if (x < map.left || x > map.right || y < map.top || y > map.bottom) problems.push(`off the map at ${Math.round(x)},${Math.round(y)}`);
        for (const { selector, box: cover } of covers) {
          if (x >= cover.left && x <= cover.right && y >= cover.top && y <= cover.bottom) problems.push(`under ${selector} at ${Math.round(x)},${Math.round(y)}`);
        }
      }
    }
    return problems.length ? problems.join("; ") : null;
  }, [kind, key]);
}

/**
 * Select every stop and every drawn leg from the list; each must land clear.
 * `prepare` runs before each tap (the phone opens its sheet to reach the row).
 */
async function everyTargetClear(page, label, prepare = async () => {}) {
  const rows = await page.evaluate(() => [
    ...[...document.querySelectorAll(".mv-stop")].map((el) => ({ kind: "stop", key: el.dataset.stopKey, mapped: el.dataset.placement === "mapped" })),
    ...[...document.querySelectorAll("button.mv-leg__row")].map((el) => ({
      kind: "leg",
      key: el.dataset.legKey,
      mapped: ["walk", "straight-line"].includes(el.closest(".mv-leg").dataset.route),
    })),
  ]);
  let checked = 0;
  for (const row of rows.filter((r) => r.mapped)) {
    const selector = row.kind === "stop" ? `.mv-stop[data-stop-key="${row.key}"]` : `.mv-leg__row[data-leg-key="${row.key}"]`;
    await prepare();
    await page.locator(selector).click();
    await settle(page, 1300);
    const blocked = await targetBlocked(page, row.kind, row.key);
    check(`${label}: selected ${row.kind} ${row.key} lands clear of the panel, sheet and controls`, blocked === null, blocked);
    checked += 1;
  }
  check(`${label}: every mapped stop and leg was checked`, checked >= 6, `${checked} targets`);
}
/** Holds a settled state on screen so the desktop recording is watchable; it changes no check. */
const beat = (page) => pause(page, 1800);

/* ---------- in this gap ---------- */

const gapText = (page) => page.locator(".mv-gap").evaluateAll((els) => els.map((el) => el.textContent ?? ""));

/** The rows, the opened list and a selected event, on whichever layout `page` has. */
async function gapJourney(page, label, prepare = async () => {}) {
  await prepare();
  const gaps = await gapText(page);
  const all = gaps.join(" | ");
  check(
    `${label}: the 70-minute break after ANTH 3700 shows "In this gap" with the first two events that fit`,
    gaps.length === 2 &&
      /^In this gap/.test(gaps[0]) &&
      /The Dialogue Society/.test(gaps[0]) &&
      /Road Trip to Registration/.test(gaps[0]) &&
      /1 more/.test(gaps[0]) &&
      !/TinkerCAD/.test(gaps[0]),
    all,
  );
  check(
    `${label}: events that overlap a class, can't get back in time, last all day or sit in the 10-minute break are not listed`,
    !/Physics Colloquium|College Democrats|Badminton|Cybersecurity/.test(all),
    all,
  );
  const first = page.locator(".mv-gap").first();
  const dialogue = first.locator(".mv-gap__event", { hasText: "The Dialogue Society" });
  const roadTrip = first.locator(".mv-gap__event", { hasText: "Road Trip to Registration" });
  const dialogueText = (await dialogue.textContent()) ?? "";
  check(
    `${label}: an event row says the place, the walk there, its start and that ANTH 1010 still works`,
    /UU/.test(dialogueText) && /8 min walk/.test(dialogueText) && /11:00\s*AM/.test(dialogueText) && /On time for ANTH 1010/.test(dialogueText),
    dialogueText,
  );
  const roadText = (await roadTrip.textContent()) ?? "";
  check(
    `${label}: a tight return says when to leave`,
    (await roadTrip.getAttribute("data-fit")) === "tight" && /Leave by 11:53\s*AM/.test(roadText),
    roadText,
  );

  const head = first.locator("button.mv-gap__head");
  await head.click();
  await settle(page, 400);
  const tinker = first.locator(".mv-gap__event", { hasText: "TinkerCAD Workshop" });
  const tinkerText = (await tinker.textContent().catch(() => "")) ?? "";
  check(
    `${label}: opening the gap lists the rest, and a place off the building list shows as written with no walk`,
    (await head.getAttribute("aria-expanded")) === "true" &&
      /Willis Library/.test(tinkerText) &&
      !/min walk/.test(tinkerText) &&
      /Ends 10 min before ANTH 1010/.test(tinkerText),
    tinkerText,
  );

  await prepare();
  const key = await dialogue.getAttribute("data-event-key");
  await dialogue.click();
  await settle(page, 1600);
  const pins = await page.locator(".mv-event-pin").count();
  const blocked = await targetBlocked(page, "event", key);
  check(`${label}: a selected event shows its pin on the map, clear of the panel, sheet and controls`, pins === 1 && blocked === null, blocked ?? `${pins} event pins`);
  const view = await camera(page);
  check(`${label}: a selected event is framed flat with its walks`, view.pitch < 1, `pitch ${view.pitch}`);
  const detail = page.locator(".mv-more--gap");
  const detailText = (await detail.textContent().catch(() => "")) ?? "";
  const link = detail.locator("a.mv-link");
  check(
    `${label}: the selected event says how to make ANTH 1010 and links to its event page`,
    /8 min walk from ENV/.test(detailText) &&
      /Leave by 11:54\s*AM to make ANTH 1010/.test(detailText) &&
      (await link.getAttribute("href")) === "https://calendar.unt.edu/event/the-dialogue-society-general-b" &&
      (await link.getAttribute("target")) === "_blank",
    detailText,
  );
  const sheet = page.locator(".mv-sheet");
  if (await sheet.count()) {
    check(`${label}: an event chosen from the full sheet drops it to half, so the map shows`, (await sheet.getAttribute("data-detent")) === "half");
  }
  await shoot(page, `${label}-gap-event-selected.png`);
  await page.keyboard.press("Escape");
  await settle(page, 400);
  check(`${label}: Escape clears the event and its pin`, (await page.locator(".mv-event-pin").count()) === 0 && (await dialogue.getAttribute("aria-expanded")) === "false");
  // Close the gap again, so the checks after this see the resting itinerary.
  await prepare();
  await head.click();
  await settle(page, 300);
}

/** With the events feed down, Day shows its itinerary and nothing about events. */
async function feedDown(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await seed(context, "down");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openMap(page);
  await settle(page, 600);
  check(
    "feed down: the itinerary has no gap rows and no error",
    (await page.locator(".mv-gap").count()) === 0 && (await page.locator(".mv-stop").count()) === 4 && errors.length === 0,
    errors.join(" | ") || null,
  );
  await context.close();
}

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
  const detailLoads = [];
  page.on("response", (response) => {
    if (response.url().includes("/map/unt-denton/detail.geojson")) detailLoads.push(response.status());
  });

  await openMap(page);
  await shoot(page, "desktop-01-day.png");
  await beat(page);

  check("desktop: the campus detail file loads", detailLoads.includes(200), detailLoads.join(", ") || "no request");
  const opening = await camera(page);
  // The sample day spans Kerr Hall to GATE: too spread out to tilt with every stop in view.
  check("desktop: the spread-out sample day opens flat", opening.pitch < 1, `zoom ${opening.zoom}, pitch ${opening.pitch}`);

  const stops = await page.locator(".mv-stop").evaluateAll((els) =>
    els.map((el) => ({ key: el.dataset.stopKey, placement: el.dataset.placement, text: el.textContent })),
  );
  check("desktop: four Monday classes listed in time order", stops.length === 4 && /ANTH 3700/.test(stops[0].text), stops.map((s) => s.text.slice(0, 12)).join(", "));

  const hero = (await page.locator(".mv-hero").first().textContent()) ?? "";
  check("desktop: the hero says when to leave the starting point", /Leave Kerr Hall by\s*\d{1,2}:\d{2}/.test(hero) && /in \d+ min/.test(hero) && /ANTH 3700 starts at 9:30/.test(hero), hero);
  check("desktop: Day opens on today", ((await page.locator(".mv-stepper__day").textContent()) ?? "") === "Today");
  check("desktop: times carry AM or PM", /\d{1,2}:\d{2}\s*AM/.test(hero) && /12:00\s*PM/.test((await page.locator(".mv-stop").nth(1).textContent()) ?? ""));
  const walkTotal = (await page.locator(".mv-walk-total").textContent().catch(() => "")) ?? "";
  check("desktop: the day's walking total ends the itinerary", /^\d+ min walking today$/.test(walkTotal.trim()), walkTotal);

  const walks = await page.locator('.mv-leg[data-route="walk"]').evaluateAll((els) => els.map((el) => el.textContent));
  check(
    "desktop: walk legs show minutes, with no distance or source",
    walks.length >= 3 && walks.every((text) => /\d+ min/.test(text) && !/\b(mi|ft)\b|via /.test(text)),
    walks.join(" | "),
  );

  const pins = await page.locator(".mv-pin").count();
  check("desktop: one numbered pin per mapped building", pins === 3, `${pins} pins`);

  const tight = page.locator('.mv-leg[data-transfer="late"], .mv-leg[data-transfer="tight"]');
  const tightText = (await tight.first().textContent().catch(() => "")) ?? "";
  check("desktop: the late transfer is flagged on its walk", (await page.locator('.mv-leg[data-transfer="late"]').count()) === 1 && /\d+ min late/.test(tightText), tightText);

  const unresolved = page.locator('.mv-stop[data-placement="unresolved"]');
  const unresolvedText = (await unresolved.first().textContent().catch(() => "")) ?? "";
  await unresolved.first().click();
  const reason = (await page.locator(".mv-more:not(.mv-more--print)").first().textContent().catch(() => "")) ?? "";
  check(
    "desktop: off-campus stop listed as not on map, with its reason when opened",
    (await unresolved.count()) === 1 && /Not on map/.test(unresolvedText) && /off the main campus/.test(reason),
    `${unresolvedText} | ${reason}`,
  );
  await page.keyboard.press("Escape");
  await settle(page, 400);
  check(
    // Discovery Park counts as Denton since the real-sections PR: main campus to it is a 20-minute shuttle, not a walk.
    "desktop: the leg to Discovery Park is a shuttle ride, not a walking route",
    (await page.locator('.mv-leg[data-route="shuttle"]').count()) === 1 &&
      /20 min shuttle/.test((await page.locator('.mv-leg[data-route="shuttle"]').textContent()) ?? ""),
  );
  const attribution = (await page.locator(".maplibregl-ctrl-attrib").textContent()) ?? "";
  check(
    "desktop: attribution credits OpenStreetMap contributors and OpenFreeMap",
    /OpenStreetMap contributors/.test(attribution) && /OpenFreeMap/.test(attribution) && /OpenMapTiles/.test(attribution),
    attribution.trim(),
  );
  check(
    "desktop: the credit line names Overture and shows in full",
    /Overture Maps/.test(attribution) && !(await page.locator(".maplibregl-ctrl-attrib").evaluate((el) => el.classList.contains("maplibregl-compact"))),
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
  after = await landed(page);
  const gabPin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^2$/ }) });
  check("desktop: selecting a row selects its pin", (await gabPin.getAttribute("data-selected")) === "true");
  check("desktop: selecting a row flies in and tilts", after.zoom > 17 && after.pitch > 30, `zoom ${after.zoom}, pitch ${after.pitch}`);
  check("desktop: selected row is marked and expanded", (await gabRow.getAttribute("aria-expanded")) === "true", gabKey);
  await shoot(page, "desktop-03-stop-selected.png");
  await beat(page);

  // Select from the map: zoom out (the selection stays) until GATE is in view, then tap its pin.
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page, 500);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await settle(page, 900);
  check("desktop: zooming out keeps the selection", (await gabRow.getAttribute("aria-expanded")) === "true");
  const gatePin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^3$/ }) });
  // The itinerary with its gap rows can reach the panel's full height, so drag GATE out from under it first.
  const panelRight = (await page.locator(".mv-panel").boundingBox()).x + (await page.locator(".mv-panel").boundingBox()).width;
  const gateBox = await gatePin.boundingBox();
  if (gateBox && gateBox.x < panelRight + 40) {
    const from = { x: mapBox.x + mapBox.width * 0.6, y: mapBox.y + mapBox.height * 0.5 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + (panelRight + 120 - gateBox.x), from.y - 120, { steps: 12 });
    await page.mouse.up();
    await settle(page, 900);
  }
  await gatePin.click();
  await settle(page, 1400);
  const gateRow = page.locator(".mv-stop").nth(2);
  check("desktop: selecting a pin selects its row", (await gateRow.getAttribute("aria-expanded")) === "true");
  check("desktop: the previous row is no longer selected", (await gabRow.getAttribute("aria-expanded")) === "false");
  await shoot(page, "desktop-04-pin-selected.png");
  await beat(page);

  // Select the tight leg.
  await page.locator('.mv-leg[data-transfer="late"] .mv-leg__row, .mv-leg[data-transfer="tight"] .mv-leg__row').first().click();
  await settle(page, 1400);
  after = await camera(page);
  check(
    "desktop: selecting a leg frames it flat",
    after.pitch < 1 && (await page.locator('.mv-leg__row[aria-expanded="true"]').count()) === 1,
    `pitch ${after.pitch}`,
  );
  const legDetail = (await page.locator(".mv-more--leg").first().textContent().catch(() => "")) ?? "";
  check(
    "desktop: a selected walk shows its leave-by time, distance and route",
    /Leave by \d{1,2}:\d{2}/.test(legDetail) && /\d (mi|ft) via campus walkways/.test(legDetail),
    legDetail,
  );
  await shoot(page, "desktop-05-leg-selected.png");
  await beat(page);

  await page.keyboard.press("Escape");
  await settle(page, 400);
  check("desktop: Escape clears the selection", (await page.locator('.mv-stop[aria-expanded="true"], .mv-leg__row[aria-expanded="true"]').count()) === 0);

  await gapJourney(page, "desktop");

  await everyTargetClear(page, "desktop");
  await page.keyboard.press("Escape");

  // The 3D control: on lifts to street zoom and tilts, off flattens.
  const threeD = page.getByRole("button", { name: "3D view" });
  await page.getByRole("button", { name: "Show the whole day" }).click();
  await settle(page, 1000);
  await threeD.click();
  await settle(page, 700);
  after = await camera(page);
  check("desktop: 3D tilts to street zoom", after.pitch > 30 && after.zoom >= 16 && (await threeD.getAttribute("aria-pressed")) === "true", `zoom ${after.zoom}, pitch ${after.pitch}`);
  await shoot(page, "desktop-06-3d.png");
  await threeD.click();
  await settle(page, 700);
  after = await camera(page);
  check("desktop: 3D again flattens", after.pitch < 1 && (await threeD.getAttribute("aria-pressed")) === "false", `pitch ${after.pitch}`);
  await threeD.focus();
  await page.keyboard.press("Enter");
  await settle(page, 120);
  after = await camera(page);
  check("desktop: 3D from the keyboard is instant", after.pitch > 30, `pitch ${after.pitch} 120 ms after Enter`);
  await page.keyboard.press("Enter");
  await settle(page, 300);

  // 3D is now off by choice: a chosen stop flies there flat, until the day changes.
  await gabRow.click();
  after = await landed(page);
  check("desktop: with 3D turned off, a chosen stop stays flat", after.zoom > 17 && after.pitch < 1, `zoom ${after.zoom}, pitch ${after.pitch}`);
  await page.keyboard.press("Escape");

  // Days switch with the stepper.
  await page.getByRole("button", { name: "Next day" }).click();
  await settle(page, 900);
  await beat(page);
  check("desktop: an empty day says so", /No classes on Tuesday/.test((await page.locator(".mv-panel__body").textContent()) ?? ""));
  await page.getByRole("button", { name: "Previous day" }).click();
  await page.locator(".mv-stop").nth(3).waitFor();
  check("desktop: the first day is the stepper's start", await page.getByRole("button", { name: "Previous day" }).isDisabled());
  await settle(page, 1200);
  await gabRow.click();
  after = await landed(page);
  check("desktop: a new day forgets the 3D choice, so a chosen stop tilts again", after.pitch > 30, `pitch ${after.pitch}`);
  await page.keyboard.press("Escape");
  await settle(page, 400);

  await axe(page, "desktop /map");

  await page.emulateMedia({ media: "print" });
  await pause(page, 300);
  check("desktop print: the map is hidden and the itinerary remains", (await page.locator(".mv-canvas").isHidden()) && (await page.locator(".mv-stop").first().isVisible()));
  await page.screenshot({ path: join(OUT, "desktop-07-print.png"), fullPage: true });
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

  // The credits show on load and fold behind (i) on the first tap on the map.
  const credits = page.locator(".maplibregl-ctrl-attrib");
  const creditsOpen = () => credits.evaluate((el) => el.classList.contains("maplibregl-compact-show"));
  const phoneCredits = (await credits.textContent()) ?? "";
  check("phone: the credit line shows on load", (await creditsOpen()) && /OpenStreetMap contributors/.test(phoneCredits) && /Overture Maps/.test(phoneCredits), phoneCredits.trim());

  const pin = page.locator(".mv-pin", { has: page.locator(".mv-pin__disc", { hasText: /^1$/ }) });
  await pin.tap();
  await settle(page, 1400);
  check("phone: tapping a pin selects its row", (await page.locator(".mv-stop").first().getAttribute("aria-expanded")) === "true");
  check("phone: the first tap on the map folds the credits", !(await creditsOpen()));
  await page.locator(".maplibregl-ctrl-attrib-button").tap();
  await pause(page, 200);
  check("phone: (i) opens the credits again", await creditsOpen());
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
  const attribution = await page.locator(".maplibregl-ctrl-attrib").boundingBox();
  const sheetTop = (await sheet.boundingBox())?.y ?? 0;
  const stepperBottom = await page.locator(".mv-top").evaluate((el) => el.getBoundingClientRect().bottom);
  check(
    "phone: at full the attribution stays visible between the stepper and the sheet",
    attribution && attribution.y >= stepperBottom && attribution.y + attribution.height <= sheetTop + 1,
    `stepper ${stepperBottom}, attribution ${attribution?.y}-${attribution && attribution.y + attribution.height}, sheet ${sheetTop}`,
  );
  await page.locator('.mv-stop[data-placement="unresolved"]').scrollIntoViewIfNeeded();
  check("phone: off-campus stop is listed at full height", await page.locator('.mv-stop[data-placement="unresolved"]').isVisible());
  await shoot(page, "phone-03-full.png");
  // Choosing from the full sheet drops it to half, then flies.
  const fromFull = page.locator(".mv-stop").nth(2);
  await fromFull.click();
  await settle(page, 1400);
  const fullKey = await fromFull.getAttribute("data-stop-key");
  const fullBlocked = await targetBlocked(page, "stop", fullKey);
  check(
    "phone: a stop chosen at full drops the sheet to half and lands above it",
    (await sheet.getAttribute("data-detent")) === "half" && fullBlocked === null,
    fullBlocked,
  );
  await shoot(page, "phone-03b-from-full.png");
  await page.keyboard.press("Escape");

  await gapJourney(page, "phone", async () => {
    if ((await sheet.getAttribute("data-detent")) !== "full") await drag(-420);
    await page.locator(".mv-gap").first().scrollIntoViewIfNeeded();
  });

  // Rows below the half sheet are out of reach, as they are for a thumb: open it to full, then tap.
  await everyTargetClear(page, "phone", async () => {
    if ((await sheet.getAttribute("data-detent")) !== "full") await drag(-420);
  });
  await page.keyboard.press("Escape");

  await drag(700);
  check("phone: dragging down collapses the sheet to peek", (await sheet.getAttribute("data-detent")) === "peek");
  check("phone: the attribution stays visible at peek", await page.locator(".maplibregl-ctrl-attrib").isVisible());
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
  const threeD = page.getByRole("button", { name: "3D view" });
  const describedBy = await threeD.getAttribute("aria-describedby");
  const note = describedBy ? ((await page.locator(`#${describedBy}`).textContent()) ?? "") : "";
  check("reduced motion: 3D is disabled, with the reason as its description", (await threeD.getAttribute("aria-disabled")) === "true" && /reduced motion/.test(note), note);
  // Playwright waits for an aria-disabled button to enable, so the press is dispatched.
  await threeD.dispatchEvent("click");
  await settle(page, 400);
  const pressed = await camera(page);
  check("reduced motion: pressing 3D keeps the map flat", pressed.pitch < 1, `pitch ${pressed.pitch}`);
  await context.close();
}

/* ---------- no WebGL ---------- */

async function withoutWebgl() {
  const noGl = await chromium.launch({ args: ["--disable-webgl", "--disable-3d-apis"] });
  try {
    const context = await noGl.newContext({ viewport: { width: 1440, height: 900 } });
    await seed(context);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
    await page.locator(".mv-stop").nth(3).waitFor({ timeout: 30000 });
    const note = page.getByText(/Map unavailable/);
    await note.waitFor({ timeout: 15000 }).catch(() => undefined);
    check("no WebGL: the page says the map is unavailable", await note.isVisible());
    await page.waitForFunction(() => document.querySelectorAll('.mv-leg[data-route="walk"]').length >= 2, null, { timeout: 20000 });
    check("no WebGL: the itinerary still lists classes and walking minutes", (await page.locator('.mv-leg[data-route="walk"]').count()) >= 2);
    check("no WebGL: no uncaught page errors", errors.length === 0, errors.join(" | ") || null);
    await shoot(page, "desktop-08-no-webgl.png");
    await context.close();
  } finally {
    await noGl.close();
  }
}

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
try {
  await desktop(browser);
  await phone(browser);
  await reducedMotion(browser);
  await feedDown(browser);
} catch (error) {
  check("journey ran to completion", false, error.stack ?? String(error));
} finally {
  await browser.close();
}
try {
  await withoutWebgl();
} catch (error) {
  check("no-WebGL pass ran to completion", false, error.stack ?? String(error));
}

report.finishedAt = new Date().toISOString();
const failed = report.checks.filter((c) => !c.passed);
report.summary = `${report.checks.length - failed.length}/${report.checks.length} checks passed`;
writeFileSync(join(OUT, "journey-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(report.summary);
process.exit(failed.length === 0 ? 0 : 1);
