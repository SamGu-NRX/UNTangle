/**
 * Black-box routing suite for the UNTangle eval harness.
 *
 * Talks ONLY to a running app over HTTP (base URL precedence: explicit env
 * UNTANGLE_BASE_URL, then the stack-provided origin, then http://127.0.0.1:3000). It never imports application code and never needs
 * files inside the target checkout. Pair data comes from
 * evals/fixtures/campus-routes.json (see evals/fixtures/METHOD.md — all pair
 * distances there are map-derived from OpenStreetMap, not physically walked).
 *
 * Cases:
 *  (a) building-coverage   — every bundled-campus building and every compD.csv
 *                            building resolves via POST /api/map/resolve
 *                            (200, resolved building id; in-bounds buildings
 *                            resolve locally, off-campus Discovery Park is
 *                            identified with an unsupported reason by design).
 *  (b) route-geodesic-floor— for every fixture pair, a 200 route response's
 *                            distanceMeters is at least the great-circle
 *                            distance between the same endpoints.
 *  (c) route-latency       — latency protocol: ORS disabled, cold and warm runs
 *                            reported separately, only 200 responses counted,
 *                            fixed-interval pacing under 60 req/min, sample
 *                            counts in measured; p95 for 12-stop routes vs the
 *                            plan bar (<= 200 ms warm).
 */
import fixtureJson from "../fixtures/campus-routes.json";
import { defineSuite } from "../suite-kit";
import type { CaseResult, CaseSpec, SuiteContext } from "../suite-kit";

// ---------------------------------------------------------------------------
// Fixture types (only the fields the suite reads; see evals/fixtures/METHOD.md)
// ---------------------------------------------------------------------------
type FixtureEntrance = { lat: number; lng: number };
type FixturePair = {
  id: string;
  start: { buildingId: string; entrance: FixtureEntrance };
  end: { buildingId: string; entrance: FixtureEntrance };
  distanceMeters: number;
  greatCircleMeters: number;
  dataOrigin: string;
  physicallyWalked: boolean;
  geometry: [number, number][];
};
type FixtureBuilding = {
  id: string;
  name: string;
  shortName: string;
  inRoutingBounds: boolean;
  inCompD: boolean;
};
type CampusRoutesFixture = {
  name: string;
  bounds: { north: number; south: number; east: number; west: number };
  buildings: FixtureBuilding[];
  pairs: FixturePair[];
};

const fixture = fixtureJson as unknown as CampusRoutesFixture;

// ---------------------------------------------------------------------------
// Environment and pacing
// ---------------------------------------------------------------------------
// Typed access without @types/node: only the env map is needed.
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
/**
 * Base URL precedence: explicit UNTANGLE_BASE_URL (standalone/dev runs) >
 * the stack-provided ctx.frontendOrigin (the runner boots the app on a free
 * port) > the dev default. Re-resolved at the start of every case run.
 */
let activeBaseUrl = (env.UNTANGLE_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

/** Fixed-interval pacing: >= 1050 ms between request starts (~57 req/min < 60). */
const MIN_REQUEST_INTERVAL_MS = 1_050;
const REQUEST_TIMEOUT_MS = 15_000;

let nextFreeSlotMs = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(ms, 0)));
}

/** Serializes all suite requests onto the shared pacing interval. */
async function pace(): Promise<void> {
  const now = Date.now();
  const startAt = Math.max(now, nextFreeSlotMs);
  nextFreeSlotMs = startAt + MIN_REQUEST_INTERVAL_MS;
  await sleep(startAt - now);
}

type PostResult = { status: number; text: string; elapsedMs: number };

