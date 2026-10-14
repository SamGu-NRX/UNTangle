# Encoding notes: 2026-2027 degree plans

Every place the 15 plan files under `frontend/src/lib/pathing/plans/` deviate
from a verbatim transcription of their catalog pages, and why. The research
basis and shared-requirement decisions are in `research-report.md` here.

## How to read the plans

- Group kinds mirror the CS plan: `all` (fixed list), `choose` (pick N from a
  list), `hours` (any courses to an hour total), `choice` (named alternative
  branches), `pool` (a rule-defined list, e.g. by level or department).
- Heading hours are verbatim from the page ("Professional field in accounting,
  28 hours"). Choose-N language is quoted from the page's own sentences.
- GPA floors, C-or-better rules, residency, and advanced-hour minimums live in
  `notChecked` — the engine does not enforce them.
- Prerequisites appear only where the catalog prints them in the requirement
  context (for example, PSYC 2317 requires MATH 1680).

## Single-ownership rule and trims

The validator rejects a course assigned to two requirements in one plan. When
a major requires a course that is also an option in a shared list (UCC, CLASS
distribution, BBA communication), the course keeps the owner the major page
states — the major group — and the shared list is trimmed. This is a modeling
limitation, not a catalog claim: the catalog may allow one course to satisfy
two groups at once. Each plan's `notChecked` carries a note pointing here.

Purely optional overlaps were left alone — a student picks one owner, and the
plan does not presume it.

### Every applied trim

Generated from the build script's authoritative trim record (plan, shared
list, course code).


