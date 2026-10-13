# Walking-time matrix — network vs same-anchor crow-flying bounds check

Regenerated 2026-10-12 (UTC) at base commit `c56fdeb` (branch `obv/untangle-campus-routing-f1`), bun 1.3.14,
entirely from the committed artifacts — no network, no API keys, no frontend module imports.

**Review round 2 (PR #15).** The crow-flying basis was moved to the same anchor coordinates the
network route connects, a reverse-entry symmetry gate was added, and every number below is computed
in the enforced run — single source of truth, no separately maintained constants. Round 1's numbers
(min 0.7298, median 1.2945, p95 1.9735, max 3.3789, 18 pairs over 2.0) used an outline-centroid /
registry-pin denominator — a different pair of points than the routed endpoints, which is how a
"network/crow" ratio of 0.7298 slipped through — and are superseded; that text survives in git
history only.

Reproduce (from the repository root):

```bash
bun tools/campus-geodata/verification/detour-bounds.ts            # evidence JSON + summary
bun tools/campus-geodata/verification/detour-bounds-crosscheck.ts # outlier hand cross-check
```

> **Update 2026-10-13 (acceptance ruling).** The acceptance owner ruled the art/arta deficit is
> storage rounding, not a routing error. `detour-bounds.ts` now fails a pair only when its stored
> network distance is more than **0.1 m** below the same-anchor crow distance (`FLOOR_TOLERANCE_M`,
> documented at the constant). The committed matrix exits **0** (largest deficit 0.0491 m, art/arta);
> a copy with art/arta stored at 70.9 m (0.149 m short) still exits 3. The analysis below is the
> record from before the ruling.

The bounds script ran twice; the evidence JSON is timestamp-free and **byte-identical across runs**
(sha256 `266082fc7f153d9249a1159caf86e9200eacb7ac0cd8b6365c15fae9114eb905` on both runs). The exit
code is **3**: the enforced same-anchor floor surfaces one violation (§4) — per the round-2 ruling
it is a hard error, never clamped, skipped or hidden. The evidence JSON is still written so the
violation is auditable.

**Matrix dimension confirmed: 29×29** (`frontend/src/lib/campus/data/walking-times.json`: 29 anchors,
29 `seconds`/`meters` keys, every row 29 wide) — 812 ordered off-diagonal pairs = 2 × 406 unordered pairs.

## 1. Method (enforced)

**Anchor definition.** A matrix anchor is the walkway graph node a building's registry pin resolved
to at matrix build time (`build-matrix.ts` `resolveAnchor`: osm-entrance, outline-node or
pin-fallback). The router routes between exactly these nodes, so for every unordered pair {a, b}
the routed path's endpoint coordinates ARE `anchors[a].anchor` and `anchors[b].anchor` in
`walking-times.json`. Per unordered pair {a, b} (diagonal excluded):

- **network meters** — `meters[a][b]`, the runtime A* path length between the two anchor nodes
  (`build-matrix.ts` stores `route.networkMeters`), stored at 1-decimal precision. No speed
  assumption.
- **same-anchor crow meters** — inline haversine on a 6,371,000 m sphere (mirroring
  `frontend/src/lib/campus/geo.ts`) between `anchors[a].anchor` and `anchors[b].anchor` — the exact
  endpoint coordinates of the routed path. This is the enforced denominator; the round-1
  outline-centroid / registry-pin basis no longer exists in the script.
- **ratio** — `networkMeters / sameAnchorCrowMeters`. The only ratio in this check.
- **implied meters / seconds × 1.4 m/s ratio (secondary)** — same denominator; steps legs are timed
  at 0.6 m/s so the conversion overstates path length wherever a route contains steps; reported
  separately for exactly that reason. The constants inlined in the script are verified against
  `frontend/src/lib/campus/speeds.ts` at run time; a mismatch fails the run.

**Enforcement — both verdicts are reported alongside the bounds:**

1. **Same-anchor great-circle floor.** Every ratio must be ≥ 1.0 up to float error: the routed path
   is a sum of haversine graph-edge lengths between the two anchor nodes, and the geodesic triangle
   inequality makes any ratio < 1 geometrically impossible. Any ratio < 1 − 1e-9 is a **hard
   error**: every violation is listed (stdout and evidence JSON) and the run exits non-zero.
   Violations are never clamped, skipped or hidden.
2. **Reverse-entry symmetry.** For all 406 unordered pairs, the reverse entry [b][a] is checked
   against [a][b] in both matrices; max asymmetry is reported in meters and in seconds; the run
   fails beyond a 1e-6 relative tolerance.

**Flag threshold: ratio > 2.0.** The plan (`docs/plan/untangle-plan.md`, branch `fleet/untangle-plan`,
read read-only) states no detour-factor bound, so 2.0 remains a generous pedestrian-route-directness
envelope: connected walkway grids typically show detour factors near 1.2–1.5, and a matrix entry
smuggled in by a build defect would show far more. Flags are findings, not failures — the floor and
symmetry gates are the failures.

## 2. Distribution (406 unordered pairs, same-anchor basis)

| metric | n | min | p25 | median | p75 | p95 | max |
|---|---|---|---|---|---|---|---|
| ratio (network / same-anchor crow) | 406 | 0.9993 | 1.2163 | **1.3029** | 1.4403 | **1.7746** | **2.8542** |
| ratio via seconds × 1.4 m/s | 406 | 0.999 | 1.2414 | 1.3317 | 1.4803 | 1.8221 | 2.9191 |

**Flagged pairs (ratio > 2.0): 9 of 406 (2.2%).** The set changed materially against round 1's
centroid basis, as the ruling anticipated: 7 of round 1's 18 flagged pairs survive (matt→uu,
chem→th, essc→uu, cury→lang, sage→symr, chil→musi, life→symr), 11 drop below 2.0 (their centroid
denominators had shortened the crow line across large footprints or pin-fallback coordinates:
col→peb, aud→cury, bain→peb, uu→wh, gab→phys, bain→col, aud→lang, blb→uu, essc→symr, blb→musa,
cury→gab), and 2 enter the list (col→gate 2.1182, chil→musa 2.0073). The largest outlier changes
from matt→uu (3.3789 on the centroid basis) to life→symr (2.8542). Every number here is computed in
the same run from the enforced ratios — nothing was carried over from round 1.

