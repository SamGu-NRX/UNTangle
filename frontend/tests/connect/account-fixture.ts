import type {
  BrowserContext,
  Page,
} from "../../../extension/node_modules/@playwright/test/index.js";
import { getInitialPlannerState } from "../../src/lib/planner";
import type { PlannerState } from "../../src/lib/types";

export async function accountFixture(context: BrowserContext) {
  let clockInstalled = false;
  let userId = "synthetic-a";
  let failure: "none" | "conflict" | "signed-out" = "none";
  let state: PlannerState | null = null;
  let revision = 0;
  const posts: {
    userId: string;
    status: number;
    state: PlannerState;
    base: string | undefined;
  }[] = [];
  await context.route("**/api/auth/get-session**", (route) =>
    route.fulfill({
      json: {
        user: {
          id: userId,
          name: "Synthetic account",
          email: `${userId}@my.unt.edu`,
          emailVerified: true,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        session: {
          id: `session-${userId}`,
          token: "fabricated-test-token",
          userId,
          expiresAt: "2030-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  await context.route("**/api/planner", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { state, revision, persistent: true } });
    const incoming = route.request().postDataJSON() as PlannerState;
    const base = route.request().headers()["x-planner-base-revision"];
    if (failure === "signed-out") {
      posts.push({ userId, status: 401, state: incoming, base });
      return route.fulfill({
        status: 401,
        json: { error: "Synthetic expired session" },
      });
    }
    if (failure === "conflict") {
      failure = "none";
      state = { ...getInitialPlannerState(), optimization: "clusterNight" };
      revision += 1;
      posts.push({ userId, status: 409, state: incoming, base });
      return route.fulfill({ status: 409, json: { state, revision } });
    }
    state = incoming;
    revision += 1;
    posts.push({ userId, status: 200, state: incoming, base });
    return route.fulfill({ json: { state, revision, persistent: true } });
  });
  return {
    posts,
    failNext(kind: typeof failure) {
      failure = kind;
    },
    get state() {
      return state;
    },
    async switchTo(page: Page, next: string) {
      userId = next;
      state = null;
      revision = 0;
      // Better Auth refetches on visibility changes; clock time avoids its documented five-second focus rate limit.
      if (!clockInstalled) { await page.clock.install(); clockInstalled = true; }
      await page.clock.runFor(6000);
      await page.evaluate(() =>
        document.dispatchEvent(new Event("visibilitychange")),
      );
      await page.clock.resume();
    },
  };
}
