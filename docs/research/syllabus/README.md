# Syllabus fact extraction: hand-labeled evaluation

**Question.** Can deterministic rules find the three planning facts (attendance policy,
exam count, grading weights) in real UNT syllabi, reliably enough to use for course
planning?

**Date:** 2026-10-14 · **Branch:** `obv/syllabus-facts-study`

## Verdict

Rules alone are not sufficient.

| Fact | Precision | Recall | F1 | Verdict |
|---|---|---|---|---|
| Attendance policy | 37.0% | 100.0% | 54.0% | Over-triggers on boilerplate |
| Exam count | 54.5% | 63.2% | 58.5% | Polluted by schedule artifacts |
| Grading weights (doc level) | — | 0.0% | — | Never fires on real documents |

- **Attendance (recall 100%, precision 37%).** The extractor found an attendance
  sentence in every document where one exists, but it also fired in 29 documents with
  no real policy, almost always on university boilerplate: Survivor Advocates
  descriptions, UNT Policy 06.039 references, and "Attendance Policy: Visit the UNT
  Attendance Policy (link)" sentences. Policy presence is nearly free; knowing whether
  a *course-specific* policy exists requires suppressing boilerplate.
- **Exam count (P 54.5% / R 63.2%).** Two dominant failure modes, both confirmed in
  the misclassification list: schedule rows read as counts ("Week 16 Final Exam" → 16;
  "October 09, 2026 Midterm Exam" → 9), and percentage-weight lists read as counts
  ("20% Examination #1 …" → 15). Syllabi that state counts plainly ("There will be
  three exams in this course") are extracted correctly.
- **Grading weights (0 recall across all 36 labeled grading tables).** The extractor
  returned no weight block in *any* labeled document. Verified directly on GEOG 3010
  (`b4c71421`), whose text contains an explicit prose list — "Grades: The course grade
  will be based on the following components: mid-term examination – 25%; End-term
  examination – 25%; op-ed piece – 25%; participation in classroom discussions 10%;
  attendance – 15%" — and on ECON 4510 (`a1f7871a`, "Exam I 30% Exam II 30% Paper and
  discussion 15% Final Exam 25%"). Prose-form lists and PDF-flattened tables both
  evade the heading-anchored block detection. This is a genuine extractor failure, not
  an evaluation artifact.

## Method

1. **Corpus.** Fall 2026 sweep of 147 public UNT faculty profiles
   (`tools/syllabus/run.ts`): 125 syllabi collected, 71 readable as text (54
   unreadable binary/DOCX outputs were excluded from labeling rather than counted as
   negatives). Cached under `tools/syllabus/.cache/`.
2. **Labels.** Each readable document was reviewed and hand-labeled for the three
   facts. 50 documents were labeled; 6 readable documents were excluded because their
   grading tables could not be fully verified from flattened text (conservative
   exclusion, listed below). Labels: `labels.json`; each entry carries the fact plus a
   verbatim excerpt as evidence.
3. **Scoring.** `frontend/tests/syllabus/eval.ts` compares extractor output
   (`extractSyllabusFacts`) against labels: presence with content-word overlap on
   excerpts, exact count match, and component-level weight matching by name overlap
   and weight. Doc-level grading scoring marks a document correct only when the
   extracted component set matches the labeled set. Raw output:
   `eval-results.txt`.

### Caveats

- Labels were written with the extractor's output visible in the review worksheet
  (extract-then-label, not blind labeling), so label bias toward the extractor cannot
  be fully excluded. Mitigation: labels were written against the document text itself,
  including cases where the extractor was wrong (e.g. exam count 16 vs the labeled 2).
- 50 labeled entries include several distinct sections sharing one syllabus document
  (same text, different section); ~38 distinct documents underlie the 50 entries.
- Excluded (grading table not fully verifiable): `4cfca730`, `989ca9a6`, `6652c54c`,
  `82f7a47a`, `56dce29e`, `9e17c57f`.

## What would change the verdict

- **Weights:** heading-anchored block detection cannot see prose-form lists or
  flattened tables. Either a table-aware PDF extraction step or a model-assisted
  extraction pass is needed; the deterministic fallback should set "not available"
  rather than guess (current behavior — correct to keep).
- **Attendance:** boilerplate suppression (link/reference sentences, resource
  descriptions) would convert the 100% recall into usable precision without losing it.
- **Exam count:** excluding schedule-section sentences and percentage-context matches
  addresses both observed failure modes.

## Replay

```sh
bun --no-env-file tools/syllabus/run.ts          # rebuild cache (network)
bun --no-env-file tools/syllabus/build-labels.ts # assemble labels.json
bun --no-env-file frontend/tests/syllabus/eval.ts
```
