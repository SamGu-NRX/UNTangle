# Campus routing verification report

Generated 2026-10-11T15:04:21.020Z at commit `6a01f2b`, entirely from the
committed artifacts (no network, no API keys). Reproduce with:

```bash
bun tools/campus-geodata/spot-check-fixture.ts <independent campus-routes.json>
bun tools/campus-geodata/bench-routing.ts <independent campus-routes.json>   # exits 1 if the p95 gate fails
cd frontend && bun test
```

The independent fixture (`evals/fixtures/campus-routes.json` from the
untangle-evals checkout) is consumed read-only from **outside** this
repository and is never committed here.

Review round 1 relabeling (2026-10-11): content that reproduces the engine's
own output is labeled **Reproduction** (§2), and accuracy is claimed only
from the independent fixture run against the plan's bars (§1).

## 1. Accuracy — independent fixture run against the plan bars (18 entrance pairs)

This section is the report's **only accuracy claim**. It runs
`spot-check-fixture.ts` over the independent evals fixture: same entrance
anchors as the fixture; only the graph, snapping and A* differ. Plan bars:
**median absolute error ≤ 10%** and **max ≤ 20%**.

- **18/18 pairs routed** on the committed walkway graph.
- Measured: median absolute distance error **1.6%**; max absolute error **45.5%**.
- 7 pairs exact; 16/18 within 20%.

**Accuracy gates: FAIL** — the max bar (≤ 20%) is violated; the median bar
(≤ 10%) passes. Pairs over the 20% bar (error = (computed − fixture) / fixture):

| pair | fixture m | computed m | error | why it is over the bar |
|---|---|---|---|---|
| aud-hick | 109.1 | 158.7 | +45.5% | The two builds attach the same auditorium entrance to different walkway nodes: the runtime's network leg between the attached nodes is ≈141 m vs the fixture build's ≈69 m — on a 109 m pair that nearly doubles the distance. |
| aud-sage | 391.2 | 297.5 | −24.0% | The same divergence in reverse: the runtime's graph connects the same entrances with a ≈279 m network leg vs the fixture build's ≈330 m — the runtime finds the shorter connection, and on a short pair that swing alone passes the bar. |

Residual errors on the 16 under-bar pairs come mostly from connector
snapping (the fixture pins entrances directly; the runtime snaps to the
largest walkway component); the two over-bar pairs are network-route
divergence between the two builds, not connector length. Per-pair rows:
`verification-evidence.json`.

## 2. Reproduction — measured building-to-building routes (20 pairs)

**Reproduction, not plan accuracy:** these 20 routes re-run the engine's own
model (same committed graph, same speed model) over registry-pin pairs. They
demonstrate that the engine reproduces its own output, not agreement with an
independent reference; accuracy is claimed only in §1.

All 20 stop-point routes (registry pin to registry pin, exactly
what `POST /api/map/route` computes per leg) routed successfully — well above the
15-route gate. Distances range 155–1095 m network
distance; steps and road crossings are counted per route in the evidence file.

| from | to | network m | seconds | steps m | crossings |
|---|---|---|---|---|---|
| sage | blb | 580.1 | 455 | 10.3 | 6 |
| sage | gab | 354.1 | 288 | 7 | 0 |
| sage | wh | 301.9 | 252 | 7 | 3 |
| sage | gate | 1083.2 | 823 | 19.4 | 2 |
| sage | col | 1094.9 | 877 | 42.2 | 2 |
| chem | art | 540.3 | 401 | 0 | 4 |
| chem | phys | 451.5 | 344 | 3 | 2 |
| chem | lang | 371.6 | 304 | 16.4 | 2 |
| chem | musi | 643.9 | 495 | 12.4 | 2 |
| chem | musa | 685 | 515 | 12.4 | 2 |
| life | blb | 583.3 | 484 | 32.4 | 2 |
| life | aud | 267.1 | 223 | 0 | 0 |
| life | hick | 294.5 | 253 | 20.1 | 1 |
| life | peb | 583.7 | 470 | 6.9 | 2 |
| life | pac | 1031.1 | 794 | 19.2 | 5 |
| matt | dath | 801.3 | 595 | 0 | 9 |
| matt | symr | 370.3 | 273 | 0 | 2 |
| gab | life | 155 | 145 | 0 | 0 |
| wh | env | 836.2 | 635 | 0 | 5 |
| uu | gate | 823.4 | 652 | 20.4 | 2 |

## 3. Latency

| measurement | n | p50 | p95 | p99 | max |
|---|---|---|---|---|---|
| route computation (ms) | 120 | 0.948 | 10.892 | 21.006 | 29.517 |
| matrix lookup (µs) | 10000 | 0.078 | 0.112 | 0.253 | 1388.227 |