| Plan | Shared list | Trimmed courses |
|---|---|---|
| accounting | UCC Component Area Option B | COMM 1010 |
| accounting | UCC Communication (sub-group 1) | ENGL 1310 |
| accounting | UCC Communication (sub-group 2) | ENGL 1320, TECM 2700 |
| accounting | UCC Mathematics | DSCI 2710, MATH 1190, MATH 1710 |
| accounting | UCC Social and Behavioral Sciences | ECON 1100, ECON 1110 |
| biology | UCC Life and Physical Sciences | BIOL 1710, BIOL 1711, BIOL 1720, BIOL 1722, CHEM 1410, CHEM 1412, CHEM 1413, CHEM 1420, CHEM 1422, CHEM 1423, PHYS 1410, PHYS 1420, PHYS 1510, PHYS 1520 |
| biology | UCC Mathematics | MATH 1650, MATH 1710, MATH 1810 |
| communication studies | CLASS distribution | ANTH 3140, ANTH 3210, ANTH 3400, ANTH 3700, COMM 3320, COMM 3620, COMM 4260, COMM 4545, COMM 4640, PHIL 4150, THEA 3040, ANTH 3110, ANTH 3300, COMM 3420, COMM 3720, COMM 3820, COMM 4240, COMM 4320, PHIL 4200 |
| communication studies | UCC Creative Arts | COMM 2060 |
| communication studies | UCC Component Area Option A | COMM 2140 |
| communication studies | UCC Component Area Option B | COMM 1010, COMM 1440 |
| communication studies | UCC Communication (sub-group 1) | ENGL 1310 |
| communication studies | UCC Communication (sub-group 2) | ENGL 1320, TECM 2700 |
| communication studies | UCC Social and Behavioral Sciences | COMM 2020 |
| computer engineering | UCC Component Area Option A | MATH 1720 |
| computer engineering | UCC Component Area Option B | CSCE 1010 |
| computer engineering | UCC Communication (sub-group 2) | TECM 2700 |
| computer engineering | UCC Life and Physical Sciences | CHEM 1410, PHYS 1710, PHYS 2220 |
| computer engineering | UCC Mathematics | MATH 1710, MATH 1810 |
| criminal justice | UCC Communication (sub-group 2) | TECM 2700 |
| criminal justice | UCC Mathematics | MATH 1680 |
| criminal justice | UCC Social and Behavioral Sciences | CJUS 2100, PSYC 1630 |
| electrical engineering | UCC Component Area Option A | MATH 1720 |
| electrical engineering | UCC Communication (sub-group 2) | TECM 2700 |
| electrical engineering | UCC Life and Physical Sciences | CHEM 1410, PHYS 1710, PHYS 2220 |
| electrical engineering | UCC Mathematics | MATH 1710, MATH 1810 |
| english | UCC Communication (sub-group 1) | ENGL 1310 |
| english | UCC Communication (sub-group 2) | ENGL 1320 |
| english | UCC Language, Philosophy and Culture | ENGL 2321, ENGL 2326, ENGL 2331, ENGL 2341, ENGL 2351, ENGL 3450 |
| finance | UCC Component Area Option A | MATH 1720 |
| finance | UCC Component Area Option B | COMM 1010 |
| finance | UCC Communication (sub-group 1) | ENGL 1310 |
| finance | UCC Communication (sub-group 2) | ENGL 1320, TECM 2700 |
| finance | UCC Mathematics | DSCI 2710, MATH 1190, MATH 1710 |
| finance | UCC Social and Behavioral Sciences | ECON 1100, ECON 1110 |
| integrative studies | CLASS distribution | ANTH 3140, ANTH 3210, ANTH 3400, ANTH 3700, PHIL 4150, THEA 3040, ANTH 3110, ANTH 3300, PHIL 4200 |
| kinesiology | UCC Component Area Option B | PHED 1000 |
| kinesiology | UCC Language, Philosophy and Culture | KINE 2050 |
| kinesiology | UCC Life and Physical Sciences | BIOL 2301, BIOL 2302 |
| kinesiology | UCC Mathematics | MATH 1680 |
| kinesiology | UCC Social and Behavioral Sciences | HLTH 2200 |
| management | UCC Component Area Option A | MATH 1720 |
| management | UCC Component Area Option B | COMM 1010 |
| management | UCC Communication (sub-group 1) | ENGL 1310 |
| management | UCC Communication (sub-group 2) | ENGL 1320, TECM 2700 |
| management | UCC Mathematics | DSCI 2710, MATH 1190, MATH 1710 |
| management | UCC Social and Behavioral Sciences | ECON 1100, ECON 1110 |
| marketing | UCC Component Area Option A | MATH 1720 |
| marketing | UCC Component Area Option B | COMM 1010 |
| marketing | UCC Communication (sub-group 1) | ENGL 1310 |
| marketing | UCC Communication (sub-group 2) | ENGL 1320, TECM 2700 |
| marketing | UCC Mathematics | DSCI 2710, MATH 1190, MATH 1710 |
| marketing | UCC Social and Behavioral Sciences | ECON 1100, ECON 1110 |
| mechanical energy | UCC Component Area Option A | MATH 1720 |
| mechanical energy | UCC Communication (sub-group 2) | TECM 2700 |
| mechanical energy | UCC Life and Physical Sciences | CHEM 1410, PHYS 1710, PHYS 2220 |
| mechanical energy | UCC Mathematics | MATH 1710, MATH 1810 |
| psychology | UCC Mathematics | MATH 1680 |
| psychology | UCC Social and Behavioral Sciences | PSYC 1630 |
| supply chain | UCC Component Area Option B | COMM 1010 |
| supply chain | UCC Communication (sub-group 2) | TECM 2700 |
| supply chain | UCC Mathematics | DSCI 2710, MATH 1190, MATH 1710 |
| supply chain | UCC Social and Behavioral Sciences | ECON 1100, ECON 1110 |

## Per-major irregularities

### accounting-bba

- **Ambiguous "Approved elective, 3 hours" block.** The page's professional
  field ends with an "Approved elective, 3 hours" line whose list contains
  exactly one course (ACCT 4200) after an "or". Encoded exactly what the page
  states: a 3-hour requirement whose only listed option is ACCT 4200. If UNT
  intended a wider approved list, the page does not say so — widening it would
  be invention.
- The Ryan College degree-requirements page is linked from the major page, but
  it is prose policy (tiered progression, GPA standards) with no course
  groups; its rules are carried in `notChecked` rather than as requirement
  groups.

### psychology-bs

- **Category lists exist only in the page-text layer.** The five category
  course lists (18 hours across social, developmental, cognitive/neuroscience,
  clinical/applied, and elective categories) render outside the standard
  catalog container and appear only in the extracted page text; they are
  transcribed from there. Spot-checked against the page-text fallback.
- **MATH 1680-or-approved-substitution.** The quantitative requirement reads
  "MATH 1680 or an approved substitute"; encoded as the literal course with
  the substitution rule quoted in the group description. PSYC 2317's printed
  prerequisite of MATH 1680 is preserved.

### integrative-studies-ba

