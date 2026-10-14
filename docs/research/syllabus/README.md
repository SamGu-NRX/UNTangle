# Syllabus fact extraction study

Can deterministic rules quote attendance policies, count exams, and identify grading
weights in UNT's public syllabi accurately enough for course planning?

## Results are withdrawn

The previous results do not answer that question reliably. The scorer counted a
wrong attendance or exam answer as a false positive without also counting the
missed labeled fact. It also omitted wrong grading blocks from document-level
counts and accepted blocks containing extra components. Recall was overstated.

The corrected scorer has regression tests, but the original labeled-text cache
was unavailable during landing. No replacement corpus scores were computed.
`eval-results.txt` records this limitation instead of publishing the old numbers.
The published numbers must be regenerated from the original labeled cache by
running this exact command from the repository root, after binding its hashes:

```sh
bun --no-env-file frontend/tests/syllabus/eval.ts > docs/research/syllabus/eval-results.txt
```

The old claim that grading extraction never fires was also wrong. The historical
misclassification output included extracted grade-scale components for
`222d3dfe` and `4556bf9b`. A wrong answer differs from an absent answer. The next
report must distinguish correct answers, wrong answers on positive documents,
spurious answers on negative documents, and absent answers on positive documents.
There is no corrected performance verdict until the corpus is rescored.

## Labels and scoring

`labels.json` contains the hand-written facts, source URLs, and short identifying
quotes, not full syllabi. Labels were written with extractor output visible in the
worksheet, so this is not a blind evaluation. Some sections share syllabus text;
entry-level scores must not be described as independent-document scores.

The committed labels include 50 entries. Tests count 38 attendance-positive,
29 exam-positive, and 38 grading-positive entries directly from that file.
These are label counts, not extraction results. Every positive entry belongs in
the corresponding recall denominator.

`frontend/tests/syllabus/eval.ts` compares predictions with labels:

- Attendance evidence must overlap the labeled excerpt in content words.
- Exam count must equal the labeled count.
- A grading block must match every labeled component by name overlap and weight,
  one-to-one, with no extra extracted components. Component-level scores also
  report unmatched labeled and extracted components separately.

A wrong answer on a positive entry counts as both a false positive and a miss.
An absent answer on a positive entry counts as a miss only. The scorer validates
all text hashes before extracting facts or publishing any scores.

## Offline replay and the missing hashes

Cached reconstructed text belongs in
`tools/syllabus/.cache/text/<sha1(syllabusUrl)>.txt`. The cache is gitignored.
Each label must carry `textSha256`, computed over the exact reconstructed UTF-8
text. The current committed labels lack these hashes because the original text
was not available; evaluation rejects them rather than silently using changed
syllabi at the same URLs.

Restore the original labeled cache and its manifest. Confirm that it is the text
used for labeling, not a newer download. Only then run:

```sh
bun --no-env-file tools/syllabus/build-labels.ts
bun --no-env-file frontend/tests/syllabus/eval.ts > docs/research/syllabus/eval-results.txt
```

`build-labels.ts` assembles the existing hand-written labels and computes each
text hash. Review and commit those hashes along with the regenerated results.
Do not rerun the builder to bypass a hash mismatch. Changed documents require a
new labeling study. For an existing hash-bound corpus, run only the evaluator;
`--cache-text=<directory>` selects a restored text directory without networking.

The original study reported exclusions for flattened grading tables that could
not be verified: `4cfca730`, `989ca9a6`, `6652c54c`, `82f7a47a`, `56dce29e`, and
`9e17c57f`. Collection and readability totals have not been recomputed here.

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
