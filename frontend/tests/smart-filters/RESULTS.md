# Smart-filters grade-history coverage

Measured 2026-10-14 with the repo's committed spring-2027 section fixture. That
fixture is a partial scrape, so these numbers describe the fixture, not the
whole term.

Command (from `frontend/`):

```
bun --no-env-file tests/smart-filters/coverage.ts
```

Sections come from the committed whole-term fixture (`tests/sections/fixtures/spring-2027.json`)
through the sections proxy; grade history comes only through the shared
grades-history service (`GradesHistoryService` + `GradesMcpClient`) with its
existing limiter and disk cache, exactly as the API route wires them. Six
distinct courses appeared, so all six history reads were attempted, under the
per-request cap of six and the shared untgrades limiter.

## Result: 6 sections, 6 courses

| Grade facts        | Sections | Meaning                                            |
| ------------------ | -------: | -------------------------------------------------- |
| `matched`          |        1 | Enough graded sections to show GPA and A/B share    |
| `insufficient-data`|        4 | Instructor matched, fewer than 3 graded sections    |
| `no-history`       |        1 | Matcher abstained, so no figures exist              |

Per course:

| Course    | Section          | Grade facts         |
| --------- | ---------------- | ------------------- |
| MATH 1680 | 6862+6863        | `matched`           |
| ACCT 5120 | 1002             | `insufficient-data` |
| ART 5450  | 8776             | `insufficient-data` |
| BCIS 4740 | 11671            | `insufficient-data` |
| DBAS 6003 | 12747            | `insufficient-data` |
| ADES 5510 | 8608             | `no-history`        |

Reading: on this partial fixture, 1 of 6 sections gets a grade summary. The
matcher abstained on ADES 5510 ("section instructor is closed"), and that
section shows no grade history rather than an inferred figure. The other four
courses matched an instructor but the course's history holds fewer than three
graded sections for them, so the figures stay withheld. Nothing is invented:
every section without a unique, sufficiently graded instructor match carries an
explicit reason instead of a number.
