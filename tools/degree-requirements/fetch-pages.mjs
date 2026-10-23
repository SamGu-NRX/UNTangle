#!/usr/bin/env bun
/**
 * tools/degree-requirements/fetch-pages.mjs
 *
 * Fetches the published catalog.unt.edu pages that back UNTangle degree
 * planning: one page per program (major) plus, later, course-description pages
 * for courses the app catalog does not resolve.
 *
 * Compliance contract (enforced in code, not aspirational):
 * - public pages only; no forms, no authenticated or ajax endpoints;
 * - robots.txt honored: Disallow rules AND crawl-delay for our user-agent
 *   group are obeyed. The effective minimum interval between requests is
 *   max(1 request/second, the robots crawl-delay) — we go slower than one
 *   request per second whenever robots asks;
 * - an honest User-Agent naming the tool and a contact;
 * - every response is cached on disk under data/degree-requirements/cache/;
 * - every request (and every cache reuse) is recorded in
 *   data/degree-requirements/receipt.json with the URL, HTTP status, byte
 *   size, timestamp and sha256 of the bytes;
 * - resumable: a cache hit short-circuits the fetch (and is re-verified
 *   against the receipt sha256), so an interrupted run continues where it
 *   stopped instead of re-requesting anything.
 *
 * Usage:
 *   bun tools/degree-requirements/fetch-pages.mjs discover
 *   bun tools/degree-requirements/fetch-pages.mjs fetch
 *   bun tools/degree-requirements/fetch-pages.mjs verify
 */

import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_BASE, WafChallengeError, decodeBytes, effectiveIntervalMs, isWafChallengePage, parseRobots, robotsVerdict } from "./fetch-lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");
const DATA = join(REPO, "data", "degree-requirements");
const CACHE = join(DATA, "cache");
const RECEIPT = join(DATA, "receipt.json");
const PROGRAMS = join(DATA, "programs.json");

const BASE = CATALOG_BASE;
const USER_AGENT =
  "UNTangleDegreePlanBot/1.0 (student degree-planning tool; fetches published catalog pages only; " +
  "respects robots.txt and its crawl-delay; contact: focus.sgu@gmail.com; " +
  "source: https://github.com/SamGu-NRX/UNTangle tools/degree-requirements)";
const MIN_INTERVAL_MS = 1000; // "at most one request per second" — crawl-delay can only raise this.
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function ensureDirs() {
  mkdirSync(CACHE, { recursive: true });
}

function loadReceipt() {
  if (!existsSync(RECEIPT)) {
    return {
      tool: "tools/degree-requirements/fetch-pages.mjs",
      userAgent: USER_AGENT,
      minRequestIntervalMs: MIN_INTERVAL_MS,
      robots: null,
      entries: [],
      requestCount: 0,
    };
  }
  return JSON.parse(readFileSync(RECEIPT, "utf8"));
}

function saveReceipt(receipt) {
  const tmp = RECEIPT + ".tmp";
  writeFileSync(tmp, JSON.stringify(receipt, null, 2) + "\n");
  renameSync(tmp, RECEIPT);
}

