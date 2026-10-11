// M0 evidence: reproduces the current broken /map states end-to-end against
// the dev server and captures screenshots into tests/e2e/__evidence__/m0/.
//
// These tests assert only stable baselines (the page renders, the seeded
// itinerary is right). The UX gaps themselves - empty-day dead end, single
// stop dashes, unexplained duplicates, eternal "lookup" - are DOCUMENTED in
// the screenshots; the failing-first bun tests own the assertions that flip
// once the fixes land.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import {
  buildingCoordsById,
  duplicateStopMondayPicks,
  fakeOrsRouteResponse,
  fakeResolveLocations,
  fixtureTilePngBase64,
  multiStopMondayPicks,
  plannerStateFromPicks,
  singleStopMondayPicks,
  unresolvedStopMondayPicks,
} from "../fixtures/map-fixtures";

const evidenceDir = join(__dirname, "__evidence__", "m0");

const tileBuffer = Buffer.from(fixtureTilePngBase64, "base64");

async function capture(page: Page, name: string) {
  mkdirSync(evidenceDir, { recursive: true });
  await page.screenshot({ path: join(evidenceDir, `${name}.png`), fullPage: true });
}

/**
 * Seeds the guest planner with the given picks before the app scripts run and
 * stubs every outbound map dependency: fixture tiles instead of OSM, an
 * identity-echoing resolve provider, and a synthetic route response.
 * ntdp (Discovery Park) resolves as unresolved, matching real behavior.
 */
async function openMapWith(page: Page, picks: ReturnType<typeof multiStopMondayPicks>) {
  await page.route(/basemaps\.cartocdn\.com/, async (route) => {
    await route.fulfill({ status: 200, body: tileBuffer, contentType: "image/png" });
  });

  await page.route("**/api/map/resolve", async (route) => {
    const body = route.request().postDataJSON() as {
      locations?: Array<{ location: string; buildingId?: string }>;
    };
    const resolved = new Map<string, { lat: number; lng: number }>();
    for (const entry of body.locations ?? []) {
      if (entry.buildingId && entry.buildingId !== "ntdp") {
        resolved.set(`${entry.buildingId}|${entry.location.trim().toLowerCase()}`, buildingCoordsById(entry.buildingId));
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fakeResolveLocations(body.locations ?? [], resolved)),
    });
  });

  await page.route("**/api/map/route", async (route) => {
    const body = route.request().postDataJSON() as { stops?: Array<{ lat: number; lng: number }> };
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(fakeOrsRouteResponse(body.stops ?? [])),
    });
  });

  await page.addInitScript((state) => {
    window.sessionStorage.setItem("untangle-planner-state", JSON.stringify(state));
  }, plannerStateFromPicks("Mon", picks));

  await page.goto("/map");
}

test.describe("M0 broken /map states", () => {
  test("multi-stop Monday renders the seeded itinerary", async ({ page }) => {
    const picks = multiStopMondayPicks();
    await openMapWith(page, picks);

    const stopItems = page.locator(".stop-item");
    await expect(stopItems).toHaveCount(3, { timeout: 30_000 });
    await expect(page.getByText("3 stops")).toBeVisible();
    await capture(page, "01-multistop-baseline");
  });

  test("empty Tuesday dead-ends without an action", async ({ page }) => {
    await openMapWith(page, multiStopMondayPicks());
    await expect(page.locator(".stop-item")).toHaveCount(3, { timeout: 30_000 });

    await page.getByRole("tab", { name: "Tue" }).click();
    await expect(page.getByText("No classes scheduled on Tue.")).toBeVisible();
    // Documents the gap: the only way out is manually clicking another tab.
    const jumpButton = page.getByRole("button", { name: /show monday/i });
    await capture(page, "02-empty-day-dead-end");
    expect(await jumpButton.count()).toBe(0);
  });

  test("single-stop Monday shows placeholder dashes", async ({ page }) => {
    await openMapWith(page, singleStopMondayPicks());

    await expect(page.getByText("1 stop")).toBeVisible({ timeout: 30_000 });
    // Documents the gap: meaningless "-" chips beside a one-stop day.
    await expect(page.locator("span", { hasText: /^-$/ }).first()).toBeVisible();
    await capture(page, "03-single-stop-dashes");
  });

  test("duplicate same-building stops lack an explanation", async ({ page }) => {
    await openMapWith(page, duplicateStopMondayPicks());

    await expect(page.getByText("3 stops")).toBeVisible({ timeout: 30_000 });
    // Documents the gap: two cards in the same building, no collapse note.
    const explanation = page.getByText(/same building|one visit|routed as/i);
    await capture(page, "04-duplicate-unexplained");
    expect(await explanation.count()).toBe(0);
  });

  test("off-bounds building is stuck as lookup", async ({ page }) => {
    await openMapWith(page, unresolvedStopMondayPicks());

    await expect(page.locator(".stop-item")).toHaveCount(2, { timeout: 30_000 });
    // Documents the gap: the chip never resolves to an explicit state.
    await expect(page.getByText(/lookup/i).first()).toBeVisible({ timeout: 20_000 });
    await capture(page, "05-unresolved-lookup-chip");
  });
});
