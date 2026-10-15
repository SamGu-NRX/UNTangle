/**
 * Builds the UNT Day map's own detail layer, frontend/public/map/unt-denton/detail.geojson:
 * building outlines with heights, mapped 3D building parts, trees, entrances,
 * parking lots, plazas and building labels.
 *
 * Why it exists: OpenFreeMap's tiles merge every building of one height into
 * one shape per tile and carry no names, so the basemap can't color one
 * building, label it, or tell a measured height from its 5 m default.
 *
 * Inputs, all in raw/ (git-ignored; only the built file is committed) and all open data:
 * - overpass-map-detail-2026-10-13.json: one Overpass query (QUERY below) over
 *   the map's pan bounds (OpenStreetMap, ODbL 1.0);
 * - overture-heights-<release>.json: Overture heights joined by OSM id
 *   (fetch-overture-heights.py; ODbL 1.0);
 * - the campus registry (frontend/src/lib/campus-locations.ts) for building
 *   ids, codes and pins, and the cited fallback heights table.
 *
 * Usage, from the repository root (no network):
 *   bun --no-env-file tools/campus-geodata/build-map-detail.ts
 *
 * The same inputs always give the same bytes. A malformed height tag or a
 * registry building matched to two outlines fails the build with the OSM id.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { campusBuildings } from "../../frontend/src/lib/campus-locations";
import { untFallbackHeights } from "../../frontend/src/lib/campus/map-detail/fallback-heights";
import { resolveHeight, type BuildingHeight } from "../../frontend/src/lib/campus/map-detail/heights";
import { buildingLabel, splitOsmName } from "../../frontend/src/lib/campus/map-detail/labels";

const here = dirname(fileURLToPath(import.meta.url));
/** Git-ignored like the other dated Overpass responses; fetch it with QUERY below (README "Day map detail"). */
const SNAPSHOT = join(here, "raw", "overpass-map-detail-2026-10-13.json");
const OVERTURE_RELEASE = "2026-09-23.1";
const OVERTURE = join(here, "raw", `overture-heights-${OVERTURE_RELEASE}.json`);
const OUT = join(here, "..", "..", "frontend", "public", "map", "unt-denton", "detail.geojson");

/** The Overpass query that produced the snapshot (the map's pan bounds, map-canvas.tsx PAN_MARGIN). */
const QUERY_BBOX = "33.194,-97.166,33.226,-97.129";
const QUERY =
  `[out:json][timeout:180];(way["building"](${QUERY_BBOX});relation["building"](${QUERY_BBOX});` +
  `way["building:part"](${QUERY_BBOX});node["natural"="tree"](${QUERY_BBOX});way["natural"="tree_row"](${QUERY_BBOX});` +
  `node["entrance"](${QUERY_BBOX});way["leisure"="stadium"](${QUERY_BBOX});relation["leisure"="stadium"](${QUERY_BBOX});` +
  `way["amenity"="parking"](${QUERY_BBOX});relation["amenity"="parking"](${QUERY_BBOX});` +
  `way["highway"="pedestrian"]["area"="yes"](${QUERY_BBOX});way["area:highway"](${QUERY_BBOX});way["place"="square"](${QUERY_BBOX}););out geom qt;`;

/**
 * Landmarks the brief names, by OSM element: they keep a label from the
 * campus overview zoom and a warmer roof. Discovery Park is 5 km north,
 * outside the map's pan bounds, so it has no outline here.
 */
const LANDMARKS: Record<string, string> = {
  "way/518915908": "University Union",
  "way/256766443": "Willis Library",
  "way/1165981497": "Coliseum",
  "relation/1918491": "DATCU Stadium (Apogee) stands",
  "way/141598547": "DATCU Stadium (Apogee) grounds, for its label",
};

/** OSM building values that mark a UNT building even without a code in its name. */
const CAMPUS_BUILDING_VALUES = new Set(["university", "dormitory", "stadium"]);

type LatLon = { lat: number; lon: number };
type OsmTags = Record<string, string>;
type OsmNode = { type: "node"; id: number; lat: number; lon: number; tags?: OsmTags };
type OsmWay = { type: "way"; id: number; geometry?: LatLon[]; tags?: OsmTags };
type OsmRelation = {
  type: "relation";
  id: number;
  tags?: OsmTags;
  members: { type: string; role: string; geometry?: LatLon[] }[];
};
type OsmElement = OsmNode | OsmWay | OsmRelation;
type Snapshot = { osm3s: { timestamp_osm_base: string }; elements: OsmElement[] };

