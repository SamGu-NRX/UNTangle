#!/usr/bin/env python3
"""Build evals/fixtures/campus-routes.json from public OpenStreetMap data.

Method: see evals/fixtures/METHOD.md (this script is the executable form of it).
Data origin: map-derived (Overpass API); nothing here is physically walked.
Stdlib only; caches raw Overpass responses so re-runs are deterministic.

Usage: python3 build-campus-routes.py [--refresh-osm]
Outputs:
  - evals/fixtures/campus-routes.json
  - evals/fixtures/evidence/overpass-pedestrian-<STAMP>.json
  - evals/fixtures/evidence/overpass-buildings-<STAMP>.json
"""

import csv
import json
import math
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from heapq import heappop, heappush

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
FIXTURES = os.path.abspath(os.path.join(HERE, ".."))
EVIDENCE = os.path.join(FIXTURES, "evidence")
CACHE = "/home/user/work/overpass-cache"

CAMPUS_TS = os.path.join(REPO, "frontend", "src", "lib", "campus-locations.ts")
COMP_D = os.path.join(REPO, "backend", "data", "compD.csv")
OUT = os.path.join(FIXTURES, "campus-routes.json")

# App bounds plus a margin so ways just outside the routing bounds (crossings on
# the perimeter streets) are still part of the graph.
BBOX = (33.2025, -97.1585, 33.2175, -97.1345)  # (south, west, north, east)
OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]
USER_AGENT = "UNTangle-eval-fixture-builder/1.0 (map-derived walking distances; contact via repo SamGu-NRX/UNTangle)"

MAX_SNAP_METERS = 250.0  # entrance must snap to a pedestrian node within this
TARGET_PAIRS = 18
MIN_PAIRS = 15
MAX_STEPS_PAIRS = 3
MAX_CROSSING_PAIRS = 4

# Walkable highway values (client-side filter; see METHOD.md).
WALKABLE_HIGHWAYS = {
    "footway", "steps", "path", "pedestrian", "corridor", "living_street",
    "service", "residential", "unclassified", "tertiary", "secondary",
    "primary", "tertiary_link", "secondary_link", "primary_link", "track",
    "road",
}

EARTH_RADIUS_M = 6371000.0


def haversine_m(lat1, lon1, lat2, lon2):
    d_lat = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    h = (math.sin(d_lat / 2) ** 2
         + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2))
         * math.sin(d_lon / 2) ** 2)
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def parse_bundled_buildings():
    """Transcribe the bundled roster straight from frontend campus-locations.ts."""
    src = open(CAMPUS_TS, encoding="utf-8").read()
    array = re.search(r"campusBuildings: CampusBuilding\[\] = \[(.*?)\n\];", src, re.S).group(1)
    blocks = re.findall(r"\{[\s\S]*?\}(?=,|\s*$)", array)
    buildings = {}
    for block in blocks:
        def field(name):
            m = re.search(rf'\b{name}: "?([^",\n]+)"?', block)
            return m.group(1).strip() if m else None
        bid = field("id")
        if not bid:
            continue
        buildings[bid] = {
            "id": bid,
            "name": field("name"),
            "shortName": field("shortName"),
            "mnemonic": field("mnemonic"),
            "lat": float(field("lat")),
            "lng": float(field("lng")),
            "isOffCampus": "isOffCampus: true" in block,
        }
    return buildings


