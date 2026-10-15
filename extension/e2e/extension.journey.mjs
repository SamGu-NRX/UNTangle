#!/usr/bin/env node
/** Offline MV3 journey against the mock portal and device-grant/API stub. */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(here, "..");
const repoRoot = path.resolve(extensionRoot, "..");
const distDir = path.join(extensionRoot, "dist");
const artifactsDir = path.join(extensionRoot, "e2e", "artifacts");

const STUB = "http://127.0.0.1:3217";
const MOCK = "http://localhost:4317";

function step(message) {
  console.log(`journey: ${message}`);
}

function fail(message) {
  console.error(`journey FAILED: ${message}`);
  process.exitCode = 1;
}

function buildExtension() {
  step("building the extension");
  const result = spawnSync("bun", ["--no-env-file", "run", "build"], { cwd: extensionRoot, stdio: "inherit" });
  if (result.status !== 0) fail("the extension build failed");
  return result.status === 0;
}

// The panel is 380px wide; 390 checks it on a phone-width page.
const PANEL_WIDTHS = [390, 380];
const PANEL_HEIGHT = 600;

async function observed() {
  return (await fetch(`${STUB}/__observed`)).json();
}

async function knobs(values) {
  const response = await fetch(`${STUB}/__knobs`, { method: "POST", body: JSON.stringify(values) });
  if (!response.ok) throw new Error(`stub knobs rejected ${JSON.stringify(values)}`);
}

/** Waits for a row's marker to show `state` (a marker waiting on the worker is hidden). */
async function settled(page, rowId, state) {
  await page.locator(`[data-unt-row="${rowId}"][data-unt-marker="${state}"] button:not([data-waiting])`).waitFor();
}

/** Waits for the panel to show the named screen, optionally holding some text. */
async function onScreen(panel, name, text) {
  const view = panel.locator(`#view[data-view="${name}"]`);
  await (text ? view.filter({ hasText: text }) : view).waitFor({ timeout: 15000 });
}

/** Clicks a row's marker and waits until the worker has stored that proposal. */
async function clickMarker(page, panel, rowId) {
  const classNumber = await page.locator(`#${rowId}_CLASS_NUM`).innerText();
  await page.locator(`[data-unt-row="${rowId}"] button`).click();
  await panel.waitForFunction(async expected => (await chrome.storage.local.get("proposed-section"))["proposed-section"]?.classNumber === expected, classNumber);
}

async function propose(page, panel, rowId, title) {
  await clickMarker(page, panel, rowId);
  await panel.reload();
  await onScreen(panel, "preview", title);
}

/**
 * Captures the panel at each width with the viewport sized to its content,
 * as Chrome sizes a popup. A full-page capture would draw the sticky foot
 * over the content.
 */
async function shootPanel(panel, name) {
  await panel.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
  for (const width of PANEL_WIDTHS) {
    await panel.setViewportSize({ width, height: 200 });
    const height = await panel.evaluate(() => document.documentElement.scrollHeight);
    await panel.setViewportSize({ width, height });
    // Two frames, so the capture never catches the compositor mid-resize.
    await panel.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await panel.screenshot({ path: path.join(artifactsDir, `v1-panel-${name}-${width}.png`) });
  }
  await panel.setViewportSize({ width: PANEL_WIDTHS[0], height: PANEL_HEIGHT });
}

async function shootMarkers(page, file) {
  // A tab behind the panel can hand back a stale, tiled frame.
  await page.bringToFront();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const box = await page.locator("#CLASS_SRCH_WRK2_RESULTS").boundingBox();
  await page.screenshot({ path: path.join(artifactsDir, file), clip: { x: 0, y: 0, width: Math.ceil(box.x + box.width + 12), height: Math.ceil(box.y + box.height + 12) } });
}

async function waitHealthy(url, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet; retry until the deadline
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`${label} did not become healthy at ${url}`);
}

function startServer(script, args, label) {
  const child = spawn("bun", ["--no-env-file", script, ...args], { cwd: repoRoot, stdio: ["ignore", "pipe", "pipe"] });
  child.stderr.on("data", data => process.stderr.write(`[${label}] ${data}`));
  child.stdout.on("data", data => process.stdout.write(`[${label}] ${data}`));
  return child;
}

async function launch(candidateList) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "untangle-extension-journey-"));
  const loadArgs = [
    `--disable-extensions-except=${distDir}`,
    `--load-extension=${distDir}`,
  ];
  let lastError;
  for (const candidate of candidateList) {
    try {
      step(`launching Chromium (channel=${candidate.channel ?? "bundled"}, headless=${candidate.headless})`);
      const context = await chromium.launchPersistentContext(userDataDir, { ...candidate, deviceScaleFactor: 2, args: loadArgs });
      return { context, userDataDir };
    } catch (error) {
      lastError = error;
      step(`launch failed: ${String(error).slice(0, 200)}`);
    }
  }
  throw new Error(`no Chromium launch candidate worked: ${lastError}`);
}