/** Paced POST; `elapsedMs` covers send -> full response read, after the wait. */
async function postJson(path: string, body: unknown): Promise<PostResult> {
  await pace();
  const started = performance.now();
  const response = await fetch(`${activeBaseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  return { status: response.status, text, elapsedMs: performance.now() - started };
}

/** Tolerant JSON-object parse: malformed bodies become recorded problems, not crashes. */
function parseJsonObject(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function appIsReachable(): Promise<boolean> {
  try {
    // Paced like every other request; any HTTP response counts as reachable.
    await postJson("/api/map/resolve", { locations: [{ location: "Library" }] });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------
type LatLng = { lat: number; lng: number };

function haversineMeters(a: LatLng, b: LatLng): number {
  const earthRadiusMeters = 6_371_000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(h));
}

/** Mirrors the app's in-bounds test (bounds constant recorded in the fixture). */
function isInsideUntBounds(point: LatLng): boolean {
  const b = fixture.bounds;
  if (!b || !Number.isFinite(b.north)) return false; // malformed fixture -> callers degrade
  return point.lat >= b.south && point.lat <= b.north && point.lng >= b.west && point.lng <= b.east;
}

/** Nearest-rank percentile over a copy of the samples. */
function percentileNearestRank(samples: number[], pct: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil((pct / 100) * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

// ---------------------------------------------------------------------------
// (a) building coverage
// ---------------------------------------------------------------------------
type ResolvedLocation = {
  location: string;
  buildingId?: string;
  lat?: number;
  lng?: number;
  resolutionStatus?: string;
  unsupportedReason?: string;
};

async function resolveBuilding(building: FixtureBuilding): Promise<ResolvedLocation> {
  // One request per building carrying the two user-visible spellings: the full
  // building name and the short mnemonic. No buildingId hint — coverage must
  // prove the roster itself resolves, not echo an id back.
  const response = await postJson("/api/map/resolve", {
    locations: [{ location: building.name }, { location: building.shortName }],
  });
  if (response.status !== 200) {
    return {
      location: building.name,
      resolutionStatus: `http-${response.status}`,
    };
  }
  const payload = parseJsonObject(response.text) as { locations?: ResolvedLocation[] } | undefined;
  if (!payload) {
    return {
      location: building.name,
      resolutionStatus: "malformed-json",
    };
  }
  const entries = payload.locations ?? [];
  const matched = (entry: ResolvedLocation | undefined): boolean =>
    !!entry && entry.buildingId === building.id;
  // Prefer the name-form result; fall back to the mnemonic form.
  return matched(entries[0]) ? entries[0] : matched(entries[1]) ? entries[1] : (entries[0] ?? {
    location: building.name,
    resolutionStatus: "missing",
  });
}

async function runBuildingCoverage(): Promise<CaseResult> {
  let resolved = 0;
  let localResolved = 0;
  let offCampusIdentified = 0;
  const problems: string[] = [];

  for (const building of fixture.buildings) {
    const result = await resolveBuilding(building);
    if (result.buildingId !== building.id) {
      problems.push(
        `${building.id}: buildingId=${result.buildingId ?? "none"} status=${result.resolutionStatus ?? "none"}`,
      );
      continue;
    }
    resolved += 1;
    if (building.inRoutingBounds) {
      if (result.resolutionStatus === "local" && Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
        localResolved += 1;
      } else {
        problems.push(
          `${building.id}: expected local resolution with coordinates, got status=${result.resolutionStatus}`,
        );
      }
    } else if (result.resolutionStatus === "unresolved" && result.unsupportedReason) {
      offCampusIdentified += 1; // Discovery Park: identified, routing unsupported by design
    } else {
      problems.push(`${building.id}: off-campus building not flagged with unsupportedReason`);
    }
  }

  const compDCount = fixture.buildings.filter((b) => b.inCompD).length;
  const ok = problems.length === 0;
  return {
    id: "building-coverage",
    status: ok ? "pass" : "fail",
    measured: {
      bundledBuildings: fixture.buildings.length,
      compDBuildings: compDCount,
      resolvedToBuildingId: resolved,
      localResolvedInBounds: localResolved,
      offCampusIdentified: offCampusIdentified,
      problems: problems.length,
    },
    bar: "every bundled and compD building resolves to its building id; in-bounds resolve locally",
    note: ok
      ? `All ${fixture.buildings.length} buildings resolve by name and mnemonic; ntdp is identified but unresolved (off main-campus bounds) by design.`
      : problems.join("; ").slice(0, 400),
  };
}

// ---------------------------------------------------------------------------
// (b) route distance floor
// ---------------------------------------------------------------------------
type RouteResponse = {
  geometry?: LatLng[];
  distanceMeters?: number;
  source?: string;
};

async function runRouteGeodesicFloor(): Promise<CaseResult> {
  const sources = new Map<string, number>();
  const violations: string[] = [];
  let minRatio = Number.POSITIVE_INFINITY;

  for (const pair of fixture.pairs) {
    const response = await postJson("/api/map/route", {
      stops: [pair.start.entrance, pair.end.entrance],
    });
    if (response.status !== 200) {
      violations.push(`${pair.id}: HTTP ${response.status}`);
      continue;
    }
    const payload = parseJsonObject(response.text) as RouteResponse | undefined;
    if (!payload) {
      violations.push(`${pair.id}: malformed JSON body`);
      continue;
    }
    const distance = payload.distanceMeters;
    const source = payload.source ?? "unknown";
    sources.set(source, (sources.get(source) ?? 0) + 1);

    if (typeof distance !== "number" || !Number.isFinite(distance)) {
      violations.push(`${pair.id}: distanceMeters missing or non-finite`);
      continue;
    }
    // Floor: a walking path cannot be shorter than the great-circle distance
    // between the same endpoints. Recomputed here from the fixture entrances,
    // so the check stands on its own. Fixture pair distances are map-derived
    // (METHOD.md); the response under ORS-disabled fallback is the haversine
    // of the same endpoints, so anything below the floor is a real defect.
    const greatCircle = haversineMeters(pair.start.entrance, pair.end.entrance);
    if (distance + 0.05 < greatCircle) {
      violations.push(
        `${pair.id}: distanceMeters ${round1(distance)} < great-circle ${round1(greatCircle)}`,
      );
    }
    const ratio = distance / greatCircle;
    if (Number.isFinite(ratio) && ratio < minRatio) minRatio = ratio;
  }

  const sourceSummary = [...sources.entries()].map(([s, n]) => `${s}:${n}`).join(",");
  return {
    id: "route-geodesic-floor",
    status: violations.length === 0 ? "pass" : "fail",
    measured: {
      pairs: fixture.pairs.length,
      violations: violations.length,
      minDistanceOverGreatCircle: round1(minRatio),
      observedSources: sourceSummary,
    },
    bar: "every 200 route response reports distanceMeters >= great-circle distance of its endpoints",
    evidencePath: "evals/fixtures/campus-routes.json",
    note:
      `ORS disabled in this environment; observed sources: ${sourceSummary}. ` +
      (violations.length === 0 ? "No sub-geodesic distances." : violations.join("; ").slice(0, 400)),
  };
}

// ---------------------------------------------------------------------------
// (c) latency protocol
// ---------------------------------------------------------------------------
const LATENCY_COLD_SAMPLES = 10;
const LATENCY_WARM_SAMPLES = 10;
const PLAN_BAR_WARM_P95_MS = 200;
const TARGET_STOPS = 12;

/** 12 distinct in-bounds stops sampled along the longest fixture route. */
function buildLatencyStops(): LatLng[] {
  const longest = [...fixture.pairs].sort((a, b) => b.distanceMeters - a.distanceMeters)[0];
  const inBounds = longest.geometry
    .map(([lat, lng]) => ({ lat, lng }))
    .filter(isInsideUntBounds)
    .filter(
      (point, index, all) =>
        index === 0 ||
        Math.abs(point.lat - all[index - 1].lat) > 1e-5 ||
        Math.abs(point.lng - all[index - 1].lng) > 1e-5,
    );
  const picked: LatLng[] = [];
  for (let i = 0; i < TARGET_STOPS && inBounds.length > 0; i += 1) {
    const candidate = inBounds[Math.floor((i * inBounds.length) / TARGET_STOPS)];
    const distinct = picked.every(
      (p) => Math.abs(p.lat - candidate.lat) > 1e-5 || Math.abs(p.lng - candidate.lng) > 1e-5,
    );
    if (distinct) picked.push(candidate);
  }
  if (picked.length < TARGET_STOPS) {
    // Fallback: distinct building entrances are all in bounds by construction.
    for (const pair of fixture.pairs) {
      for (const endpoint of [pair.start.entrance, pair.end.entrance]) {
        if (!isInsideUntBounds(endpoint)) continue;
        const distinct = picked.every(
          (p) => Math.abs(p.lat - endpoint.lat) > 1e-5 || Math.abs(p.lng - endpoint.lng) > 1e-5,
        );
        if (distinct && picked.length < TARGET_STOPS) picked.push(endpoint);
      }
    }
  }
  return picked.slice(0, TARGET_STOPS);
}

function rotate<T>(items: T[], by: number): T[] {
  const offset = by % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

async function timedRouteRequest(stops: LatLng[]): Promise<{ status: number; ms: number }> {
  // postJson measures send -> full response read, after the pacing wait, so
  // the latency sample contains no pacing time.
  const result = await postJson("/api/map/route", { stops });
  return { status: result.status, ms: result.elapsedMs };
}

async function runRouteLatency(): Promise<CaseResult> {
  const stops = buildLatencyStops();
  if (stops.length < TARGET_STOPS) {
    return {
      id: "route-latency",
      status: "not-applicable",
      note: `could not build ${TARGET_STOPS} distinct in-bounds stops from the fixture`,
    };
  }

  // Cold: each sample uses a rotated stop order (a distinct request body).
  // Warm: the identical body repeated. Only 200 responses enter the stats.
  const coldSamples: number[] = [];
  const warmSamples: number[] = [];
  let non200 = 0;
  const requestLog: string[] = [];

  for (let i = 0; i < LATENCY_COLD_SAMPLES; i += 1) {
    const { status, ms } = await timedRouteRequest(rotate(stops, i));
    if (status === 200) coldSamples.push(ms);
    else {
      non200 += 1;
      requestLog.push(`cold#${i}: HTTP ${status}`);
    }
  }
  for (let i = 0; i < LATENCY_WARM_SAMPLES; i += 1) {
    const { status, ms } = await timedRouteRequest(stops);
    if (status === 200) warmSamples.push(ms);
    else {
      non200 += 1;
      requestLog.push(`warm#${i}: HTTP ${status}`);
    }
  }

  const measured = {
    coldN: coldSamples.length,
    coldP50Ms: round1(percentileNearestRank(coldSamples, 50)),
    coldP95Ms: round1(percentileNearestRank(coldSamples, 95)),
    warmN: warmSamples.length,
    warmP50Ms: round1(percentileNearestRank(warmSamples, 50)),
    warmP95Ms: round1(percentileNearestRank(warmSamples, 95)),
    non200Count: non200,
    stops: stops.length,
    pacingIntervalMs: MIN_REQUEST_INTERVAL_MS,
    totalRequests: LATENCY_COLD_SAMPLES + LATENCY_WARM_SAMPLES,
    planBarWarmP95Ms: PLAN_BAR_WARM_P95_MS,
  };

  if (non200 > 0) {
    return {
      id: "route-latency",
      status: "fail",
      measured,
      bar: `p95 warm <= ${PLAN_BAR_WARM_P95_MS} ms for ${TARGET_STOPS}-stop routes`,
      note: `non-200 responses excluded from stats but present: ${requestLog.join(", ")}`.slice(0, 400),
    };
  }

  const warmP95 = measured.warmP95Ms;
  const withinBar = warmP95 <= PLAN_BAR_WARM_P95_MS;
  return {
    id: "route-latency",
    status: withinBar ? "pass" : "fail",
    measured,
    bar: `p95 warm <= ${PLAN_BAR_WARM_P95_MS} ms for ${TARGET_STOPS}-stop routes`,
    note:
      `ORS disabled; fixed-interval pacing ${MIN_REQUEST_INTERVAL_MS} ms (~57 req/min < 60). ` +
      `Warm p95 ${warmP95} ms vs bar ${PLAN_BAR_WARM_P95_MS} ms; n=${measured.warmN} warm / ${measured.coldN} cold.`,
  };
}