type Position = [number, number];
type Ring = Position[];
type Polygon = Ring[];

/* ---------- geometry ---------- */

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;
const toPosition = (point: LatLon): Position => [round6(point.lon), round6(point.lat)];

function closedRing(points: LatLon[] | undefined): Ring | null {
  if (!points || points.length < 4) return null;
  const ring = points.map(toPosition);
  const [first, last] = [ring[0], ring[ring.length - 1]];
  return first[0] === last[0] && first[1] === last[1] ? ring : null;
}

/** Join open member ways end to end into closed rings (OSM multipolygon outers are often split). */
function stitch(segments: LatLon[][]): Ring[] {
  const pending = segments.map((segment) => segment.map(toPosition));
  const rings: Ring[] = [];
  const same = (a: Position, b: Position) => a[0] === b[0] && a[1] === b[1];
  while (pending.length > 0) {
    let ring = pending.shift()!;
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let index = 0; index < pending.length; index += 1) {
        const next = pending[index];
        const end = ring[ring.length - 1];
        if (same(end, next[0])) ring = [...ring, ...next.slice(1)];
        else if (same(end, next[next.length - 1])) ring = [...ring, ...[...next].reverse().slice(1)];
        else continue;
        pending.splice(index, 1);
        grown = true;
        break;
      }
    }
    if (ring.length >= 4 && same(ring[0], ring[ring.length - 1])) rings.push(ring);
  }
  return rings;
}

function inRing(point: Position, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > point[1] !== yj > point[1] && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function inPolygon(point: Position, polygon: Polygon): boolean {
  return inRing(point, polygon[0]) && !polygon.slice(1).some((hole) => inRing(point, hole));
}

/** Shoelace area in square metres (equirectangular, fine at campus scale). */
function ringArea(ring: Ring): number {
  const metresPerDegLat = 111_320;
  const metresPerDegLng = 111_320 * Math.cos((33.21 * Math.PI) / 180);
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    sum += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
  }
  return Math.abs(sum / 2) * metresPerDegLat * metresPerDegLng;
}

function centroid(ring: Ring): Position {
  const points = ring.slice(0, -1);
  return [
    points.reduce((sum, p) => sum + p[0], 0) / points.length,
    points.reduce((sum, p) => sum + p[1], 0) / points.length,
  ];
}

function distanceToEdges(point: Position, polygon: Polygon): number {
  let best = Infinity;
  for (const ring of polygon) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [ax, ay] = ring[j];
      const [bx, by] = ring[i];
      const dx = bx - ax;
      const dy = by - ay;
      const t = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / (dx * dx + dy * dy)));
      best = Math.min(best, Math.hypot(point[0] - (ax + t * dx), point[1] - (ay + t * dy)));
    }
  }
  return best;
}

