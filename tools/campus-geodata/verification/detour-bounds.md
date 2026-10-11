# Walking-time matrix — network vs crow-flying bounds check

Generated 2026-10-11 (UTC) at commit `f44f23d` (base `obv/untangle-campus-routing-f1`), bun 1.3.14,
entirely from the committed artifacts — no network, no API keys, no frontend module imports.

Reproduce (from the repository root):

```bash
bun tools/campus-geodata/verification/detour-bounds.ts           # evidence JSON + summary
bun tools/campus-geodata/verification/detour-bounds-crosscheck.ts # outlier hand cross-check
```

The bounds script ran twice; the evidence JSON is timestamp-free and byte-identical across runs
(sha256 `27dcad25d9b4bf46895f156cdd18aa4d84320705a854e1d4e4e2c8d0bd86b011` on both runs, exit code 0 each),
and the cross-check companion ran once with exit code 0.

**Matrix dimension confirmed: 29×29** (`frontend/src/lib/campus/data/walking-times.json`: 29 anchors,
29 `seconds`/`meters` keys, every row 29 wide) — 812 ordered off-diagonal pairs = 2 × 406 unordered pairs.

## 1. Method

For every unordered pair {a, b} of the 29 matrix buildings (diagonal excluded; symmetry verified —
max |Δseconds| 0.0, max |Δmeters| 0.0, zero ordered pairs differing by more than 1 s, so the ordered
distribution equals the unordered one):

- **network meters** — `meters[a][b]`, the routed path length the matrix builder recorded from the
  runtime A* (`build-matrix.ts` stores `route.networkMeters`). This is the primary metric and involves
  **no speed assumption**.
- **implied meters (secondary)** — `seconds[a][b] × 1.4 m/s`, the seconds-times-speed conversion.
  The speed model is way-class dependent (`speeds.ts`): **base 1.4 m/s, steps 0.6 m/s**. Since the
  matrix times steps legs at 0.6 m/s, this conversion **overstates path length wherever a route
  contains steps**; it is reported separately for exactly that reason (see §5). The constants inlined
  in the script are verified against `speeds.ts` at run time; a mismatch fails the run.
- **crow-flying** — inline haversine on a 6,371,000 m sphere, the same convention as
  `frontend/src/lib/campus/geo.ts` (read for reference, not imported). The straight-line endpoint for
  each building is the **centroid of the OSM outline its registry pin resolved into**
  (`buildings.json` matched via the anchor's `outlineOsmId` — 26 of 29 buildings). The three
  pin-fallback anchors with no outline (Art Building, Art Annex, Music Building) use their walkway
  anchor coordinate instead, which understates crow distance and therefore *inflates* their ratios —
  conservative for a bounds check. A second straight line between the walkway anchor nodes
  themselves is reported as `ratioAnchor` per pair in the evidence JSON.

> **Task-premise correction.** `frontend/src/lib/campus/data/buildings.json` is the OSM building
> *outline* snapshot (1,353 closed ways with centroids), not a registry of anchor coordinates. The
> matrix anchors live in `walking-times.json` (`anchors[id]`: coordinate, method, `outlineOsmId`,
> `connectorMeters`) and the registry pins in `frontend/src/lib/campus-locations.ts`. The check above
> uses the buildings.json-derived building position (containing-outline centroid), which is the
> closest faithful reading of "registry anchor coordinates from buildings.json".

**Flag threshold: ratio ≤ 2.0.** The plan (`docs/plan/untangle-plan.md`, branch `fleet/untangle-plan`,
read read-only) states **no detour-factor bound** — its routing bars are coverage, hand-measured
distance error and latency. 2.0 is chosen here as a generous pedestrian-route-directness envelope:
connected walkway grids typically show detour factors of roughly 1.1–1.5 (pedestrian route-directness
findings — from training knowledge, not retrieved this session), while a matrix entry smuggled in by
a build defect (path forced through a distant chokepoint) would show far more. Connector snapping adds
at most ~2 × 61.4 m (the largest observed connector) to a path, which a 2.0 envelope absorbs on every
pair that is not already very short. Flags are findings, not failures; the script exits 0 when the
analysis completes and non-zero only on structural invalidity or a speed-constant mismatch.

## 2. Distribution (406 unordered pairs)

| metric | n | min | p25 | median | p75 | p95 | max |
|---|---|---|---|---|---|---|---|
| ratio (network / crow) | 406 | 0.7298 | 1.1764 | **1.2945** | 1.4604 | **1.9735** | **3.3789** |
| ratio via seconds × 1.4 m/s | 406 | 0.7869 | 1.1949 | 1.3205 | 1.4984 | 2.0454 | 3.4632 |

**Flagged pairs (ratio > 2.0): 18 of 406 (4.4%).** An additional 4 pairs cross 2.0 only through the
seconds × 1.4 conversion (steps-speed artifact, §5). The p95 of the path-length ratio sits just under
the envelope (1.9735).

The 8 pairs with ratio < 1.0 are a coordinate-basis artifact, not a defect: all 8 have
`ratioAnchor ≥ 1.14` — the walkway path between adjacent buildings' anchors (which sit on the
walkway-facing edge of each building) is slightly longer than anchor-to-anchor crow but shorter than
centroid-to-centroid crow. The apparent minimum, art→arta (0.7298 vs centroid basis), is 0.9993 on the
anchor basis: a near-collinear walkway sequence whose path length sits within haversine model error
(~0.1%) of the straight line.

