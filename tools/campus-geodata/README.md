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
cd frontend && bun ../tools/campus-geodata/build-matrix.ts   # rebuild the walking-time matrix
```

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
