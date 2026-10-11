# Round-one comparison run (v4, seeded)

Measured against next dev on port 3317, no ORS key (straight-line fallback), reduced-motion context. Each page waits for fixture evidence (.cal-event / .lab-itin__card / .lab-sheet) before switching to Tuesday, so measurements reflect the seeded guest plan, not the transient pre-bootstrap state.

## Page-level measurements (Tue)

| Direction | Viewport | Seeded | Tue switch (ms) | /api/map/route calls | Longest-walk text | axe violations |
|---|---|---|---|---|---|---|
| a | desktop | NO | 1145 | 0 | 0 | color-contrast(3), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | desktop | NO | 2157 | 0 | 0 | color-contrast(1) |
| c | desktop | NO | 2238 | 0 | 0 | color-contrast(1) |
| a | mobile | NO | 1688 | 3 | 1 | color-contrast(3), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | mobile | NO | 3823 | 2 | 1 | color-contrast(1), heading-order(1) |
| c | mobile | NO | 3296 | 2 | 1 | heading-order(1) |

## Scripted tasks (v3 run)