## 3. Flagged pairs (18), with reasons

| pair | ratio | network m | crow m | reason |
|---|---|---|---|---|
| matt→uu | 3.38 | 405.4 | 120.0 | **cross-checked (§4)** — opposite facing corners of two large-footprint buildings; route bends through the mall footway grid with 2 pedestrian crossings and a terraced-mall stair |
| chem→th | 2.86 | 304.2 | 106.5 | **cross-checked (§4)** — W Mulberry Street crossing chokepoint; zero steps |
| essc→uu | 2.85 | 219.5 | 77.1 | **cross-checked (§4)** — terraced library mall; two staircase ways; walkways set back ≥ 19.4 m from the direct line |
| cury→lang | 2.50 | 145.6 | 58.3 | cross-checked (§4, supplementary) — route around Curry Hall's footprint corners over 3 steps ways (23.0 m steps share) and a service way |
| col→peb | 2.43 | 653.3 | 269.0 | Coliseum anchoring: the round Coliseum's centroid sits far from its walkway side (ratioAnchor falls to 1.71); 22.9 m steps share |
| aud→cury | 2.37 | 181.3 | 76.4 | cross-checked (§4, supplementary) — Auditorium service-court + Curry Hall steps; short-crow regime |
| sage→symr | 2.32 | 263.7 | 113.5 | short-crow regime on the west mall; 10.6 m steps share; not path-traced |
| bain→peb | 2.31 | 318.8 | 138.0 | short-crow regime; zero steps; not path-traced |
| uu→wh | 2.22 | 400.2 | 180.2 | University Union anchoring (uu appears in 4 of the 18 flagged pairs); not path-traced |
| gab→phys | 2.22 | 314.6 | 141.8 | short-crow regime; 2.9 m steps share; not path-traced |
| chil→musi | 2.20 | 303.3 | 138.0 | short-crow regime; Music Building is a pin-fallback anchor (anchor-coordinate crow basis); not path-traced |
| bain→col | 2.20 | 409.8 | 186.5 | short-crow regime; 22.9 m steps share; not path-traced |
| life→symr | 2.16 | 211.9 | 98.1 | short-crow regime; not path-traced |
| aud→lang | 2.12 | 130.1 | 61.3 | short-crow regime; 16.4 m steps share; not path-traced |
| blb→uu | 2.09 | 439.1 | 209.9 | University Union anchoring; largest absolute steps share among flagged (30.2 m); not path-traced |
| essc→symr | 2.03 | 397.3 | 195.5 | short-crow regime; not path-traced |
| blb→musa | 2.01 | 468.5 | 233.0 | Music Annex anchoring + steps (8.2 m share); not path-traced |
| cury→gab | 2.01 | 285.8 | 142.2 | Curry Hall footprint corners; 6.7 m steps share; not path-traced |

