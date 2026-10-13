/// <reference path="../../../extension/node_modules/@types/chrome/index.d.ts" />
import {
  test,
  expect,
  chromium,
  type Page,
  type BrowserContext,
} from "../../../extension/node_modules/@playwright/test/index.js";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { accountFixture } from "./account-fixture";
import { syntheticPdf } from "../../../tools/mock-myunt/pdf";
const root = resolve(__dirname, "../../..");
const evidence = resolve(root, "extension/evidence");
async function context(extension: boolean) {
  const path = resolve(root, "extension/dist-dev");
  const ctx = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: true,
    viewport: { width: 390, height: 844 },
    recordVideo: {
      dir: resolve(root, "extension/test-results/videos"),
      size: { width: 390, height: 844 },
    },
    args: extension
      ? [`--disable-extensions-except=${path}`, `--load-extension=${path}`]
      : [],
  });
  await ctx.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      ["localhost", "127.0.0.1"].includes(url.hostname) ||
      ["chrome-extension:", "data:", "blob:"].includes(url.protocol)
    )
      return route.continue();
    return route.abort();
  });
  return ctx;
}
async function shot(page: Page, name: string) {
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: resolve(evidence, `${name}.png`),
    fullPage: true,
  });
}
async function request(page: Page, resource: "transcript" | "sections") {
  return page.evaluate(
    (resource) =>
      new Promise<unknown>((resolve) => {
        const nonce = crypto.randomUUID();
        const timer = setTimeout(() => resolve("timeout"), 10_000);
        function receive(event: MessageEvent) {
          if (
            event.source !== window ||
            event.origin !== location.origin ||
            event.data?.from !== "extension" ||
            event.data?.nonce !== nonce ||
            !["result", "error"].includes(event.data?.type)
          )
            return;
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          resolve(event.data);
        }
        window.addEventListener("message", receive);
        window.postMessage(
          {
            channel: "untangle-connect",
            version: 1,
            from: "app",
            type: "request",
            nonce,
            resource,
          },
          location.origin,
        );
      }),
    resource,
  );
}
async function popup(ctx: BrowserContext) {
  const worker =
    ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const page = await ctx.newPage();
  await page.goto(
    `chrome-extension://${new URL(worker.url()).host}/popup.html`,
  );
  await expect(
    page.getByRole("heading", { name: "Send to UNTangle" }),
  ).toBeVisible();
  return page;
}
async function approvePending(ctx: BrowserContext) {
  const page = await popup(ctx);
  await expect(
    page.getByRole("button", { name: "Send to UNTangle" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Send to UNTangle" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Sent to the requesting",
  );
  await page.close();
}
async function upload(page: Page) {
  await expect(
    page.getByLabel("Upload transcript PDF", { exact: true }),
  ).toBeEnabled();
  await page
    .getByLabel("Upload transcript PDF", { exact: true })
    .setInputFiles({
      name: "synthetic.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from(syntheticPdf()),
    });
  await expect(
    page.getByRole("heading", { name: "Review your courses" }),
  ).toBeVisible();
}
async function saveOne(page: Page) {
  await page
    .getByRole("checkbox", { name: "Include CSCE 1030", exact: true })
    .check();
  await page.getByRole("button", { name: "Save 1 course" }).click();
}
test("extension PDF handshake reaches course review and saves approved courses", async () => {
  test.setTimeout(90_000);
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    const video = page.video();
    if (video)
      await writeFile(
        resolve(root, "extension/test-results/connect-video-source.txt"),
        await video.path(),
      );
    await page.goto("http://127.0.0.1:3000/connect");
    await expect(
      page.getByRole("button", { name: "Connect myUNT" }),
    ).toBeDisabled();
    await shot(page, "permission-mobile");
    await page.getByRole("checkbox", { name: "I allow" }).check();
    await page.getByRole("button", { name: "Connect myUNT" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Waiting for your approval",
    );
    await shot(page, "waiting-mobile");
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>((resolve) => {
      releaseDownload = resolve;
    });
    await ctx.route("**/synthetic-transcript.pdf", async (route) => {
      await downloadGate;
      await route.continue();
    });
    await ctx.route("**/*pdf.worker*", async (route) => {
      await shot(page, "parsing-mobile");
      await route.continue();
    });
    // A real elapsed wait crosses MV3's 30-second idle threshold, proving the heartbeat rather than just the fast path.
    const started = Date.now();
    await page.waitForFunction(
      (started) => Date.now() - started >= 35_000,
      started,
      { timeout: 40_000 },
    );
    await expect(page.getByRole("status")).toContainText(
      "Waiting for your approval",
    );
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-entry");
    await expect(page.getByRole("status")).toContainText(
      "Waiting for your approval",
    );
    await report.getByRole("link", { name: "Submit and View Report" }).click();
    await expect(
      report.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeVisible();
    const approval = await popup(ctx);
    await expect(
      approval.getByText("http://127.0.0.1:3000", { exact: true }),
    ).toBeVisible();
    await shot(approval, "extension-approval");
    await approval.getByRole("button", { name: "Send to UNTangle" }).click();
    await expect(page.getByRole("status")).toContainText("Reading your report");
    await shot(page, "reading-mobile");
    releaseDownload();
    await expect(
      page.getByRole("heading", { name: "Review your courses" }),
    ).toBeVisible();
    for (const course of ["CSCE 1030", "MATH 1650", "ENGL 1310", "CSCE 1040"])
      await expect(
        page.getByRole("checkbox", { name: `Include ${course}` }),
      ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save selected courses" }),
    ).toBeDisabled();
    await shot(page, "review-mobile");
    await page
      .getByRole("checkbox", { name: "Include CSCE 1030", exact: true })
      .check();
    await page.getByRole("button", { name: "Save 1 course" }).click();
    await expect(
      page.getByText("1 course added to your plan.", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Save state" }),
    ).toContainText("Saved");
    await shot(page, "saved-mobile");
    await expect
      .poll(() => page.evaluate(() => Object.values(localStorage).join("\n")))
      .toContain('"CSCE 1030":"completed"');
    const stored = await page.evaluate(() =>
      Object.values(localStorage).join("\n"),
    );
    expect(stored).toContain('"CSCE 1030":"completed"');
    const imported = await page.evaluate(
      () =>
        Object.values(localStorage)
          .map((raw) => JSON.parse(raw))
          .find((value) => value.storeSchemaVersion === 1)?.state
          .transcriptRecords,
    );
    expect(imported.map((row: { code: string }) => row.code)).toEqual([
      "CSCE 1030",
    ]);
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Connect myUNT", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => Object.values(localStorage).join("\n")),
    ).toContain('"CSCE 1030":"completed"');
    await page.setViewportSize({ width: 1440, height: 1000 });
    await shot(page, "permission-desktop");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await shot(page, "permission-desktop-reduced-motion");
    await report.close();
    const search = await ctx.newPage();
    await search.goto("http://localhost:4317/class-search");
    const sections = request(page, "sections");
    await approvePending(ctx);
    const result = (await sections) as { payload: { rows: unknown[] } };
    expect(result.payload.rows).toEqual([
      {
        course: "CSCE 1030",
        section: "001",
        days: "MWF",
        times: "10:00 AM - 10:50 AM",
        room: "Discovery Park B155",
        instructor: "Example Instructor",
        status: "Open",
      },
    ]);
  } finally {
    await ctx.close();
  }
});
test("no extension falls back to PDF upload with keyboard and reduced-motion access", async () => {
  const ctx = await context(false);
  try {
    const page = await ctx.newPage();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://127.0.0.1:3000/connect");
    await page.getByRole("checkbox", { name: "I allow" }).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Connect myUNT" }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("region", { name: "Connect myUNT" }).getByRole("alert"),
    ).toContainText("extension wasn't found");
    await shot(page, "fallback-mobile");
    await page
      .getByLabel("Upload transcript PDF", { exact: true })
      .setInputFiles({
        name: "synthetic.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(syntheticPdf()),
      });
    await expect(
      page.getByRole("heading", { name: "Review your courses" }),
    ).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true }),
    ).toBeVisible();
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(
      await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth),
    ).toBe(true);
    await shot(page, "review-320-reduced-motion");
    await page
      .getByRole("checkbox", { name: "Include CSCE 1030", exact: true })
      .focus();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Save 1 course" }).focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("heading", { name: "Your courses are ready" }),
    ).toBeFocused();
  } finally {
    await ctx.close();
  }
});
test("rendered report works; multiple reports and cross-tab requests fail closed", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    const a = await ctx.newPage();
    await a.goto("http://localhost:4317/transcript-report?rendered");
    const renderedRequest = request(page, "transcript");
    await approvePending(ctx);
    const rendered = (await renderedRequest) as {
      payload: { kind: string; text: string };
    };
    expect(rendered.payload.kind).toBe("transcript-text");
    expect(rendered.payload.text).toContain("CSCE 1030");
    const b = await ctx.newPage();
    await b.goto("http://localhost:4317/transcript-report");
    const ambiguous = request(page, "transcript");
    const confirmation = await popup(ctx);
    await expect(
      confirmation.getByText("Close extra report tabs before approving."),
    ).toBeVisible();
    await expect(
      confirmation.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeDisabled();
    await b.close();
    await expect(
      confirmation.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeEnabled();
    await confirmation
      .getByRole("button", { name: "Send to UNTangle" })
      .click();
    expect(await ambiguous).toMatchObject({ type: "result" });
    await a.close();
    const waiting = request(page, "transcript");
    const other = await ctx.newPage();
    await other.goto("http://127.0.0.1:3000/connect");
    expect(await request(other, "transcript")).toMatchObject({
      type: "error",
      reason: "BUSY",
    });
    await page.close();
    await waiting.catch(() => {});
    await other.getByRole("checkbox", { name: "I allow" }).check();
    await other.getByRole("button", { name: "Connect myUNT" }).click();
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-report");
    await approvePending(ctx);
    await expect(
      other.getByRole("heading", { name: "Review your courses" }),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("route changes revoke the bridge and a cancelled request cannot deliver", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await page.getByRole("checkbox", { name: "I allow" }).check();
    await page.getByRole("button", { name: "Connect myUNT" }).click();
    await expect(
      page.getByRole("button", { name: "Cancel connection" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Cancel connection" }).click();
    await expect(
      page.getByRole("button", { name: "Connect myUNT" }),
    ).toBeFocused();
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-report");
    await page.evaluate(() => history.pushState({}, "", "/courses"));
    const replied = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const nonce = crypto.randomUUID();
          let replied = false;
          const listener = (e: MessageEvent) => {
            if (e.data?.nonce === nonce && e.data?.from === "extension")
              replied = true;
          };
          window.addEventListener("message", listener);
          window.postMessage(
            {
              channel: "untangle-connect",
              version: 1,
              from: "app",
              type: "request",
              nonce,
              resource: "transcript",
            },
            location.origin,
          );
          setTimeout(() => {
            window.removeEventListener("message", listener);
            resolve(replied);
          }, 600);
        }),
    );
    expect(replied).toBe(false);
    await page.evaluate(() => history.pushState({}, "", "/connect"));
    const resumed = request(page, "transcript");
    await approvePending(ctx);
    expect(await resumed).toMatchObject({
      type: "result",
      payload: { kind: "pdf" },
    });
    await expect(
      page.getByRole("heading", { name: "Connect myUNT", exact: true }),
    ).toBeVisible();
  } finally {
    await ctx.close();
  }
});

test("an upload error retry without consent returns to permission and sends no request", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await page.evaluate(() => {
      (window as unknown as { connectRequests: number }).connectRequests = 0;
      window.addEventListener("message", (event) => {
        if (event.data?.from === "app" && event.data?.type === "request")
          (window as unknown as { connectRequests: number }).connectRequests++;
      });
    });
    await expect(
      page.getByLabel("Upload transcript PDF", { exact: true }),
    ).toBeEnabled();
    await page
      .getByLabel("Upload transcript PDF", { exact: true })
      .setInputFiles({
        name: "bad.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from("not a PDF"),
      });
    await page.getByRole("button", { name: "Try Connect again" }).click();
    await expect(
      page.getByRole("checkbox", { name: "I allow" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("button", { name: "Connect myUNT" }),
    ).toBeDisabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { connectRequests: number }).connectRequests,
      ),
    ).toBe(0);
  } finally {
    await ctx.close();
  }
});

