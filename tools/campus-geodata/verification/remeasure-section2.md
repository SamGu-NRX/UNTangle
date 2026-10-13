# Independent re-measurement of verification-report.md §2 (20 routes)

Produced by `verification/independent-remeasure.ts` (this directory), machine-readable
companion `remeasure-results.json`. Branch `obv/untangle-campus-routing-f1-fix3-remeasure`,
cut from the PR #15 head `f44f23d`. No file in this comparison edits
`verification-report.md` or `verification-evidence.json`.

## Why

§2 of `tools/campus-geodata/verification-report.md` lists 20 building-to-building
routes with "measured" times. Per the report's own reproduce instructions and
`bench-routing.ts` (the script that wrote §2), those numbers were produced by
calling the runtime's own `routeBetweenPoints` — the same graph, the same A*, and
the same duration code that `POST /api/map/route` serves. As verification they are
therefore circular: the system measuring itself. This re-measurement asks a
different question: can the same 20 numbers be reproduced from the **raw Overpass
snapshot** by an **independent implementation** of the documented policy, without
importing any app module?

## Method

`independent-remeasure.ts` (run with `bun`, ~1 s) imports nothing from
`frontend/src` — no `graph.ts`, `geo.ts`, `speeds.ts`, `walking-times.ts`, and no
registry module. It:

1. loads `tools/campus-geodata/raw/overpass-pedestrian-snapshot.json` (committed,
   sha256 pinned in `receipt.json`);
2. re-implements the extraction pipeline: way filter → node clipping to the
   build box with fragment splitting → node dedup (8-dp key, 7-dp stored
   coordinates) → undirected edge dedup keeping the shortest way per node pair
   with its class flags;
3. computes the largest connected component itself (union-find);
4. reads the registry pins by parsing the plain data fields out of
   `frontend/src/lib/campus-locations.ts` (text parse, not an import);
5. runs its own A* (min-heap, admissible haversine heuristic) and duration
   accounting for the same 20 pairs as `bench-routing.ts`'s `MEASURED_PAIRS`;
6. compares against the recorded values in `verification-evidence.json`
   (read-only).

As a reconstruction-integrity check (not a route input), it diffs its rebuilt
node array and counts against the committed `walkways.json`: **exact match** —
8,129 nodes, 9,816 edges, 2,598 usable way fragments, largest component 99.53%,
node coordinates equal element-for-element.

## Policy replicated

Stated in full so it can be checked against the build scripts it cites:

- **Way filter** (`build.mjs` / README "Way filter"): `highway` ∈ {footway,
  steps, path, pedestrian, corridor, living_street, service, residential,
  unclassified, tertiary, secondary, primary, tertiary_link, secondary_link,
  primary_link, track, road}; `foot != "no"`; not (`access` ∈ {no, private}
  unless `foot` ∈ {yes, designated, permissive}).
- **Node clipping** (`build.mjs`): keep nodes inside {33.2005, −97.1605,
  33.2195, −97.1325}; split ways into fragments at dropped nodes so no edge is
  fabricated across a gap.
- **Node dedup** (`build.mjs`): merge nodes agreeing at 8 decimal places; store
  coordinates rounded to 7.
- **Edge dedup** (`graph.ts buildGraph`): one undirected edge per node pair;
  the **shortest** way wins and carries its class flags. Class precedence
  (`build.mjs wayClass`): `footway=crossing` → crossing, `footway=sidewalk` →
  sidewalk, else the `highway` tag.
- **Snapping** (`graph.ts nearestWalkwayNode`): nearest node in the **largest
  connected component only**, within 250 m.
- **Routing** (`graph.ts astarPath`): A* minimizing **haversine meters**
  (R = 6,371,000 m), haversine heuristic. Duration is computed *afterwards*
  along the distance-optimal path: per edge, `meters / (0.6 if steps-class else
  1.4)`; straight pin→snap connectors are added at the base speed
  (`graph.ts routeBetweenPoints`, `speeds.ts`).
- **Rounding**: seconds `Math.round`; meters to 0.1 — exactly as the runtime
  reports them, which is what §2 reprints.

## Results — recorded (§2 / evidence) vs independently re-measured

All 20 pairs routed. Every column matches exactly: seconds, network meters,
steps meters, and road crossings — 20/20 at Δ = 0.0 s and Δ = 0.0 m.

