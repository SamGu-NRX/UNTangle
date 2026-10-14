# Syllabus rates study

Measures how well `frontend/src/lib/syllabus/extract.ts` finds three facts in
real UNT syllabi — attendance policy, exam count, grading weights — using
publicly posted Fall 2026 syllabi from facultyinfo.unt.edu.

## Components

- `lib/fetcher.ts` — polite HTTP fetcher: 1.1 s between requests,
  robots.txt honored (regex pattern matching), local response cache,
  bounded retries.
- `lib/profile.ts` — parses a faculty profile page into teaching rows
  (course, section, term, syllabus link).
- `lib/text.ts` — extracts text from syllabus PDFs (pdf.js) and HTML.
- `run.ts` — sweeps faculty profiles, keeps only planner-catalog courses in
  the target term, downloads and caches each syllabus's text.

## Collection and offline replay

Collection uses the network and is not a replay of the original labeled corpus:

```sh
bun --no-env-file tools/syllabus/run.ts \
  --profiles=tools/syllabus/data/profile-ids.txt --term="Fall 2026"
```

For offline evaluation, restore the original hash-bound text cache and run:

```sh
bun --no-env-file frontend/tests/syllabus/eval.ts
```

The current labels lack text hashes because the original cache was unavailable
at landing. Results are withdrawn. See `docs/research/syllabus/README.md` for the
hash-binding and regeneration steps. Never rebind a changed document to old labels.

The worksheet requires an explicit JSON array of readable cached text filenames:

```sh
bun --no-env-file tools/syllabus/make-worksheet.ts \
  --readable=/path/to/readable.json --output=/tmp/worksheet.txt
```

Each filename must be `<sha1(syllabusUrl)>.txt`. `--cache=<directory>` selects a
cache with `manifest.json` and a `text/` directory; the default is `.cache/` beside
these tools.

The fetcher cache lives in `.cache/` (gitignored): downloaded pages,
syllabi, extracted text, and `manifest.json` mapping every cached syllabus
to its source URL, faculty member, course, and section. Raw downloaded
content is never committed.

## Scoring

`frontend/tests/syllabus/eval.ts` scores the extractor against hand labels
in `docs/research/syllabus/labels.json` and prints per-fact precision,
recall, and F1 with each misclassification listed.
