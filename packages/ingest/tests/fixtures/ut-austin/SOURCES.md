# UT Austin fixture sources

Every fixture in this directory is a saved copy of a public page, captured
once, politely, and never re-fetched by tests. The parser that reads them is
`packages/ingest/src/ut-austin/catalog.ts`; the access-rule research behind
the capture is `docs/research/ut-austin/README.md`.

| File | Source URL | Captured | How |
|---|---|---|---|
| `catalog/c-s.html` | https://catalog.utexas.edu/courses/c-s/ | 2026-10-15 | single plain HTTP GET, no login |
| `catalog/m.html` | https://catalog.utexas.edu/courses/m/ | 2026-10-15 | single plain HTTP GET, no login |
| `catalog/phy.html` | https://catalog.utexas.edu/courses/phy/ | 2026-10-15 | single plain HTTP GET, no login |

Capture details: the three pages were fetched with `curl` under the agent
string `UNTangleIngest/0.1 (contact: sgu07966@gmail.com)`, three seconds
apart, from a shared sandbox. `catalog.utexas.edu` published no robots.txt
that day (the path returned the site's 404 page), no terms page governs the
course pages, and no login or CAPTCHA was met. Future captures follow the
`catalog-utexas` source policy in `packages/ingest/src/source-policies.ts`.