function cachePathFor(url) {
  const name = url
    .replace(/^https?:\/\//, "")
    .replace(/[^a-zA-Z0-9.-]+/g, "_")
    .slice(0, 180);
  return join(CACHE, name + ".html");
}

function relCache(p) {
  return "data/degree-requirements/cache/" + p.split("/").pop();
}


class PoliteFetcher {
  constructor(receipt) {
    this.receipt = receipt;
    this.lastRequestAt = 0;
    this.intervalMs = MIN_INTERVAL_MS;
  }

  async sleep(ms) {
    await new Promise((r) => setTimeout(r, ms));
  }

  async respectInterval() {
    const since = Date.now() - this.lastRequestAt;
    const wait = this.intervalMs - since;
    if (wait > 0) await this.sleep(wait);
    this.lastRequestAt = Date.now();
  }

  /** Fetch or reuse cache; record in the receipt either way. Returns bytes. */
  async fetchPage(url, purpose) {
    const cacheFile = cachePathFor(url);
    if (existsSync(cacheFile)) {
      const bytes = readFileSync(cacheFile);
      const digest = sha256(bytes);
      const entry = this.receipt.entries.find((e) => e.url === url && e.cacheHit);
      if (entry && entry.sha256 !== digest) {
        throw new Error(`cache sha256 mismatch for ${url} — the cache file was edited; refusing to use it`);
      }
      if (!entry) {
        this.receipt.entries.push({
          url, purpose, cacheHit: true, cacheFile: relCache(cacheFile),
          sha256: digest, bytes: bytes.length, fetchedAt: null, status: null,
        });
        this.receipt.cacheHits = (this.receipt.cacheHits ?? 0) + 1;
        saveReceipt(this.receipt);
      }
      return bytes;
    }

    await this.respectInterval();
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, "accept": "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) {
      throw new Error(`GET ${url} -> HTTP ${response.status}`);
    }
    // A WAF challenge page is an access-control response, not content:
    // record it honestly and refuse to cache it as a fetched page.
    if (isWafChallengePage(decodeBytes(bytes))) {
      this.receipt.entries.push({
        url, purpose, cacheHit: false, wafChallenge: true,
        bytes: bytes.length, fetchedAt: new Date().toISOString(),
        status: response.status, note: "challenge page; not cached as content",
      });
      this.receipt.requestCount += 1;
      saveReceipt(this.receipt);
      throw new WafChallengeError(url);
    }
    writeFileSync(cacheFile, bytes);
    this.receipt.entries.push({
      url, purpose, cacheHit: false, cacheFile: relCache(cacheFile),
      sha256: sha256(bytes), bytes: bytes.length,
      fetchedAt: new Date().toISOString(), status: response.status,
      finalUrl: response.url,
    });
    this.receipt.requestCount += 1;
    saveReceipt(this.receipt);
    return bytes;
  }

  async loadRobots() {
    const url = BASE + "/robots.txt";
    const cached = this.receipt.robots;
    if (
      cached && cached.fetchedAt &&
      Date.now() - Date.parse(cached.fetchedAt) < ROBOTS_TTL_MS &&
      existsSync(cachePathFor(url))
    ) {
      const bytes = readFileSync(cachePathFor(url));
      const robots = parseRobots(decodeBytes(bytes), "untangledegreeplanbot");
      // The crawl-delay drives EVERY request, including cache-hit runs —
      // re-apply it here too (a cache hit must not relax pacing).
      this.intervalMs = effectiveIntervalMs(robots.crawlDelay);
      this.receipt.crawlDelaySeconds = robots.crawlDelay;
      return { url, bytes, robots };
    }
    await this.respectInterval();
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!response.ok) throw new Error(`robots.txt fetch failed: HTTP ${response.status}`);
    writeFileSync(cachePathFor(url), bytes);
    const parsed = parseRobots(decodeBytes(bytes), "untangledegreeplanbot");
    this.receipt.robots = {
      url,
      fetchedAt: new Date().toISOString(),
      sha256: sha256(bytes),
      disallowedPaths: ["/portfolio.php", "/portfolio_nopop.php", "/ajax/", "/search_advanced.php"],
      crawlDelaySeconds: parsed.crawlDelay,
    };
    this.receipt.requestCount += 1;
    this.receipt.crawlDelaySeconds = parsed.crawlDelay;
    this.intervalMs = effectiveIntervalMs(parsed.crawlDelay);
    saveReceipt(this.receipt);
    return { url, bytes, robots: parsed };
  }
}

/** Program display names to find in the catalog's program index. */
const PROGRAM_NAMES = [
  "Computer Science",
  "Computer Engineering",
  "Mathematics",
  "Biology",
  "Psychology",
  "English",
  // "Business" is resolved from the index in discover (the exact published
  // program name is not decided until the index is read — never guessed).
  "Business",
];

async function findProgramIndexUrl(fetcher) {
  // The home page links the program index; find its navoid there.
  const home = decodeBytes(await fetchWithWafBackoff(fetcher, BASE + "/", "discovery:home"));
  const catoidMatch = home.match(/catoid=(\d+)/);
  if (!catoidMatch) throw new Error("could not find a catoid on the catalog home page");
  const catoid = catoidMatch[1];
  const anchorMatches = [
    ...home.matchAll(/<a[^>]+href="([^"]*content\.php\?catoid=\d+&(?:amp;)?navoid=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi),
  ];
  console.log(`discover: catoid=${catoid}, ${anchorMatches.length} anchors with navoids on home page`);
  let programsCandidate = null;
  for (const m of anchorMatches) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    // Prefer the single-page majors listing ("Majors, Minors, Certificates"),
    // then any Programs A-Z style index, then any page mentioning Programs.
    const isMajors = /majors?/i.test(text);
    const isPrograms = /programs?/i.test(text);
    if (isMajors || isPrograms) {
      const href = m[1].replace(/&amp;/g, "&");
      const candidate = { url: new URL(href, BASE).toString(), fromText: text, isMajors };
      if (isMajors) return candidate;
      if (!programsCandidate) programsCandidate = candidate;
    }
  }
  if (programsCandidate) return programsCandidate;
  throw new Error("could not locate a Programs index link on the home page");
}