def parse_comp_d_codes():
    """Distinct building codes used by backend/data/compD.csv, e.g. CHEM -> chem."""
    codes = set()
    with open(COMP_D, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            m = re.search(r"\(([A-Z0-9]+)\)\s*\S*\s*$", row["location"].strip())
            if m:
                codes.add(m.group(1))
    return sorted(codes)


def overpass(query, stamp, name):
    """Run an Overpass query with a disk cache; keep the raw response as evidence."""
    os.makedirs(CACHE, exist_ok=True)
    os.makedirs(EVIDENCE, exist_ok=True)
    cache_path = os.path.join(CACHE, f"{name}.json")
    if os.path.exists(cache_path) and not REFRESH:
        print(f"[overpass] cache hit: {cache_path}")
        return json.load(open(cache_path, encoding="utf-8"))
    body = urllib.parse.urlencode({"data": query}).encode()
    last_err = None
    for attempt in range(4):
        endpoint = OVERPASS_ENDPOINTS[attempt % len(OVERPASS_ENDPOINTS)]
        if attempt:
            time.sleep(15)  # back off before retrying the public servers
        req = urllib.request.Request(endpoint, data=body, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=240) as resp:
                raw = resp.read()
            data = json.loads(raw)
            open(cache_path, "wb").write(raw)
            evidence_path = os.path.join(EVIDENCE, f"{name}-{stamp}.json")
            open(evidence_path, "wb").write(raw)
            print(f"[overpass] fetched {len(raw)} bytes from {endpoint} -> {evidence_path}")
            return data
        except Exception as err:  # rotate endpoints / retry; these servers 504 easily
            last_err = err
            print(f"[overpass] {endpoint} failed (attempt {attempt + 1}): {err}")
    raise RuntimeError(f"all Overpass endpoints failed: {last_err}")


def way_is_walkable(tags):
    hw = tags.get("highway")
    if hw not in WALKABLE_HIGHWAYS:
        return False
    if tags.get("foot") == "no":
        return False
    if tags.get("access") in {"no", "private"} and tags.get("foot") not in {"yes", "designated", "permissive"}:
        return False
    return True


def way_kind(tags):
    """Classification used in the fixture's wayTypes histogram."""
    hw = tags.get("highway")
    if hw == "footway" and tags.get("footway") == "crossing":
        return "crossing"
    if hw == "footway" and tags.get("footway") == "sidewalk":
        return "sidewalk"
    return hw


def node_key(lat, lon):
    return (round(lat, 8), round(lon, 8))


def build_graph(ped_data):
    """Nodes = OSM nodes; edges = consecutive way nodes, undirected.

    edges[(a, b)] = (meters, set_of_way_ids, set_of_way_kinds) with a < b.
    """
    edges = {}
    used_ways = 0
    for el in ped_data["elements"]:
        if el.get("type") != "way":
            continue
        tags = el.get("tags", {})
        if not way_is_walkable(tags):
            continue
        geom = el.get("geometry") or []
        kind = way_kind(tags)
        used_ways += 1
        for i in range(len(geom) - 1):
            a = node_key(geom[i]["lat"], geom[i]["lon"])
            b = node_key(geom[i + 1]["lat"], geom[i + 1]["lon"])
            if a == b:
                continue
            meters = haversine_m(a[0], a[1], b[0], b[1])
            key = (a, b) if a < b else (b, a)
            if key in edges:
                edges[key][1].add(el["id"])
                edges[key][2].add(kind)
            else:
                edges[key] = (meters, {el["id"]}, {kind})
    adjacency = {}
    for (a, b), (meters, way_ids, kinds) in edges.items():
        adjacency.setdefault(a, {})[b] = (meters, way_ids, kinds)
        adjacency.setdefault(b, {})[a] = (meters, way_ids, kinds)
    print(f"[graph] {used_ways} walkable ways, {len(adjacency)} nodes, "
          f"{len(edges)} edges")
    return adjacency, edges


def build_footprints(bld_data):
    """Closed building ways as polygons (list of (lat, lon) rings)."""
    polygons = []
    for el in bld_data["elements"]:
        if el.get("type") != "way":
            continue
        if "building" not in el.get("tags", {}):
            continue
        geom = el.get("geometry") or []
        if len(geom) < 4:
            continue
        ring = [(p["lat"], p["lon"]) for p in geom]
        if ring[0] != ring[-1]:
            continue
        polygons.append(ring)
    print(f"[footprints] {len(polygons)} closed building ways")
    return polygons


def point_in_ring(lat, lon, ring):
    inside = False
    n = len(ring)
    for i in range(n):
        lat1, lon1 = ring[i]
        lat2, lon2 = ring[(i + 1) % n]
        if (lon1 > lon) != (lon2 > lon):
            x_cross = (lon2 - lon1) * (lat - lat1) / (lon2 - lon1) + lon1
            if lon < x_cross:
                inside = not inside
    return inside


def ring_area_sq_deg(ring):
    total = 0.0
    for i in range(len(ring) - 1):
        lat1, lon1 = ring[i]
        lat2, lon2 = ring[i + 1]
        total += lon1 * lat2 - lon2 * lat1
    return abs(total) / 2.0


def nearest_point_on_ring(lat, lon, ring):
    """Nearest point (lat, lon) on the ring boundary to the given point."""
    best = (None, float("inf"))
    for i in range(len(ring) - 1):
        a_lat, a_lon = ring[i]
        b_lat, b_lon = ring[i + 1]
        # equirectangular local projection: fine at building scale
        ax, ay = a_lon * math.cos(math.radians(lat)), a_lat
        bx, by = b_lon * math.cos(math.radians(lat)), b_lat
        px, py = lon * math.cos(math.radians(lat)), lat
        dx, dy = bx - ax, by - ay
        seg2 = dx * dx + dy * dy
        t = 0.0 if seg2 == 0 else max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / seg2))
        cx, cy = ax + t * dx, ay + t * dy
        d = math.hypot(px - cx, py - cy)
        if d < best[1]:
            clon = cx / math.cos(math.radians(lat))
            best = ((cy, clon), d)
    return best[0]


