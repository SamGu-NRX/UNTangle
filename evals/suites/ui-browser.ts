/**
 * ui-browser — real-browser setup for the UI suites.
 *
 * One fresh Chromium per case (launch + close inside the case) so long suite
 * runs cannot accumulate contexts/file descriptors across cases. The
 * PLAYWRIGHT_BROWSERS_PATH env (set by the operator) selects the browser cache;
 * Playwright resolves it itself.
 */
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

export type ViewportName = "desktop" | "mobile";

export const VIEWPORTS: Record<ViewportName, { width: number; height: number }> = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

export interface CaseBrowser {
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

/**
 * Every browser openCase launched that nobody has closed yet. A case that
 * throws before its own close — the planted-defect shape: a persona
 * activation that times out — would otherwise leak the browser: the transport
 * pipes keep bun's event loop alive, so run.ts writes its scorecard and then
 * never exits (observed on the round-2 journey run 1792408147072, where all
 * 28 case browsers outlived the completed run).
 */
const openCases = new Set<CaseBrowser>();

/**
 * Launch a fresh browser + context for one case and land on the app root.
 * `pathname` may carry a query (e.g. "/courses?q=CSCE"); it is appended to the
 * origin exactly as given.
 */
export async function openCase(origin: string, viewport: ViewportName, pathname = "/"): Promise<CaseBrowser> {
  const browser = await launchWithRetry();
  const context = await browser.newContext({
    viewport: VIEWPORTS[viewport],
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  await page.goto(`${origin}${pathname}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  const cb: CaseBrowser = { browser, context, page };
  openCases.add(cb);
  return cb;
}

/** Close everything opened by openCase. Errors are recorded, not thrown. */
export async function closeCase(cb: CaseBrowser): Promise<void> {
  openCases.delete(cb);
  // A browser that dies mid-case (OOM, SIGKILL) can leave close() awaiting a
  // transport that will never answer — the round-2 journey run 1792409956203
  // parked ~20 minutes inside close after its case browser vanished. Cleanup
  // must be fail-safe in TIME, not only in error handling: bound every step
  // and keep going regardless of how it ends.
  await boundedClose(cb.context.close(), "context.close()");
  await boundedClose(cb.browser.close(), "browser.close()");
}

const CLOSE_STEP_TIMEOUT_MS = 10_000;

/**
 * Bun 1.3.14 on this host intermittently fails out of its child_process stdio
 * plumbing during chromium launch (`connect ENOENT`, and later "Failed to
 * connect" — diagnostic run 2026-10-19 around map-registered-desktop, a11y run
 * 2026-10-19 around axe-auth). Three attempts with growing delays turn those
 * transients into recovered launches instead of dead suites.
 */
const LAUNCH_DELAYS_MS = [2_000, 5_000];

async function launchWithRetry(): Promise<Browser> {
  for (let attempt = 1; attempt <= LAUNCH_DELAYS_MS.length + 1; attempt++) {
    try {
      return await chromium.launch({ headless: true });
    } catch (error) {
      if (attempt > LAUNCH_DELAYS_MS.length) throw error;
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[ui-browser] chromium.launch failed (${message}) — retrying (attempt ${attempt + 1}/3)`);
      await new Promise((resolve) => setTimeout(resolve, LAUNCH_DELAYS_MS[attempt - 1]));
    }
  }
  throw new Error("unreachable: launchWithRetry attempts exhausted");
}

function boundedClose(promise: Promise<void>, what: string): Promise<void> {
  return Promise.race([
    promise.then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      setTimeout(() => {
        console.error(`[ui-browser] ${what} did not finish within ${CLOSE_STEP_TIMEOUT_MS}ms — continuing`);
        resolve();
      }, CLOSE_STEP_TIMEOUT_MS);
    }),
  ]);
}

/**
 * Boundary drain for a suite's case dispatch: closes whatever the case left
 * open (including a browser from an enter/activation that threw before the
 * caller could hold the handle). A no-op when every path already closed its
 * own browser — the normal case.
 */
export async function closeTrackedCases(): Promise<void> {
  const pending = Array.from(openCases);
  openCases.clear();
  for (const cb of pending) await closeCase(cb);
}

/** Let hydration/route transitions finish: network idle (best-effort) + a beat. */
export async function settle(page: Page, extraMs = 400): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(extraMs);
}

/** Full-page screenshot into the run's evidence dir; returns the path. */
export async function screenshot(page: Page, dir: string, name: string): Promise<string> {
  const path = `${dir}/${name.replace(/[^a-z0-9-]+/gi, "_")}.png`;
  await page.screenshot({ path, fullPage: true }).catch(() => {});
  return path;
}
