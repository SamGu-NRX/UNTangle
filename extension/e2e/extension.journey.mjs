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
      const context = await chromium.launchPersistentContext(userDataDir, { ...candidate, args: loadArgs });
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
    await panel.setViewportSize({width:390,height:844});
    const page = await context.newPage();
    await page.goto(`${MOCK}/class-search`);
    await page.locator('[data-unt-row="SSR_CLSRCH_R1"][data-unt-marker="unknown"]').waitFor();
    await panel.goto(`chrome-extension://${extensionId}/popup.html`);
    await panel.locator("#sign-in").click();
    try { await panel.waitForFunction(() => document.querySelector("#sign-in").hidden, undefined, {timeout:15000}); }
    catch { throw new Error(`Sign-in failed: ${await panel.locator("body").innerText()} Requests: ${JSON.stringify(await (await fetch(`${STUB}/__observed`)).json())}`); }
    step("device grant exchanged through the trusted panel");
    await page.locator('[data-unt-row="SSR_CLSRCH_R1"][data-unt-marker="conflict"]').waitFor();
    await page.locator('[data-unt-row="SSR_CLSRCH_R2"][data-unt-marker="clear"]').waitFor();
    await page.locator('[data-unt-row="SSR_CLSRCH_R3"][data-unt-marker="unknown"]').waitFor();
    const pageText = await page.locator("body").innerText();
    if (pageText.includes("Work on Monday") || pageText.includes("3.40")) throw new Error("Private details leaked onto class search");
    await page.screenshot({path:path.join(artifactsDir,"v1-markers.png"),fullPage:true});
    // A page click proposes only. Opening the trusted extension page is a
    // deterministic way to inspect the same popup document in headless CI.
    await page.locator('[data-unt-row="SSR_CLSRCH_R1"] button').click();
    await panel.reload();
    await panel.locator("#details").filter({hasText:"Work on Monday"}).waitFor();
    for (const width of [390,1440]) {
      await panel.setViewportSize({width,height:900});
      await panel.emulateMedia({reducedMotion:"reduce"});
      await panel.locator("body").click({position:{x:2,y:2}});
      await panel.keyboard.press("Tab");
      const focused=await panel.locator(":focus").getAttribute("id");
      if (focused !== "confirm") throw new Error(`Keyboard focus missed confirm at ${width}`);
      const layout=await panel.evaluate(() => ({overflow:document.documentElement.scrollWidth > innerWidth, height:document.querySelector("#confirm").getBoundingClientRect().height, outline:getComputedStyle(document.activeElement).outlineStyle}));
      if (layout.overflow || layout.height < 44 || layout.outline === "none") throw new Error(`Popup accessibility/layout failed at ${width}: ${JSON.stringify(layout)}`);
      await panel.screenshot({path:path.join(artifactsDir,`v1-panel-${width}.png`)});
    }
    await panel.setViewportSize({width:390,height:844});
    if ((await (await fetch(`${STUB}/__observed`)).json()).writes.length !== 0) throw new Error("A proposal wrote the schedule");
    await page.locator('[data-unt-row="SSR_CLSRCH_R2"] button').click();
    await panel.reload();
    await panel.locator("#confirm").filter({hasText:"ENGL 1310"}).waitFor();
    await fetch(`${STUB}/__advance`,{method:"POST"});
    await panel.locator("#confirm").click();
    await panel.locator("#notice").filter({hasText:"Review the fresh preview"}).waitFor();
    const fresh = await panel.evaluate(() => chrome.runtime.sendMessage({type:"panel/status"}));
    if (fresh.preview.preview.revision !== 2) throw new Error("Stale revision did not load a fresh preview");
    if ((await (await fetch(`${STUB}/__observed`)).json()).writes.length !== 0) throw new Error("Stale revision silently applied");
    await page.locator('[data-unt-row="SSR_CLSRCH_R2"][data-unt-marker="conflict"]').waitFor();
    step("stale add rejected and refreshed both the panel and page marker before reconfirmation");
    await fetch(`${STUB}/__drop-next`,{method:"POST"});
    await panel.locator("#confirm").click();
    await panel.locator("#notice").filter({hasText:"Waiting to sync"}).waitFor();
    const stored = await worker.evaluate(async () => chrome.storage.local.get(null));
    const pendingKey = Object.keys(stored).find(key=>key.startsWith("add:"));
    if (!pendingKey) throw new Error("Confirmed add was not retained after a lost response");
    const operationId = stored[pendingKey].command.operationId;
    await panel.screenshot({path:path.join(artifactsDir,"v1-waiting-to-sync.png")});
    await context.close();
    // Restart the browser with the same profile. The MV3 worker must replay
    // from local storage without a page message or a second confirmation.
    context = await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,args:[`--disable-extensions-except=${distDir}`,`--load-extension=${distDir}`]});
    const restartedPanel=await context.newPage();
    await restartedPanel.goto(`chrome-extension://${extensionId}/popup.html`);
    await restartedPanel.waitForFunction(async () => !Object.keys(await chrome.storage.local.get(null)).some(key=>key.startsWith("add:")));
    const observed=await (await fetch(`${STUB}/__observed`)).json();
    if (observed.writes.length !== 1 || observed.writes[0].operationId !== operationId || observed.writes[0].expectedRevision !== 2) throw new Error("Restart duplicated or changed the confirmed operation");
    if (observed.requests.some(r=>r.cookie)) throw new Error("The worker sent session cookies");
    if (observed.requests.filter(r=>r.path==="/api/v1/extension/commands").length !== 3) throw new Error("Expected stale, committed and replay requests");
    await restartedPanel.locator("#notice").filter({hasText:"Added to Main."}).waitFor();
    if (await restartedPanel.locator("#confirm").isVisible()) throw new Error("Receipt left a duplicate add action");
    await restartedPanel.screenshot({path:path.join(artifactsDir,"v1-restarted.png")});
    const transcript=await context.newPage(); await transcript.goto(`${MOCK}/transcript`);
    if (await transcript.locator("[data-unt-row]").count()) throw new Error("Content script ran outside class search");
    step("ALL ASSERTIONS PASSED: device sign-in, markers, private panel, stale preview and restart replay");
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
