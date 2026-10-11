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
  return { browser, context, page };
}

/** Close everything opened by openCase. Errors are recorded, not thrown. */
export async function closeCase(cb: CaseBrowser): Promise<void> {
  for (const closer of [
    () => cb.context.close(),
    () => cb.browser.close(),
  ]) {
    try {
      await closer();
    } catch {
      // A crashed browser must not mask the case's own result.
    }
  }
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