- **Individualized major.** Three student-chosen fields, 12 hours each (at
  least 6 advanced), are encoded as three untracked pools — no invented course
  lists. Each pool's description carries the catalog's rule that the fields
  are chosen with an advisor/counselor approval. The catalog's own four-year
  plan table shows "Major Field" placeholders, confirming the individualized
  reading.
- CLASS distribution overlaps with UCC options are resolved in UCC's favor:
  the CLASS lists are trimmed of courses a student would already claim under
  UCC (see the trim table).

### communication-studies-ba

- **Methods/Theory reuse rule.** The catalog says Methods/Theory courses that
  also appear in a distribution group may count toward the 6-hour
  Methods/Theory requirement, and after it is completed additional courses
  from that list may satisfy the distribution groups. Encoding that conditional
  reuse without duplicate listings is impossible under the validator, so the
  Methods/Theory list owns its courses and the distribution groups are trimmed
  of them (see the trim table). The conditional rule is quoted in the group
  description; advisors may approve the reuse the engine cannot express.
- COMM 3260 and COMM 3840 are assigned to their initial requirements rather
  than duplicated in distribution groups B and C.
- **No foreign-language group — the catalog exempts this major.** The CLASS
  distribution page states: "Majors in Communication Studies, Content
  Strategy, Converged Broadcast Media, Media Arts and Theatre are not required
  to complete the Foreign Language requirement." The CLASS distribution groups
  are encoded; the foreign-language requirement is not (it would contradict
  the source), and the exemption sentence is carried in the plan's
  `notChecked`.

### english-ba-literature

- **Category overlaps.** Courses listed across the six category groups and
  already-used survey/author courses are single-owned: earlier requirements
  (surveys, author courses) keep their courses and later category lists are
  trimmed of them.
- The additional 4000-level course requirement cannot be represented as a
  tracked pool without duplicating options already owned by category groups;
  it is carried as an untracked `hours` group with the catalog wording, and
  the limitation is noted in its description.

### biology-bsbio

- **Advanced-elective exclusivity.** The catalog states courses used for other
  requirements cannot also count toward the advanced biology electives. The
  foundation biology/chemistry, physics, and math courses the major requires
  are owned by their major groups and trimmed from the UCC science and math
  option lists (see the trim table).
- The College of Science degree-requirements page is linked from the major
  page and its checkable course groups are encoded; its GPA/progression prose
  is in `notChecked`.

### kinesiology-bs

- Anatomy-and-physiology structure resolved from the page-text fallback: HLTH
  2200 plus KINE 2105, or the BIOL 2301/2311 and BIOL 2302/2312 sequence,
  encoded as a choice.
- Interest-area courses are a level-rule pool (KINE 3000+), not a fixed list.
- The major page links a `catoid=32` catalog page — an archived catalog
  reference; skipped as stale per the research report.

### criminal-justice-bs

- The catalog gives a 33-hour criminal-justice total without stating an
  elective-level rule for the remaining hours; the elective pool is encoded as
  an untracked hours group with an advisor-confirmation note rather than an
  invented level rule.
- PSYC 1630, TECM 2700, and MATH 1680 are required supporting courses; TECM
  2700 and MATH 1680 are trimmed from UCC options, PSYC 1630 from UCC Social
  and Behavioral Sciences.

### BBA majors (accounting, finance, management, marketing)

- **BBA communication owns its courses.** Combination A (ENGL 1310, ENGL 1320
  or TECM 2700, COMM 1010) and Combination B (ENGL 1310, ENGL 1320, TECM
  2700) are encoded as a choice owned by the BBA communication group; the UCC
  communication option lists are trimmed of ENGL 1310/1320 and TECM 2700
  (they were sub-groups of UCC communication), and COMM 1010 is trimmed from
  UCC Component Area Option B.
- Pre-business, business foundation, professional development, and the
  international requirement are owned by each BBA plan (pre-business overlaps
  with UCC mathematics are trimmed from UCC: DSCI 2710, MATH 1190, MATH 1710;
  ECON 1100/1110 are trimmed from UCC Social and Behavioral Sciences).
- MATH 1720 appears as the Component Area Option A entry for the BBA plans
  (calculus for business contexts); it is trimmed from UCC CAO A where the
  BBA block owns it.

### management-bba

- Locally the plan holds only the professional field (18 hours) and the
  supporting field (12 hours); everything else lives on the BBA page.
