# REPAIR-LOCATIONS — catalog-consistency, run 2 (RULES_VERSION 2)

Audit: `node tools/catalog-consistency/audit.mjs --input frontend/src/lib/generated/seed-data.json --out tools/catalog-consistency/results`
Inputs bound: `input-receipt.json` (sha256 + byte size of the generated catalog, the majors source, the committed rule sources, all 29 `courses/*.json` corpus files with an aggregate digest `4633da9535decebe1c1a84e9485703ec6f58dbfaeca0ea601d9b9eb9ef7a1911`, and the section source `backend/data/compD.csv`), plus `report.json`, `unresolved-examples.json`, `results-manifest.json`.
Source commit audited: `24a798d053ebb76f2342fe298cd2c73effcfd283` (certification-run receipt `sourceCommit`). Backend submodule working tree at `0a49d4d863161c3b568f6aa6d3da4b4e68637a44` — bound by sha256/byte size throughout, and bound by commit pin in the regenerated receipt (F1, resolved below).

Verification of this run (all reproduced independently of `audit.mjs`, from the raw inputs, by a scratch script that imports nothing from the auditor):

- every `report.json` count, finding total, and provenance number recomputed from raw inputs — all match, zero discrepancies;
- five sections quoted end-to-end (compD row vs JSON meetings) — all agree (see "Spot checks");
- determinism: a second auditor run over the same inputs produced byte-identical outputs (sha256 of all four files equal before/after);
- `node --test tools/catalog-consistency/tests/*.test.mjs` → 23 pass, 0 fail;
- `cd frontend && bun x tsc --noEmit` → clean.

Verdict: the committed catalog is internally consistent apart from **6 unresolved major core-course references** (0 duplicate ids, 0 meeting-bound violations, 0 unresolved section→course / meeting→building / courseStatus→course references). 222 of 879 prerequisite edges point to 123 distinct codes outside the bundle, all classified `unknown` under the v2 evidence rules. Section provenance is fully bound: 2704/2704 bundle sections match the compD lattice and every section's meetings equal the compD day-pattern expansion exactly.

## Record counts (exact, both runs)

| Records | Total | Notes |
| --- | --- | --- |
| Buildings | 15 | ids unique (R1.3 total 0) |
| Courses | 656 | codes unique (R1.1 total 0) |
| Sections | 2704 | ids unique (R1.2 total 0) |
| Section meetings | 5984 | all bounds-checked (R3), 0 violations |
| Majors | 8 | 22 core-course references (R2.4), 6 unresolved |
| Course statuses | 656 | all keys resolve (R2.3 total 0) |
| Prerequisite edges | 879 | 657 internal, 222 external (R2.5/R4) |
| Corpus files | 29 | `courses/*.json`, digest-bound |
| compD rows | 2704 | exactly one row per (course_number, section_number) lattice key |

## R2. Unknown references — exact total 6 (all R2.4, majors)

R2.1 section→course: 2704 checked, 0 unresolved. R2.2 meeting→building: 5984 checked, 0 unresolved. R2.3 courseStatus→course: 656 checked, 0 unresolved. R2.4 major-core: 22 checked, **6 unresolved** — every one in `frontend/src/lib/seed-data.ts`:

| Major | Unresolved code | Line | Committed evidence |
| --- | --- | --- | --- |
| `busi` (Business) | `GOVT 2305` | 71 | `titleAnnotatedEquivalent`: bundle course `PSCI 2305` titled `US Political Behavior and Policy  (GOVT 2305)` (double space before the parenthetical); the corpus file `courses/unt_psci_courses.json` records the same title annotation |
| `psyc` (Psychology) | `HIST 2610` | 78 | none |
| `psyc` (Psychology) | `HIST 2620` | 78 | none |
| `psyc` (Psychology) | `GOVT 2305` | 78 | `titleAnnotatedEquivalent` (same `PSCI 2305` title) |
| `engl` (English) | `HIST 2610` | 85 | none |
| `engl` (English) | `HIST 2620` | 85 | none |

- **Repair location**: `frontend/src/lib/seed-data.ts:71` (`busi`), `frontend/src/lib/seed-data.ts:78` (`psyc`), `frontend/src/lib/seed-data.ts:85` (`engl`).
- **Nature of the repair decision**: for `GOVT 2305` the committed evidence supports repointing to `PSCI 2305` (title-annotated equivalent) — but the auditor records the string match, it does not relabel the reference as intentional; only the maintainer can pick the canonical code. For `HIST 2610` / `HIST 2620` there is no committed evidence either way: either add real course records to `courses/unt_hist_courses.json` (and regenerate the bundle) or repoint the majors to bundled courses. Neither can be resolved mechanically.
- **In-product consequence (recorded, not judged)**: `getMissingPrerequisites`/`getCoreCoursesForMajor` in `frontend/src/lib/planner.ts` silently drop unresolved core codes (`.filter(Boolean)`), so these majors under-report progress rather than erroring.

