/**
 * Shared spherical/planar helpers for the campus walkway graph.
 *
 * Distances use haversine on a 6,371,000 m sphere — the same convention as
 * tools/campus-geodata and evals/fixtures/METHOD.md, so distances agree
 * across the fixture, the build and the runtime.
 */

export type LatLng = { lat: number; lng: number };

export const EARTH_RADIUS_M = 6371000;

export function haversineMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLng = ((bLng - aLng) * Math.PI) / 180;
  const lat1 = (aLat * Math.PI) / 180;
  const lat2 = (bLat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function haversineMetersBetween(a: LatLng, b: LatLng): number {
  return haversineMeters(a.lat, a.lng, b.lat, b.lng);
}

/**
 * Point-in-polygon (ray casting) with a 1 m boundary tolerance, on raw
 * lat/lng. Ring is open or closed; a missing closing edge is tolerated
 * because the tolerance check tests every segment.
 */
export function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const latI = ring[i][0];
    const lngI = ring[i][1];
    const latJ = ring[j][0];
    const lngJ = ring[j][1];
    const intersects =
      lngI > lng !== lngJ > lng && lat < ((latJ - latI) * (lng - lngI)) / (lngJ - lngI) + latI;
    if (intersects) inside = !inside;
  }
  if (inside) return true;
  return distanceToRingMeters(lat, lng, ring) <= 1;
}

/** Shortest distance in meters from a point to a ring's segments. */
export function distanceToRingMeters(lat: number, lng: number, ring: [number, number][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    best = Math.min(best, segmentDistanceMeters([lat, lng], ring[j], ring[i]));
  }
  return best;
}

function segmentDistanceMeters(point: number[], a: number[], b: number[]): number {
  const proj = makeProjector(point[0]);
  const [px, py] = proj.toXY(point[0], point[1]);
  const [ax, ay] = proj.toXY(a[0], a[1]);
  const [bx, by] = proj.toXY(b[0], b[1]);
  const abx = bx - ax;
  const aby = by - ay;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lengthSq));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Nearest point on a polygon ring to a target point, in a local
 * equirectangular frame. Used to project a building's snap node onto the
 * building's OSM outline when no entrance node exists.
 */
export function nearestPointOnRing(
  target: LatLng,
  ring: [number, number][],
): LatLng {
  const proj = makeProjector(target.lat);
  const [tx, ty] = proj.toXY(target.lat, target.lng);
  let bestD = Number.POSITIVE_INFINITY;
  let best: [number, number] = [target.lat, target.lng];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [ax, ay] = proj.toXY(ring[j][0], ring[j][1]);
    const [bx, by] = proj.toXY(ring[i][0], ring[i][1]);
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    const t =
      lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((tx - ax) * abx + (ty - ay) * aby) / lengthSq));
    const dx = tx - (ax + t * abx);
    const dy = ty - (ay + t * aby);
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = proj.fromXY(ax + t * abx, ay + t * aby);
    }
  }
  return { lat: best[0], lng: best[1] };
}

/** Shoelace area of a ring in square meters (local equirectangular frame). */
export function polygonAreaMeters(ring: [number, number][]): number {
  if (ring.length < 3) return 0;
  const proj = makeProjector(ring[0][0]);
  const points = ring.map(([lat, lng]) => proj.toXY(lat, lng));
  let area = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    area += points[j][0] * points[i][1] - points[i][0] * points[j][1];
  }
  return Math.abs(area / 2);
}

function makeProjector(refLat: number) {
  const latScale = (Math.PI / 180) * EARTH_RADIUS_M;
  const lngScale = latScale * Math.cos((refLat * Math.PI) / 180);
  return {
    toXY: (lat: number, lng: number): [number, number] => [lng * lngScale, lat * latScale],
    fromXY: (x: number, y: number): [number, number] => [y / latScale, x / lngScale],
  };
}