test("a forged request and synthetic popup click cannot read; stale approval cannot approve a new port", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-report");
    let downloads = 0;
    ctx.on("request", (req) => {
      if (req.url().endsWith("synthetic-transcript.pdf")) downloads++;
    });
    const first = request(page, "transcript");
    const approval = await popup(ctx);
    await expect(
      approval.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeEnabled();
    const stale = await approval.evaluate(() =>
      chrome.runtime.sendMessage({ type: "status" }),
    );
    await approval
      .getByRole("button", { name: "Send to UNTangle" })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(approval.getByRole("status")).toContainText(
      "import is waiting",
    );
    expect(downloads).toBe(0);
    await page.close();
    await first.catch(() => {});
    const next = await ctx.newPage();
    await next.goto("http://localhost:3000/connect");
    const second = request(next, "transcript");
    await expect(
      approval.getByText("http://localhost:3000", { exact: true }),
    ).toBeVisible();
    const rejected = await approval.evaluate(
      (id) => chrome.runtime.sendMessage({ type: "approve", approvalId: id }),
      stale.approvalId,
    );
    expect(rejected.accepted).toBe(false);
    expect(downloads).toBe(0);
    await approval.getByRole("button", { name: "Send to UNTangle" }).click();
    expect(await second).toMatchObject({ type: "result" });
    expect(downloads).toBe(1);
  } finally {
    await ctx.close();
  }
});

