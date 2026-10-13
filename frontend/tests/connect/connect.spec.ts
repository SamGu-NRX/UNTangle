import { test, expect, chromium, type Page } from "../../../extension/node_modules/@playwright/test/index.js";
import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { syntheticPdf } from "../../../tools/mock-myunt/pdf";
const root = resolve(__dirname, "../../..");
const evidence = resolve(root, "extension/evidence");
async function context(extension: boolean) {
  const path = resolve(root, "extension/dist-dev");
  const ctx = await chromium.launchPersistentContext("", { channel: "chromium", headless: true, viewport: { width: 390, height: 844 }, recordVideo: { dir: resolve(root, "extension/test-results/videos"), size: { width: 390, height: 844 } }, args: extension ? [`--disable-extensions-except=${path}`, `--load-extension=${path}`] : [] });
  await ctx.route("**/*", route => {
    const url = new URL(route.request().url());
    if (["localhost", "127.0.0.1"].includes(url.hostname) || ["chrome-extension:", "data:", "blob:"].includes(url.protocol)) return route.continue();
    return route.abort();
  });
  return ctx;
}
async function shot(page: Page, name: string) { await mkdir(evidence, { recursive: true }); await page.screenshot({ path: resolve(evidence, `${name}.png`), fullPage: true }); }
async function request(page: Page, resource: "transcript" | "sections") {
  return page.evaluate(resource => new Promise<unknown>(resolve => {
    const nonce = crypto.randomUUID();
    const timer = setTimeout(() => resolve("timeout"), 10_000);
    function receive(event: MessageEvent) {
      if (event.source !== window || event.origin !== location.origin || event.data?.from !== "extension" || event.data?.nonce !== nonce || !["result", "error"].includes(event.data?.type)) return;
      clearTimeout(timer); window.removeEventListener("message", receive); resolve(event.data);
    }
    window.addEventListener("message", receive);
    window.postMessage({ channel: "untangle-connect", version: 1, from: "app", type: "request", nonce, resource }, location.origin);
  }), resource);
}
test("extension PDF handshake reaches course review and saves approved courses", async () => {
  test.setTimeout(90_000);
  const ctx = await context(true);
  try {
    const page = await ctx.newPage();
    await page.goto("http://127.0.0.1:3000/connect");
    await expect(page.getByRole("button", { name: "Connect myUNT" })).toBeDisabled();
    await shot(page, "permission-mobile");
    await page.getByRole("checkbox", { name: "I allow" }).check();
    await page.getByRole("button", { name: "Connect myUNT" }).click();
    await expect(page.getByRole("status")).toContainText("Waiting for your transcript");
    await shot(page, "waiting-mobile");
    let releaseDownload!: () => void;
    const downloadGate = new Promise<void>(resolve => { releaseDownload = resolve; });
    await ctx.route("**/synthetic-transcript.pdf", async route => { await downloadGate; await route.continue(); });
    await ctx.route("**/*pdf.worker*", async route => { await shot(page, "parsing-mobile"); await route.continue(); });
    // A real elapsed wait crosses MV3's 30-second idle threshold, proving the heartbeat rather than just the fast path.
    const started = Date.now();
    await page.waitForFunction(started => Date.now() - started >= 35_000, started, { timeout: 40_000 });
    await expect(page.getByRole("status")).toContainText("Waiting for your transcript");
    const report = await ctx.newPage(); await report.goto("http://localhost:4317/transcript-entry");
    await expect(page.getByRole("status")).toContainText("Waiting for your transcript");
    await report.getByRole("link", { name: "Submit and View Report" }).click();
    await expect(report.getByRole("button", { name: "Send to UNTangle" })).toBeVisible();
    await expect(page.getByRole("status")).toContainText("Reading your report");
    await shot(page, "reading-mobile");
    releaseDownload();
    await expect(page.getByRole("heading", { name: "Review your courses" })).toBeVisible();
    for (const course of ["CSCE 1030", "MATH 1650", "ENGL 1310", "CSCE 1040"]) await expect(page.getByRole("checkbox", { name: `Include ${course}` })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save selected courses" })).toBeDisabled();
    await shot(page, "review-mobile");
    await page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true }).check();
    await page.getByRole("button", { name: "Save 1 course" }).click();
    await expect(page.getByRole("status")).toContainText("1 course added");
    await expect(page.getByRole("status")).toContainText("Saved in this browser");
    await shot(page, "saved-mobile");
    await expect.poll(() => page.evaluate(() => Object.values(localStorage).join("\n"))).toContain('"CSCE 1030":"completed"');
    const stored = await page.evaluate(() => Object.values(localStorage).join("\n"));
    expect(stored).toContain('"CSCE 1030":"completed"');
    const imported = await page.evaluate(() => Object.values(localStorage).map(raw => JSON.parse(raw)).find(value => value.storeSchemaVersion === 1)?.state.transcriptRecords);
    expect(imported.map((row: { code: string }) => row.code)).toEqual(["CSCE 1030"]);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Connect myUNT", exact: true })).toBeVisible();
    expect(await page.evaluate(() => Object.values(localStorage).join("\n"))).toContain('"CSCE 1030":"completed"');
    await page.setViewportSize({ width: 1440, height: 1000 }); await shot(page, "permission-desktop");
    await page.emulateMedia({ reducedMotion: "reduce" }); await shot(page, "permission-desktop-reduced-motion");
    await report.close();
    const search = await ctx.newPage(); await search.goto("http://localhost:4317/class-search");
    const result = await request(page, "sections") as { payload: { rows: unknown[] } };
    expect(result.payload.rows).toEqual([{ course: "CSCE 1030", section: "001", days: "MWF", times: "10:00 AM - 10:50 AM", room: "Discovery Park B155", instructor: "Example Instructor", status: "Open" }]);
  } finally { await ctx.close(); }
});
test("no extension falls back to PDF upload with keyboard and reduced-motion access", async () => {
  const ctx = await context(false);
  try {
    const page = await ctx.newPage(); await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("http://127.0.0.1:3000/connect");
    await page.getByRole("checkbox", { name: "I allow" }).focus(); await page.keyboard.press("Space");
    await page.keyboard.press("Tab"); await expect(page.getByRole("button", { name: "Connect myUNT" })).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page.getByRole("region", { name: "Connect myUNT" }).getByRole("alert")).toContainText("extension wasn't found");
    await shot(page, "fallback-mobile");
    await page.getByLabel("Upload transcript PDF", { exact: true }).setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from(syntheticPdf()) });
    await expect(page.getByRole("heading", { name: "Review your courses" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true })).toBeVisible();
    expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    await page.setViewportSize({ width: 320, height: 844 });
    expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, "review-320-reduced-motion");
    await page.getByRole("checkbox", { name: "Include CSCE 1030", exact: true }).focus(); await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Save 1 course" }).focus(); await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Your courses are ready" })).toBeFocused();
  } finally { await ctx.close(); }
});
test("rendered report works; multiple reports and cross-tab requests fail closed", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage(); await page.goto("http://127.0.0.1:3000/connect");
    const a = await ctx.newPage(); await a.goto("http://localhost:4317/transcript-report?rendered");
    const rendered = await request(page, "transcript") as { payload: { kind: string; text: string } };
    expect(rendered.payload.kind).toBe("transcript-text"); expect(rendered.payload.text).toContain("CSCE 1030");
    const b = await ctx.newPage(); await b.goto("http://localhost:4317/transcript-report");
    expect(await request(page, "transcript")).toMatchObject({ type: "error", reason: "AMBIGUOUS_REPORT" });
    await a.close(); await b.close();
    const waiting = request(page, "transcript");
    const other = await ctx.newPage(); await other.goto("http://127.0.0.1:3000/connect");
    expect(await request(other, "transcript")).toMatchObject({ type: "error", reason: "BUSY" });
    await page.close(); await waiting.catch(() => {});
    await other.getByRole("checkbox", { name: "I allow" }).check(); await other.getByRole("button", { name: "Connect myUNT" }).click();
    const report = await ctx.newPage(); await report.goto("http://localhost:4317/transcript-report");
    await expect(other.getByRole("heading", { name: "Review your courses" })).toBeVisible();
  } finally { await ctx.close(); }
});

