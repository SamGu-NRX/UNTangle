#!/usr/bin/env node
/**
 * End-to-end journey: load the built extension into Chromium, open the mock
 * myUNT class-search page served by tools/mock-myunt, and assert the three
 * behaviors against the contract-accurate local stub:
 *
 *   1. the row colliding with the seeded Main schedule shows the conflict badge,
 *   2. the free row shows a clear verdict and the async row a cannot-check verdict,
 *   3. the instructor panel shows grade history, and Add posts the merged
 *      planner state (observed at the stub) and flips the row to Added.
 *
 * Offline by construction: the only servers are the local stub and the local
 * mock; the only network fetch permitted beyond localhost is the one-time
 * `playwright install chromium`.
 *
 * Run: node extension/e2e/extension.journey.mjs
 * (after `bun --no-env-file x playwright install chromium` once)
 */
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
const SECTION_ENGL = "vsb:spring-2027:ENGL 1310:005";

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

async function waitForSelector(page, selector, label, timeoutMs = 20000) {
  try {
    await page.waitForSelector(selector, { timeout: timeoutMs });
    return true;
  } catch {
    fail(`${label} did not appear (${selector})`);
    return false;
  }
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

    // Seed the student session the way a signed-in tab would have it: the
    // stub's /session page sets the Better Auth session cookie.
    const seed = await context.newPage();
    await seed.goto(`${STUB}/session`);
    await seed.waitForSelector("#session");
    await seed.close();
    step("stub session cookie seeded");

    const page = await context.newPage();
    await page.goto(`${MOCK}/class-search`);
    step("opened the mock class-search page");

    const results = [];
    const check = (ok, label) => {
      console.log(`journey ${ok ? "OK" : "FAIL"}: ${label}`);
      results.push({ ok, label });
      return ok;
    };

    // 1. The colliding row shows the Main-schedule conflict badge.
    const conflictOk =
      (await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R1"] [data-unt-badge="conflict"]', "the conflict badge")) &&
      check((await page.textContent('[data-unt-row="SSR_CLSRCH_R1"] [data-unt-badge="conflict"]')).includes("Conflicts with Main"), "row 1 shows the Main-schedule conflict badge");

    // 2. The free row clears; the async row cannot be checked.
    const clearOk =
      (await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R2"] [data-unt-badge="clear"]', "the clear verdict")) &&
      check((await page.textContent('[data-unt-row="SSR_CLSRCH_R2"] [data-unt-badge="clear"]')).includes("No conflict with Main"), "row 2 shows a clear verdict");
    const unknownOk = await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R3"] [data-unt-badge="unknown"]', "the cannot-check verdict on the async row");

    // 3. Grade history renders for the matched instructor.
    const gradesOk =
      (await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R1"] [data-unt-grades="history"]', "the grade history panel")) &&
      check((await page.textContent('[data-unt-row="SSR_CLSRCH_R1"] [data-unt-grades="history"]')).includes("GPA 3.40"), "row 1 shows John Smith's CSCE 1030 grade history");
    const noHistoryOk = await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R2"] [data-unt-grades="no-history"]', "the honest no-history state on row 2");

    await page.screenshot({ path: path.join(artifactsDir, "01-conflict-badges-and-grades.png"), fullPage: true });
    step("screenshot 01 written");

    // 4. Add the free row to Main; the stub must observe the merged write.
    const addButton = page.locator('[data-unt-row="SSR_CLSRCH_R2"] [data-unt-add="idle"]');
    await addButton.click();
    const addedOk =
      (await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R2"] [data-unt-add="added"]', "the Added state")) &&
      check((await page.textContent('[data-unt-row="SSR_CLSRCH_R2"] [data-unt-add="added"]')).includes("Added to Main"), "row 2 flips to Added to Main");

    const observed = await (await fetch(`${STUB}/__observed`)).json();
    const lastWrite = observed.writes.at(-1);
    if (lastWrite === undefined) fail("the stub observed no planner write");
    else console.log(`journey: last observed write: ${JSON.stringify(lastWrite)}`);
    const writeOk =
      lastWrite !== undefined &&
      check(lastWrite.header === "1", "the write carried X-Planner-Base-Revision 1") &&
      check(lastWrite.body?.selectedSections?.["ENGL 1310"] === SECTION_ENGL, "the stub observed ENGL 1310 added") &&
      check(lastWrite.body?.selectedSections?.["CSCE 1040"] === "vsb:spring-2027:CSCE 1040:10001", "the write preserved the existing Main schedule");

    // The add changed the schedule: the other rows' annotations rebuild and
    // re-request their facts. Wait for the settled badges so the screenshot
    // shows final verdicts, and prove the refresh actually recomputed them.
    const conflictRefreshedOk = check(
      await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R1"] [data-unt-badge="conflict"]', "row 1's refreshed conflict badge"),
      "row 1 still conflicts with the new Main schedule after the add",
    );
    const unknownRefreshedOk = check(
      await waitForSelector(page, '[data-unt-row="SSR_CLSRCH_R3"] [data-unt-badge="unknown"]', "row 3's refreshed cannot-check badge"),
      "row 3 still cannot be checked against Main after the add",
    );

    await page.screenshot({ path: path.join(artifactsDir, "02-added-to-main.png"), fullPage: true });
    step("screenshot 02 written");

    const allOk = conflictOk && clearOk && unknownOk && gradesOk && noHistoryOk && addedOk && writeOk && conflictRefreshedOk && unknownRefreshedOk;
    if (!allOk) fail("one or more journey assertions did not hold");
    else console.log("journey: ALL ASSERTIONS PASSED");
  } catch (error) {
    fail(String(error));
  } finally {
    if (context) await context.close().catch(() => {});
    stub.kill();
    mock.kill();
    if (userDataDir) rmSync(userDataDir, { recursive: true, force: true });
  }
}

main();