test("async existing-node report readiness and hidden duplicate section text are handled", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-report?async");
    const result = request(page, "transcript");
    const approval = await popup(ctx);
    await expect(
      approval.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeDisabled();
    await report.getByRole("button", { name: "Finish report" }).click();
    await expect(
      approval.getByRole("button", { name: "Send to UNTangle" }),
    ).toBeEnabled();
    await approval.getByRole("button", { name: "Send to UNTangle" }).click();
    expect(await result).toMatchObject({
      type: "result",
      payload: { kind: "pdf" },
    });
    await report.close();
    const search = await ctx.newPage();
    await search.goto("http://localhost:4317/class-search");
    const sections = request(page, "sections");
    await approvePending(ctx);
    expect(await sections).toMatchObject({
      payload: { rows: [{ course: "CSCE 1030" }] },
    });
    await search.evaluate(() => {
      const cell = document.querySelector<HTMLTableCellElement>(
        "tbody tr td:nth-child(6)",
      );
      if (cell) cell.style.display = "none";
    });
    const hiddenCell = request(page, "sections");
    await approvePending(ctx);
    expect(await hiddenCell).toMatchObject({
      payload: { rows: [{ instructor: "" }] },
    });
  } finally {
    await ctx.close();
  }
});

test("same-document report navigation revokes probes and rendered-text reads", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    const report = await ctx.newPage();
    await report.goto("http://localhost:4317/transcript-report?rendered");
    const worker =
      ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
    const tabs = await worker.evaluate(() => chrome.tabs.query({}));
    const id = tabs.find((tab) => tab.url?.includes("transcript-report"))!.id!;
    await report.evaluate(() => history.pushState({}, "", "/account"));
    expect(
      await worker.evaluate(
        (id) => chrome.tabs.sendMessage(id, { type: "probe" }),
        id,
      ),
    ).toMatchObject({ ready: false });
    const raw = await worker
      .evaluate(
        (id) =>
          chrome.tabs.sendMessage(id, {
            type: "read",
            resource: "transcript",
            nonce: crypto.randomUUID(),
          }),
        id,
      )
      .catch(() => null);
    expect(raw).toMatchObject({ type: "error", reason: "UNSUPPORTED_REPORT" });
  } finally {
    await ctx.close();
  }
});