## R1 + R3. No duplicate ids, no contradictory meeting bounds — exact totals 0

- R1.1 duplicate `courses[].code`: 656 records / 656 distinct → 0. R1.2 duplicate `sections[].id`: 2704 / 2704 → 0. R1.3 duplicate `buildings[].id`: 15 / 15 → 0.
- R3 over 5984 meetings: malformed `HH:MM` times 0; `end <= start` 0; day outside the committed `weekDays` vocabulary 0. All meetings are zero-padded 24-hour strings and Mon–Fri only.

## R4. External prerequisites — 222 edges / 123 codes, all three categories exact

879 prerequisite edges total; 657 resolve inside the bundle; **222 edges point to 123 distinct codes with no bundled course record**. v2 classifies each distinct code by first matching committed evidence:

| Category | Codes | Edges |
| --- | --- | --- |
| `inSourceCorpus` (code in `courses/*.json`) | 0 | 0 |
| `titleAnnotatedInBundle` (parenthesized annotation in a bundle course/section title) | 0 | 0 |
| `unknown` (no committed evidence) | **123** | **222** |

Categories sum exactly to the external totals. Highest-edge unknown codes (full per-code detail in `report.json`; capped at 10 examples in `unresolved-examples.json`): `MATH 1830` (10 edges), `EENG 2711` (6), `BIOL 2042` (5), `EENG 2611` (5), `MEEN 2332` (5), `PHYS 3030` (5), `EENG 3811` (4), `ADVG 1100` (4), `CSCE 1015` (4), `CHEM 1430` (4). The `unknown` note is fixed by the rules: *"no committed evidence of external intent; consistent with the subset-catalog claim (README) but unverified per code — intent unresolved."* The README's subset claim is quoted as collection-level grounding only; v2 does not certify any of the 123 codes as intentional. External prerequisites are **not** counted in the 6 unknown references.

## R5. Section-source provenance — fully bound, 2704/2704 match

`backend/data/compD.csv` bound by sha256 (`c81759456a874fd0995a9a28d7b55775728e45781c84531872e05fa5e7ce2383`, 201156 bytes). Exact numbers, all reproduced independently:

| Metric | Value |
| --- | --- |
| compD data rows | 2704 |
| Bundle sections matched on (normalized course code, section number) | 2704 |
| Bundle sections unmatched | 0 |
| Meetings implied by the compD day-pattern expansion | 5984 |
| Sections whose meeting multiset equals the expansion exactly | 2704 |
| Sections disagreeing | 0 |
| Distinct building short codes in compD locations | 15 |
| …resolving to bundle building ids | 15 |
| Term/semester/session/year columns | none (`[]`) |

Times compare as exact 24-hour strings; day patterns expand `MWF`→Mon,Wed,Fri, `MW`→Mon,Wed, `TuTh`→Tue,Thu, `Th`→Thu, `T`→Tue, `M`/`W`/`F` to the single day. compD carries 656 distinct course numbers — the same 656 as the bundle; no compD course is missing from the bundle and no bundled course lacks compD rows.

### Generated-not-recorded assessment (verified against compD before writing)

The evidence for treating the section source as **generated rather than a real-term export**:

1. **656 courses each carrying sections 001 and 002.** All 656 compD course numbers carry a `001` row and a `002` row; none missing.
2. **Further section counts in equal pairs.** Every additional section number appears in equal-count pairs, exactly: 003:226 / 004:226, 005:118 / 006:118, 007:70 / 008:70, 009:49 / 010:49, 011:38 / 012:38, 013:28 / 014:28, 015:21 / 016:21, 017:15 / 018:15, 019:14 / 020:14, 021:14 / 022:14, 023:9 / 024:9, 025:8 / 026:8, 027:6 / 028:6, 029:5 / 030:5, 031–044: 4 each, 045–056: 3 each, 057–068: 2 each, 069–102: 1 each — for every consecutive odd/even pair the course counts are equal, and within each course the extra sections always form consecutive pairs (003&004, 005&006, …). Real registration lattices show cancelled/odd-numbered sections; this one never does.
3. **26 distinct (start, end) time pairs** across all 2704 rows — a small closed set of slot templates, not organic scheduling.
4. **No term/semester/session/year column.** Header: `course_number, section_number, professor, start_time, end_time, days, location`.

Consequence for repair: the section lattice, meetings, professors, and locations are generator output (the generator itself is not committed under `scripts/`); the section source is synthetic and carries no term identity. Any repair of section data belongs in the generator, not in the committed bundle — and this audit documents the defect rather than repairing it (R5: reported, never repaired).

