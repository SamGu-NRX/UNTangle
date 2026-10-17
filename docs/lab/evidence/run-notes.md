# Round-one comparison run (seeded rerun)

Measured against next dev on port 3317, no ORS key (straight-line fallback), reduced-motion context. Each page waits for fixture hydration (.cal-event / .lab-itin__card / .lab-sheet) before switching to Tuesday, and for the Tuesday content selector before stopping the interaction clock, so page-level rows reflect the seeded guest plan rather than the transient pre-bootstrap state. Scripted-task rows ran in the same session at 1440x900.

## Page-level measurements (Tue)

| Direction | Viewport | Seeded | Tue content rendered | Tue switch (ms) | /api/map/route calls | Longest-walk text | axe violations |
|---|---|---|---|---|---|---|---|
| a | desktop | yes | yes | 1531 | 2 | 1 | color-contrast(5), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | desktop | yes | yes | 1415 | 0 | 1 | color-contrast(1), heading-order(1) |
| c | desktop | yes | yes | 1406 | 0 | 1 | color-contrast(1), heading-order(1) |
| a | mobile | yes | yes | 1354 | 0 | 1 | color-contrast(3), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | mobile | yes | yes | 1490 | 0 | 1 | color-contrast(1), heading-order(1) |
| c | mobile | yes | yes | 1402 | 0 | 1 | color-contrast(1), heading-order(1) |
| b | desktop | NO | NO | - | - | - | none |
| c | desktop | NO | NO | - | - | - | none |
| b | desktop | NO | NO | - | - | - | none |
| c | desktop | NO | NO | - | - | - | none |

## Scripted tasks (desktop)

- b-tuesday-conflict-fix: OK — conflict badges 2 → 0 — picked: anth-3200-002 · Tue 14:30-15:50 · Thu 14:30-15:50no conflicts — 1186 ms
- c-tuesday-conflict-fix: OK — conflict badges 2 → 0 — picked: anth-3200-002 · Tue 14:30-15:50 · Thu 14:30-15:50no conflicts — 1141 ms
- b-friday-free: OK — Fri cards 1 → 0, Tue badges after 2 — picked: anth-1150-001 · Mon 14:30-15:50 · Wed 14:30-15:501 conflict
- c-sheet-states: OK — sheet peek(false) → 1st half(true) → 2nd full(true) → Esc peek(false)
