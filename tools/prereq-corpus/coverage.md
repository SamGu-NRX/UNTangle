# UNT prerequisite parse coverage

This report measures the 656 bundled catalog entries, not parser accuracy. The golden set checks specific interpretations.

| Classification | Courses |
| --- | ---: |
| Fully parsed | 429 |
| Partial | 168 |
| Unknown | 59 |
| Total | 656 |

Fully parsed includes 202 empty prerequisite strings. Partial means at least one requirement leaf was parsed and at least one remains unknown. Unknown means no requirement leaf was parsed. Recognized annotations remain in the parse result and original source. Consent is fully parsed but always requires advisor review.

Unknown classifications that still name a course code: 39. The required limit is fewer than 40.

Unsupported mandatory major restrictions, GPA rules, placement rules, scoped department-credit totals, timing conditions, and ambiguous lists remain advisor checks. Course conjuncts are retained beside unknown leaves. Conditional major-dependent prose is kept whole so closure cannot assume a course belonging to another branch. Equivalents are advisor notes on a named course. Total-hour thresholds use explicit or accepted transcript hours.

[Per-course classifications and original text](coverage.json) carry the corpus SHA-256, 7b1f6cfd71b19c44e5fab4b12dc1d7457a329933c9c76a9645ae0dde7bd20af7.

Regenerate from the repository root with `bun tools/prereq-corpus/coverage.ts`. Use `--check` to verify that the committed report matches the parser and catalog.