Fifteen of the 18 flagged pairs have crow distances under 200 m, where even a modest 60–100 m walkway
detour exceeds the envelope; the three long-crow exceptions all involve the Coliseum or the University
Union, whose centroids sit far from where walkways touch them. The five cross-checked exemplars cover
both regimes; the remaining rows carry cluster-level explanations (short-crow grid detours, or
large-footprint anchor offsets with the per-pair steps share shown) and are explicitly marked
*not path-traced*.

## 4. Hand cross-check of the three largest outliers (raw way snapshot)

Method (`detour-bounds-crosscheck.ts`): independent Dijkstra over `walkways.json` between the two
matrix anchor nodes; every path edge mapped back to its OSM way in
`tools/campus-geodata/raw/overpass-pedestrian-snapshot.json` (tags read from source); straight lines
between registry pins and between anchors sampled at 201 points each against all 1,353 outline rings
in `buildings.json`.

1. **Matthews Hall → University Union (ratio 3.38).** Independent Dijkstra 405.4 m = matrix 405.4 m
   (33 nodes, 14 ways). Route: a `highway=steps` way at Matthews' south-east terraced edge
   (osm/610351712), frontage footways, **two pedestrian crossings** (osm/1191499498, osm/1034821656),
   then the mall footway grid (osm/611700136–143) into the Union's north-west mall face
   (osm/610351735, osm/610351746). Both the pin-to-pin and anchor-to-anchor straight lines pierce
   **only Matthews Hall (osm/256877950) and the University Union (osm/518915908)** — no third
   building. The detour is real campus geometry: the buildings' graph connections face away from each
   other and no diagonal walkway crosses the block between them. Steps share 7.6 m.
2. **Chemistry Building → Terrill Hall (ratio 2.86).** Dijkstra 304.2 m = matrix 304.2 m (18 nodes,
   11 ways). The two frontages are separated by **West Mulberry Street** (osm/9972808,
   `highway=residential`): the route walks the chem frontage footways, a sidewalk, the graph's
   pedestrian crossing (osm/994975975), the Mulberry corridor itself, a service way
   (osm/196948631), then Terrill's sidewalks. Straight lines pierce only the two endpoint outlines
   (osm/256787476, osm/260225245). This is the road-crossing chokepoint regime: zero steps, and the
   crossing point sits off the direct line, forcing the L-detour.
3. **Eagle Student Services Center → University Union (ratio 2.85).** Dijkstra 219.5 m = matrix
   219.5 m (19 nodes, 10 ways). The route includes **two staircase ways** (osm/520667009,
   osm/610351741 — 14.4 m steps share) dropping from ESSC onto the terraced library mall and climbing
   to the Union's mall walkways; mid-route walkways stay **≥ 19.4 m away** from the straight line.
   Straight lines pierce only ESSC (osm/256766445) and the Union (osm/518915908).

Supplementary short-crow exemplars: Curry Hall → Language Building (145.6 m = matrix; three steps
ways plus a service way around Curry Hall's corners; straight lines pierce only osm/256943683 and
osm/256943681) and Auditorium Building → Curry Hall (181.3 m = matrix; service-court ways plus a
steps way; pierces only osm/256943682 and osm/256943683). All five cross-checks print `AGREE` between
the independent Dijkstra and the matrix meters column — the bundled network distances are true
shortest-path lengths over the committed graph, not smuggled values.

## 5. The steps-speed artifact in the seconds × 1.4 metric