test("account changes invalidate consent, extension approval, work and review selections", async () => {
  const ctx = await context(true);
  try {
    const account = await accountFixture(ctx);
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await page.getByRole("checkbox", { name: "I allow" }).check();
    await page.getByRole("button", { name: "Connect myUNT" }).click();
    await expect(
      page.getByRole("button", { name: "Cancel connection" }),
    ).toBeVisible();
    const approval = await popup(ctx);
    const old = await approval.evaluate(() =>
      chrome.runtime.sendMessage({ type: "status" }),
    );
    await page.bringToFront();
    await account.switchTo(page, "synthetic-b");
    await expect(
      page.getByRole("checkbox", { name: "I allow" }),
    ).not.toBeChecked();
    expect(
      await approval.evaluate(
        (id) => chrome.runtime.sendMessage({ type: "approve", approvalId: id }),
        old.approvalId,
      ),
    ).toMatchObject({ accepted: false });
    await upload(page);
    await page
      .getByRole("checkbox", { name: "Include CSCE 1030", exact: true })
      .check();
    await account.switchTo(page, "synthetic-c");
    await expect(
      page.getByRole("checkbox", { name: "I allow" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true }),
    ).toHaveCount(0);
    expect(
      account.posts.filter((post) => post.state.transcriptRecords?.length),
    ).toHaveLength(0);
  } finally {
    await ctx.close();
  }
});

