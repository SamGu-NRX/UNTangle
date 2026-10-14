# Preference parser evaluation results

Results for the natural-language schedule-preference parser
(`frontend/src/lib/preferences/parse.ts`), scored against the labeled corpus
(`corpus.ts`, 410 entries) and the strict behavior tests
(`preferences.test.ts`, 37 tests).

**How to read these numbers.** The corpus was authored alongside the parser by
the same author. A perfect score here is **coverage of our own wording**, not
an accuracy claim: every entry encodes a rule the parser was built to handle,
and entries were relabeled when they contradicted the parser's uniform rules.
These numbers say nothing about how the parser does on unseen phrasings. An
independent held-out set exists and is scored separately by the lead; its
results are not reported here and must not be inferred from this file.

## How to run

```sh
# From the repository root:
bun --no-env-file frontend/tests/preferences/eval.ts   # corpus metrics below
cd frontend && bun --no-env-file test tests/preferences   # 66 strict behavior tests
cd frontend && bun x tsc --noEmit                          # whole-project typecheck
```

The evaluation command exits 0 when it completes scoring (it always prints
misses; there is no threshold gate — CI gates on the unit tests instead).
Tests and typecheck are run with environment-file loading disabled
(`--no-env-file`) so validation never reads machine-specific configuration.

## Latest run

```
labeled corpus: 410/410 entries pass

  [ok  ] ambiguous    1/1
  [ok  ] blocked      46/46
  [ok  ] campus       15/15
  [ok  ] credits      36/36
  [ok  ] daysOff      49/49
  [ok  ] earliest     29/29
  [ok  ] latest       34/34
  [ok  ] mode         15/15
  [ok  ] multi        20/20
  [ok  ] seats        14/14
  [ok  ] soft         78/78
  [ok  ] tag          65/65
  [ok  ] unparseable  8/8
```

```
66 pass / 0 fail (109 assertions), preferences.test.ts
tsc --noEmit: clean
eslint (src/lib/preferences, tests/preferences): clean
```

## What the evaluator scores

Per entry, against the parser's full output:

- **Hard fields:** every hard field must equal its expected value — there is
  no partial credit and no default-forgiveness. Unspecified hard fields must
  hold the documented defaults (null bounds, empty day-off and blocked lists),
  so a spurious value anywhere fails the entry.
- **Soft preferences:** exact comparison of key, strength, and polarity.
  Strong-for-mild counts as a failure, and a missed polarity direction is a
  failure.
- **Unsupported tags:** the exact tag set with spans (wanted/avoided courses,
  named instructors, weekend day groups, free-on-X, day-with-time, ambiguous
  times, and the rest of the planner-unmappable families).
- **Residuals:** optional exact count of unparseable spans.
- **Span invariants:** every reported span must align with the original input
  text and understood/unsupported spans must not overlap.

## Design contract under test

- **Precision first.** Ambiguous input produces a reported span
  (`ambiguousTime`, `freeOnDay`, `dayWithTime`, ...), never a guessed fact: a
  bare hour without am/pm, a same-period bare range that only makes sense one
  way, a day with a time qualifier, a coordinate alternative ("done by noon,
  or by 3" keeps the noon bound and tags the bare alternative). A missed fact
  surfaces as a visible span the student can fix; a guessed fact silently
  builds the wrong schedule.
- **Hard vs soft.** Hard constraints are exact. Soft preferences carry
  strength (mild/strong) and polarity (toward/away), so "no morning classes"
  lowers the morning weight instead of raising it, and negated directional
  preferences flip to their opposite ("no gaps between classes" is compact).
- **Unsupported is honest.** Courses, named instructors, free-on-X asks,
  weekend-only commitments, and similar planner-unmappable requests are
  reported as tagged spans. The planner cannot act on them, so they are never
  rounded into a different field.
- **Patched, not overwritten.** `applyIntent(current, intent)` touches only
  the fields the intent sets, appends blocked times with `uniqueBlockId`, and
  follows `applyChoice`'s rule that a control owns only its own weights.
  Untouched fields are preserved byte-identically, and every output passes the
  planner's own `parseSchedulePreferences` validation.

## Known approximations and limits

- **Not an independent benchmark.** See the framing note above. The corpus is
  self-authored coverage; per-field precision/recall on unseen wording is
  unknown from this file alone.
- **Corpus-label corrections.** Several entries were relabeled during the
  redesign because their labels contradicted the parser's uniform rules:
  an 11pm bound read as 1380 minutes, an ambiguous "no 9.30" kept ambiguous,
  only-days complements excluded rather than included the named days,
  back-to-back avoidance labeled as a positive spreadOut preference, and a
  same-period babysit range matched the identical "training Saturday 9 to 11"
  ambiguity label. Each correction brought the entry in line with a rule
  other entries already followed; no label was changed to make a failing
  behavior pass.
- **Courses and named instructors are tags, not data.** The planner cannot
  filter by course code or professor yet; requests are surfaced as spans for
  the UI.
- **Globally scoped bounds only.** The planner has no per-day start/end, so
  "no classes after 5pm on Thursdays" is tagged `dayWithTime` rather than
  invented as a global bound; all-weekday scopes still apply.
- **Ambiguity is reported, not resolved.** Users typing "nothing after 5"
  get an `ambiguousTime` span to clarify, by design. Downstream UI must
  render these spans or the information is lost.
- **Regex table, not a grammar.** The row table is readable and deterministic
  but cannot parse arbitrary nesting. New phrasings need new rows or row
  generalizations, each verified against the corpus.