The minimum is 0.9993 (art→arta) — a same-anchor floor violation, not a legitimate ratio; §4
attributes it. Excluding it, the distribution starts at 1.0638 (blb→gate).

## 3. Flagged pairs (9), with reasons

| pair | ratio | network m | same-anchor crow m | steps m | reason |
|---|---|---|---|---|---|
| life→symr | 2.8542 | 211.9 | 74.2 | 3.6 | **cross-checked (§5)** — Life Sciences Complex and Sycamore Hall anchors face each other across the west-mall footway grid; the route bends through 11 footway ways plus a steps way (osm/994027110); straight lines pierce only the two endpoint outlines |
| chem→th | 2.8168 | 304.2 | 108.0 | 0.0 | **cross-checked (§5)** — W Mulberry Street crossing chokepoint; zero steps |
| chil→musi | 2.7516 | 303.3 | 110.2 | 0.0 | **cross-checked (§5)** — Chilton Hall's east-face anchor; sidewalks plus two `tunnel=building_passage` ways around the block; Music Building is a pin-fallback anchor |
| essc→uu | 2.5391 | 219.5 | 86.4 | 14.4 | terraced library mall; two staircase ways; not path-traced this round (traced in round 1, git history) |
| matt→uu | 2.2560 | 405.4 | 179.7 | 7.6 | round 1's largest (3.3789 on the centroid basis — its 120.0 m centroid line is what inflated it); not path-traced this round |
| cury→lang | 2.1694 | 145.6 | 67.1 | 23.0 | **cross-checked (§5, supplementary)** — three steps ways plus a service way around Curry Hall's corners |
| col→gate | 2.1182 | 168.8 | 79.7 | 22.8 | new to the list on the same-anchor basis; Coliseum anchoring + steps share; not path-traced |
| sage→symr | 2.0106 | 263.7 | 131.2 | 10.6 | short-crow regime; not path-traced |
| chil→musa | 2.0073 | 329.7 | 164.3 | 0.0 | new to the list on the same-anchor basis; short-crow regime; not path-traced |

All 9 flagged pairs have same-anchor crow distances under 180 m, where a modest walkway
detour exceeds the envelope; all three regimes (road-crossing chokepoint,
terraced-mall stairs, large-footprint anchoring) are represented among the traced pairs.

## 4. Same-anchor floor violation (1) — the enforcement verdict

The enforced run **fails the floor on exactly one pair** (exit code 3):

