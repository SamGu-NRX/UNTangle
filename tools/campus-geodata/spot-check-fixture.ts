/**
 * Spot-check: route the 18 eval-fixture pairs over the committed walkway
 * graph and compare distances. Same entrance anchors as the fixture; only
 * the graph, snapping and A* differ. Run with bun from the repo root:
 *   bun tools/campus-geodata/spot-check-fixture.ts <path-to-campus-routes.json>
 */
import { readFileSync } from "node:fs";
import { routeBetweenPoints } from "../../frontend/src/lib/campus/graph";

type Pair = {
  id: string;
  start: { buildingId: string; entrance: { lat: number; lng: number } };
  end: { buildingId: string; entrance: { lat: number; lng: number } };
  distanceMeters: number;
};

const fixturePath = process.argv[2];
if (!fixturePath) {
  console.error("usage: bun tools/campus-geodata/spot-check-fixture.ts <campus-routes.json>");
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as { pairs: Pair[] };

const rows: { id: string; fixture: number; mine: number | null; errorPct: number | null }[] = [];
for (const pair of fixture.pairs) {
  const route = routeBetweenPoints(pair.start.entrance, pair.end.entrance);
  const mine = route ? route.distanceMeters : null;
  const errorPct = mine === null ? null : ((mine - pair.distanceMeters) / pair.distanceMeters) * 100;
  rows.push({ id: pair.id, fixture: pair.distanceMeters, mine, errorPct });
  const shown = mine === null ? "NO ROUTE" : `${mine.toFixed(1)}m (${errorPct! >= 0 ? "+" : ""}${errorPct!.toFixed(1)}%)`;
  console.log(`${pair.id.padEnd(22)} fixture ${String(pair.distanceMeters).padStart(7)}m  mine ${shown}`);
}

const measured = rows.filter((r) => r.errorPct !== null);
const errors = measured.map((r) => Math.abs(r.errorPct!)).sort((a, b) => a - b);
const median = errors.length % 2 === 0 ? (errors[errors.length / 2 - 1] + errors[errors.length / 2]) / 2 : errors[(errors.length - 1) / 2];
const max = errors[errors.length - 1] ?? 0;
console.log(`\n${measured.length}/${rows.length} pairs routed; median |error| ${median.toFixed(1)}%, max ${max.toFixed(1)}%`);
const within = measured.filter((r) => Math.abs(r.errorPct!) <= 20).length;
console.log(`pairs within 20%: ${within}/${measured.length}`);
