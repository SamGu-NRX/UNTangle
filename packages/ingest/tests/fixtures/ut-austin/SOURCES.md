# UT Austin fixture sources

Every fixture in this directory is a saved copy of a public page, captured
once, politely, and never re-fetched by tests. The parser that reads them is
`packages/ingest/src/ut-austin/catalog.ts`; the access-rule research behind
the capture is `docs/research/ut-austin/README.md`.

| File | Source URL | Captured | How |
|---|---|---|---|
| `catalog/c-s.html` | https://catalog.utexas.edu/courses/c_s/ | 2026-10-15 | single plain HTTP GET, no login |
| `catalog/m.html` | https://catalog.utexas.edu/courses/m/ | 2026-10-15 | single plain HTTP GET, no login |
| `catalog/phy.html` | https://catalog.utexas.edu/courses/phy/ | 2026-10-15 | single plain HTTP GET, no login |

Capture details: the three pages were fetched with `curl` under the agent
string `UNTangleIngest/0.1 (contact: sgu07966@gmail.com)`, three seconds
apart, from a shared sandbox. `catalog.utexas.edu` published no robots.txt
that day (the path returned the site's 404 page), no terms page governs the
course pages, and no login or CAPTCHA was met. Future captures follow the
`catalog-utexas` source policy in `packages/ingest/src/source-policies.ts`.

URL correction, October 15, 2026: the Computer Science page is served at
`/courses/c_s/` (underscore); the first draft of this file recorded the
hyphenated `/courses/c-s/`, which returns the site's Page Not Found page. The
corrected URL above is the slug the live course index
(https://catalog.utexas.edu/courses/) links for "Computer Science (C S)", and
the page it served that day was byte-identical to the saved fixture (same 190
course blocks). The file name `c-s.html` predates the correction and is kept
only as the fixture's local name.
