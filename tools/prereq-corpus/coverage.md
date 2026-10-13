# UNT prerequisite parse coverage

This report measures the 656 bundled catalog entries, not parser accuracy. The golden set checks specific interpretations.

| Classification | Courses |
| --- | ---: |
| Fully parsed | 430 |
| Partial | 168 |
| Unknown | 58 |
| Total | 656 |

Fully parsed includes 202 empty prerequisite strings. Partial means at least one requirement leaf was parsed and at least one remains unparsed. Unknown means no requirement leaf was parsed. Recognized annotations remain in the parse result and original source. Consent and equivalent routes count as parsed grammar but require advisor confirmation when used.

Unknown classifications that still name a course code: 38. The required limit is fewer than 40.

Unsupported mandatory major restrictions, GPA rules, placement rules, scoped department-credit totals, timing conditions, and ambiguous lists remain advisor checks. Course conjuncts are retained beside unknown leaves. Conditional major-dependent prose is kept whole. Scoped consent, equivalent, and replacement alternatives supply no closure facts, while mandatory AND siblings do. Mandatory consent does not waive course siblings. Unparsed text outside an explicitly attached escape blocks the entire rule. Equivalent alternatives retain an advisor-check leaf; direct named-course evidence still satisfies the alternative. Consent exceptions attach to preceding requirements, and replacement sentences attach to the named course. Explicit all or each grade wording applies across listed semicolon groups. Both binds to a demonstrated two-course pair and preserves explicit per-course grades; ambiguous scope stays unknown. Plural equivalents protect the preceding course list within its group, and singular equivalents protect their course. Unmarked trailing grades stay local. Total-hour thresholds use explicit or accepted transcript hours.

[Per-course classifications and original text](coverage.json) carry the corpus SHA-256, 7b1f6cfd71b19c44e5fab4b12dc1d7457a329933c9c76a9645ae0dde7bd20af7.

Regenerate from the repository root with `bun tools/prereq-corpus/coverage.ts`. Use `--check` to verify that the committed report matches the parser and catalog.
