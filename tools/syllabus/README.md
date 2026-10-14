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

## Reproducing

```sh
bun --no-env-file tools/syllabus/run.ts \
  --profiles=tools/syllabus/data/profile-ids.txt --term="Fall 2026"
cd frontend && bun --no-env-file tests/syllabus/eval.ts
```

The fetcher cache lives in `.cache/` (gitignored): downloaded pages,
syllabi, extracted text, and `manifest.json` mapping every cached syllabus
to its source URL, faculty member, course, and section. Raw downloaded
content is never committed.

## Scoring

`frontend/tests/syllabus/eval.ts` scores the extractor against hand labels
in `docs/research/syllabus/labels.json` and prints per-fact precision,
recall, and F1 with each misclassification listed.
