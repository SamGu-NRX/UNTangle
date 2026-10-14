# Instructor matching: how to check it, and the last run

The scenario set (`data/scenarios.ts`) is built from real strings: the
committed section and grade-history fixtures plus one cached fetch of public
vsb.untgrades.app term data (endpoint, fetch date, byte size and sha256 are
recorded in `data/vsb-spring-2027-instructors.json`; the 16 MB response itself
is not committed). Passing it shows the matcher covers the surface forms we
captured. It is not an accuracy number. Accuracy on unseen wording comes from
the lead's private held-out set, which is scored separately and not reported
here, so families are covered broadly rather than phrasings memorized.

The matcher abstains on every weak or ambiguous case, so most scenarios expect
no match. That is the design: precision is the commitment, recall is reported
honestly and never bought with fuzzy guesses.

## Commands

From `frontend/`:

```sh
bun --no-env-file tests/instructors/eval.ts        # score the scenarios
bun --no-env-file test tests/instructors           # behavior, parser, provenance tests
bun x tsc --noEmit
bun run lint
```

`eval.ts` exits 1 when total pairs fall below 150, hard-case scenarios fall
below 40, precision falls below 0.98, or any scenario names a family outside
the spec table. It exits 0 otherwise.

## Last run (2026-10-14)

```
threshold: 0.9
scenarios: 81 hard-case, 12 fixture / 39 vsb-fetch / 30 derived
pairs: 377 total, 284 real (non-derived) -- tp 25, fp 0, fn 0, tn 352

  family                  scenarios  pairs   precision  recall    (tp/fp, tp/fn)
  unusable-instructor     7          56      n/a        n/a       (0/0, 0/0)
  surnames                11         67      100%       100%      (2/0, 2/0)
  first-names-initials    7          9       100%       100%      (6/0, 6/0)
  middle-names            7          30      100%       100%      (3/0, 3/0)
  suffixes                6          42      100%       100%      (1/0, 1/0)
  accents-and-case        5          19      100%       100%      (3/0, 3/0)
  shared-surnames         14         18      100%       100%      (6/0, 6/0)
  multi-person            16         90      100%       100%      (2/0, 2/0)
  display-form            8          46      100%       100%      (2/0, 2/0)

precision: 100%
recall:    100%
gates: pairs >= 150, hard cases >= 40, precision >= 0.98 -- all pass   (exit 0)
```

`tests/instructors`: 62 pass, 0 fail. Full `bun --no-env-file test` in
`frontend/`: the same 4 failures appear with and without the instructor files
present (1601 tests with, 1548 without), so they pre-exist on the alpha base
and are unrelated to this change: the rate-limit, campus and map route tests
are timing-sensitive under full-suite parallelism, and each passes when its
file runs in isolation. `tsc --noEmit`: clean. `bun run lint`: 0 errors;
3 pre-existing warnings, all in files this change does not touch
(`src/components/map/map-canvas.tsx`,
`src/lib/optimizer/worker/optimize.worker.bundle.js`).

## Review round (2026-10-14)

The automated reviewer found six issues, all fixed in this revision:

- Display-form compound surnames lost the match the raw pair form had:
  "Fernando Mosquera Ferrandiz" read its surname as the last token only. The
  parser now records every trailing token block as a possible surname for
  comma-less segments, and the surname gate tries them.
- "Smith, Ipek" with a dotted capital I lowercased into a base letter plus a
  combining mark; tokenizing split on the mark and invented the initial "i",
  producing a false 0.9 match against Ian Smith. Combining marks now strip
  after folding, and any letter the fold map does not cover makes the whole
  form abstain ("unsupported characters") instead of losing information.
- "Hickman,M.T." collapsed to the single token "mt" because periods were
  deleted rather than widened; adjacent initials now stay separate initials.
- A zero-return corpus made precision NaN, which passed the `< 0.98` check.
  The gate now rejects an undefined precision, and a test pins that corpus.
- The labeled evaluation ran only as a manual script; CI never ran it. The
  scoring core is now a pure `evaluate()` that `bun test` enforces.
- `CONFIDENCE_THRESHOLD` was not consulted when qualifying pairs. The gate
  now compares every outcome against the exported constant.

## Threshold

CONFIDENCE_THRESHOLD is 0.9, and the weakest returning evidence (surname plus
a consistent first-name initial) sits exactly at it. Anything weaker abstains:
no edit distance, no phonetics, no nickname dictionary, no match on surname
alone. Lowering the bar below the initial tier would trade the 98 percent
precision commitment for recall on names the feed spells loosely, so it stays.

## Mutation checks

Three mutations were applied during development and reverted:

- Removing the surname gate fails the cross-surname test ("identical first
  names do not match without a surname overlap").
- Removing the n-tilde accent fold fails three accent tests.
- Removing the identical-person dedupe filter changes nothing: the ambiguity
  check already collapses duplicate people through its key sets, so the
  dedupe filter is a small performance nicety, not a correctness load.
  The repeated-person scenario still passes either way.

## What the numbers do not show

Every positive pair in the table involves one of the eight identities the
committed grade-history fixtures carry. The abstention rows (352 true
negatives) are the real safety story: look-alike real names (Jiang, Wang,
Shah, Sarkar, Shrestha families), team-taught fields, stray None placeholders
and suffix or middle variants all abstain or separate correctly. Surface forms
outside these families are the held-out set's job, not this run's.