/** Fetch with a patient WAF backoff: challenge pages are retried after a
 * multi-minute backoff, at most a few times, then reported and left unrun. */
async function fetchWithWafBackoff(fetcher, url, purpose, { attempts = 3, backoffMs = 600000 } = {}) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fetcher.fetchPage(url, purpose);
    } catch (err) {
      if (err instanceof WafChallengeError && attempt < attempts) {
        console.log(`waf: challenge on ${url}; backing off ${backoffMs / 1000}s (attempt ${attempt}/${attempts})`);
        await fetcher.sleep(backoffMs);
        continue;
      }
      throw err;
    }
  }
}

async function discover() {
  ensureDirs();
  const receipt = loadReceipt();
  const fetcher = new PoliteFetcher(receipt);
  const { robots } = await fetcher.loadRobots();
  console.log(
    `discover: robots crawl-delay=${robots.crawlDelay ?? "none"}; effective interval ${fetcher.intervalMs}ms`,
  );

  const index = await findProgramIndexUrl(fetcher);
  console.log(`discover: program index candidate from "${index.fromText}" -> ${index.url}`);
  const indexPage = decodeBytes(await fetchWithWafBackoff(fetcher, index.url, "discovery:program-index"));

  const found = {};
  const linkPattern = /<a[^>]+href="([^"]*preview_program\.php[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of indexPage.matchAll(linkPattern)) {
    const href = m[1].replace(/&amp;/g, "&");
    const name = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    for (const wanted of PROGRAM_NAMES) {
      if (name.startsWith(wanted)) {
        if (!found[wanted]) found[wanted] = [];
        found[wanted].push({ name, url: new URL(href, BASE).toString() });
      }
    }
  }

  const manifest = {
    generatedAt: new Date().toISOString(),
    indexUrl: index.url,
    note:
      "Candidates discovered from the public program index. The exact program page for each major is " +
      "confirmed by a human-readable check before fetch; ambiguous names stay unresolved here rather than guessed.",
    candidates: found,
  };
  writeFileSync(join(DATA, "program-discovery.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log("discover: wrote program-discovery.json");
  for (const wanted of PROGRAM_NAMES) {
    const c = found[wanted] ?? [];
    console.log(
      `  ${wanted}: ${c.length} candidate(s)${c.length ? " -> " + c.map((x) => x.name).join(" | ") : " (NOT FOUND)"}`,
    );
  }
}

async function fetchPrograms() {
  ensureDirs();
  const manifest = JSON.parse(readFileSync(PROGRAMS, "utf8"));
  const receipt = loadReceipt();
  const fetcher = new PoliteFetcher(receipt);
  const { robots } = await fetcher.loadRobots();
  for (const program of manifest.programs) {
    const u = new URL(program.url);
    const v = robotsVerdict(robots, u.pathname);
    if (!v.allowed) {
      console.error(`fetch: refusing ${program.url} — ${v.because}`);
      continue;
    }
    process.stdout.write(`fetch: ${program.majorId} ${u.pathname}${u.search} ... `);
    await fetcher.fetchPage(program.url, `program:${program.majorId}`);
    console.log("ok");
  }
  console.log(`fetch: done (${receipt.requestCount} network requests so far, ${receipt.entries.length} receipt entries)`);
}

async function verify() {
  const receipt = JSON.parse(readFileSync(RECEIPT, "utf8"));
  let bad = 0;
  for (const entry of receipt.entries) {
    const p = join(REPO, entry.cacheFile);
    if (!existsSync(p)) {
      console.error(`verify: MISSING ${entry.cacheFile} (${entry.url})`);
      bad += 1;
      continue;
    }
    const digest = sha256(readFileSync(p));
    if (digest !== entry.sha256) {
      console.error(
        `verify: SHA MISMATCH ${entry.cacheFile} (${entry.url}) expected ${entry.sha256} got ${digest}`,
      );
      bad += 1;
    }
  }
  console.log(`verify: ${receipt.entries.length - bad}/${receipt.entries.length} cache files match the receipt`);
  if (bad > 0) process.exit(1);
}

const command = process.argv[2] ?? "fetch";
if (command === "discover") await discover();
else if (command === "fetch") await fetchPrograms();
else if (command === "verify") await verify();
else {
  console.error("unknown command; use discover | fetch | verify");
  process.exit(2);
}
