/**
 * Fixture self-check for evals/fixtures/campus-routes.json.
 *
 * Re-derives every recorded number from the data recorded in the fixture itself
 * (no network, no app): recomputes each pair's polyline length from the recorded
 * geometry and the great-circle distance between the recorded entrances, and
 * asserts the honesty invariants. Exit 0 = all checks pass.
 *
 * Run: bun evals/fixtures/verify-campus-routes.ts
 */
import { readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

type LatLng = { lat: number; lng: number };
type Pair = {
  id: string;
  start: { buildingId: string; entrance: LatLng };
  end: { buildingId: string; entrance: LatLng };
  distanceMeters: number;
  greatCircleMeters: number;
  wayTypes: string[];
  roadCrossings: number;
  stepsSegments: number;
  geometry: [number, number][];
  dataOrigin: string;
  physicallyWalked: boolean;
  method: string;
  evidence: string;
};
type Fixture = {
  name: string;
  buildings: Array<{ id: string; inRoutingBounds: boolean; inCompD: boolean }>;
  pairs: Pair[];
};

const fixturePath = join(import.meta.dir, "campus-routes.json");
const fixture: Fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));

const EARTH_RADIUS_M = 6_371_000;

function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

let failures = 0;
function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

// --- structural expectations -------------------------------------------------
const inBounds = fixture.buildings.filter((b) => b.inRoutingBounds);
check("fixture name is campus-routes", fixture.name === "campus-routes");
check("at least 15 pairs", fixture.pairs.length >= 15, `${fixture.pairs.length} pairs`);

const endpoints = new Set(fixture.pairs.flatMap((p) => [p.start.buildingId, p.end.buildingId]));
const uncovered = inBounds.filter((b) => !endpoints.has(b.id));
check("every in-bounds building is a pair endpoint", uncovered.length === 0,
  uncovered.length ? `missing: ${uncovered.map((b) => b.id).join(",")}` : "all covered");

const withSteps = fixture.pairs.filter((p) => p.stepsSegments > 0);
const withCrossings = fixture.pairs.filter((p) => p.roadCrossings > 0);
check("at least one pair uses steps", withSteps.length >= 1, `${withSteps.length} pairs`);
check("at least 3 pairs include road crossings", withCrossings.length >= 3,
  `${withCrossings.length} pairs`);

// --- per-pair honesty invariants ---------------------------------------------
const ROUNDING_TOLERANCE_M = 0.5; // coordinates rounded to 7 dp (~1 cm/vertex)
for (const pair of fixture.pairs) {
  const pts: LatLng[] = pair.geometry.map(([lat, lng]) => ({ lat, lng }));
  let recomputed = 0;
  for (let i = 1; i < pts.length; i += 1) recomputed += haversineMeters(pts[i - 1], pts[i]);
  recomputed = Math.round(recomputed * 10) / 10;

  const gc = haversineMeters(pair.start.entrance, pair.end.entrance);
  const gcRounded = Math.round(gc * 10) / 10;

  check(
    `${pair.id}: recorded distance equals recomputed polyline length`,
    Math.abs(recomputed - pair.distanceMeters) <= ROUNDING_TOLERANCE_M,
    `recorded ${pair.distanceMeters} m, recomputed ${recomputed} m`,
  );
  check(
    `${pair.id}: path length >= great-circle distance`,
    recomputed >= gcRounded - 0.05,
    `path ${recomputed} m vs great-circle ${gcRounded} m`,
  );
  check(
    `${pair.id}: recorded great-circle matches entrances`,
    Math.abs(gcRounded - pair.greatCircleMeters) <= 0.1,
    `recorded ${pair.greatCircleMeters} m, recomputed ${gcRounded} m`,
  );
  check(
    `${pair.id}: labeled map-derived, not walked`,
    pair.dataOrigin === "map-derived" && pair.physicallyWalked === false,
  );
  check(`${pair.id}: method reference present`, pair.method === "evals/fixtures/METHOD.md");

  const evidencePath = join(import.meta.dir, pair.evidence);
  const evidenceOk = existsSync(evidencePath) && statSync(evidencePath).size > 5_000;
  check(`${pair.id}: visual evidence exists (${pair.evidence})`, evidenceOk);
}

console.log(
  failures === 0
    ? `\nOK — ${fixture.pairs.length} pairs, all self-checks passed`
    : `\n${failures} check(s) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