| from | to | recorded s | re-measured s | Δs | Δ% | recorded m | re-measured m | Δm% | steps m | crossings |
|---|---|---|---|---|---|---|---|---|---|---|
| sage | blb | 455 | 455 | 0.0 | 0.00% | 580.1 | 580.1 | 0.00% | 10.3 | 6 |
| sage | gab | 288 | 288 | 0.0 | 0.00% | 354.1 | 354.1 | 0.00% | 7 | 0 |
| sage | wh | 252 | 252 | 0.0 | 0.00% | 301.9 | 301.9 | 0.00% | 7 | 3 |
| sage | gate | 823 | 823 | 0.0 | 0.00% | 1083.2 | 1083.2 | 0.00% | 19.4 | 2 |
| sage | col | 877 | 877 | 0.0 | 0.00% | 1094.9 | 1094.9 | 0.00% | 42.2 | 2 |
| chem | art | 401 | 401 | 0.0 | 0.00% | 540.3 | 540.3 | 0.00% | 0 | 4 |
| chem | phys | 344 | 344 | 0.0 | 0.00% | 451.5 | 451.5 | 0.00% | 3 | 2 |
| chem | lang | 304 | 304 | 0.0 | 0.00% | 371.6 | 371.6 | 0.00% | 16.4 | 2 |
| chem | musi | 495 | 495 | 0.0 | 0.00% | 643.9 | 643.9 | 0.00% | 12.4 | 2 |
| chem | musa | 515 | 515 | 0.0 | 0.00% | 685 | 685 | 0.00% | 12.4 | 2 |
| life | blb | 484 | 484 | 0.0 | 0.00% | 583.3 | 583.3 | 0.00% | 32.4 | 2 |
| life | aud | 223 | 223 | 0.0 | 0.00% | 267.1 | 267.1 | 0.00% | 0 | 0 |
| life | hick | 253 | 253 | 0.0 | 0.00% | 294.5 | 294.5 | 0.00% | 20.1 | 1 |
| life | peb | 470 | 470 | 0.0 | 0.00% | 583.7 | 583.7 | 0.00% | 6.9 | 2 |
| life | pac | 794 | 794 | 0.0 | 0.00% | 1031.1 | 1031.1 | 0.00% | 19.2 | 5 |
| matt | dath | 595 | 595 | 0.0 | 0.00% | 801.3 | 801.3 | 0.00% | 0 | 9 |
| matt | symr | 273 | 273 | 0.0 | 0.00% | 370.3 | 370.3 | 0.00% | 0 | 2 |
| gab | life | 145 | 145 | 0.0 | 0.00% | 155 | 155 | 0.00% | 0 | 0 |
| wh | env | 635 | 635 | 0.0 | 0.00% | 836.2 | 836.2 | 0.00% | 0 | 5 |
| uu | gate | 652 | 652 | 0.0 | 0.00% | 823.4 | 823.4 | 0.00% | 20.4 | 2 |

**Reproduction:** median |Δ| **0.00%**, max |Δ| **0.00%** on seconds and on
network meters; all 20 pairs reproduce exactly. The script gates this: every
pair must agree within the runtime's output rounding (1 s, 0.1 m) on seconds
*and* meters, and the rebuilt graph must match the committed `walkways.json`;
otherwise it exits 1.

This is not the plan's accuracy bar. It rebuilds the same model from the same
raw data, so it shows the recorded numbers are faithful products of that model,
not that the model matches real walks. Accuracy is gated only on the independent
eval fixture (`spot-check-fixture.ts`, reported in `verification-report.md` §1),
and that gate currently **fails**: maximum error 45.5%, with aud→hick (+45.5%)
and aud→sage (−24.0%) over the 20% bar.

**Reproducibility:** before the gate rewrite the script ran twice with identical
tables and timestamp-free digests (`652f791af7977acd`). The rewrite renamed fields
in `remeasure-results.json`; its first run under the new gate exited 0 with digest
`3d3ea76d22ecf3f2`.

## Verdict

The report's §2 numbers hold up. They are exactly what the documented pipeline
produces — reproducible to the digit from the raw OSM snapshot by an independent
implementation, including the steps-speed edge timing, crossing counts, and
connector accounting — so the circularity concern resolves into a provenance
note, not a data error: the values are honest products of the stated model, but
they were (and remain) model-derived, not field measurements. Two things this
re-measurement deliberately does not establish: the speed assumptions themselves
(1.4 m/s base, 0.6 m/s steps are stated model assumptions — the plan's
"hand-measured routes" bar needs real field timings that do not exist yet), and
time-optimality of the underlying paths (the runtime's A* minimizes *meters*, so
on routes where a steps shortcut exists a time-optimal path could in principle
differ; the recorded §2 times share that property by construction). Both are
properties of the accepted design, already disclosed in the report's §5 and the
README; neither affects the agreement measured here.

## Reproduce

```bash
bun tools/campus-geodata/verification/independent-remeasure.ts   # exit 0 when every pair reproduces
cd frontend && bun x tsc --noEmit                                # exit 0, no errors
```

Results: `verification/remeasure-results.json` (per-pair rows include snap node
indices and connector meters).