## Tool defects found while certifying (reported, not repaired in this commit)

These are findings about the audit tooling discovered by this run; none changes the data numbers above.

- **F1 — receipt records a `null` submodule pin although the submodule is initialized.** `audit.mjs` extracted the pin with `/^040000 commit ([0-9a-f]{40})\tbackend$/m` over `git ls-tree HEAD backend`, but git records submodule entries with mode `160000`, so the regex never matched and the certification-run receipt carried `submodulePins: [{path: "backend", commit: null}]`. The actual pin at audit time is `0a49d4d863161c3b568f6aa6d3da4b4e68637a44`. Provenance was otherwise sound: `backend/data/compD.csv` is bound by sha256/byte size regardless. **Resolved** in the follow-up commit on this branch: pin extraction is now the exported `submodulePinFromLsTree`, matching the gitlink mode git actually emits (`160000`) and never a tree entry (`040000`), covered by unit tests; the regenerated `input-receipt.json` binds the pin and `results-manifest.json` rebinds the receipt bytes.
- **F2 — `verify.mjs` is documented but not committed.** `RULES.md` (§ "Input binding and verification (method)") and `README.md` name `tools/catalog-consistency/verify.mjs` as "the only supported replay path", but no such file exists in the tree — the documented verification command cannot run. This certification used an independent scratch re-derivation from the raw inputs instead (all totals matched); the repo should either commit the verifier or drop the claim. Repair location: `tools/catalog-consistency/verify.mjs` (create) or the `RULES.md`/`README.md` references.
- **F3 — stale v1 artifact removed.** `results/replay.json` (the v1 `--replay` output, `replayVersion: 1`) was still tracked from run 1. v2 retires `--replay` and does not write that file; it is removed in this commit so the results directory contains exactly what the v2 run produced.

## Determinism of this run

Two auditor runs over identical inputs produced byte-identical outputs (sha256, all four files; the hashes below record the certification run at `24a798d` — the regenerated results after the F1 pin fix were re-proven byte-stable the same way, and the final committed hashes are self-documented in `results-manifest.json`):

| File | sha256 (run 1 = run 2) |
| --- | --- |
| `input-receipt.json` | `2df532d8c018d009b0970d85984954d7f870101c17c0f0c099d182b115fb0574` |
| `report.json` | `6e8499df38991f746e95c0735e12ebaa6ea8d869982dc520d192a63a55fedc56` |
| `unresolved-examples.json` | `7a1b012f65bed31505bdb195395f6825be028af163553aeddfbfdd00f70b3cc2` |
| `results-manifest.json` | `8b57c294dc5218e13fe366806276db4831349968250eeb43de00c3706130369a` |

`results-manifest.json` binds the sha256 of the three evidence files; re-hashing the stored bytes reproduces the manifest exactly.

## Spot checks (five sections, compD row next to the committed JSON)

All five agree end-to-end — lattice match, day-pattern expansion, exact time strings, building short code → bundle id:

1. `anth-1010-001` — compD: `ANTH1010,001,"Jamie K. Johnson",16:00,16:50,MWF,"Life Sciences Complex (LIFE) 291"`; JSON meetings: Mon/Wed/Fri 16:00–16:50 @ `life` (3 meetings, equal multisets).
2. `anth-1150-001` — compD: `ANTH1150,001,"Melissa A. Nelson",14:30,15:50,MW,"Chemistry Building (CHEM) 116"`; JSON meetings: Mon/Wed 14:30–15:50 @ `chem` (2 meetings).
3. `anth-2300-002` — compD: `ANTH2300,002,"Jara M. Carrington",09:30,10:50,TuTh,"General Academic Building (GAB) 403"`; JSON meetings: Tue/Thu 09:30–10:50 @ `gab` (2 meetings).
4. `anth-3110-004` — compD: `ANTH3110,004,"Kimberly T. Wren",12:00,14:50,Th,"Hickory Hall (HICK) 242"`; JSON meetings: Thu 12:00–14:50 @ `hick` (1 meeting).
5. `anth-3110-001` — compD: `ANTH3110,001,"Kelsey Lee",11:00,13:50,T,"Auditorium Building (AUD) 215"`; JSON meetings: Tue 11:00–13:50 @ `aud` (1 meeting).

## Out of scope (unchanged from run 1)

Cross-field coherence (a major whose core course belongs to another department), section counts per course as a product decision, schedule conflicts/feasibility, room validity, professor workloads, catalog completeness against any external catalog. The schedule oracle lives in `docs/schedule-oracle-report.md`; this audit is not another oracle.