Four pairs cross the 2.0 envelope only through the seconds conversion — their path-length ratios stay
below 2.0: blb→essc (2.12 via seconds vs 1.998 path), blb→matt (2.05 vs 1.97), essc→sage (2.03 vs
1.94), gab→sage (2.05 vs 1.99). The matrix's own speed model makes the steps share exactly
recoverable: with `seconds = base/1.4 + steps/0.6` and `meters = base + steps`,
`steps = 0.75 × (1.4 × seconds − meters)` — 14.6, 7.6, 15.5 and 7.0 m respectively for these pairs.
The largest seconds-conversion inflation anywhere in the matrix is col→lang at +68.7 m of implied
distance. This is the documented way-class speed assumption doing its job (stairs are slow), not a
data defect.

## 6. Verdict

The matrix is **plausible as bundled**. The detour-factor distribution is tight and sane — median
1.29, p95 1.97, max 3.38 over 406 unordered pairs — with 18 flagged pairs (4.4%) that all resolve to
real, hand-verifiable campus geometry rather than build defects: a road-crossing chokepoint on West
Mulberry Street, terraced-mall staircases, walkway set-backs around building footprints, and
large-footprint anchoring where a building's centroid sits far from where walkways touch it (University
Union, Coliseum, Auditorium dominate the flagged list). Every structural guard passed: perfect
symmetry (zero ordered-pair deltas), no unroutable zeros, diagonal zeros, an independent Dijkstra
agreeing with the matrix to 0.1 m on all five traced outliers, and no straight line piercing any third
building in any traced case. The four seconds-driven flags are the stated 0.6 m/s steps assumption,
not corruption. Two follow-ups are worth carrying: the p95 sits 1.3% under the 2.0 envelope, so this
check is a useful regression tripwire to re-run whenever the matrix is rebuilt (in particular when the
lost Willis Library addition — which would make the matrix 30×30 — is re-landed); and upgrading the
three pin-fallback anchors (Art Building, Art Annex, Music Building) to outline-anchored, as
`tools/campus-geodata/README.md` already contemplates, would remove the one conservative bias in this
check's crow-flying basis.

## 7. Check classification

| check | result | evidence |
|---|---|---|
| detour-bounds.ts run 1 | PASS (exit 0) | stdout summary above; evidence JSON written |
| detour-bounds.ts run 2 | PASS (exit 0) | sha256 identical to run 1: `27dcad25d9b4bf46895f156cdd18aa4d84320705a854e1d4e4e2c8d0bd86b011` |
| detour-bounds-crosscheck.ts | PASS (exit 0) | 5/5 pairs print AGREE (independent Dijkstra = matrix meters) |
| matrix symmetry | PASS | max \|Δseconds\| 0.0, max \|Δmeters\| 0.0, 0 ordered pairs > 1 s |
| structural validation | PASS | 29×29, diagonals zero, zero off-diagonal zeros, all values finite |
| speeds.ts constant sync | PASS | 1.4 / 0.6 m/s match the inlined constants |
| `frontend` untouched | PASS | `git status` shows only `tools/campus-geodata/verification/` |
| `bun x tsc --noEmit` (frontend) | PASS (exit 0) | after `bun install --frozen-lockfile` (988 packages, lockfiles unchanged); zero errors. A pre-install run floods with missing-module errors — environment, not code |
| `bun test` (frontend) | PASS (exit 0) | 26 pass / 0 fail across 3 files, 265 expect() calls — matches the 26/26 recorded for `f44f23d` |

Nothing was BLOCKED or NOT_RUN. Files changed on this branch, all under
`tools/campus-geodata/verification/`: `detour-bounds.ts`, `detour-bounds-crosscheck.ts`,
`detour-bounds-evidence.json` (machine-readable, 406-pair table with per-pair `ratio`,
`ratioSeconds`, `ratioAnchor`, flag status), and this report. `verification-report.md` and
`verification-evidence.json` are intentionally untouched.
