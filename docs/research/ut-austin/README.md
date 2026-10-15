# UT Austin: public sources, access rules, and the first real campus adapter

This document surveys UT Austin's public academic sources so UNTangle can add a second
institution after UNT. Per source: what we can get, how, the policy evidence, and what the
adapter must handle differently from UNT. It ends with a build plan in order. Every claim
carries the URL it came from; claims checked live in this session are dated October 15, 2026,
and claims carried from the earlier registration-platform survey are dated October 13, 2026,
as that document records.

Method: web research against official UT Austin pages, plus direct HTTP checks from this
repo's sandbox (single unauthenticated requests, a descriptive agent string, seconds between
requests, no login, no CAPTCHA or access-control bypass). The three catalog pages captured as
fixtures are recorded with their URLs and capture date in
`packages/ingest/tests/fixtures/ut-austin/SOURCES.md`.

## 1. Course catalog (catalog.utexas.edu)

What it is: the official catalog publication, organized by catalog year, with colleges,
degree programs, academic policies and course listings. The current undergraduate edition is
the 2026-2028 catalog at https://catalog.utexas.edu/undergraduate/ and past editions are
archived, for example https://catalog.utexas.edu/archive/2025-26/undergraduate/.

What we can get: one static HTML page per field of study under
https://catalog.utexas.edu/courses/, for example
https://catalog.utexas.edu/courses/c-s/ ("Computer Science (C S)"),
https://catalog.utexas.edu/courses/m/ (Mathematics) and
https://catalog.utexas.edu/courses/phy/ (Physics). Each course is a Courseleaf
`div.courseblock` carrying: the code (`detail-ut_code`, as in "C S 301K"), the title
(`detail-title`), the credit hours (`detail-hours_html`, "3 Hours" or a range like
"1-4 Hours"), lecture and lab contact hours, a description (`courseblockextra`), and labeled
detail spans: prerequisites or corequisites (`detail-prereq`), restrictions
(`detail-restrictions`), the Texas core component code (`detail-utexas_core`, "Core
Curriculum: 093"), same-as notes (`detail-utexas_sameas`), TCCN equivalents
(`detail-utexas_tccn`), grading basis (`detail-utexas_grade_mode`), repeatability
(`detail-utexas_repeatable`) and academic level (`detail-acad_level`). All three example
pages above returned HTTP 200 unauthenticated when checked on October 15, 2026.

How we get it: plain server-side HTTP GET. No authentication, no JavaScript rendering, no
API key. The first captures are saved fixtures under
`packages/ingest/tests/fixtures/ut-austin/catalog/`, and
`packages/ingest/src/ut-austin/catalog.ts` parses the saved copies. The reviewed source
policy `catalog-utexas` in `packages/ingest/src/source-policies.ts` permits fetching only
URLs under `https://catalog.utexas.edu/courses/`, at least three seconds apart, one at a
time.

Policy evidence: the course pages are public and unauthenticated. The host published no
robots.txt when checked on October 15, 2026 (https://catalog.utexas.edu/robots.txt returned
the site's 404 page, observed live that day; the university-wide file at
https://www.utexas.edu/robots.txt governs www.utexas.edu, not the catalog host). No terms
page governs the course pages themselves, so the policy's `policyEvidenceUrl` is null and
pacing is self-imposed. Catalog text remains UT Austin's publication, so the policy marks
redistribution unverified and releases built from it should be served only through
`/api/v1`, the same treatment the architecture README gives the VSB mirror
(docs/architecture/README.md, "Reference data: published releases").

Flags: the Skills and Experience flags (Writing, Quantitative Reasoning, Global Cultures,
Cultural Diversity in the United States, Ethics and Leadership, Independent Inquiry) were a
longstanding UT general-education mechanism, described in archived catalog material such as
https://catalog.utexas.edu/archive/2012-13/undergraduate/undergraduate-studies/academic-policies-and-procedures/.
The archived 2025-26 general education page states, under a dagger note: "Effective April
2025, UT Austin no longer requires Skills and Experience flags"
(https://catalog.utexas.edu/archive/2025-26/undergraduate/the-university/general-education-requirements/,
retrieved October 15, 2026). The current catalog's general education page
(https://catalog.utexas.edu/undergraduate/general-education/) carries no flag requirement at
all, and none of the three captured course pages contains a flag field; the word "Writing"
appears in them only inside course titles and descriptions, checked October 15, 2026. The
adapter's record type keeps a `flags` field so archived captures parse into the same shape,
and it stays empty for current-catalog captures.

## 2. The registrar's Course Schedule, and what needs a UT EID

What it is: the registrar's per-semester listing of what is actually being offered,
published before advising and registration begin each term
(https://registrar.utexas.edu/schedules, retrieved October 15, 2026). The catalog answers
"what is this course"; the Course Schedule answers "which sections run this term, when and
where" (the distinction the registrar's own using-the-schedule page draws,
https://registrar.utexas.edu/schedules/269/using, retrieved October 15, 2026).

What is public: the schedule's class listings, arranged by field of study, include the
course number, title, unique number, meeting times and locations, instructor when assigned,
instruction mode, credit value, and registration notes; the registrar's glossary page
defines these fields (https://registrar.utexas.edu/schedules/262/terms, retrieved October
15, 2026). Older schedule front-matter pages also show the schedule was designed to work
with a free guest EID (https://registrar.utexas.edu/schedules/222/print/front).

What needs a UT EID: the interactive Course Schedule application on UT Direct redirects to
SAML sign-on; the earlier probe of
https://utdirect.utexas.edu/apps/registrar/course_schedule/20269 observed HTTP 302 to the
enterprise.login.utexas.edu sign-in on October 13, 2026
(docs/research/registration-platforms/registration-platform-survey.md, source [S31]). Guest
EIDs are free, so the interactive app is reachable to non-students, but only in a browser
with an EID session, which places it under the architecture's `browser-capture` acquisition,
never server fetch. Registration transactions, waitlist management and personal records are
EID-only by definition (https://registrar.utexas.edu/schedules/262/terms;
https://registrar.utexas.edu/schedules/269/using).

How the adapter should treat it: catalog pages are the server-fetchable source (course
identity, hours, prerequisites, core codes). Section-level data is a browser-capture
surface, matching the survey's classification of UT Austin as a custom public schedule with
a partially public front end
(docs/research/registration-platforms/platform-comparison.md, "Custom public class-search
applications").

## 3. Grade distributions

What we can get: course-level grade distributions, published by Institutional Reporting as
the UT Course Grade Distributions dashboard, in bar-graph and crosstab forms
(https://reports.utexas.edu/spotlight-data/ut-course-grade-distributions, retrieved October
15, 2026).

Known limits, from the registrar's grade-reporting pages and the dashboard itself: data is
published only after the semester closes and passes validation; public summaries cover fall
and spring; courses are omitted where disclosure could compromise student confidentiality,
for example small sections (https://registrar.utexas.edu/faculty/grades;
https://reports.utexas.edu/spotlight-data/ut-course-grade-distributions). Institutional
Reporting generally provides aggregate summaries rather than row-level data
(https://reports.utexas.edu/content/faqs).

How we get it: link-only plus curated for now. The dashboard is an interactive product, not
a documented bulk download, so the adapter treats grade evidence for UT Austin as a link
from a course to the dashboard rather than a parsed dataset, until a stable export surface
is verified. This mirrors how the UNT adapter links out where no structured source exists.

## 4. The academic calendar

The registrar publishes the academic calendar with semester dates, registration periods and
deadlines at https://registrar.utexas.edu/calendar (HTTP 200, retrieved October 15, 2026),
and each term's schedule site carries its own dates, for example the Spring 2026 schedule
pages under https://registrar.utexas.edu/schedules/262/terms. The adapter's `terms`
capability can be fed from these pages, but they are human-readable HTML with no public API,
so the first pass is curated: a reviewed term table with source URLs, like the UNT term
data, rather than a scraped page.

## 5. Degree requirements: core curriculum and BS Computer Science

Core curriculum: all UT Austin undergraduates complete the 42-hour statewide Texas Core
Curriculum, in component areas of First-Year Signature Course (3), Communication (6),
Humanities (3), American and Texas Government (6), U.S. History (6), Social and Behavioral
Sciences (3), Mathematics (3), Natural Science and Technology Part I (6) and Part II (3),
and Visual and Performing Arts (3)
(https://catalog.utexas.edu/undergraduate/general-education/, retrieved October 15, 2026;
the same table appears in the archived 2025-26 edition,
https://catalog.utexas.edu/archive/2025-26/undergraduate/the-university/general-education-requirements/).
Core courses must be taken for a letter grade, and a single course may not count toward more
than one core component area (same page). Each courseblock that fills a core area carries
the component code in `detail-utexas_core`, as "Core Curriculum: 093" observed in the
captured C S page (October 15, 2026). The statewide component codes are defined in the
core curriculum section of the General Information catalog,
https://catalog.utexas.edu/general-information/academic-policies-and-procedures/core-curriculum/.

BS Computer Science: the degree requirements live in the undergraduate catalog under the
Computer Science, Computer Science Option, BSCompSci program page,
https://catalog.utexas.edu/undergraduate/programs/computer-science-computer-science-option-bscompsci/
(HTTP 200, retrieved October 15, 2026), with honors variants at
https://catalog.utexas.edu/undergraduate/programs/computer-science-computer-science-honors-option-bscompsci/
and https://catalog.utexas.edu/undergraduate/programs/computer-science-turing-scholars-honors-option-bscompsci/.
The program page carries the requirement blocks (core curriculum, major requirements,
electives, upper-division minimums) in the same Courseleaf HTML the degree-plan pipeline
already parses for UNT
(packages/ingest/src/degree/, per the repo's degree-plan work).

Difference from UNT: UNT degree plans were encoded from catalog.unt.edu pages with UNT's own
core component areas; UT's core adds areas UNT's core does not have in the same form,
notably the First-Year Signature Course and six hours each of American and Texas Government
and U.S. History, and UT marks core membership on course pages with statewide component
codes. The degree-plan validator needs UT's component table and its own approved-course
lists; nothing about the tree format changes.

## 6. Campus buildings

The UT Austin campus data already in the repo: 32 buildings in
`frontend/src/lib/campus/data/ut-austin/catalogue.json` with OSM-derived ids, names and
coordinates (Perry-Castaneda Library, Main Building, McCombs School of Business and others),
plus `campus-map.json`, `walking-times.json` and `verification.json` in the same directory.
These came from OpenStreetMap and follow the same shape as the UNT Denton files under
`frontend/src/lib/campus/data/unt/`. The adapter's `map` capability can point at these files
as-is; what is missing compared to UNT is building code abbreviations (UT uses codes like
"GDC" for the Gates Dell Complex in schedule locations), so a curated code-to-building table
is a later task, sourced from the registrar's building codes list.

## 7. Registration: unique numbers, waitlists, and how UT differs from myUNT

Unique numbers: UT identifies each scheduled section for registration by a five-digit unique
number, distinct from the course number; students register by unique number, and one catalog
course has many unique numbers per term
(https://registrar.utexas.edu/schedules/262/terms, retrieved October 15, 2026). UNT uses
CRNs inside PeopleSoft Campus Solutions, which myUNT exposes
(UNT's PeopleSoft Campus Solutions label is verified from the official UNT Enterprise
Systems page, https://enterprisesystems.unt.edu/index.html, per
docs/research/registration-platforms/registration-platform-survey.md source [S20]). Both
systems register per section with a section number, but UT's unique numbers are the
registrar's published identity across the schedule, grade distributions and registration,
while UNT's CRNs live inside the myUNT search. The adapter must therefore carry
`uniqueNumber` on UT section records as a first-class field and join grade evidence on it,
where UNT joins on CRN.

Registration system: UT Austin's student-facing registration runs on UT Direct with UT
EIDs, and public documentation does not name a vendor SIS; the earlier survey classifies the
public front end as a custom in-house application with the interactive Course Schedule
behind an EID gate
(docs/research/registration-platforms/registration-platform-survey.md, section 2). The
adapter's `registration` metadata should therefore say system `custom`, portalName "UT
Direct (MyUT)", not PeopleSoft. UNT is a verified PeopleSoft Campus Solutions school, so
UNTangle's existing myUNT assumptions do not transfer.

Waitlists: UT's automated waitlists are department-activated; a student must already be
registered in at least one class to join; a student may hold up to two waitlists for the
same course and four active waitlists in total; seats offered from a list are processed
first-come, first-served and can be skipped for time conflicts, maximum-hours violations or
duplicates; a waitlist never guarantees a seat; and automated waitlists run from the start
of registration through an early-semester deadline (the registrar's waitlist page,
https://registrar.utexas.edu/staff/waitlists, retrieved October 15, 2026; the Law school
states its own fourth-class-day end, https://law.utexas.edu/students/registration-planning/registration-adds-and-drops/waitlist-information-policies/).
myUNT waitlists behave differently in the details UNTangle models today (UNT caps and
deadlines differ), so waitlist modeling must live behind the campus adapter, not in shared
core logic.

Maximum hours: UT's published registration limits are 17 hours for undergraduates in
fall/spring and 14 in summer (graduate 15/12, Law 16), published in the schedule glossary
(https://registrar.utexas.edu/schedules/262/terms, retrieved October 15, 2026). The
credit-load policy capability needs these numbers as UT Austin data, sourced and dated, the
way PR #63 did for UNT's thresholds.

## What the adapter must handle differently from UNT

- Institution and campus ids: `ut-austin` with one campus site (`ut-austin-austin`) for
  now; UNT has Denton and Frisco sharing a registration system.
- Codes: UT codes carry a spaced abbreviation ("C S 301K") and topic blocks grant credit
  under several codes at once ("M 175T, 275T, 375T, 475T"); the parser expands them onto one
  record. UNT codes never repeat an abbreviation across a block.
- Prerequisites: UT prints one merged "Pre/Corequisites" field per block in the current
  catalog; the parser keeps the label and text. The UNT prereq grammar parser
  (frontend/src/lib/prereq/) must accept UT's sentence forms before shared logic can run.
- Flags: none in the current catalog, retired April 2025 (evidence in section 1); UNT's
  planner has no equivalent either, so the field is carried but empty.
- Core: UT's 42-hour Texas core with First-Year Signature Course, Government and History
  areas, marked on courses with statewide component codes; UNT's core differs in areas and
  approved-course lists.
- Sections: the server-fetchable source is the catalog, not sections. Term section data
  needs a browser capture of the EID-gated Course Schedule app (guest EIDs allowed), so
  UT Austin sections start as `browser-capture` capability, never a server job.
- Registration: custom portal, unique numbers, department-managed waitlists with UT's caps
  (two per course, four total), 17-hour fall/spring undergraduate limit.
- Grade evidence: aggregate dashboard only, fall/spring, suppressed small sections; link
  out instead of parsing.

## Build plan, in order

1. Catalog ingest (this PR): the `catalog-utexas` source policy, three saved course pages
   with recorded sources, and `packages/ingest/src/ut-austin/catalog.ts` parsing them into
   records. Extend fixtures to more fields of study as needed.
2. Catalog release job: walk `https://catalog.utexas.edu/courses/` (about one page per field
   of study), build a versioned release of course records with the SourceRecord evidence
   fields, publish under the release rules in docs/architecture/README.md, "Reference data".
3. Prerequisite grammar: extend the shared prereq parser with UT sentence forms, tested on
   parsed `prerequisiteText` from the saved pages, without touching UNT behavior.
4. Campus adapter: build the `CampusAdapter` interface from docs/architecture/README.md,
   "The campus adapter", with the UT Austin instance first (institutionId, codes, terms,
   policy, map, registration metadata, links), and move UNT behind it.
5. Academic calendar and credit policy: curated UT term table and the 17/14-hour limits,
   each with source URLs and check dates.
6. Sections via browser capture: sanitized captures of the UT Direct Course Schedule with a
   guest EID, a `PortalAdapter`-shaped reader per the architecture README, never a server
   fetch.
7. Degree plans: parse the BSCompSci program pages with the existing degree pipeline and
   UT's core component table; validate against the core curriculum page.
8. Grade evidence: link courses to the grade-distribution dashboard; revisit parsing only if
   a stable export surface appears.
