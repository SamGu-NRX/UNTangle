# Syllabus fact extraction study

Can deterministic rules quote attendance policies, count exams, and identify grading
weights in UNT's public syllabi accurately enough for course planning?

## Results: a new evaluation dated 2026-10-14

Rules alone can't quote these facts reliably enough for course planning. Scored on 38 labeled syllabi:

| Fact | Precision | Recall | Correct / wrong / missed |
|---|---|---|---|
| Attendance policy | 20.0% | 24.1% | 7 / 28 / 22 |
| Exam count | 68.8% | 45.8% | 11 / 5 / 13 |
| Grading weights, per document | 0.0% | 0.0% | 0 / 2 / 28 |
| Grading weights, per component | 0.0% | 0.0% | 0 / 2 / 123 |

What the misclassifications in `eval-results.txt` show:
- **Attendance:** most errors quote the wrong sentence, often the university's standard excused-absence policy, which most syllabi carry, instead of the course's own rule. A section heading or keyword is not enough to find the policy.
- **Exam count:** errors come from schedule rows and grading tables ("16 Final Exam", "Midterm Exam 15% Final Exam 15%"), where the count has to be read from structure, not from a sentence.
- **Grading weights:** almost all are tables. After PDF text extraction they become flat runs of names and percentages, and the rules find no block or the wrong one (a letter-grade scale).

Next step: don't build syllabus-fact UI on these rules. Grading weights need layout-aware table extraction from the PDF. Attendance needs a way to tell a course's own policy from the university's boilerplate. Either one could be tested with a model-based extractor whose every claim must quote its source span, measured against this same corpus before any UI. That would cost money, so it needs Sam's approval.

**How this corpus was built.** The original labeled text was lost, so this is a new evaluation, not a replay of the first study.
1. On 2026-10-14 the lead downloaded again exactly the 50 syllabus URLs in `labels.json`. The collector's polite fetcher made one request at a time, at most one per second, honoring robots.txt, and would have stopped on any 429 or 5xx. None occurred.
2. Each label was kept only if every labeled excerpt still appears verbatim, ignoring whitespace, in the fresh text.
3. 38 entries passed and are bound to the SHA-256 of their text. 12 failed and are listed under `excluded` in `labels.json`. Most are excerpts the labeler had trimmed or reworded. The rest are PDFs whose fresh text spaces or splits a phrase differently.

The downloaded text is archived privately outside the repository, at `~/.long-run/untangle/archive/syllabus-corpus-2026-10-14/`, with a fetch report. It's needed to rerun the evaluation and isn't committed.

The extractor was corrected before this evaluation:
- week and calendar-date schedule positions are rejected as exam counts;
- an explicit exam total takes precedence over listed exams;
- attendance polarity is compared;
- sentence splitting scans past intervening whitespace;
- PDF text reconstruction keeps spaces between adjacent text items;
- a PDF with no text layer is reported as unreadable.

## Labels and scoring

`labels.json` contains the hand-written facts, source URLs, and short identifying
quotes, not full syllabi. Labels were written with extractor output visible in the
worksheet, so this is not a blind evaluation. Some sections share syllabus text;
entry-level scores must not be described as independent-document scores.

The committed labels include 38 scored entries, plus 12 excluded ones recorded
with reasons. Every positive entry belongs in the corresponding recall
denominator: 29 attendance-positive, 24 exam-positive and 28 grading-positive.

`frontend/tests/syllabus/eval.ts` compares predictions with labels:

- Attendance evidence must overlap the labeled excerpt in content words, and
  explicit negation markers must agree. This is a conservative sentence-level
  check, not a semantic comparison of individual policy clauses.
- Exam count must equal the labeled count.
- A grading block must match every labeled component by name overlap and weight,
  one-to-one, with no extra extracted components. Component-level scores also
  report unmatched labeled and extracted components separately.

A wrong answer on a positive entry counts as both a false positive and a miss.
An absent answer on a positive entry counts as a miss only. The scorer validates
all text hashes before extracting facts or publishing any scores.

## Rerunning the evaluation

The scored entries are bound to text hashes, so the evaluator refuses changed
documents. With the archived text, run this from the repository root. It
replaces `eval-results.txt` only if the evaluation succeeds:

```sh
output=$(mktemp docs/research/syllabus/eval-results.txt.XXXXXX) &&
if bun --no-env-file frontend/tests/syllabus/eval.ts --cache-text="$HOME/.long-run/untangle/archive/syllabus-corpus-2026-10-14/text" > "$output"; then
  mv "$output" docs/research/syllabus/eval-results.txt
else
  rm -f "$output"
  false
fi
```

## Future collection, not a replay of the labeled corpus

This command uses the network and may produce changed documents. It was not run
during landing and does not restore the original labeled corpus:

```sh
bun --no-env-file tools/syllabus/run.ts \
  --profiles=tools/syllabus/data/profile-ids.txt --term="Fall 2026"
```

The fetcher combines matching robots groups, compares literal rule specificity,
and blocks an origin for the run if robots.txt times out, fails, or returns a
server error. Only a client-error response means no restrictions.

For manual labeling, create a JSON array of readable cached text filenames, such
as `["<40-character sha1 of syllabus URL>.txt"]`. Pass that list explicitly:

```sh
bun --no-env-file tools/syllabus/make-worksheet.ts \
  --readable=/path/to/readable.json --output=/tmp/worksheet.txt
```

The worksheet accepts `--cache=/path/to/cache` and otherwise reads
`tools/syllabus/.cache`. It does not depend on a hidden `/tmp/readable.json`.