> **art→arta: ratio 0.999309** — stored network 71.0 m vs same-anchor crow 71.0491 m (deficit 0.0491 m)

Root cause, re-verified with the independent Dijkstra (§5, `[floor-violation]` trace): the shortest
path between the two anchors is a **single footway way (osm/625370910)** whose recomputed length is
**71.0491 m — equal to the same-anchor crow distance to 0.0000 m** (the way's nodes are collinear
with the geodesic). The true ratio is therefore exactly 1.000000. The stored matrix value 71.0 is
the `toFixed(1)` round-down of 71.0491 applied at matrix build time (`build-matrix.ts` stores
`Number(route.networkMeters.toFixed(1))`): the entire 0.0491 m deficit is **storage quantization**
(bounded by ±0.05 m per stored entry), not geometry. It is the only such pair — the next-lowest
same-anchor ratio in the matrix is 1.0638 (blb→gate).

Per the round-2 ruling the violation is surfaced as a hard error and is never clamped, skipped or
hidden. Removing it properly means storing matrix meters at higher precision (or comparing with an
explicit quantization-aware tolerance) — an app-data change to `frontend/src` plus a matrix
rebuild, outside this task's tools-and-report scope; flagged for the coordinator.

## 5. Hand cross-check of the new largest outliers (raw way snapshot)

Subjects are read from the companion evidence JSON — the three largest flagged ratios plus every
floor violator — so a basis change can never leave this script tracing stale pairs (the crosscheck
fails loudly if the evidence is missing). This round that traces **life→symr, chem→th, chil→musi**
(the new top-3; round 1's top-3 were matt→uu, chem→th, essc→uu), the floor violator **art→arta**,
plus the two named short-crow supplements **cury→lang** and **aud→cury** — 6 subjects.

Method (`detour-bounds-crosscheck.ts`): independent Dijkstra over `walkways.json` between the two
matrix anchor nodes; every path edge mapped back to its OSM way in
`tools/campus-geodata/raw/overpass-pedestrian-snapshot.json` (tags read from source); straight lines
between registry pins and between anchors sampled at 201 points each against all 1,353 outline rings
in `buildings.json`.

1. **Life Sciences Complex → Sycamore Hall (ratio 2.8542).** Independent Dijkstra 211.8601 m =
   matrix 211.9 m (36 nodes, 12 ways). Route: the mall footway grid (osm/610349999–610350015,
   osm/611889013–611889907, osm/611867810, osm/481152955, osm/293810456) plus one steps way
   (osm/994027110); same-anchor floor margin +137.6192 m. Both straight lines pierce **only the two
   endpoint outlines** (osm/256787051 Life Sciences Complex, osm/256760039 Sycamore Hall) — no third
   building. The detour is real campus geometry: the buildings' graph connections face away from
   each other across the mall grid.
2. **Chemistry Building → Terrill Hall (ratio 2.8168).** Dijkstra 304.2452 m = matrix 304.2 m
   (18 nodes, 11 ways). The two frontages are separated by **West Mulberry Street** (osm/9972808,
   `highway=residential`): the route walks the chem frontage footways, the graph's pedestrian
   crossing (osm/994975975), the Mulberry corridor itself, a service way (osm/196948631), then
   Terrill's sidewalks. Straight lines pierce only the two endpoint outlines (osm/256787476,
   osm/260225245). Road-crossing chokepoint regime; zero steps. (Same regime round 1 traced for
   this pair.)
3. **Chilton Hall → Music Building (ratio 2.7516).** Dijkstra 303.2512 m = matrix 303.3 m (26 nodes,
   13 ways): frontage sidewalks plus two `tunnel=building_passage` footways (osm/1355098453,
   osm/1355098454) crossing the block. The anchor-to-anchor line pierces only Chilton Hall's own
   outline (osm/256877960); the Music Building has no outline (pin-fallback anchor). No third
   building.
4. **Art Building → Art Annex [floor violator, ratio 0.999309].** Dijkstra 71.0491 m = matrix 71.0 m
   (6 nodes, **1 way: osm/625370910**), same-anchor floor margin **0.0000 m** — the true ratio is
   exactly 1.0 and the stored 71.0 is a round-down; see §4.
5. **Curry Hall → Language Building (supplementary, ratio 2.1694).** Dijkstra 145.6274 m = matrix
   145.6 m; three steps ways (osm/625372318, osm/612462003, osm/610354196) plus a service way
   (osm/525927666) around Curry Hall's corners; straight lines pierce only osm/256943683 and
   osm/256943681.