test("account save persists the approved record and conflict recovery chooses a version", async () => {
  const ctx = await context(false);
  try {
    const account = await accountFixture(ctx);
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await upload(page);
    account.failNext("conflict");
    await saveOne(page);
    await expect(
      page.getByRole("alertdialog", { name: "Unsaved changes conflict" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Retry saving" }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Keep my edits" }).click();
    await expect(
      page.getByRole("status", { name: "Save state" }),
    ).toContainText("Saved");
    expect(account.posts.map((post) => post.status)).toEqual([409, 200]);
    expect(account.posts[1].base).toBe("1");
    expect(account.state?.transcriptRecords.map((row) => row.code)).toEqual([
      "CSCE 1030",
    ]);
  } finally {
    await ctx.close();
  }
});

test("signed-out account save offers export and retries after session recovery", async () => {
  const ctx = await context(false);
  try {
    const account = await accountFixture(ctx);
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await upload(page);
    account.failNext("signed-out");
    await saveOne(page);
    await expect(
      page.getByRole("status", { name: "Save state" }),
    ).toContainText("signed out");
    await expect(
      page.getByRole("button", { name: "Export schedule" }),
    ).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export schedule" }).click();
    expect((await download).suggestedFilename()).toMatch(/\.json$/);
    account.failNext("none");
    await page.getByRole("button", { name: "Retry save" }).click();
    await expect(
      page.getByRole("status", { name: "Save state" }),
    ).toContainText("Saved");
    expect(account.posts.map((post) => post.status)).toEqual([401, 200]);
    expect(account.state?.transcriptRecords).toHaveLength(1);
  } finally {
    await ctx.close();
  }
});

test("the extracted review row clears approval when its detected status changes", async () => {
  const ctx = await context(false);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await upload(page);
    const checkbox = page.getByRole("checkbox", {
      name: "Include CSCE 1030",
      exact: true,
    });
    await checkbox.check();
    const row = page.locator("li").filter({ has: checkbox });
    await row.getByText("Change detected status", { exact: true }).click();
    await row
      .getByRole("combobox", { name: "Status for CSCE 1030" })
      .selectOption("ignored");
    await expect(checkbox).not.toBeChecked();
    await expect(checkbox).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save selected courses" }),
    ).toBeDisabled();
    await row
      .getByRole("combobox", { name: "Status for CSCE 1030" })
      .selectOption("completed");
    await expect(checkbox).not.toBeChecked();
    await checkbox.check();
    await expect(
      page.getByRole("button", { name: "Save 1 course" }),
    ).toBeEnabled();
  } finally {
    await ctx.close();
  }
});
