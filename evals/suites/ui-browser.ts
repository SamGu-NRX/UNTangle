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
  const browser = await chromium.launch({ headless: true });
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
