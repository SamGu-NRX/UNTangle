# Campus routing verification report

Generated 2026-10-11T15:04:21.020Z at commit `6a01f2b`, entirely from the
committed artifacts (no network, no API keys). Reproduce with:

```bash
bun tools/campus-geodata/spot-check-fixture.ts /home/user/work/untangle-evals/evals/fixtures/campus-routes.json
bun tools/campus-geodata/bench-routing.ts
cd frontend && bun test
```

## 1. Fixture agreement (18 eval-fixture entrance pairs)

- **18/18 pairs routed** on the committed walkway graph.
- Median absolute distance error **1.6%**; 7 pairs exact; 16/18 within 20%.
- Residual differences come from connector snapping (the fixture pins entrances
  directly; the runtime snaps to the largest walkway component), not from graph
  divergence. Per-pair rows: `verification-evidence.json`.

## 2. Measured building-to-building routes (20 pairs)

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
- Test suite: 26/26 pass (`frontend/tests`).

## 5. Assumptions and limitations

- Speeds (1.4 m/s base, 0.6 m/s steps) are **model assumptions**, not UNT
  measurements; sources in `README.md`.
- Buildings mapped as OSM multipolygon relations (Art Building, Art Annex)
  anchor via pin fallback (connectors ≤ 30 m), not OSM entrance nodes.
- Off-campus registry entries (AFROTC, Discovery Park, MGV P) resolve as
  buildings but are excluded from walkway routing by design.
