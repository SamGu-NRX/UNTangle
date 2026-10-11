/**
 * ui-contract — locators and helpers built strictly from evals/CONTRACT.md.
 *
 * Every role/name here comes from the contract. When the contract marks an
 * element REQUIRED but the head under test does not expose it, the honest
 * behavior is: the case fails and its note names the missing contract element
 * (see missingElement). Helpers never silently skip.
 */
import type { Locator, Page } from "playwright";
import { settle } from "./ui-browser";

export const COURSES = "/courses";
export const SCHEDULE = "/schedule";
export const MAP = "/map";
export const PLANS = "/plans";

/**
 * Activate a control despite overlapping/animating layout: pointer click first;
 * on interception fall back to keyboard activation (focus + Enter), which is
 * the behavior the journeys assert anyway.
 */
export async function activate(page: Page, locator: Locator): Promise<void> {
  try {
    await locator.click({ timeout: 8_000 });
  } catch {
    await locator.focus({ timeout: 5_000 });
    await page.keyboard.press("Enter");
  }
}

/**
 * The major-selection modal opens on a fresh planner when no major is chosen
 * and cannot be dismissed without choosing one. It may hydrate in late (12s+
 * observed), so wait generously. Pointer clicks can be clipped at mobile
 * widths — retry with focus + Enter — and the dialog must close before the
 * journey continues.
 */
export async function chooseMajorIfOpen(page: Page): Promise<void> {
  const dialog = page.getByRole("dialog");
  const opened = await dialog.isVisible({ timeout: 14_000 }).catch(() => false);
  if (!opened) return;

  const cs = dialog.getByRole("button", { name: "Computer Science" }).first();
  try {
    await cs.click({ timeout: 8_000 });
  } catch {
    await cs.focus({ timeout: 5_000 });
    await page.keyboard.press("Enter");
  }
  const confirm = dialog.getByRole("button", { name: /^Confirm/ }).first();
  try {
    await confirm.click({ timeout: 8_000 });
  } catch {
    await confirm.focus({ timeout: 5_000 });
    await page.keyboard.press("Enter");
  }
  await dialog.waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The course row whose own code element starts with the exact code — never a
 * row that merely mentions the code in a prerequisite list. Rows render the
 * code in `.course-row__meta` text (no heading), so anchor on the meta span.
 */
export function courseRow(page: Page, code: string): Locator {
  const codeMeta = page
    .locator(".course-row__meta")
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(code)}\\b`) })
    .first();
  return page.locator("article.course-row").filter({ has: codeMeta });
}

/** Read the displayed code of the nth visible course row, or null. */
export async function courseCodeAt(page: Page, index: number): Promise<string | null> {
  const row = page.locator("article.course-row").nth(index);
  if ((await row.count()) === 0) return null;
  // The code renders in .course-row__meta ("CSCE 1010 · 3 cr"), not a heading.
  const text = (await row.textContent({ timeout: 8_000 }).catch(() => null)) ?? "";
  const match = text.match(/\b[A-Z]{2,4}\s\d{4}\b/);
  return match?.[0] ?? null;
}

/** Mark a course as taking via its row status buttons (contract: /courses). */
export async function markCourseTaking(page: Page, code: string): Promise<void> {
  await activate(page, courseRow(page, code).getByRole("button", { name: "Taking", exact: true }).first());
}

/**
 * Wait until the visible first course row reflects the searched prefix. The
 * page filters client-side via useDeferredValue, and the unfiltered catalog
 * can linger for a while on a loaded host — reading codes before this resolves
 * yields codes whose rows the filter is about to remove.
 */
export async function waitForFilteredRows(page: Page, term: string, timeoutMs = 45_000): Promise<void> {
  const firstRow = page.locator("article.course-row").first();
  const pattern = new RegExp(`\\b${escapeRegExp(term.toUpperCase())}\\s?\\d{4}\\b`);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const text = (await firstRow.textContent({ timeout: 5_000 }).catch(() => null)) ?? "";
    if (pattern.test(text)) return;
    if (Date.now() > deadline) {
      throw new Error(`course list never reflected the search "${term}" within ${timeoutMs}ms (first row: ${text.slice(0, 80) || "none"})`);
    }
    await page.waitForTimeout(400);
  }
}

/** Mark `count` courses taking, then follow the Optimize step-link to /schedule. */
export async function activateCoursesAndOpenSchedule(page: Page, count: number, searchTerm?: string): Promise<string[]> {
  if (searchTerm) await waitForFilteredRows(page, searchTerm);
  const codes: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const code = await courseCodeAt(page, i);
    if (!code) break;
    await markCourseTaking(page, code);
    codes.push(code);
  }
  await activate(page, page.getByRole("link", { name: "Optimize schedule →" }).first());
  await page.waitForURL("**/schedule", { timeout: 20_000 });
  return codes;
}

/**
 * Navigate to a course-detail route and fail the case precisely when the head
 * shows the branded not-found state — observed when the harness boots an
 * unseeded backend, so the note carries that context instead of a late
 * unrelated timeout.
 */
export async function expectDetailNot404(page: Page, detailPath: string): Promise<void> {
  await page.goto(detailPath, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await settle(page);
  const notFound = page.getByRole("heading", { name: /Course not found/i }).first();
  const missing = await notFound.isVisible({ timeout: 6_000 }).catch(() => false);
  if (missing) {
    throw new Error(
      `course detail unreachable on this head: ${detailPath} rendered the branded 'Course not found' state — ` +
        "the harness boots the pinned backend with an empty database (no seeded courses), so no detail page exists to assert against",
    );
  }
}

export type MissingProbe = { present: true } | { present: false; reason: string };

/**
 * Honest REQUIRED-element probe: resolves to present:false with a note naming
 * the contract element when the head does not expose it. Cases turn that into
 * a failing outcome with the note attached — never into a silent skip.
 */
export async function missingElement(locator: Locator, contractDescription: string, timeoutMs = 8_000): Promise<MissingProbe> {
  const visible = await locator.isVisible({ timeout: timeoutMs }).catch(() => false);
  if (visible) return { present: true };
  return { present: false, reason: `Required contract surface absent: ${contractDescription}` };
}
