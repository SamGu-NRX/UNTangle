# Preference parser: how to check it, and the last run

The corpus (`corpus.ts`) is our own wording, written alongside the parser.
Passing it shows the parser covers phrasings we thought of. It is not an
accuracy number. Accuracy on unseen wording comes from the lead's private
held-out set, which is scored separately and not reported here.

## Commands

From `frontend/`:

```sh
bun --no-env-file tests/preferences/eval.ts                      # score the corpus
bun --no-env-file tests/preferences/eval.ts --file=labels.json   # score another label file
bun --no-env-file test tests/preferences                         # behavior tests
bun x tsc --noEmit
```

`eval.ts` exits 1 when an entry fails, or when an entry marked as a known
miss starts passing (so its mark gets removed). It exits 0 otherwise. Known
misses keep their correct label and are listed on every run, so they stay
visible without hiding new failures.

## Last run (2026-10-13)

```
corpus: 457/472 pass, 15 known misses, 0 failures      (exit 0)

  field                precision  recall   (correct / set, correct / labeled)
  hard.blockedTimes    100%       100%     (50/50, 50/50)
  hard.campusScope     100%        94%     (17/17, 17/18)
  hard.creditMax       100%       100%     (25/25, 25/25)
  hard.creditMin       100%       100%     (26/26, 26/26)
  hard.daysOff         100%       100%     (65/65, 65/65)
  hard.earliestStart   100%        97%     (35/35, 35/36)
  hard.latestEnd       100%        95%     (35/35, 35/37)
  hard.mode            100%        94%     (16/16, 16/17)
  hard.openSeatsOnly   100%       100%     (15/15, 15/15)
  soft                 100%        91%     (97/97, 97/107)
  tags                 100%       100%     (108/108, 108/108)
  facts (hard + soft)  100%        96%
```

`preferences.test.ts`: 156 pass, 0 fail. Full `bun --no-env-file test` in
`frontend/`: 1517 pass, 4 skip, 0 fail. `tsc --noEmit`: clean.

A field the parser set counts as a prediction; a field the label sets counts
as a fact; a prediction is correct only when its value equals the label's.
Soft preferences compare key, strength and polarity together.

## Known misses

Thirteen come from cutting single-phrase rules ("home by", "morning
person", "night person", "be in a classroom", "keep me off the Frisco",
"get it over with", "knock it out"). The negated forms ("I'm not a morning
person") still parse through the general negation rule. The other two:
"10am or before" states no direction, and "evening classes would be nice"
puts the leaning after the noun, where no cue word reaches it.

## Label changes in this revision

- Plain soft statements are mild; an intensifier makes one strong. That
  covers words before the leaning ("really", "strongly prefer", "would much
  rather") and phrases after it ("matters a lot to me", "is important", "is
  a must"). A clause's own intensifier beats a hedge in the same clause, so
  "I really want fewer days on campus, if possible" is strong. A clause
  joined by "and" or a comma with no subject of its own inherits the
  intensifier before it, unless it has its own hedge. Every plain soft label
  moved from strong to mild.
- A bare range starting at 12 ("keep 12-1 free") is `ambiguousTime`, since
  12 can be noon or midnight. Each such entry gained a twin with am/pm
  written, which still blocks the time.
- A hedged day off is `hedgedConstraint` (it was `softDayOff`).
- "no morning classes before 8am" now sets the 8am bound; the negation
  reaches the bound through the general rule.