test("route changes revoke the bridge and a cancelled request cannot deliver", async () => {
  const ctx = await context(true);
  try {
    const page = await ctx.newPage(); await page.goto("http://127.0.0.1:3000/connect");
    await page.getByRole("checkbox", { name: "I allow" }).check(); await page.getByRole("button", { name: "Connect myUNT" }).click();
    await expect(page.getByRole("button", { name: "Cancel connection" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel connection" }).click();
    await expect(page.getByRole("button", { name: "Connect myUNT" })).toBeFocused();
    const report = await ctx.newPage(); await report.goto("http://localhost:4317/transcript-report");
    await page.evaluate(() => history.pushState({}, "", "/courses"));
    const replied = await page.evaluate(() => new Promise(resolve => {
      const nonce = crypto.randomUUID();
      let replied = false;
      const listener = (e: MessageEvent) => { if (e.data?.nonce === nonce && e.data?.from === "extension") replied = true; };
      window.addEventListener("message", listener);
      window.postMessage({ channel: "untangle-connect", version: 1, from: "app", type: "request", nonce, resource: "transcript" }, location.origin);
      setTimeout(() => { window.removeEventListener("message", listener); resolve(replied); }, 600);
    }));
    expect(replied).toBe(false);
    await page.evaluate(() => history.pushState({}, "", "/connect"));
    expect(await request(page, "transcript")).toMatchObject({ type: "result", payload: { kind: "pdf" } });
    await expect(page.getByRole("heading", { name: "Connect myUNT", exact: true })).toBeVisible();
  } finally { await ctx.close(); }
});