/** A point well inside the outline for its label: the best of a 24 x 24 grid, by distance to the nearest edge. */
function labelPoint(polygon: Polygon): Position {
  const xs = polygon[0].map((p) => p[0]);
  const ys = polygon[0].map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  let best = centroid(polygon[0]);
  let bestDistance = inPolygon(best, polygon) ? distanceToEdges(best, polygon) : -1;
  const steps = 24;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      const candidate: Position = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (!inPolygon(candidate, polygon)) continue;
      const distance = distanceToEdges(candidate, polygon);
      if (distance > bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return [round6(best[0]), round6(best[1])];
}

/* ---------- elements ---------- */

type Outline = {
  osm: string;
  tags: OsmTags;
  polygons: Polygon[];
  area: number;
};

function outlineOf(element: OsmWay | OsmRelation): Outline | null {
  const osm = `${element.type}/${element.id}`;
  const tags = element.tags ?? {};
  if (element.type === "way") {
    const ring = closedRing(element.geometry);
    return ring ? { osm, tags, polygons: [[ring]], area: ringArea(ring) } : null;
  }
  const outers = stitch(element.members.filter((m) => m.role === "outer" && m.geometry).map((m) => m.geometry!));
  const inners = stitch(element.members.filter((m) => m.role === "inner" && m.geometry).map((m) => m.geometry!));
  if (outers.length === 0) return null;
  const polygons: Polygon[] = outers.map((outer) => [outer, ...inners.filter((inner) => inRing(inner[0], outer))]);
  const area = polygons.reduce((sum, polygon) => sum + ringArea(polygon[0]) - polygon.slice(1).reduce((s, hole) => s + ringArea(hole), 0), 0);
  return { osm, tags, polygons, area };
}

const geometryOf = (polygons: Polygon[]) =>
  polygons.length === 1
    ? { type: "Polygon" as const, coordinates: polygons[0] }
    : { type: "MultiPolygon" as const, coordinates: polygons };

const containsPoint = (outline: Outline, point: Position) => outline.polygons.some((polygon) => inPolygon(point, polygon));

function isUnderground(tags: OsmTags): boolean {
  return tags.location === "underground" || (tags.layer !== undefined && Number(tags.layer) < 0);
}

/** A roof with no walls (canopies, fuel-station roofs): solid only when its underside height is mapped. */
function drawnHeight(tags: OsmTags, height: BuildingHeight): BuildingHeight {
  const isRoofOnly = tags.building === "roof" || tags["building:part"] === "roof";
  if (height.source !== "none" && isRoofOnly && height.base === 0) return { source: "none" };
  return height;
}

/* ---------- build ---------- */

function build() {
  const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot;
  const overture = JSON.parse(readFileSync(OVERTURE, "utf8")) as { meta: unknown; heights: Record<string, number> };
  const fallback = new Map(untFallbackHeights.map((entry) => [entry.osm, entry]));

  const elements = snapshot.elements;
  const buildings: Outline[] = [];
  const parts: Outline[] = [];
  const stadiums: Outline[] = [];
  const ground: { kind: "pk" | "pz"; outline: Outline }[] = [];
  const skipped = { unclosed: 0, underground: 0 };

  for (const element of elements) {
    if (element.type === "node") continue;
    const tags = element.tags ?? {};
    const isBuilding = tags.building !== undefined && tags.building !== "no";
    const isPart = !isBuilding && tags["building:part"] !== undefined && tags["building:part"] !== "no";
    const isStadium = tags.leisure === "stadium" && !isBuilding;
    const isParking = tags.amenity === "parking" && !isBuilding && tags.parking !== "multi-storey" && tags.parking !== "underground";
    const isPlaza = !isBuilding && (tags["area:highway"] === "footway" || tags["area:highway"] === "pedestrian" || (tags.highway === "pedestrian" && tags.area === "yes") || tags.place === "square");
    if (!isBuilding && !isPart && !isStadium && !isParking && !isPlaza) continue;
    const outline = outlineOf(element);
    if (!outline) {
      skipped.unclosed += 1;
      continue;
    }
    if (isUnderground(tags)) {
      skipped.underground += 1;
      continue;
    }
    if (isBuilding) buildings.push(outline);
    else if (isPart) parts.push(outline);
    else if (isStadium) stadiums.push(outline);
    else ground.push({ kind: isParking ? "pk" : "pz", outline });
  }

  // Registry buildings to outlines: by the code in OSM's name, else by the pin.
  const byCode = new Map<string, Outline>();
  for (const outline of buildings) {
    const { code } = splitOsmName(outline.tags.name ?? "");
    if (code) byCode.set(code, outline);
  }
  const registry = new Map<string, { id: string; outline: Outline; via: "code" | "pin" }>();
  const unmatched: string[] = [];
  for (const building of campusBuildings) {
    const codes = [building.shortName, building.mnemonic].filter((code): code is string => Boolean(code));
    const named = codes.map((code) => byCode.get(code)).find(Boolean);
    const pinned = buildings.find((outline) => containsPoint(outline, [building.lng, building.lat]));
    const outline = named ?? pinned;
    if (!outline) {
      unmatched.push(`${building.shortName} (${building.name})`);
      continue;
    }
    const taken = registry.get(outline.osm);
    if (taken) throw new Error(`${outline.osm} matches two registry buildings: ${taken.id} and ${building.id}`);
    registry.set(outline.osm, { id: building.id, outline, via: named ? "code" : "pin" });
  }

  const tierOf = (outline: Outline) => {
    if (LANDMARKS[outline.osm]) return 2;
    const tags = outline.tags;
    if (registry.has(outline.osm) || CAMPUS_BUILDING_VALUES.has(tags.building ?? "") || tags.leisure === "stadium" || splitOsmName(tags.name ?? "").code) return 1;
    return 0;
  };

  // Parts replace their outline (OSM's Simple 3D Buildings rule): the outline stays as a flat footprint.
  const partParent = new Map<Outline, Outline>();
  for (const part of parts) {
    const point = labelPoint(part.polygons[0]);
    const parent = buildings
      .filter((outline) => containsPoint(outline, point))
      .sort((a, b) => a.area - b.area)[0];
    if (parent) partParent.set(part, parent);
  }
  // A part replaces its outline only if the part itself is drawn; drawnHeight can still drop it
  // (a roof-only part with no min_height), and then the outline must keep its own height.
  const hasParts = new Set(
    [...partParent.entries()]
      .filter(([part]) => drawnHeight(part.tags, resolveHeight({ tags: part.tags, osm: part.osm, fallback })).source !== "none")
      .map(([, parent]) => parent),
  );

  const coverage = { all: {} as Record<string, number>, campus: {} as Record<string, number> };
  const count = (bucket: Record<string, number>, key: string) => {
    bucket[key] = (bucket[key] ?? 0) + 1;
  };
  const flatCampus: string[] = [];
  const features: object[] = [];

  for (const outline of buildings.sort((a, b) => a.osm.localeCompare(b.osm))) {
    const tier = tierOf(outline);
    const resolved = drawnHeight(
      outline.tags,
      resolveHeight({ tags: outline.tags, osm: outline.osm, fallback, overtureMetres: overture.heights[outline.osm] }),
    );
    const replaced = hasParts.has(outline);
    const source = replaced ? "osm-parts" : resolved.source;
    count(coverage.all, source);
    if (tier > 0) count(coverage.campus, source);
    if (tier > 0 && source === "none") flatCampus.push(`${outline.osm} ${outline.tags.name ?? "(no name)"}`);
    const drawn = !replaced && resolved.source !== "none" ? resolved : null;
    const cid = registry.get(outline.osm)?.id;
    features.push({
      type: "Feature",
      properties: {
        k: "b",
        h: drawn ? drawn.height : 0,
        ...(drawn && drawn.base > 0 ? { b: drawn.base } : {}),
        t: tier,
        ...(cid ? { c: cid } : {}),
      },
      geometry: geometryOf(outline.polygons),
    });
  }

  for (const part of parts.sort((a, b) => a.osm.localeCompare(b.osm))) {
    const parent = partParent.get(part);
    const resolved = drawnHeight(part.tags, resolveHeight({ tags: part.tags, osm: part.osm, fallback }));
    if (!parent || resolved.source === "none") continue;
    const cid = registry.get(parent.osm)?.id;
    features.push({
      type: "Feature",
      properties: { k: "p", h: resolved.height, ...(resolved.base > 0 ? { b: resolved.base } : {}), t: tierOf(parent), ...(cid ? { c: cid } : {}) },
      geometry: geometryOf(part.polygons),
    });
  }

  for (const { kind, outline } of ground.sort((a, b) => a.outline.osm.localeCompare(b.outline.osm))) {
    features.push({ type: "Feature", properties: { k: kind }, geometry: geometryOf(outline.polygons) });
  }

  // Trees: OSM points (natural=tree) and the one mapped tree row.
  const nodes = elements.filter((element): element is OsmNode => element.type === "node").sort((a, b) => a.id - b.id);
  let trees = 0;
  for (const node of nodes) {
    if (node.tags?.natural !== "tree") continue;
    trees += 1;
    features.push({ type: "Feature", properties: { k: "tr" }, geometry: { type: "Point", coordinates: toPosition(node) } });
  }
  for (const element of elements) {
    if (element.type !== "way" || element.tags?.natural !== "tree_row" || !element.geometry) continue;
    features.push({ type: "Feature", properties: { k: "trl" }, geometry: { type: "LineString", coordinates: element.geometry.map(toPosition) } });
  }

  // Entrances on campus buildings: main ones are drawn a little larger.
  const campusOutlines = buildings.filter((outline) => tierOf(outline) > 0);
  let entrances = 0;
  for (const node of nodes) {
    const kind = node.tags?.entrance;
    if (kind !== "main" && kind !== "yes") continue;
    const point = toPosition(node);
    const nearCampus = campusOutlines.some((outline) =>
      outline.polygons.some((polygon) => distanceToEdges(point, polygon) < 0.000015 || inPolygon(point, polygon)),
    );
    if (!nearCampus) continue;
    entrances += 1;
    features.push({ type: "Feature", properties: { k: "en", m: kind === "main" ? 1 : 0 }, geometry: { type: "Point", coordinates: point } });
  }

  // Labels. Registry buildings sit at their pin (the stop marker stands there);
  // other UNT buildings with a code, and the landmarks, at a point inside the outline.
  type Label = { text: string; code: string | null; point: Position; tier: number; cid?: string; area: number };
  const labels: Label[] = [];
  const registryById = new Map([...registry.values()].map((entry) => [entry.id, entry]));
  for (const building of campusBuildings) {
    if (building.isOffCampus) continue;
    const entry = registryById.get(building.id);
    labels.push({
      text: buildingLabel(building.name, building.shortName),
      code: building.shortName,
      point: [round6(building.lng), round6(building.lat)],
      tier: entry ? tierOf(entry.outline) : 1,
      cid: building.id,
      area: entry?.outline.area ?? 0,
    });
  }
  for (const outline of [...buildings, ...stadiums]) {
    if (registry.has(outline.osm) || !outline.tags.name) continue;
    const { name, code } = splitOsmName(outline.tags.name);
    const tier = tierOf(outline);
    // UNT buildings with a code, landmarks, and named stadium grounds; dorm and annex outlines without a code stay unlabelled.
    if (tier === 0 || (!code && tier < 2 && outline.tags.leisure !== "stadium")) continue;
    labels.push({ text: buildingLabel(name, code), code, point: labelPoint(outline.polygons[0]), tier, area: outline.area });
  }
  // Landmarks first, then registry order, then bigger buildings: collisions always drop the same labels.
  const registryOrder = new Map(campusBuildings.map((building, index) => [building.id, index]));
  labels.sort((a, b) =>
    b.tier - a.tier ||
    (registryOrder.get(a.cid ?? "") ?? 1e6) - (registryOrder.get(b.cid ?? "") ?? 1e6) ||
    b.area - a.area ||
    a.text.localeCompare(b.text),
  );
  labels.forEach((label, index) => {
    features.push({
      type: "Feature",
      properties: { k: "lb", n: label.text, ...(label.code ? { cd: label.code } : {}), t: label.tier, p: index + 1, ...(label.cid ? { c: label.cid } : {}) },
      geometry: { type: "Point", coordinates: label.point },
    });
  });

  const meta = {
    generatedBy: "tools/campus-geodata/build-map-detail.ts",
    attribution: "© OpenStreetMap contributors (ODbL 1.0); building heights partly from Overture Maps Foundation (ODbL 1.0), Microsoft ML Buildings",
    sources: {
      openstreetmap: { query: QUERY, osmBase: snapshot.osm3s.timestamp_osm_base, licence: "ODbL 1.0" },
      overture: overture.meta,
    },
    legend: {
      k: { b: "building outline", p: "building part", pk: "parking", pz: "plaza", tr: "tree", trl: "tree row", en: "entrance", lb: "label" },
      h: "height in metres; 0 is drawn flat (no height in any source, or replaced by its parts)",
      b: "base height in metres, when above the ground",
      t: { 0: "other building", 1: "UNT building", 2: "landmark" },
    },
    counts: { buildings: buildings.length, parts: parts.length, trees, entrances, labels: labels.length, skipped },
    // Outlines by height source: osm-height, osm-levels (x 3.66 m), fallback-table,
    // overture-ml (Microsoft ML estimate), osm-parts (drawn by mapped parts), none (flat).
    heightCoverage: coverage,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  const body = JSON.stringify({ type: "FeatureCollection", meta, features });
  writeFileSync(OUT, `${body}\n`);

  console.log(`wrote ${OUT} (${(body.length / 1024).toFixed(0)} KiB)`);
  console.log("counts", JSON.stringify(meta.counts));
  console.log("height coverage, all buildings", JSON.stringify(coverage.all));
  console.log("height coverage, UNT buildings", JSON.stringify(coverage.campus));
  console.log(`registry matched ${registry.size}/${campusBuildings.length}:`, [...registry.values()].map((entry) => `${entry.id}:${entry.via}`).join(" "));
  console.log("registry buildings with no outline:", unmatched.join("; ") || "none");
  console.log(`flat campus buildings (${flatCampus.length}):`, flatCampus.join("; "));
}

build();