async function main() {
  mkdirSync(artifactsDir, { recursive: true });
  if (!buildExtension()) return;

  // Guard against an orphaned server from an earlier run: if either port
  // already answers, the journey would test the wrong process.
  for (const [url, label] of [[`${STUB}/health`, "stub port 3217"], [`${MOCK}/health`, "mock port 4317"]]) {
    const alreadyUp = await fetch(url).then(() => true, () => false);
    if (alreadyUp) throw new Error(`${label} is already serving; kill the orphaned process first`);
  }

  const stub = startServer("extension/e2e/stub-untangle.ts", [], "stub");
  const mock = startServer("tools/mock-myunt/server.ts", [], "mock");
  let context;
  let userDataDir;
  try {
    await waitHealthy(`${STUB}/health`, "the stub server");
    await waitHealthy(`${MOCK}/health`, "the mock server");
    step("both localhost servers are healthy");

    const launched = await launch([
      { channel: "chromium", headless: true },
      { headless: true },
      { channel: "chrome", headless: true },
      { channel: "chromium", headless: false },
    ]);
    context = launched.context;
    userDataDir = launched.userDataDir;

    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const panel = await context.newPage();
    await panel.setViewportSize({ width: PANEL_WIDTHS[0], height: PANEL_HEIGHT });
    const page = await context.newPage();
    await page.goto(`${MOCK}/class-search`);
    await settled(page, "SSR_CLSRCH_R1", "unknown");
    await panel.goto(`chrome-extension://${extensionId}/popup.html`);
    await onScreen(panel, "signed-out");
    await shootPanel(panel, "signed-out");
    // Sign-in runs the device-code flow: the panel shows a code, the worker
    // opens the UNTangle approval page in a normal tab, and the student
    // approves there. No redirect and no identity window. The token issued
    // now lives 8 seconds, so the next authenticated call must refresh first.
    await knobs({ accessExpiresInSeconds: 8 });
    await panel.locator("#sign-in").click();
    try {
      await onScreen(panel, "signing-in");
      const shownCode = (await panel.locator("#user-code").innerText()).trim();
      if (!/^[A-Z2-7]{8}$/.test(shownCode)) throw new Error(`the panel's code is not 8 base32 characters: ${shownCode}`);
      let approvalTab = null;
      for (let i = 0; i < 40 && approvalTab === null; i++) {
        approvalTab = context.pages().find(candidate => candidate.url().startsWith(`${STUB}/device?`)) ?? null;
        if (approvalTab === null) await panel.waitForTimeout(250);
      }
      if (approvalTab === null) throw new Error("the worker never opened the UNTangle approval tab");
      const approvalCode = new URL(approvalTab.url()).searchParams.get("user_code");
      if (approvalCode !== shownCode) throw new Error(`the approval tab's code ${approvalCode} does not match the panel's ${shownCode}`);
      await approvalTab.locator("#result").filter({ hasText: "Approved" }).waitFor({ timeout: 15000 });
      await onScreen(panel, "empty");
    }
    catch (error) {
      throw new Error(`Device sign-in failed: ${error instanceof Error ? error.message : String(error)} — panel: ${await panel.locator("body").innerText()} Requests: ${JSON.stringify(await observed())}`);
    }
    await knobs({ accessExpiresInSeconds: null });
    await shootPanel(panel, "empty");
    const signInObserved = await observed();
    if (!signInObserved.requests.some(request => request.path === "/api/v1/device/start")) throw new Error("sign-in did not start the device flow");
    if (signInObserved.requests.some(request => request.cookie)) throw new Error("the device flow sent a session cookie");
    step("device grant exchanged through the trusted panel");

    await settled(page, "SSR_CLSRCH_R1", "conflict");
    await settled(page, "SSR_CLSRCH_R2", "clear");
    await settled(page, "SSR_CLSRCH_R3", "unknown");
    // The 8-second token was inside the refresh margin, so these first
    // authenticated calls must have rotated it before use.
    if (!(await observed()).requests.some(request => request.path === "/api/v1/device/refresh")) throw new Error("an 8-second access token did not refresh before its first authenticated use");
    const pageText = await page.locator("body").innerText();
    if (pageText.includes("Work") || pageText.includes("3.40") || pageText.includes("CSCE 1040")) throw new Error("Private details leaked onto class search");
    await shootMarkers(page, "v1-markers.png");
    await page.mouse.click(1000, 600);
    await page.keyboard.press("Tab");
    if (await page.evaluate(() => document.activeElement?.getAttribute("data-unt-row") ?? document.activeElement?.closest?.("[data-unt-row]")?.getAttribute("data-unt-row")) === null)
      throw new Error("Tab did not reach the first marker");
    await shootMarkers(page, "v1-markers-focus.png");
    step("markers show conflict, fits and cannot check with no private detail, and take keyboard focus");

    // A page click proposes only. Opening the trusted extension page is a
    // deterministic way to inspect the same popup document in headless CI.
    await propose(page, panel, "SSR_CLSRCH_R1", "Computer Science I");
    for (const width of PANEL_WIDTHS) {
      await panel.setViewportSize({ width, height: PANEL_HEIGHT });
      await panel.emulateMedia({ reducedMotion: "reduce" });
      await panel.locator("body").click({ position: { x: 2, y: 2 } });
      await panel.keyboard.press("Tab");
      const focused = await panel.locator(":focus").getAttribute("id");
      if (focused !== "confirm") throw new Error(`Keyboard focus missed confirm at ${width}`);
      const layout = await panel.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, height: document.querySelector("#confirm").getBoundingClientRect().height, ring: getComputedStyle(document.activeElement).boxShadow }));
      if (layout.overflow || layout.height < 44 || layout.ring === "none") throw new Error(`Popup accessibility/layout failed at ${width}: ${JSON.stringify(layout)}`);
    }
    await panel.emulateMedia({ reducedMotion: "no-preference" });
    await shootPanel(panel, "conflict");
    if ((await observed()).writes.length !== 0) throw new Error("A proposal wrote the schedule");

    await knobs({ previewDelayMs: 3000 });
    await clickMarker(page, panel, "SSR_CLSRCH_R3");
    await panel.reload();
    await panel.locator("#view .loading").waitFor({ timeout: 5000 });
    await shootPanel(panel, "loading");
    await knobs({ previewDelayMs: 0 });
    await onScreen(panel, "preview", "Foundations of Computing");
    await shootPanel(panel, "cannot-check");

    await propose(page, panel, "SSR_CLSRCH_R2", "College Writing I");
    await shootPanel(panel, "fits");
    await fetch(`${STUB}/__advance`, { method: "POST" });
    await panel.locator("#confirm").click();
    await onScreen(panel, "changed", "HIST 2610");
    const fresh = await panel.evaluate(() => chrome.runtime.sendMessage({ type: "panel/status" }));
    if (fresh.preview.preview.revision !== 2) throw new Error("Stale revision did not load a fresh preview");
    if ((await observed()).writes.length !== 0) throw new Error("Stale revision silently applied");
    await settled(page, "SSR_CLSRCH_R2", "conflict");
    await shootPanel(panel, "changed");
    step("stale add rejected and refreshed both the panel and page marker before reconfirmation");

    await knobs({ commandDelayMs: 2500 });
    await panel.locator("#confirm").click();
    const busyAtOnce = await panel.locator("#confirm").evaluate(e => [e.getAttribute("aria-busy"), e.hasAttribute("data-loading")]);
    if (busyAtOnce[0] !== "true" || busyAtOnce[1]) throw new Error(`The add button should be busy at once and spin only after 400ms: ${busyAtOnce}`);
    await panel.locator("#confirm[data-loading]").waitFor();
    if (await panel.locator("#confirm").getAttribute("aria-label") !== "Add ENGL 1310 to Main") throw new Error("The busy add button lost its accessible name");
    await shootPanel(panel, "adding");
    await onScreen(panel, "added", "Added ENGL 1310 to Main");
    await knobs({ commandDelayMs: 0 });
    if (await panel.locator("#view .state[data-enter]").count() !== 1) throw new Error("A pointer-confirmed add did not play its confirmation");
    await panel.waitForTimeout(400);
    await shootPanel(panel, "added");
    await settled(page, "SSR_CLSRCH_R2", "added");
    step("a confirmed add reads Added in the panel and on the page");

    await propose(page, panel, "SSR_CLSRCH_R1", "Computer Science I");
    await fetch(`${STUB}/__drop-next`, { method: "POST" });
    await panel.locator("#confirm").click();
    await onScreen(panel, "waiting");
    const stored = await worker.evaluate(async () => chrome.storage.local.get(null));
    const pendingKey = Object.keys(stored).find(key => key.startsWith("add:"));
    if (!pendingKey) throw new Error("Confirmed add was not retained after a lost response");
    const operationId = stored[pendingKey].command.operationId;
    await shootPanel(panel, "waiting");
    await settled(page, "SSR_CLSRCH_R1", "pending");
    await shootMarkers(page, "v1-markers-after-adds.png");
    await context.close();
    // Restart the browser with the same profile. The MV3 worker must replay
    // from local storage without a page message or a second confirmation.
    context = await chromium.launchPersistentContext(userDataDir, { channel: "chromium", headless: true, deviceScaleFactor: 2, args: [`--disable-extensions-except=${distDir}`, `--load-extension=${distDir}`] });
    const restartedPanel = await context.newPage();
    await restartedPanel.setViewportSize({ width: PANEL_WIDTHS[0], height: PANEL_HEIGHT });
    await restartedPanel.goto(`chrome-extension://${extensionId}/popup.html`);
    await restartedPanel.waitForFunction(async () => !Object.keys(await chrome.storage.local.get(null)).some(key => key.startsWith("add:")));
    const replayed = await observed();
    if (replayed.writes.length !== 2 || replayed.writes[1].operationId !== operationId || replayed.writes[1].expectedRevision !== 3) throw new Error("Restart duplicated or changed the confirmed operation");
    if (replayed.requests.some(r => r.cookie)) throw new Error("The worker sent session cookies");
    if (replayed.requests.filter(r => r.path === "/api/v1/extension/commands").length !== 4) throw new Error("Expected stale, committed, lost and replay requests");
    await restartedPanel.reload();
    await onScreen(restartedPanel, "added", "Added to Main");
    if (await restartedPanel.locator("#confirm").count()) throw new Error("Receipt left a duplicate add action");
    await shootPanel(restartedPanel, "restarted");
    step("a restarted worker replayed the stored add once");

    const restartedPage = await context.newPage();
    await restartedPage.goto(`${MOCK}/class-search`);
    await settled(restartedPage, "SSR_CLSRCH_R3", "unknown");
    await propose(restartedPage, restartedPanel, "SSR_CLSRCH_R3", "Foundations of Computing");
    // The preview failure is set before the add, so every later status read
    // fails alike, including one from a popup Chrome opened for the click.
    await knobs({ nextCommand: "reject", failPreviewFor: "16077" });
    await restartedPanel.locator("#confirm").click();
    await onScreen(restartedPanel, "rejected", "Couldn't add CSCE 2100");
    await shootPanel(restartedPanel, "rejected");

    await restartedPanel.reload();
    await onScreen(restartedPanel, "error", "Couldn't load Main from UNTangle");
    const errorText = await restartedPanel.locator("body").innerText();
    if (/fixture|HTTP|Invalid|500/.test(errorText)) throw new Error(`Raw error text reached the panel: ${errorText}`);
    await shootPanel(restartedPanel, "error");
    await knobs({ failPreviewFor: null });
    await restartedPanel.locator("#reload").click();
    await onScreen(restartedPanel, "preview", "Foundations of Computing");

    await knobs({ nextCommand: "unauthorized" });
    await restartedPanel.locator("#confirm").click();
    await onScreen(restartedPanel, "needs-sign-in", "Sign in to finish adding CSCE 2100");
    await shootPanel(restartedPanel, "needs-sign-in");
    await restartedPanel.locator("#sign-in").click();
    await onScreen(restartedPanel, "added", "Added CSCE 2100 to Main");
    if ((await observed()).writes.length !== 3) throw new Error("Signing in again did not send the waiting add exactly once");
    // Signing out revokes the grant on the server, clears the stored tokens,
    // and returns the panel to its signed-out screen; signing in again works.
    await restartedPanel.locator("#sign-out").click();
    await onScreen(restartedPanel, "signed-out");
    if (!(await observed()).requests.some(request => request.path === "/api/v1/device/revoke")) throw new Error("signing out did not revoke the grant on the server");
    await restartedPanel.locator("#sign-in").click();
    await onScreen(restartedPanel, "signing-in");
    await onScreen(restartedPanel, "empty");
    step("rejection, load failure, sign-out with revocation and a lapsed sign-in each show their own panel state");

    const transcript = await context.newPage(); await transcript.goto(`${MOCK}/transcript`);
    if (await transcript.locator("[data-unt-row]").count()) throw new Error("Content script ran outside class search");
    step("ALL ASSERTIONS PASSED: device sign-in with a matching code, refresh before use, markers, private panel, stale preview, restart replay, sign-out with revocation and every panel state");
  } catch (error) {
    if (context) {
      for (const tab of context.pages()) if (tab.url().includes("popup.html")) console.error("popup failure state", await tab.locator("body").innerText().catch(()=>"closed"));
      console.error("stub failure state", JSON.stringify(await (await fetch(`${STUB}/__observed`)).json()));
    }
    fail(String(error));
  } finally {
    if (context) await context.close().catch(() => {});
    stub.kill();
    mock.kill();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
}

main();
