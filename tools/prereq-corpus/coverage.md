# UNT prerequisite parse coverage

This report measures the 656 bundled catalog entries, not parser accuracy. The golden set checks specific interpretations.

| Classification | Courses |
| --- | ---: |
| Fully parsed | 371 |
| Partial | 59 |
| Unknown | 226 |
| Total | 656 |

Fully parsed includes 202 empty prerequisite strings. Partial means at least one complete clause was parsed and at least one clause remains unknown. Unknown means no mandatory clause was parsed. Recognized annotations remain in the parse result and original source. Consent is fully parsed but always requires advisor review.

Unsupported major restrictions, GPA rules, equivalencies, placement rules, credit totals, timing conditions, and ambiguous lists remain unknown. Text references within an unsupported clause do not become mandatory courses or closure facts.

[Per-course classifications and original text](coverage.json) carry the corpus SHA-256, 7b1f6cfd71b19c44e5fab4b12dc1d7457a329933c9c76a9645ae0dde7bd20af7.

Regenerate from the repository root with `bun tools/prereq-corpus/coverage.ts`. Use `--check` to verify that the committed report matches the parser and catalog.