def dijkstra(adjacency, source, target):
    dist = {source: 0.0}
    prev = {}
    heap = [(0.0, source)]
    while heap:
        d, node = heappop(heap)
        if node == target:
            path = [node]
            while node in prev:
                node = prev[node]
                path.append(node)
            return d, list(reversed(path))
        if d > dist.get(node, float("inf")):
            continue
        for nxt, (meters, _, _) in adjacency.get(node, {}).items():
            nd = d + meters
            if nd < dist.get(nxt, float("inf")):
                dist[nxt] = nd
                prev[nxt] = node
                heappush(heap, (nd, nxt))
    return None, None


def path_edges(edges, path):
    out = []
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        key = (a, b) if a < b else (b, a)
        out.append(edges[key])
    return out


def main():
    stamp = STAMP
    bundled = parse_bundled_buildings()
    comp_d_codes = parse_comp_d_codes()
    code_to_id = {b["shortName"]: bid for bid, b in bundled.items()}
    comp_d_ids = sorted(code_to_id[c] for c in comp_d_codes)
    print(f"[roster] {len(bundled)} bundled buildings; compD codes {comp_d_codes}")

    south, west, north, east = BBOX
    bbox = f"{south},{west},{north},{east}"
    ped_q = f"[out:json][timeout:180];(way[\"highway\"]({bbox}););out geom;"
    bld_q = f"[out:json][timeout:120];(way[\"building\"]({bbox}););out geom;"
    ped_data = overpass(ped_q, stamp, "overpass-pedestrian")
    bld_data = overpass(bld_q, stamp, "overpass-buildings")

    adjacency, edges = build_graph(ped_data)
    polygons = build_footprints(bld_data)

    # --- entrances -------------------------------------------------------
    buildings_out = []
    snap_nodes = {}
    for bid in sorted(bundled):
        b = bundled[bid]
        entry = {
            "id": bid,
            "name": b["name"],
            "shortName": b["shortName"],
            "mnemonic": b["mnemonic"],
            "pin": {"lat": round(b["lat"], 7), "lng": round(b["lng"], 7)},
            "inRoutingBounds": not b["isOffCampus"],
            "inCompD": bid in comp_d_ids,
        }
        if b["isOffCampus"]:
            entry["entrance"] = None
            entry["entranceSource"] = "off-campus (outside routing bounds; no entrance derived)"
            buildings_out.append(entry)
            continue
        # graph nodes within MAX_SNAP_METERS of the pin
        candidates = []
        for node in adjacency:
            d = haversine_m(b["lat"], b["lng"], node[0], node[1])
            if d <= MAX_SNAP_METERS:
                candidates.append((d, node))
        if not candidates:
            raise RuntimeError(f"no pedestrian node within {MAX_SNAP_METERS} m of {bid}")
        snap_d, node = min(candidates)
        snap_nodes[bid] = node
        # footprint: smallest building polygon containing the pin
        containing = [ring for ring in polygons if point_in_ring(b["lat"], b["lng"], ring)]
        if containing:
            ring = min(containing, key=ring_area_sq_deg)
            entrance = nearest_point_on_ring(b["lat"], b["lng"], ring)
            source = "osm-building-footprint-edge"
            footprint_way = None
            for el in bld_data["elements"]:
                if el.get("type") == "way" and "building" in el.get("tags", {}):
                    geom = el.get("geometry") or []
                    if geom and node_key(geom[0]["lat"], geom[0]["lon"]) == node_key(ring[0][0], ring[0][1]):
                        footprint_way = el["id"]
                        break
            entry["osmFootprintWayId"] = footprint_way
        else:
            entrance = (b["lat"], b["lng"])
            source = "pin-fallback (no OSM building polygon contains the pin)"
        entry["entrance"] = {"lat": round(entrance[0], 7), "lng": round(entrance[1], 7)}
        entry["entranceSource"] = source
        entry["snapToNetworkMeters"] = round(haversine_m(
            entrance[0], entrance[1], node[0], node[1]), 1)
        entry["snapNode"] = {"lat": node[0], "lng": node[1]}
        buildings_out.append(entry)

    # --- all-pairs shortest paths among in-bounds buildings --------------
    in_bounds = [b for b in buildings_out if b["inRoutingBounds"]]
    routes = {}
    for i, a in enumerate(in_bounds):
        for b2 in in_bounds[i + 1:]:
            d, path = dijkstra(adjacency, snap_nodes[a["id"]], snap_nodes[b2["id"]])
            if path is None:
                continue
            pe = path_edges(edges, path)
            kinds = sorted(set().union(*[k for _, _, k in pe]))
            crossings = sum(1 for _, _, k in pe if "crossing" in k)
            steps = sum(1 for _, _, k in pe if "steps" in k)
            routes[(a["id"], b2["id"])] = {
                "networkMeters": d,
                "path": path,
                "kinds": kinds,
                "crossingEdges": crossings,
                "stepsEdges": steps,
            }
    print(f"[routes] {len(routes)} routable pairs of {len(in_bounds)} buildings")

    # --- pair selection (deterministic; see METHOD.md) -------------------
    def pair_id(a, b):
        return f"{a}-{b}" if a < b else f"{b}-{a}"

    selected = []
    steps_pairs = sorted(
        (p for p, r in routes.items() if r["stepsEdges"] > 0),
        key=lambda p: (pair_id(*p), routes[p]["networkMeters"]))
    selected += steps_pairs[:MAX_STEPS_PAIRS]
    crossing_pairs = sorted(
        (p for p, r in routes.items() if r["crossingEdges"] > 0 and p not in selected),
        key=lambda p: (-routes[p]["crossingEdges"], pair_id(*p)))
    selected += crossing_pairs[:MAX_CROSSING_PAIRS]

    def coverage(pair):
        return len({pair[0], pair[1]} - {b for p in selected for b in p})

    remaining = sorted(
        (p for p in routes if p not in selected),
        key=lambda p: (-coverage(p), routes[p]["networkMeters"], pair_id(*p)))
    while remaining:
        covered = {b for p in selected for b in p}
        if len(selected) >= TARGET_PAIRS and covered >= {b["id"] for b in in_bounds}:
            break
        nxt = remaining.pop(0)
        if len(selected) >= TARGET_PAIRS and coverage(nxt) == 0:
            break
        selected.append(nxt)
    # top up with the longest remaining routes for spread if still short
    for p in sorted(routes, key=lambda p: (-routes[p]["networkMeters"], pair_id(*p))):
        if len(selected) >= TARGET_PAIRS:
            break
        if p not in selected:
            selected.append(p)

    selected = sorted(set(selected))[: max(TARGET_PAIRS, MIN_PAIRS)]
    covered = {b for p in selected for b in p}
    assert len(selected) >= MIN_PAIRS, f"only {len(selected)} pairs selected"
    assert covered == {b["id"] for b in in_bounds}, "not all buildings covered"

    # --- emit -------------------------------------------------------------
    from datetime import datetime, timezone
    fetched = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    pairs_out = []
    for (a, b) in selected:
        r = routes[(a, b)]
        ea, eb = next(x for x in buildings_out if x["id"] == a), next(x for x in buildings_out if x["id"] == b)
        gc = haversine_m(ea["entrance"]["lat"], ea["entrance"]["lng"],
                         eb["entrance"]["lat"], eb["entrance"]["lng"])
        # walking length includes the two straight connectors (door -> network -> door)
        total = (ea["snapToNetworkMeters"] + r["networkMeters"] + eb["snapToNetworkMeters"])
        geometry = [
            [ea["entrance"]["lat"], ea["entrance"]["lng"]],
            [ea["snapNode"]["lat"], ea["snapNode"]["lng"]],
        ] + [[round(n[0], 7), round(n[1], 7)] for n in r["path"][1:-1]] + [
            [eb["snapNode"]["lat"], eb["snapNode"]["lng"]],
            [eb["entrance"]["lat"], eb["entrance"]["lng"]],
        ]
        pairs_out.append({
            "id": pair_id(a, b),
            "start": {"buildingId": a, "entrance": ea["entrance"]},
            "end": {"buildingId": b, "entrance": eb["entrance"]},
            "distanceMeters": round(total, 1),
            "greatCircleMeters": round(gc, 1),
            "networkRouteMeters": round(r["networkMeters"], 1),
            "connectorMeters": round(ea["snapToNetworkMeters"] + eb["snapToNetworkMeters"], 1),
            "wayTypes": r["kinds"],
            "roadCrossings": r["crossingEdges"],
            "stepsSegments": r["stepsEdges"],
            "geometry": geometry,
            "dataOrigin": "map-derived",
            "physicallyWalked": False,
            "method": "evals/fixtures/METHOD.md",
            "evidence": f"evidence/route-{pair_id(a, b)}.png",
        })

    fixture = {
        "name": "campus-routes",
        "version": "1.0.0",
        "provenance": {
            "dataOrigin": "map-derived",
            "physicallyWalked": False,
            "label": "All distances measured from OpenStreetMap way geometry via the "
                     "Overpass API. No entry in this fixture was physically walked.",
            "method": "evals/fixtures/METHOD.md",
            "overpassEndpoints": OVERPASS_ENDPOINTS,
            "bbox": {"south": south, "west": west, "north": north, "east": east},
            "fetchedAt": fetched,
            "backendSubmoduleCommit": "0a49d4d863161c3b568f6aa6d3da4b4e68637a44",
            "generator": "evals/fixtures/tools/build-campus-routes.py",
            "sources": [
                "frontend/src/lib/campus-locations.ts (building roster, pins)",
                "backend/data/compD.csv (compD building set)",
                "OpenStreetMap via Overpass API (pedestrian ways, building footprints)",
            ],
        },
        "bounds": {"north": 33.216, "south": 33.204, "east": -97.139, "west": -97.156},
        "buildings": buildings_out,
        "pairs": pairs_out,
    }
    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(fixture, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(f"[out] {OUT}: {len(buildings_out)} buildings, {len(pairs_out)} pairs")
    for p in pairs_out:
        print(f"  {p['id']:16s} {p['distanceMeters']:8.1f} m  gc {p['greatCircleMeters']:7.1f}  "
              f"cross {p['roadCrossings']:2d}  steps {p['stepsSegments']:2d}  {','.join(p['wayTypes'])}")


REFRESH = "--refresh-osm" in sys.argv
STAMP = "2026-10-11"

if __name__ == "__main__":
    main()