Gate from the plan: route p95 ≤ 200 ms → **PASS** (p95 10.892 ms).

## 4. Coverage

- Registry: 32 buildings (29 routable on-campus, 3 off-campus excluded).
- All 15 distinct `backend/data/compD.csv` codes resolve (tests).
- Walking-time matrix: 29×29, zero asymmetries, max leg 20.6 min.
- Test suite: 43 pass, 0 fail, 0 skipped (`frontend/tests`; re-run 2026-10-11
  on the round-1 branch — the formerly-skipped straight-line test now
  executes).

## 5. Detour bounds — enforced same-anchor floor + reverse symmetry (review round 2)

Per the round-2 ruling (PR #15), `tools/campus-geodata/verification/detour-bounds.ts` now defines
the crow-flying denominator as the **great-circle distance between the exact same two walkway
anchors the network route connects** (the router's endpoint coordinates from `walking-times.json`
`anchors[id].anchor` — the round-1 denominator used outline centroids / registry pins, a different
pair of points, and is superseded), checks **every reverse entry of the full 29×29 matrix**
(406 unordered pairs) for symmetry, and computes the reported distribution **in the same run from
the enforced ratios** — one source of truth. Full method and per-pair evidence:
`verification/detour-bounds.md` + `verification/detour-bounds-evidence.json`
(sha256 `266082fc7f153d9249a1159caf86e9200eacb7ac0cd8b6365c15fae9114eb905`, byte-identical across
two consecutive runs).

**Enforced numbers (406 unordered pairs, same-anchor basis):** min **0.9993** (floor violation,
below), p25 1.2163, **median 1.3029**, p75 1.4403, **p95 1.7746**, **max 2.8542**.
**Pairs over 2.0: 9 of 406** — life→symr 2.8542, chem→th 2.8168, chil→musi 2.7516, essc→uu 2.5391,
matt→uu 2.2560, cury→lang 2.1694, col→gate 2.1182, sage→symr 2.0106, chil→musa 2.0073.
(The round-1 report of min 0.7298 / median 1.2945 / p95 1.9735 / max 3.3789 with 18 pairs over 2.0
was centroid-based; the set changed as the ruling anticipated — 7 of 18 survive, 11 drop below 2.0,
2 enter — and the new largest outlier is life→symr.)

**Enforcement verdicts, reported alongside the bounds:**

- **Same-anchor great-circle floor: FAIL — 1 violation, surfaced as a hard error (exit 3), never
  clamped.** art→arta: stored network 71.0 m vs same-anchor crow 71.0491 m (ratio 0.999309,
  deficit 0.0491 m). The independent-Dijkstra crosscheck re-traced it: the true shortest path is a
  single footway way (osm/625370910) of 71.0491 m — **0.0000 m above the same-anchor crow, i.e. a
  true ratio of exactly 1.0** — so the deficit is `toFixed(1)` storage quantization at matrix build
  time, not geometry. The data-side fix (store meters at higher precision or a
  quantization-aware tolerance) touches `frontend/src` and the matrix rebuild and is outside this
  tools-only scope; flagged for the coordinator. It is the only violation (next-lowest ratio
  1.0638).
- **Reverse-entry symmetry: PASS.** Max asymmetry over the 406 reverse pairs: **0 m and 0 s**
  (relative 0 against the 1e-6 tolerance).

**Crosscheck:** `detour-bounds-crosscheck.ts` re-ran against the new code — 6/6 subjects print
AGREE (independent Dijkstra = matrix meters, every same-anchor floor margin ≥ 0): the three largest
flagged ratios **life→symr, chem→th, chil→musi** (the top-3 changed from round 1's matt→uu,
chem→th, essc→uu), the floor violator art→arta, and the supplementary cury→lang, aud→cury. The
three largest were re-verified against the raw OSM way snapshot (path edges mapped back to
`raw/overpass-pedestrian-snapshot.json` ways; straight lines sampled against all 1,353 outline
rings): life→symr routes the west-mall footway grid plus one steps way and its straight line
pierces only its own two endpoint outlines (osm/256787051, osm/256760039); chem→th is the West
Mulberry Street crossing chokepoint (zero steps, endpoint outlines only); chil→musi runs sidewalks
plus two `tunnel=building_passage` ways and pierces only Chilton Hall (the Music Building is a
pin-fallback anchor with no outline). No third building in any traced case.

## 6. Assumptions and limitations

- Speeds (1.4 m/s base, 0.6 m/s steps) are **model assumptions**, not UNT
  measurements; sources in `README.md`.
- Buildings mapped as OSM multipolygon relations (Art Building, Art Annex)
  anchor via pin fallback (connectors ≤ 30 m), not OSM entrance nodes.
- Off-campus registry entries (AFROTC, Discovery Park, MGV P) resolve as
  buildings but are excluded from walkway routing by design.