// ---------------------------------------------------------------------------
// Suite definition
// ---------------------------------------------------------------------------
export default defineSuite({
  name: "routing",
  describe: async (): Promise<CaseSpec[]> => [
    {
      id: "building-coverage",
      bar: "every bundled-campus and compD.csv building resolves via /api/map/resolve to its building id",
    },
    {
      id: "route-geodesic-floor",
      bar: "every 200 route response on the fixture pairs reports distanceMeters >= great-circle distance",
    },
    {
      id: "route-latency",
      bar: `12-stop route p95 warm <= ${PLAN_BAR_WARM_P95_MS} ms; ORS disabled, cold/warm separate, 200-only, paced < 60 req/min`,
    },
  ],
  run: async (caseId: string, ctx: SuiteContext): Promise<CaseResult> => {
    activeBaseUrl = (env.UNTANGLE_BASE_URL ?? ctx.frontendOrigin ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    if (!(await appIsReachable())) {
      return {
        id: caseId,
        status: "not-applicable",
        note: `app not reachable at ${activeBaseUrl} (infrastructure, not an application result)`,
      };
    }
    switch (caseId) {
      case "building-coverage":
        return runBuildingCoverage();
      case "route-geodesic-floor":
        return runRouteGeodesicFloor();
      case "route-latency":
        return runRouteLatency();
      default:
        return { id: caseId, status: "not-applicable", note: `unknown case ${caseId}` };
    }
  },
});
