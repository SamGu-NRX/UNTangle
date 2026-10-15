#!/usr/bin/env node
/**
 * Map fidelity measurements against a production build (`next start`), run
 * the same way before and after a map change so the numbers compare:
 *
 * - frame times during six camera flights between class buildings at
 *   390x844 with Chromium's CPU throttled 4x (DevTools' "mid-tier mobile"),
 *   from requestAnimationFrame deltas, per flight and pooled;
 * - bytes received (bodies as sent, plus headers) while the Day map loads at
 *   390x844, by kind, with the browser cache empty (a fresh context);
 * - a pitched view of the core campus at 1440x900 and 390x844 (select GAB,
 *   which tilts the camera, then zoom out one step);
 * - a 1440x900 recording of a flight from GAB to GATE.
 *
 * The plan is journey.mjs's sample Monday (ENV, GAB, GATE, Discovery Park).
 *
 * Env: UNTANGLE_BASE_URL, UNTANGLE_OUT, UNTANGLE_E2E_MODULES (a node_modules
 * with playwright). UNTANGLE_GL=swiftshader (default, as journey.mjs) or
 * metal (the host GPU through ANGLE). Writes fidelity-report.json.
 */
import { createRequire } from "node:module";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.UNTANGLE_BASE_URL ?? "http://127.0.0.1:3217";
const OUT = process.env.UNTANGLE_OUT;
const MODULES = process.env.UNTANGLE_E2E_MODULES;
const GL = process.env.UNTANGLE_GL ?? "swiftshader";
if (!OUT || !MODULES) {
  console.error("Set UNTANGLE_OUT and UNTANGLE_E2E_MODULES");
  process.exit(2);
}
const GL_ARGS = {
  swiftshader: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  metal: ["--use-angle=metal", "--ignore-gpu-blocklist", "--enable-gpu-rasterization"],
};
if (!GL_ARGS[GL]) {
  console.error(`UNTANGLE_GL must be one of ${Object.keys(GL_ARGS).join(", ")}, not "${GL}"`);
  process.exit(2);
}
const require = createRequire(join(MODULES, "noop.js"));
const { chromium } = require("playwright");
mkdirSync(OUT, { recursive: true });

