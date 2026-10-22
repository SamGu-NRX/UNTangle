/**
 * One polite headless-browser capture of the UNT 2026-2027 catalog pages the
 * degree-audit parser reads. catalog.unt.edu refuses plain HTTP clients, so
 * this drives a real Chromium through Playwright and saves each page's
 * rendered HTML under packages/ingest/data/catalog/unt-2026-27/.
 *
 * Politeness rules (docs/architecture/README.md, "Reference data"):
 * - one page at a time, at least one second between page loads;
 * - an honest User-Agent naming the project and a contact address;
 * - public catalog pages only, no forms, no real UNT account.
 *
 * Playwright is a one-off tool, not a repo dependency: install it where you
 * like and point NODE_PATH at it, then run from the repository root:
 *
 *   NODE_PATH=/tmp/node_modules node packages/ingest/scripts/capture-catalog.mjs
 *
 * A run with no arguments rewrites every saved page and the manifest, so a
 * capture is re-runnable and reviewable as a unit. Naming files captures only
 * those pages and keeps the other manifest entries as they are:
 *
 *   NODE_PATH=/tmp/node_modules node packages/ingest/scripts/capture-catalog.mjs math-bsmth.html biology-bsbio.html
 *
 * Adding a program should not recapture pages that other derivations were
 * written against; a changed hash there would stop the build.
 */
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const CONTACT = "sgu07966@gmail.com";
const USER_AGENT = `UNTangle-ingest/0.1 (UNT educational course-planning project; contact ${CONTACT})`;
// The live 2026-2027 Undergraduate Catalog. The catalog id rotates on refresh;
// a capture that no longer serves 2026-2027 must fail, not silently re-save.
const CATOID = 40;
const BASE = "https://catalog.unt.edu";
const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/catalog/unt-2026-27");

const PAGES = [
  { file: "cs-bs.html", url: `${BASE}/preview_program.php?catoid=${CATOID}&poid=21227`, expect: "Computer Science" },
  { file: "ce-bs.html", url: `${BASE}/preview_program.php?catoid=${CATOID}&poid=21225`, expect: "Computer Engineering" },
  { file: "core-curriculum.html", url: `${BASE}/preview_program.php?catoid=${CATOID}&poid=21275`, expect: "University Core" },
  { file: "degree-requirements.html", url: `${BASE}/content.php?catoid=${CATOID}&navoid=4689`, expect: "Degree" },
  { file: "math-bsmth.html", url: `${BASE}/preview_program.php?catoid=${CATOID}&poid=21333`, expect: "Mathematics, BSMTH" },
  { file: "biology-bsbio.html", url: `${BASE}/preview_program.php?catoid=${CATOID}&poid=21206`, expect: "Biology, BSBIO" },
];

const INTERVAL_MS = 1100;

/** The pages named on the command line, or every page when none is named. */
function selectedPages(names) {
  if (names.length === 0) return PAGES;
  const unknown = names.filter((name) => !PAGES.some((page) => page.file === name));
  if (unknown.length > 0) throw new Error(`unknown page ${unknown.join(", ")}; known pages: ${PAGES.map((page) => page.file).join(", ")}`);
  return PAGES.filter((page) => names.includes(page.file));
}

async function main() {
  const targets = selectedPages(process.argv.slice(2));
  const partial = targets.length < PAGES.length;
  // A partial capture keeps the earlier manifest's other entries.
  const previous = partial ? JSON.parse(await readFile(path.join(OUT_DIR, "manifest.json"), "utf8")) : null;
  // An environment override keeps the capture working where Playwright's
  // registry expects a browser revision that is not downloaded.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ userAgent: USER_AGENT });
  const page = await context.newPage();
  await mkdir(OUT_DIR, { recursive: true });
  const capturedAt = new Date().toISOString();
  const entries = [];
  for (const [index, target] of targets.entries()) {
    if (index > 0) await page.waitForTimeout(INTERVAL_MS);
    const response = await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response || !response.ok()) throw new Error(`${target.url} returned ${response ? response.status() : "no response"}`);
    // The site answers the first request with a short challenge that the real
    // browser resolves and reloads; wait until the real page renders. The
    // program pages only count as rendered once their acalog-core blocks are
    // present — "2026-2027" also appears in the catalog-picker shell.
    let html = "";
    let title = "";
    const rendered = (source) => source.includes("acalog-core") || source.includes("Degree Tools");
    for (let attempt = 0; attempt < 20 && !rendered(html); attempt += 1) {
      await page.waitForTimeout(1500);
      html = await page.content();
      title = (await page.title()).trim();
    }
    if (!html.includes("2026-2027")) throw new Error(`${target.url} never rendered the 2026-2027 catalog (title: "${title}"); the catalog id may have rotated.`);
    if (!html.includes(target.expect)) throw new Error(`${target.url} does not mention "${target.expect}"; refusing to save a wrong page.`);
    const sha256 = createHash("sha256").update(html).digest("hex");
    entries.push({ file: target.file, url: target.url, title, httpStatus: response.status(), capturedAt, sha256 });
    await writeFile(path.join(OUT_DIR, target.file), html);
    console.log(`saved ${target.file} (${html.length} bytes) sha256=${sha256.slice(0, 12)}… "${title}"`);
  }
  await context.close();
  await browser.close();
  // Entries stay in PAGES order. A partial run replaces only the pages it
  // captured; each entry keeps its own capturedAt, and the top-level one
  // stays the last full capture's.
  const byFile = new Map([...(previous?.pages ?? []), ...entries].map((entry) => [entry.file, entry]));
  const pages = PAGES.flatMap((page) => byFile.get(page.file) ?? []);
  const manifest = {
    source: "UNT Undergraduate Catalog 2026-2027 (catalog.unt.edu)",
    capturedAt: previous?.capturedAt ?? capturedAt,
    captureMethod: `headless Chromium via Playwright, one page per ${INTERVAL_MS} ms, honest User-Agent, public pages only`,
    userAgent: USER_AGENT,
    pages,
  };
  await writeFile(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest written with ${pages.length} pages (${entries.length} captured this run)`);
}

main().catch((error) => {
  console.error("capture failed:", error.message);
  process.exit(1);
});
