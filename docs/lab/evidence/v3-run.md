# Round-one comparison run (v3)

Measured against next dev on port 3317, no ORS key (straight-line fallback), reduced-motion context. Day switched to Tuesday before every measurement.

## Page-level measurements (Tue)

| Direction | Viewport | Tue switch (ms) | /api/map/route calls | Longest-walk text | axe violations |
|---|---|---|---|---|---|
| a | desktop | 1145 | 0 | 0 | color-contrast(3), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | desktop | 2157 | 0 | 0 | color-contrast(1) |
| c | desktop | 2238 | 0 | 0 | color-contrast(1) |
| a | mobile | 1688 | 3 | 1 | color-contrast(3), landmark-main-is-top-level(1), landmark-no-duplicate-main(1), landmark-unique(2) |
| b | mobile | 3823 | 2 | 1 | color-contrast(1), heading-order(1) |
| c | mobile | 3296 | 2 | 1 | heading-order(1) |

## Scripted tasks

