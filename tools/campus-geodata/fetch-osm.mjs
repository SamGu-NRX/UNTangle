#!/usr/bin/env node
/**
 * Downloads the OpenStreetMap snapshot for the UNT Denton campus bounding box
 * from the public Overpass API (main instance + mirror), with retries and
 * bounded backoff, into raw/ so the build is reproducible from a fixed
 * snapshot.
 *
 * Usage:
 *   node tools/campus-geodata/fetch-osm.mjs            # downloads if raw files are missing
 *   node tools/campus-geodata/fetch-osm.mjs --refresh  # force a fresh download
 *
 * Exit codes: 0 = snapshot present (fetched now or already cached), 1 = all
 * attempts failed (the attempt log is written to raw/fetch-attempts.json).
 *
 * Data (c) OpenStreetMap contributors, ODbL 1.0. See README.md in this
 * directory.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const rawDir = join(here, "raw");

// South, west, north, east — the app's campus bounds widened by ~0.0015 deg
// so perimeter-street crossings are included. Same box as
// evals/fixtures/METHOD.md so fixtures and runtime data describe the same area.
const BBOX = { south: 33.2025, west: -97.1585, north: 33.2175, east: -97.1345 };

// Honest User-Agent per Overpass usage policy: a real project name, an
// explanation, and a contact.
const USER_AGENT =
  "UNTangle-campus-geodata/1.0 (offline walking routes for the UNT Denton campus; https://github.com/SamGu-NRX/UNTangle; contact: gushisamenze@gmail.com)";

const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const QUERIES = {
  // All mapped highways in the box; the pedestrian filter is applied in
  // build.mjs so the raw snapshot stays complete and re-filterable.
  pedestrian: `[out:json][timeout:180];(way["highway"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out geom qt;`,
  // Building outlines (for names, refs, entrances) plus every entrance node.
  buildings: `[out:json][timeout:180];(way["building"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});node["entrance"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east});node["highway"="entrance"](${BBOX.south},${BBOX.west},${BBOX.north},${BBOX.east}););out geom qt;`,
};

// Bounded backoff: at most 6 attempts across the two endpoints, ~13 minutes
// of total wait, then report a blocker.
const BACKOFF_SECONDS = [15, 30, 60, 120, 240, 300];
const REQUEST_TIMEOUT_MS = 240_000;

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
}

function sha256Of(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function postOverpass(endpoint, query) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: controller.signal,
    });
    const body = await response.text();
    return { status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchQuery(kind, query) {
  const attempts = [];
  for (let attempt = 0; attempt < BACKOFF_SECONDS.length; attempt += 1) {
    const endpoint = ENDPOINTS[attempt % ENDPOINTS.length];
    const startedAt = new Date().toISOString();
    try {
      const { status, body } = await postOverpass(endpoint, query);
      if (status === 200 && body.trimStart().startsWith("{")) {
        JSON.parse(body); // fail this attempt if the body is not valid JSON
        attempts.push({ attempt: attempt + 1, endpoint, startedAt, status, ok: true, bytes: body.length });
        return { body, attempts };
      }
      const detail = body.slice(0, 160).replace(/\s+/g, " ");
      attempts.push({ attempt: attempt + 1, endpoint, startedAt, status, ok: false, detail });
      console.error(`[${kind}] attempt ${attempt + 1}: HTTP ${status} from ${endpoint}: ${detail}`);
    } catch (error) {
      attempts.push({
        attempt: attempt + 1,
        endpoint,
        startedAt,
        ok: false,
        detail: String(error && error.message ? error.message : error).slice(0, 160),
      });
      console.error(`[${kind}] attempt ${attempt + 1}: ${attempts[attempts.length - 1].detail}`);
    }
    if (attempt < BACKOFF_SECONDS.length - 1) {
      const seconds = BACKOFF_SECONDS[attempt];
      console.error(`[${kind}] backing off ${seconds}s before the next attempt`);
      await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
    }
  }
  return { body: null, attempts };
}

async function main() {
  const force = process.argv.includes("--refresh");
  mkdirSync(rawDir, { recursive: true });

  const files = {
    pedestrian: join(rawDir, "overpass-pedestrian-snapshot.json"),
    buildings: join(rawDir, "overpass-buildings-snapshot.json"),
  };

  const missing = Object.values(files).filter((path) => !existsSync(path));
  if (!force && missing.length === 0) {
    for (const [kind, path] of Object.entries(files)) {
      const buffer = readFileSync(path);
      console.log(`[${kind}] cached snapshot present (${buffer.length} bytes, sha256 ${sha256Of(buffer).slice(0, 12)}…)`);
    }
    console.log("Raw snapshots already present; pass --refresh to download a new one.");
    return;
  }

  const manifest = { fetchedAt: null, endpoints: ENDPOINTS, queries: QUERIES, files: {} };
  const allAttempts = [];

  for (const [kind, query] of Object.entries(QUERIES)) {
    const prefix = kind === "pedestrian" ? "overpass-pedestrian" : "overpass-buildings";
    const target = join(rawDir, `${prefix}-${stamp()}.json`);
    console.log(`[${kind}] downloading from Overpass…`);
    const { body, attempts } = await fetchQuery(kind, query);
    allAttempts.push({ kind, attempts });

    if (body === null) {
      writeFileSync(join(rawDir, "fetch-attempts.json"), JSON.stringify({ ok: false, kind, attempts }, null, 2));
      console.error(`[${kind}] BLOCKER: all ${attempts.length} attempts failed; attempt log written to raw/fetch-attempts.json`);
      process.exitCode = 1;
      return;
    }

    writeFileSync(target, body);
    manifest.fetchedAt = new Date().toISOString();
    manifest.files[kind] = target;
    console.log(`[${kind}] saved ${target} (${body.length} bytes)`);
  }

  // Fix the stable "snapshot" names the build and the receipt reference.
  for (const [kind, path] of Object.entries(manifest.files)) {
    const stable = files[kind];
    const buffer = readFileSync(path);
    writeFileSync(stable, buffer);
    manifest.files[kind] = stable;
  }

  writeFileSync(join(rawDir, "fetch-attempts.json"), JSON.stringify({ ok: true, attempts: allAttempts }, null, 2));
  console.log("Raw OSM snapshot downloaded once and cached in raw/. Run build.mjs next.");
}

main();