6. **Auditorium Building → Curry Hall (supplementary).** Dijkstra 181.3271 m = matrix 181.3 m;
   service-court ways (osm/525927635, osm/525927666) plus a steps way (osm/625372318); pierces only
   osm/256943682 and osm/256943683.

All six print `AGREE` between the independent Dijkstra and the matrix meters column (tolerance
0.15 m — the same tolerance that absorbs art→arta's 0.0491 m quantization deficit), and every
same-anchor floor margin is ≥ 0: the bundled network distances are true shortest-path lengths over
the committed graph, not smuggled values.

## 6. The steps-speed artifact in the seconds × 1.4 metric

Two pairs cross 2.0 only through the seconds conversion on the same-anchor basis — aud→lang (2.3264
via seconds vs 1.9925 path; 16.3 m steps share) and blb→essc (2.0059 vs 1.8932; 14.6 m). The
matrix's own speed model makes the steps share exactly recoverable: with
`seconds = base/1.4 + steps/0.6` and `meters = base + steps`,
`steps = 0.75 × (1.4 × seconds − meters)`. The largest seconds-conversion inflation anywhere in the
matrix is col→lang at +68.7 m of implied distance. This is the documented way-class speed assumption
doing its job (stairs are slow), not a data defect.

## 7. Verdict

The matrix is **plausible as bundled, with one quantization artifact that the new enforcement now
catches**. The same-anchor detour-factor distribution is tight — median 1.3029, p95 1.7746 (11.3%
under the 2.0 envelope), max 2.8542 over 406 unordered pairs — and the 9 flagged pairs resolve to
real, hand-verifiable campus geometry: a road-crossing chokepoint on West Mulberry Street, terraced
mall stairs, tunnel passages, and large-footprint anchoring (University Union, Coliseum, Chilton
Hall dominate the list). Structural guards: perfect reverse-entry symmetry (max |Δmeters| 0, max
|Δseconds| 0 over all 406 reverse pairs — relative 0 against the 1e-6 tolerance), no unroutable
zeros, diagonal zeros, an independent Dijkstra agreeing with the matrix on all six traced pairs
with every same-anchor floor margin ≥ 0. The one floor violation (art→arta, 0.999309) is storage
quantization of a path whose true ratio is exactly 1.0 — surfaced as a hard error per the ruling,
with the data-side fix flagged for the coordinator (§4). Two follow-ups worth carrying from round 1:
re-run this check whenever the matrix is rebuilt (in particular when the lost Willis Library
addition — which would make the matrix 30×30 — is re-landed), and upgrade the three pin-fallback
anchors (Art Building, Art Annex, Music Building) to outline-anchored, as
`tools/campus-geodata/README.md` already contemplates.

## 8. Check classification

| check | result | evidence |
|---|---|---|
| detour-bounds.ts run 1 | floor **FAIL** (exit 3), symmetry PASS | stdout summary above; evidence JSON written |
| detour-bounds.ts run 2 | byte-identical evidence | sha256 `266082fc7f153d9249a1159caf86e9200eacb7ac0cd8b6365c15fae9114eb905` on both runs |
| same-anchor great-circle floor | **FAIL — 1 violation** | art→arta 0.999309 (deficit 0.0491 m; root cause §4); surfaced, not clamped |
| reverse-entry symmetry (1e-6 relative) | PASS | max \|Δmeters\| 0 m, max \|Δseconds\| 0 s over 406 reverse pairs |
| detour-bounds-crosscheck.ts | PASS (exit 0) | 6/6 subjects print AGREE (independent Dijkstra = matrix meters) |
| matrix symmetry | PASS | 0 ordered pairs differing by more than 1 s; relative deltas all 0 |
| structural validation | PASS | 29×29, diagonals zero, zero off-diagonal zeros, all values finite |
| speeds.ts constant sync | PASS | 1.4 / 0.6 m/s match the inlined constants |

Round-1 rows removed from this table (superseded basis): the centroid-basis distribution claims.
Files changed on this branch, all under `tools/campus-geodata/verification/`:
`detour-bounds.ts`, `detour-bounds-crosscheck.ts`, `detour-bounds-evidence.json` (machine-readable:
406-pair table with per-pair `ratio`, `ratioSeconds`, flag status; `enforcement` verdicts), and
this report. `verification-report.md` gains the round-2 detour section; `verification-evidence.json`
is intentionally untouched.
