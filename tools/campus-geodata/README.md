# campus-geodata

Offline walking-route data for the UNT Denton main campus, built from
OpenStreetMap. No paid API and no network calls at runtime: the app imports the
committed JSON artifacts and serves real walkway routing from them.

## What is here

| Path | What it is |
|---|---|
| `fetch-osm.mjs` | Downloads the OSM snapshot for the campus bounding box from the Overpass API (main instance + mirror), with an honest User-Agent, bounded retries and backoff. Downloads **once**; afterwards it is a no-op unless `--refresh` is passed. |
| `build.mjs` | Extracts the pedestrian-usable ways and building outlines from the raw snapshot and writes the compact committed artifacts plus `receipt.json`. Deterministic: same raw snapshot → byte-identical outputs. |
| `build-matrix.ts` | Precomputes the building-to-building walking-seconds matrix (`data/walking-times.json`) from the registry pins, the committed walkway graph and the OSM building outlines. Run with `bun` from `frontend/`. |
| `raw/` | The raw Overpass responses (the cached copy of the downloaded data) and the fetch attempt log. |
| `receipt.json` | Provenance: exact Overpass queries, source URLs, fetch timestamp, and the sha256 of every raw input and every output. |
| `../frontend/src/lib/campus/data/` | The committed compact artifacts (`walkways.json`, `buildings.json`, `walking-times.json`) that the runtime imports. |

## Usage

```bash
# from the repository root
node tools/campus-geodata/fetch-osm.mjs          # downloads once; --refresh forces a new fetch
node tools/campus-geodata/build.mjs              # rebuild artifacts + receipt from raw/
bun tools/campus-geodata/build-matrix.ts         # rebuild the walking-time matrix
```

## Adding a campus

The app reads everything campus-specific through one `CampusConfig`
(`frontend/src/lib/campus/config.ts`): id, name, bounds, center, building
registry and walking-speed model. A second campus is that config plus a run of
this pipeline with the campus's bounding box (`BBOX` in `fetch-osm.mjs`, the
same box in `build.mjs`), writing its own `walkways.json` and
`walking-times.json`, and one entry in `frontend/src/lib/campus/engine.ts`
that points the route API at them. UNT Denton is the only campus built.

## Way filter

A highway way is pedestrian-usable iff its `highway` tag is one of `footway`,
`steps`, `path`, `pedestrian`, `corridor`, `living_street`, `service`,
`residential`, `unclassified`, `tertiary`, `secondary`, `primary`,
`tertiary_link`, `secondary_link`, `primary_link`, `track`, `road` — and
`foot != "no"` — and not (`access ∈ {no, private}` unless `foot ∈ {yes,
designated, permissive}`). This keeps footways, paths, pedestrian areas, steps,
crossings, sidewalks, service roads that allow foot traffic, and the perimeter
streets a pedestrian may legally walk on. `footway=crossing` and
`footway=sidewalk` are recorded as their own classes. The same filter is
documented in `evals/fixtures/METHOD.md`, so fixture distances and runtime
distances describe the same network.

## Route contract

The route API and `WalkingTime` (`frontend/src/lib/campus/walking-times.ts`)
are **separate contracts by design**. Do not unify them:

1. **`POST /api/map/route`** (`frontend/src/app/api/map/route/route.ts`) —
   returns one leg per consecutive pair of stops. A stop that names its
   building (`buildingId`) starts or ends at that building's matrix anchor, so
   the leg's seconds equal the matrix's. A leg the campus graph cannot serve
   is `source: "fallback"`: a straight line with `durationSeconds: null`. The
   UI shows it as an **approximate distance only** — never a walking route or
   a walking time. The leg type makes a fallback leg with a time
   unrepresentable.

2. **`getWalkingSeconds`** — serves the optimizer, which needs a number:
   - a registry building the graph cannot connect returns a straight-line
     estimate at the 1.4 m/s base speed, labeled `source: "straight-line"`;
   - an unknown or off-campus id returns `{ seconds: null, source: "unknown" }`
     — unknown is **never** treated as free (a missing measurement must not
     read as a zero-second walk).

## Known limitations


- Building outlines capture simple closed OSM **ways** only. Buildings mapped
  as multipolygon **relations** (currently the Art Building and Art Annex) have
  no outline in buildings.json, so the matrix anchors their registry pins
  with the nearest-node fallback ("pin-fallback", all current connectors
  ≤ 30 m). Relation support would upgrade those anchors to entrance-anchored.

## Walking-speed model

- **Base speed: 1.4 m/s** — the Highway Capacity Manual crosswalk design
  walking speed, as summarized in FHWA, *Capacity Analysis of Pedestrian and
  Bicycle Facilities* ("Chapter 2 — Capacity Analysis of Pedestrian and Bicycle
  Facilities", https://www.fhwa.dot.gov/publications/research/safety/pedbike/98107/section2.cfm).
- **Steps: 0.6 m/s along the stair** — chosen inside the range of published
  stair walking speeds (0.48–0.83 m/s): “Individual Stair Ascent and Descent
  Walk Speeds Measured in a Korean High-Rise Building”, *Fire Technology*
  (2013), https://link.springer.com/article/10.1007/s10694-013-0371-4
  (ascent 0.66 m/s men / 0.48 m/s women; descent 0.83 / 0.74 m/s). The value
  is a stated assumption for a mixed campus population, not a UNT measurement.

Durations are `distance / speed`, computed per edge so steps edges get the
steps speed. Both speeds are restated in
`frontend/src/lib/campus/speeds.ts` and in every route response's provenance
(`frontend/src/lib/campus/README.md`).

## License and attribution

The data in `raw/` and in the committed artifacts is from OpenStreetMap and is
licensed under the **Open Database License (ODbL) v1.0**.

> OpenStreetMap is open data, licensed under the Open Data Commons Open
> Database License (ODbL) by the OpenStreetMap Foundation (OSMF).
> https://www.openstreetmap.org/copyright

Any use of the data must keep the attribution **“© OpenStreetMap
contributors”**. The app shows this attribution on the map and the route
API documents it in its response contract. This directory's summary does not
alter the ODbL terms set.
