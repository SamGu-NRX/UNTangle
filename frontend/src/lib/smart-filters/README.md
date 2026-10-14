# Smart filters

Pure, deterministic filters over term sections and the grade facts joined
onto them. No network, no I/O; the API route wires real sources in.

- `model.ts` - the filter and grade-facts types.
- `facts.ts` - derives `SectionFacts` (days, times, modality, campuses) from a section.
- `filters.ts` - the filter predicates and their AND combination.
- `join.ts` - joins a section to its course's grade history through the
  abstain-first instructor matcher (`@/lib/instructors/match`).
- `handlers.ts` - the injected-sources term handler: parameter parsing,
  filtering, per-course grade-history reads, response shaping.

## Matching rules

- A section joins to grade history only through a matcher match against the
  identities its own course's history names. The matcher's abstentions are
  honored exactly: an abstention is a `no-history` result and never a figure.
- GPA and A/B-share figures wait for at least `MIN_GRADED_SECTIONS` (3)
  graded sections for that instructor in that course; below the threshold the
  result is `insufficient-data` with the counts but no figures.
- Figures come only from the matched instructor's graded sections within the
  same course. Nothing is inferred across instructors, courses, or from
  withdrawn-only sections.
