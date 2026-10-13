# Registry coverage cross-check — UNT class-hosting buildings (fix 6)

**Branch:** `obv/untangle-campus-routing-f1-fix6-coverage` (descendant of
`f44f23d821966bbd39f581d0e63bbe1d851db910`, the PR #15 head)
**Scope:** prove the registry's class-hosting set against UNT's own public
sources. Registry = `frontend/src/lib/campus-locations.ts` (32 entries: 29
routable on-campus, 3 off-campus by design). No code changed; this file is the
only addition.

## Verdict

**No UNT Denton main-campus class-hosting building is missing from the
registry.** Every class-hosting building on the registrar's public Learning
Spaces Search maps to a registry entry — 26 labels resolve directly, 2
(Lyceum, spelled-out RTFP) resolve only to their host buildings, which are in
the registry (alias gaps documented below). The registry's routable set (29)
is a strict superset of the main-campus class-hosting set (28).

## Sources

1. **Class-hosting list** — UNT Registrar, Learning Spaces Search:
   `https://classrooms.unt.edu/` — page title **"Home | Learning Spaces
   Search"** — accessed **2026-10-11**. The page renders every class-hosting
   room as one row of a single table; the `Room` column carries the building
   label plus room number (e.g. `Art 219`, `BLB 240`). Decisive structural
   fact: 286 room rows across 32 distinct building labels (30 Denton, 2
   Frisco). Raw HTML: 369,759 bytes. Note: one earlier fetch rendered 285
   rows; the count used here is 286 from the raw HTML.
2. **Building identity verification** — UNT Facilities, Building Information:
   `https://facilities.unt.edu/resources/building-information.html` — page
   title **"Building Information | University of North Texas"** — accessed
   **2026-10-11**. Table rows of (Building Name, Mnemonic, Building number,
   Building address); 164 rows parsed. Decisive example rows (mnemonic /
   number / name as printed): `WH 150 Wooten Hall`, `SAGE 104 Sage Hall`,
   `RTFP 140 Radio, TV, Film & Performing Arts`, `UU 155 University Union`,
   `MGVP 464 MGV Bldg P`. Raw HTML: 163,283 bytes.
3. **Repo-recorded provenance** — the registry source comment
   (`frontend/src/lib/campus-locations.ts`, lines 15–22) states names,
   mnemonics, building numbers, and addresses come from UNT Facilities, and
   that registrar building-code research confirmed the mnemonics; commit
   `6a01f2b` ("Expand campus registry to 32 buildings and ship the
   walking-time matrix") describes the registry as "all 15 compD codes plus
   the registrar class-hosting set (Chilton, Curry, DATH, ESSC, MUSA, PAC,
   PEB, PHYS, RTFP, SYMR, TH, UU, Bain, Coliseum)". This cross-check
   re-derives that claim from the live page and confirms it.

## Method

1. Fetched both pages fresh (2026-10-11, browser user agent).
2. Parsed the Learning Spaces table: 286 room rows; derived each row's
   building label by stripping the trailing room token; grouped to 32 labels.
3. Extracted all 32 registry entries (`id`, `name`, `mnemonic`,
   `buildingNumber`, `isOffCampus`) from `campus-locations.ts`.
4. Cross-checked every registry mnemonic + building number against the
   Facilities table (exact match after HTML entity decoding).
5. Probed the production resolver `resolveCampusBuilding` on every inventory
   label — bare, and as the inventory renders it (e.g. `Art 219`).
6. Probed targeted forms for the two failures (`RTFP 127`, `Lyceum`,
   `University Union`).

## Full class-hosting list with in/out status

Learning Spaces Search, all 32 labels (room counts from the inventory):

| Inventory label | rooms | Registry entry | Resolver | Status |
|---|---|---|---|---|
| Art | 3 | `art` Art Building | art | IN — resolves |
| Art Annex | 3 | `arta` Art Annex | arta | IN — resolves |
| Auditorium | 5 | `aud` Auditorium Building | aud | IN — resolves |
| Business Leadership Building | 24 | `blb` | blb | IN — resolves |
| Chemistry | 4 | `chem` Chemistry Building | chem | IN — resolves |
| Chilton | 5 | `chil` Chilton Hall | chil | IN — resolves |
| Coliseum | 2 | `col` Coliseum | col | IN — resolves |
| Curry Hall | 8 | `cury` Curry Hall | cury | IN — resolves |
| Dance and Theatre | 5 | `dath` Dance and Theatre Building | dath | IN — resolves |
| Discovery Park | 16 | `ntdp` Discovery Park | ntdp | IN registry — off-campus by design (satellite site, excluded from routing) |
| Eagle Student Services Center | 1 | `essc` | essc | IN — resolves |
| Environmental Science | 15 | `env` Environmental Science Building | env | IN — resolves |
| Frisco Inspire Park | 6 | — | NULL | OUT of scope — UNT Frisco campus, not Denton main campus |
| Frisco Landing | 29 | — | NULL | OUT of scope — UNT Frisco campus, not Denton main campus |
| Gateway | 6 | `gate` Gateway Center | gate | IN — resolves |
| General Academic Building | 10 | `gab` | gab | IN — resolves |
| Hickory | 1 | `hick` Hickory Hall | hick | IN — resolves |
| Language | 40 | `lang` Language Building | lang | IN — resolves |
| Life Science Building | 24 | `life` | life | IN — resolves |
| Lyceum - University Union | 1 | `uu` University Union (host) | NULL | IN via host building — alias gap, see Observations |
| Matthews | 8 | `matt` Matthews Hall | matt | IN — resolves |
| Mean Green Village P | 1 | `mgvp` MGV Building P | mgvp | IN registry — off-campus by design (satellite site, excluded from routing) |
| Murchinson Performing Arts Center | 1 | `pac` Murchison Performing Arts Center | pac | IN — resolves (registry anticipates the misspelling) |
| Music | 18 | `musi` Music Building | musi | IN — resolves |
| Music Annex | 1 | `musa` Music Annex | musa | IN — resolves |
| Physical Education Building | 2 | `peb` | peb | IN — resolves |
| Physics | 7 | `phys` Physics Building | phys | IN — resolves |
| Radio, Television, Film and Performing Arts | 6 | `rtfp` (host) | NULL | IN via host building — alias gap, see Observations |
| Sage | 5 | `sage` Sage Hall | sage | IN — resolves |
| Sycamore | 1 | `symr` Sycamore Hall | symr | IN — resolves |
| Terrill | 2 | `th` Terrill Hall | th | IN — resolves |
| Wooten | 26 | `wh` Wooten Hall | wh | IN — resolves |

All 32 labels also reproduce identically in room-suffixed form (`Art 219`) —
the resolver's normalization strips room tokens.

## Facilities cross-check (identity, not class-hosting)

All **32/32** registry mnemonics and building numbers appear in the UNT
Facilities table with matching values — no mismatches. Method note, recorded
because it initially looked like a mismatch: 12 mnemonic cells carry HTML
`&nbsp;` padding (e.g. `WH&nbsp;&nbsp;&nbsp;`); without entity decoding the
comparison reports 12 failures. After decoding, every pair matches, e.g.
`WH/150`, `SAGE/104`, `RTFP/140`, `UU/155`, `MGVP/464`.

## The none-missing argument

- The Learning Spaces Search yields **30 distinct Denton labels**; 28 of them
  are main-campus hosts (the exceptions, Discovery Park and Mean Green
  Village P, are satellite sites the registry deliberately includes as
  off-campus-by-design and excludes from routing).
- **All 28 main-campus hosts map to registry entries**: 26 resolve directly;
  the Lyceum label is a room inside University Union (`uu`, in registry) and
  the spelled-out RTFP label is the RTFP Building (`rtfp`, in registry). Both
  failures are alias-form gaps, not coverage gaps.
- Registry routable set = 29 buildings ⊇ the 28 main-campus hosts. The one
  extra, Bain Hall (`bain`), hosts no Learning Spaces rooms — the registry is
  a superset in the correct direction.
- The two Frisco labels (35 rooms combined) belong to UNT's separate Frisco
  campus, outside the Denton main-campus scope, and have no registry entries —
  by design, consistent with the registry's Denton focus.

## Registry observations (non-blocking)

1. **Lyceum alias gap** — `uu` aliases are `uu`, `union`, `university union`,
   `student union`; the inventory's `Lyceum - University Union` label (1 room)
   fails `resolveCampusBuilding`. Adding `lyceum` would close it. The host
   building is already in the registry, so routing is unaffected.
2. **RTFP spelled-out form** — the inventory spells it "Radio, Television,
   Film and Performing Arts"; the registry aliases use the abbreviation
   ("radio tv film and performing arts"), so the spelled form fails while
   `RTFP 127` resolves. Adding a "radio television film and performing arts"
   alias would close it.
3. **Murchison spelling** — the registry comment already documents that the
   classroom system misspells it "Murchinson" and aliases both spellings;
   the inventory label resolves to `pac`. Registry quality confirmed.
4. **Row-count discrepancy** — the raw page carries 286 room rows; one
   earlier rendered fetch showed 285. This report uses 286 from the raw HTML.
   Either count leaves the verdict unchanged.

## Check ledger

| # | Check | Result | Evidence |
|---|---|---|---|
| C1 | Inventory parse (286 rows → 32 labels) | PASS | Table above, generated from the fetched page |
| C2 | Facilities mnemonic + number cross-check | PASS | 32/32 match after entity decoding |
| C3 | Resolver probes, 30 Denton labels, bare + room forms | PASS | 28/30 resolve in each form; 2 alias gaps documented |
| C4 | No-missing verdict | PASS | Argument above |
| C5 | `cd frontend && bun x tsc --noEmit` at this head | PASS | Exit 0, zero diagnostics (run 2026-10-11). Sequence: the first two runs failed on module resolution — the fresh clone had no `node_modules` (environmental), then a temporary probe script produced the only diagnostic (TS2532); after installing declared dependencies (`bun install --frozen-lockfile`, no manifest/lockfile changes) and removing the temp script, the check is clean. |
| C6 | Code untouched | PASS | Branch adds only `tools/campus-geodata/verification/coverage-crosscheck.md` |

No BLOCKED or NOT_RUN checks. Reproduction: fetch the two cited URLs, parse
the Learning Spaces `Room` column, and run the resolver probes against
`frontend/src/lib/campus-locations.ts`; every row of the table above was
generated that way on 2026-10-11.
