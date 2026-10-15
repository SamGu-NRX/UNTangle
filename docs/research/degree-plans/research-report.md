# Degree-plan research: 15 majors from the 2026-2027 UNT catalog

Research basis for the plan files under `frontend/src/lib/pathing/plans/` and the
encoding notes in this directory. The catalog source of record is the
**2026-2027 Undergraduate Catalog** (`catalog.unt.edu`, `catoid=40`), retrieved
2026-10-14.

## Method

`catalog.unt.edu` refuses plain HTTP fetchers, so every page was read in a real
Chrome session at roughly one page per four seconds. A per-page extractor
captured headings (h2-h4), paragraphs, catalog course list items
(`li.acalog-course`), requirement tables, and in-content links, with a
full-page-text fallback per page. Four majors were verified in full
(psychology, accounting, management, integrative studies) plus heading-level
review of the rest.

## Catalog ID discrepancy (catoid=37 vs catoid=40)

The Computer Science BS plan (PR #70) cites `catoid=37`. The live catalog pages
now use `catoid=40`, and those pages self-identify as the **2026-2027
Undergraduate Catalog** — verified on the page title and the catalog selector
("2026-2027 Undergraduate Catalog" as the selected catalog on `catoid=40`
pages; archived catalogs are listed separately back to 2011-2012). The catalog
ID rotates when the catalog is refreshed; `catoid=37` no longer serves the live
2026-2027 catalog. **The plans added here cite `catoid=40` URLs**,
retrieval-dated 2026-10-14, matching how the CS plan records its source. The CS
plan's `catoid=37` citation stays as-is (it was correct when captured).

## Major selection caveat

The 15 majors carry forward from the approved task. UNT publishes total
undergraduate enrollment (34,149, Fall 2025 Fact Sheet) but no accessible
major-level ranking; the THECB dashboards loaded but their filters could not
produce a reliable per-major count this session. The list is therefore
task-prescribed, not enrollment-derived.

## Corpus

23 pages: the 15 major pages plus 8 shared requirement pages.

- **University Core Curriculum (UCC)** — program page poid=21275 and content
  page navoid=4670 (identical content). Nine component areas: Communication 6h
  (two sub-groups, C-or-better required), Mathematics 3h, Life and Physical
  Sciences 6h (choose 2), Language Philosophy and Culture 3h, Creative Arts 3h,
  American History 6h, Government/Political Science 6h, Social and Behavioral
  Sciences 3h, Component Area Option 6h (sub-groups A and B). Total 42h.
- **Degree and Program Requirements** (navoid=4689) — university-wide rules
  (minimum hours, advanced hours, GPA, residency). Linked by all 15 majors.
- **BBA common requirements** (poid=21199) — UCC 42h, BBA communication 9h,
  pre-business 21h, professional development 3h, business foundation 24h,
  international requirement 3h. Linked by accounting, finance, management,
  marketing.
- **Ryan College degree requirements** (poid=21566) — prose policy (tiered
  progression, GPA standards). Linked by accounting.
- **CLASS degree requirements** (poid=21595) and **CLASS
  distribution/foreign language** (poid=21596) — linked by english; 21596 also
  by integrative studies and communication studies.
- **College of Science degree requirements** (poid=21599) — linked by biology.

## Shared-requirement encoding decisions (encode when clearly linked)

| Requirement source | Encoded in plans of | Basis |
|---|---|---|
| UCC component groups (42h) | all 15 | hyperlinked from every major page |
| BBA common groups | accounting, finance, management, marketing | hyperlinked "Bachelor of Business Administration" reference |
| CLASS distribution | integrative studies, communication studies | hyperlinked (poid=21596); both majors carry the two 3-hour distribution groups |
| CLASS foreign language | integrative studies only | hyperlinked, but poid=21596 states "Majors in Communication Studies, ... are not required to complete the Foreign Language requirement" |
| CLASS degree requirements | english | hyperlinked |
| Science college requirements | biology | hyperlinked |
| College pages for psychology, criminal justice, kinesiology, engineering majors | — | college requirements named in prose but NOT hyperlinked on those pages -> skipped per the task rule |
| Kinesiology's catoid=32 link | — | points into the archived catalog; skipped as stale |

## Encoding rules

1. One plan file per major under `frontend/src/lib/pathing/plans/`, same shape
   as `cs-bs-2026-27.ts`: `name`, `source` (catoid=40 URL + copied date),
   `notChecked`, ordered `requirements`.
2. Group kinds follow the CS example: `all` (fixed list), `choose`/`choice`
   (N-of / branch), `hours` (any hours), `pool` (rule-defined list). Heading
   hours are verbatim ("Professional field in accounting, 28 hours");
   choose-N language is quoted from the page's own paragraphs.
3. Prerequisites are preserved only where the catalog prints them in the
   requirement context (e.g., PSYC 2317 requires MATH 1680).
4. GPA floors, C-or-better rules, residency and advanced-hour minimums go in
   `notChecked`, as the CS plan does.
5. Double-counting: the validator rejects a course assigned to two
   requirements. When a major REQUIRES a course that is also an option in a
   shared pool, the course stays in the major group and the shared pool is
   trimmed, with a per-plan note in `encoding-notes.md`. Purely optional
   overlaps are left alone (the student picks one owner).
6. Integrative studies is individualized (three student-chosen fields, 12h
   each): encoded as hour-based pools with the counselor-approval rule in a
   note — no invented course lists.

## Irregularities

The per-major irregularities (accounting's ambiguous "or" block, psychology's
page-text-only category lists, management's level-rule pool, integrative
studies' individualized fields, communication studies' Methods/Theory reuse
rule, english's category overlaps) and the complete list of single-ownership
trims are recorded in `encoding-notes.md`.