- **Supporting field is a level-rule pool.** "Select 4 courses from MGMT 3000
  and 4000-level courses" with a recommended list — encoded as a pool matching
  MGMT 3000/4000-level, with the recommended courses quoted in the
  description. Not a fixed list.

### supply-chain-bs

- The BS (not BBA) page carries its own pre-business and business-foundation
  structure, five concentration alternatives with concentration-specific
  internship and capstone courses, a professional-field elective pool, and
  professional-development alternatives; encoded per that page.
- UCC overlaps (TECM 2700, DSCI 2710, MATH 1190/1710, ECON 1100/1110, COMM
  1010) are trimmed from UCC per the table.

### mechanical-energy-bs, computer-engineering-bs, electrical-engineering-bs

- Some option groups link to course-detail pages; the resolved course lists
  come from the research digests of those pages.
- **Mechanical energy's calculus wording is ambiguous.** The "Other required
  courses: calculus" block nests OR/AND structure (MATH 1710 and 1720, or the
  1810/1820/1830 sequence); the encoding preserves the page's literal nested
  structure as a choice between the two sequences, and the four-year-plan
  context is noted in the group description. Both sequences' first courses
  are trimmed from UCC mathematics where the major owns them.
- **Electrical engineering's math substitution** (the MATH 1810/1820/1830
  sequence may substitute for MATH 1710/1720) is encoded as a choice with the
  substitution quoted; MATH 1710/1810 are trimmed from UCC mathematics.
- **Optional certificates are not encoded** — they are optional credentials,
  not degree requirements.
- The engineering majors' college requirements pages are named in prose on the
  major pages but NOT hyperlinked; per the encoding rule they are skipped.
  TECM 2700, CHEM 1410, PHYS 1710/2220, and CSCE 1010/1030 where required are
  trimmed from UCC lists per the table.

## What the engine cannot express

Recorded in `notChecked` per plan rather than approximated: GPA floors,
C-or-better grade rules, residency and advanced-hour minimums, advisor
approvals (approved substitutes, counselor-approved fields), and conditional
reuse rules (communication studies' Methods/Theory; english's extra 4000-level
course).


## Round-1 review corrections (2026-10-14)

Greptile's review of PR #86 found real defects in the first encoding pass; each is
fixed in the follow-up commit and recorded here.

- **BBA communication combinations were missing entirely.** The four BBA plans
  trimmed ENGL 1310, COMM 1010, ENGL 1320, and TECM 2700 from their UCC lists for
  single ownership, but the BBA page's owning block — "Communication requirements,
  9 hours" with Combination A (ENGL 1310; ENGL 1320 or TECM 2700; COMM 1010) or
  Combination B (ENGL 1310; ENGL 1320; TECM 2700) — was never emitted. Each BBA
  plan now carries that block as a choice named "BBA communication requirements,
  9 hours" with the page's two named branches.
- **Accounting's international course was encoded as a 9-hour all-group.** The
  accounting page reads "International business course, 3 hours — Choose one from
  the following" (BCIS 4730, FINA 4500, MGMT 4660, MKTG 4280); it is now a
  choose-one. The BBA-wide page adds SENM 4230 for sport-industry majors, which
  the accounting page does not list; the four-course major-page list is encoded.
- **Five level pools now stay advisor-checked instead of matching one band.** A
  pool's pattern matches a single 1000-band, so a 3000-match silently omits every
  eligible 4000-level course. The rules span two bands on their pages: management
  ("MGMT 3000 and 4000-level courses"), marketing ("3000- or 4000-level marketing
  courses"), kinesiology ("KINE 3000/4000-level"), and communication studies' two
  additional-requirement pools (12-hour and 6-hour). All five dropped their
  `match` and rely on advisor confirmation.
- **Government pairing rule rejected.** The review proposed modeling government
  as pairs (2305+2306, 2315+2316). The UCC page's instruction is "choose two
  courses from the following list" with no pairing language, so the two-of-four
  selection stands as transcribed.
- **Tests read the plans' own targets.** The 42-hour test now derives hour targets
  from each plan's data — selection counts for the nine areas and each Component
  Area Option branch's own hour requirements — instead of comparing against
  test-only constants, and new tests run the engine's analysis over completed
  courses to confirm the BBA communication choice and accounting's international
  one-of evaluate correctly.
