# Preference parser evaluation results

Results for the natural-language schedule-preference parser
(`frontend/src/lib/preferences/parse.ts`), scored against the labeled corpus
(`corpus.ts`, 320 entries). Numbers in this file were produced by the runs
below; rerun them to reproduce.

## How to run

```sh
# From the repository root:
bun run frontend/tests/preferences/eval.ts   # corpus metrics below
bun test tests/preferences/preferences.test.ts   # 46 strict behavior tests
```

The evaluation command exits 0 when it completes scoring (it always prints
misses; there is no threshold gate — CI gates on the unit tests instead).

## Latest run

```
Corpus entries: 320
Strictly correct entries (every expected field exact): 320 (100.0%)
```

### Field-level metrics

| field | tp | fp | fn | precision | recall | f1 |
|---|---|---|---|---|---|---|
| avoidedCourses | 11 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| blockedTimes | 175 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| campusScope | 19 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| creditMax | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| creditMin | 18 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| daysOff | 69 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| earliestStart | 39 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| instructor | 16 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| latestEnd | 38 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| mode | 15 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| openSeatsOnly | 12 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| soft | 32 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| unparseable | 5 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| unsupportedTags | 25 | 0 | 0 | 100.0% | 100.0% | 100.0% |
| wantedCourses | 20 | 0 | 0 | 100.0% | 100.0% | 100.0% |

### Per-family strict accuracy

| family | entries | strict |
|---|---|---|
| earliestStart | 32 | 32/32 |
| latestEnd | 32 | 32/32 |
| daysOff | 34 | 34/34 |
| blockedTimes | 30 | 30/30 |
| credits | 28 | 28/28 |
| seats | 11 | 11/11 |
| campus | 17 | 17/17 |
| mode | 13 | 13/13 |
| courses | 25 | 25/25 |
| instructor | 14 | 14/14 |
| soft | 26 | 26/26 |
| multi | 24 | 24/24 |
| unsupported | 24 | 24/24 |
| chatter | 10 | 10/10 |

## How to read a 100% score

**This is not an independent benchmark.** The corpus was authored alongside
the parser as an executable specification of the phrasing families the
scheduler agrees to support. Every entry was written by the same process that
wrote the rules, and during development two corpus labels were corrected
where the labels were wrong, not the parser: `le-001` ("No classes after
3pm" — 3pm is minute 900, not 1020) and `cr-027` ("I want about 15 credits"
— hedged credit requests are intentionally not guessed, so the honest label
is `unparseable`, matching the parser's fallback).

So 320/320 means: every documented phrasing family parses to its labeled
intent, with no false positives or misses on this set. It does **not**
predict accuracy on phrasings outside the corpus. The honest failure modes —
the ones the design relies on instead of silent wrong answers — are:

- **Unsupported but recognized families** (max classes per day, back-to-back
  specific days, class duration caps, professor avoidance, and others) are
  reported as `unsupportedTags` with exact text spans, never dropped
  silently.
- **Preference-sounding text no rule claims** (for example "I want about 15
  credits") is reported as `unparseable` with the span that could not be
  understood, so the UI can ask rather than guess.
- **Genuine chatter** ("hey there") produces an empty intent and no
  complaints.

Any new phrasing should land in `corpus.ts` first (pick the family kind,
label the expected fields, set `unparseable: true` if no rule should claim
it), then in the parser. The evaluation prints per-entry misses with
diffs when a family regresses.

## Scoring definitions

- **Strict entry match**: every expected field is exactly right (spans for
  blocked times, minutes for bounds, day lists order-insensitive but
  complete) and no unexpected field appears.
- **Field-level tp/fp/fn**: per-occurrence for list fields, per-value for
  singletons; `unsupportedTags` and `unparseable` are scored as sets.
- **Soft preferences** are scored as (key, strength) pairs — a mild answer
  to a strong ask counts as a miss, per the corpus's `softStrong` labels.
- **Instructor** is scored as a whole value (kind, name, strength).

## Known parser approximations

Documented in the source, summarized here:

- Bare hours after a negative bound read as pm when that reading is
  plausible ("nothing after 5" → 17:00); the corpus deliberately avoids
  genuinely ambiguous cases like "before 7".
- "Too early" / "too late" style complaints map to the corresponding time
  bound only when the sentence states no explicit time.
- Unmarked blocked-range ends adjust forward when the stated end is not
  after the start (for example "10-2" → 10:00-14:00).
- Overlap resolution works on text spans, not on the resulting blocked
  intervals: two distinct stated blocks that overlap in minutes (for
  example "I work 8-12, no 8am classes") both land in the intent. Redundant
  intervals are harmless downstream; no interval algebra is performed.
- Weekend days and named instructors parse into the intent but have no
  planner input to land in; `toPlannerPreferences` drops them on purpose
  (see the mapping's doc comment in `schema.ts` for the full
  dropped-on-purpose list).