// Same sample plan as journey.mjs (synthetic sections).
const sections = {
  "ANTH 3700": "anth-3700-002",
  "ANTH 1010": "anth-1010-003",
  "BIOL 1720": "biol-1720-016",
  "BMEN 1400": "bmen-1400-001",
};
const plannerDoc = {
  storeSchemaVersion: 1,
  revision: 1,
  savedAt: new Date().toISOString(),
  state: {
    courseStatuses: { "MATH 1710": "completed", ...Object.fromEntries(Object.keys(sections).map((code) => [code, "inProgress"])) },
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

const pause = (page, ms) => page.waitForTimeout(ms);

async function openMap(page) {
  await page.goto(`${BASE}/map`, { waitUntil: "domcontentloaded" });
  await page.locator(".mv-stop").nth(3).waitFor({ timeout: 30000 });
  await page.locator('[data-testid="campus-map"][data-ready="true"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => document.querySelectorAll('.mv-leg[data-route="walk"]').length >= 2, null, { timeout: 20000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await pause(page, 1500);
}

function kindOf(url) {
  if (/tiles\.openfreemap\.org\/planet\/.*\.pbf/.test(url)) return "basemap tiles";
  if (/tiles\.openfreemap\.org\/fonts\//.test(url)) return "glyphs";
  if (/tiles\.openfreemap\.org/.test(url)) return "tilejson";
  if (/\/map\/[^/]+\/[^/]+\.(geo)?json/.test(url)) return "campus map data";
  if (/\.js(\?|$)/.test(url) || /\/api\/map\/worker/.test(url)) return "javascript";
  return "other";
}

const stats = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return {
    frames: sorted.length,
    windowMs: Math.round(sorted.reduce((sum, value) => sum + value, 0)),
    p50: Number(at(0.5).toFixed(1)),
    p95: Number(at(0.95).toFixed(1)),
    max: Number(sorted[sorted.length - 1].toFixed(1)),
    over33: sorted.filter((v) => v > 33.4).length,
    over50: sorted.filter((v) => v > 50).length,
  };
};

/** Click a stop row and collect rAF deltas (ms) until the flight and its tile loads settle. */
async function measureFlight(page, rowIndex, windowMs) {
  // Each recording owns a generation number, so a loop left over from the previous flight stops
  // instead of pushing duplicate frames into this one.
  await page.evaluate(() => {
    const generation = (window.__generation ?? 0) + 1;
    window.__generation = generation;
    window.__frames = [];
    let last = performance.now();
    const tick = (now) => {
      if (window.__generation !== generation) return;
      window.__frames.push(now - last);
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.locator(".mv-stop").nth(rowIndex).click();
  await pause(page, windowMs);
  return page.evaluate(() => {
    window.__generation += 1;
    return window.__frames.slice(1);
  });
}

const report = { startedAt: new Date().toISOString(), base: BASE, gl: GL };

async function phoneRun(browser) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await seed(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  // Context-level events include MapLibre's web worker, which fetches the tiles and GeoJSON.
  const bytes = {};
  const counts = {};
  const finished = [];
  context.on("requestfinished", (request) => {
    finished.push(
      request.sizes().then((sizes) => {
        const kind = kindOf(request.url());
        bytes[kind] = (bytes[kind] ?? 0) + sizes.responseBodySize + sizes.responseHeadersSize;
        counts[kind] = (counts[kind] ?? 0) + 1;
      }),
    );
  });

  await openMap(page);
  await Promise.all(finished);
  report.renderer = await page.evaluate(() => {
    const gl = document.createElement("canvas").getContext("webgl2");
    const info = gl?.getExtension("WEBGL_debug_renderer_info");
    return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : "unknown";
  });
  report.loadBytes = Object.fromEntries(Object.entries(bytes).map(([kind, value]) => [kind, { bytes: value, requests: counts[kind] }]));
  await page.screenshot({ path: join(OUT, "phone-day.png") });

  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  // Six flights between class buildings, alternating stop 2 (GAB) and stop 3 (GATE);
  // the frames of all six are pooled so one slow tile load doesn't decide the result.
  const flights = [];
  const pooled = [];
  for (let flight = 0; flight < 6; flight += 1) {
    const frames = await measureFlight(page, flight % 2 === 0 ? 1 : 2, 2000);
    flights.push(stats(frames));
    pooled.push(...frames);
  }
  report.phoneFlights = flights;
  report.phoneFlightsPooled = stats(pooled);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  await context.close();
}

async function pitchedView(browser, viewport, name, mobile) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  await seed(context);
  const page = await context.newPage();
  await openMap(page);
  await page.locator(".mv-stop").nth(1).click();
  await pause(page, 1500);
  await page.getByRole("button", { name: "Zoom out" }).click();
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await pause(page, 1500);
  report[`${name}Camera`] = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="campus-map"]');
    return { zoom: el.dataset.zoom, pitch: el.dataset.pitch, center: el.dataset.center };
  });
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  await context.close();
}

async function flightRecording(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: join(OUT, "video-tmp"), size: { width: 1440, height: 900 } },
  });
  await seed(context);
  const page = await context.newPage();
  await openMap(page);
  await page.locator(".mv-stop").nth(1).click();
  await pause(page, 2200);
  await page.locator(".mv-stop").nth(2).click();
  await pause(page, 2200);
  await page.locator(".mv-stop").nth(1).click();
  await pause(page, 2200);
  const video = page.video();
  await context.close();
  if (video) renameSync(await video.path(), join(OUT, "flight-gab-gate.webm"));
}

const browser = await chromium.launch({ args: GL_ARGS[GL] });
try {
  await phoneRun(browser);
  await pitchedView(browser, { width: 1440, height: 900 }, "desktop-3d-core", false);
  await pitchedView(browser, { width: 390, height: 844 }, "phone-3d-core", true);
  await flightRecording(browser);
} finally {
  await browser.close();
}
report.finishedAt = new Date().toISOString();
writeFileSync(join(OUT, "fidelity-report.json"), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
