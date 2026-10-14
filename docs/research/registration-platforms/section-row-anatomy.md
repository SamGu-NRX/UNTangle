# Section-Row Anatomy: What Identifies a Section Row per Platform

Companion to `registration-platform-survey.md` and `platform-comparison.md` in this directory. The original brief required, for one public class-search results page per platform type, a description of the DOM structure that identifies a section row: the selectors and fields present. This document records what live probes observed, distinguishes observed structure from inference, and states plainly what could not be verified.

Method, applying to every probe below:

- Date of inspection: October 13, 2026. Probes were single, unauthenticated HTTP requests with a generic browser user agent, run from this repo's sandbox. No login was performed anywhere, and no CAPTCHA or access control was bypassed.
- No response markup is republished here. This file records structure (endpoint paths, element names, JSON keys, field values observed in examples) but includes no saved HTML or XML documents, because the sites' terms for republication were not reviewed.
- "Observed" means seen directly in a probe response this session. "Unverified" means it could not be confirmed without a login or a richer session; it is stated as unverified and never filled in from vendor documentation, other schools, or memory.
- Probe URLs and their statuses are also listed in the survey's source index entry for live probes.

## 1. Banner Self-Service Banner (reference: UTRGV ASSIST)

Inspected URLs, all retrieved October 13, 2026:

- Term-selection page (public, verified in the first survey pass): `https://assist.utrgv.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=courseSearch`
- Term-list API: `https://assist.utrgv.edu/StudentRegistrationSsb/ssb/classSearch/getTerms?searchTerm=2025&offset=1&pageSize=5`
- Results API: `https://assist.utrgv.edu/StudentRegistrationSsb/ssb/searchResults/searchResults?txt_term={code}&pageOffset=0&pageMaxSize=2`, probed with several term codes, subject-filtered and unfiltered, both with and without a session cookie
- `https://assist.utrgv.edu/robots.txt` returned HTTP 404: the host has no robots.txt

What loads the results (observed): the class-search page is an application shell; its data comes from JSON endpoints under `/StudentRegistrationSsb/ssb/`. The getTerms endpoint returned a JSON array of objects with `code` and `description` keys (values observed include code 202613, "Fall 2025 Module 1 (View Only)", and 202749, "Fall-Spr 2026-27 SOM Y4"). The searchResults endpoint returned the standard JSON envelope with the keys `success`, `totalCount`, `data`, `pageOffset`, `pageMaxSize`, `sectionsFetchedCount`, `pathMode`, `searchResultsConfigs`, `ztcEncodedImage`.

One section's shape: NOT observed. Every searchResults probe returned `success: true` with `totalCount: 0` and `data: null`, across four term codes, with and without a subject filter and with and without a cookie jar. The section-level object and its keys are therefore unverified this session and are deliberately not filled in from vendor documentation. What remains unverified: the section JSON keys, and whether this deployment exposes populated results to unauthenticated callers at all (the app's own flow may send parameters our probes did not).

Fields present: unverified (no row obtained): course code, section, class number (CRN), title, instructor, days and times, room, seats or enrollment, dates, modality.

Stable versus generated (observed at the envelope level): the endpoint paths under `/StudentRegistrationSsb/ssb/` and the envelope keys are the stable product surface that makes Banner SSB a family; term codes are numeric, school-defined values (202613, 202617, 202749 observed), so they are data, not selectors. No generated values inside rows could be observed because no row was returned.

## 2. Oracle PeopleSoft Campus Solutions (reference: UCF guest class search)

Inspected URL, retrieved October 13, 2026:

- `https://csprod-ss.net.ucf.edu/psc/CSPROD/EMPLOYEE/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL?Action=U&Page=SSR_CLSRCH_ENTRY&TargetFrameName=None`

What loads the results (observed): a server-rendered PeopleSoft component page, not a public JSON endpoint. A plain GET without cookies first lands on an Oracle login/error page (redirect target contains `cmd=login&errorPg=ckreq`); with a cookie jar, the same URL returns the guest Class Search entry page (HTTP 200, page title "Class Search", about 82 KB). Results are produced by PeopleSoft component POSTs carrying per-session state, not by an addressable public API.

One section's shape: NOT observed. A scripted POST that replayed the entry page's hidden fields and selected a term returned the entry page again, not a results grid; the `SSR_CLSRCH_RSLT` results grid was not reached. Cross-checks: the same guest URL pattern at Central Washington University also bounced a plain GET to the login-error page, and a Boise State guest-search host did not respond from this network. The results-page DOM is therefore unverified this session. What remains unverified: the results grid's element structure, row markers, and field layout.

Entry-page structure (observed): the search form is `form id='CLASS_SEARCH' name='win0' method='post'` posting back to the CLASS_SEARCH.GBL URL. Search-criteria controls observed (selected ids): `CLASS_SRCH_WRK2_INSTITUTION$31$`, `CLASS_SRCH_WRK2_STRM$35$`, `SSR_CLSRCH_WRK_SSR_EXACT_MATCH1$1`, `SSR_CLSRCH_WRK_ACAD_CAREER$3`, `SSR_CLSRCH_WRK_LOCATION$4`, `ATTR_VAL$5`, `SSR_CLSRCH_WRK_SSR_START_TIME_OPR$7`, `SSR_CLSRCH_WRK_SSR_END_TIME_OPR$7`. Hidden state fields observed: `ICType`, `ICElementNum`, `ICStateNum`, `ICAction`, `ICModelCancel`, `ICXPos`.

Fields present in a results row: unverified (results grid not reached): course code, section, class number (CRN), title, instructor, days and times, room, seats or enrollment, dates, modality.

Stable versus generated (observed): the component path pattern `/psc/{site}/{portal}/SA/c/COMMUNITY_ACCESS.CLASS_SEARCH.GBL` and the `SSR_CLSRCH_` / `CLASS_SRCH_WRK2_` id prefixes are PeopleSoft product surface and stable; the numeric suffixes (`$31$`, `$35$`, `$1`) are generated indices that must never be hardcoded; the ICStateNum and ICSID hidden fields are per-session state, generated per request.

Side finding (observed): the returned page carries an Oracle copyright header and the URL structure is PeopleSoft's own, so this probe upgrades UCF's SIS classification from "reported" to verified for the platform vendor; the survey row has been updated.

## 3. Custom public class-search applications

### 3.1 UIUC Course Explorer (CISAPI, documented public XML API)

Inspected URLs, all retrieved October 13, 2026 and HTTP 200:

- API documentation: `https://courses.illinois.edu/cisapp/` (Swagger UI over the OpenAPI spec at `https://courses.illinois.edu/cisapp/cisapi.yaml`). The official answers page `https://answers.uillinois.edu/uic/88215` states the Course Explorer public API "does not require any authentication or authorization" and that all course and schedule information is available via it. The former documentation URL `https://courses.illinois.edu/cisdocs/api` is no longer available (it now returns the site's "page does not exist" page); this document and the survey's source index were updated to the new location.
- Course list for a subject: `https://courses.illinois.edu/cisapp/explorer/schedule/2025/fall/CS.xml`
- One course with its sections: `https://courses.illinois.edu/cisapp/explorer/schedule/2025/fall/CS/101.xml`
- One section: `https://courses.illinois.edu/cisapp/explorer/schedule/2025/fall/CS/101/35879.xml` (Fall 2025, CS 101, section AL1, CRN 35879)

What loads the results (observed): the Course Explorer web app is a front end over CISAPI, a set of unauthenticated XML endpoints with a documented path grammar: `/cisapp/explorer/schedule/{year}.xml` lists calendar years, `/{year}/{term}.xml` lists terms, `/{year}/{term}/{subjectCode}.xml` lists a subject's courses, `/{year}/{term}/{subjectCode}/{number}.xml` lists a course's sections, and `/{year}/{term}/{subjectCode}/{number}/{crn}.xml` returns one section. (Earlier probes that used a term code or year-term string in place of `{year}/{term}` returned server errors, which is how the grammar was pinned down.)

One section's shape (observed, CRN 35879): a `<section>` element whose `id` attribute is the CRN, with child elements `sectionNumber` (AL1), `statusCode` (A), `sectionText`, `sectionNotes`, `partOfTerm` (1), `sectionStatusCode` (A), `startDate` (08-25-25Z), `endDate` (12-10-25Z), and a `meetings` element. Each `<meeting>` carries `start` (10:00AM), `end` (10:50AM), `daysOfTheWeek` (MW), `roomNumber` (AUD), `buildingName` (Foellinger Auditorium), a `type` element with a `code` attribute (LCD, rendered as Lecture-Discussion), and an `instructors` element whose `<instructor>` children carry `lastName` and `firstName` attributes. Course context arrives through a `parents` element chain (calendarYear 2025, term id 120258 Fall 2025, subject id CS, course id 101 with its label).

Fields present (all observed in the subject, course, and section chain):

- Course code: observed (subject id plus course id, and repeated in `parents`)
- Section: observed (`sectionNumber`, AL1)
- Class number (CRN): observed (the section element's `id` attribute, 35879, also the URL segment)
- Title: observed (the course `label`, "Intro Computing: Engrg & Sci")
- Instructor: observed (meeting `instructors` with names)
- Days and times: observed (`daysOfTheWeek` MW, `start` 10:00AM, `end` 10:50AM)
- Room: observed (`roomNumber` AUD plus `buildingName` Foellinger Auditorium)
- Dates: observed (`startDate`, `endDate`)
- Seats or enrollment: not observed (no enrollment or seats element appeared anywhere in the section detail response)
- Modality: not observed (the meeting `type` code describes lecture versus lab format, not online versus in-person)

Stable versus generated: element names, the path grammar, and the XML namespace (`http://rest.cis.illinois.edu`) are stable and documented in the OpenAPI spec; section ids are CRNs, which are durable identifiers; `href` attributes are stable full URLs. This is the survey's best-in-class surface, and it needs no DOM parsing at all.

### 3.2 UT Austin Course Schedule

Inspected URLs, retrieved October 13, 2026:

- `https://registrar.utexas.edu/schedules` (public term index, HTTP 200)
- `https://registrar.utexas.edu/schedules/269` (public Fall 2026 schedule article, HTTP 200, whose "Find courses now" button points at the interactive app and carries a lock icon)
- `https://utdirect.utexas.edu/apps/registrar/course_schedule/20269` (HTTP 302 to the university's SAML sign-on at enterprise.login.utexas.edu; the redirect was observed and not followed past the login gate)

What loads the results (observed at the gate only): the interactive per-section schedule app lives on utdirect.utexas.edu and is EID-gated. The registrar's schedule pages themselves are public and describe the schedule, and the page tells visitors without an EID to get a free guest EID.

Section shape and fields: unverified (behind the login gate; no listing markup was observed and none is described here). What remains unverified: the app's result mechanics and field layout, and whether a guest-EID session sees the same markup as a student session. This probe corrects the survey's original "public, no-login" rating for UT Austin; the survey row, its summary text, and its support-target list were updated, and the correction is recorded in the survey's audit appendix.

### 3.3 Rutgers Schedule of Courses

Inspected URLs, retrieved October 13, 2026:

- `https://sis.rutgers.edu/soc/` (HTTP 302 to `https://classes.rutgers.edu//soc/`)
- `https://classes.rutgers.edu/soc/` (HTTP 200)
- `https://classes.rutgers.edu/soc/js/soc_app.SearchService.js` and `.../soc_app.js` (HTTP 200, inspected for request construction)

What loads the results (partially observed): a public JavaScript application (Dojo plus jQuery) whose search service builds query fragments such as `keyword?keyword={term}&semester={code}&campus={code}&level={code}` and hands them to a content loader that routes fragments to subject, course, keyword, and core-code loaders; a course-download service also references JSON data. The data-service base path was not identified in the scripts inspected this session, so the exact JSON endpoint and one section's JSON shape are unverified. Rutgers' underlying SIS remains reported, unverified.

Fields present: unverified (no row or endpoint observed): all ten fields in the matrix below.

## 4. Cross-platform field matrix

"Observed" means seen in a probe response on October 13, 2026; "unverified" means not obtained this session; "absent" means the endpoint responded fully but carried no such field.

| Field | Banner SSB (UTRGV) | PeopleSoft (UCF) | UIUC CISAPI | UT Austin app | Rutgers SOC |
|---|---|---|---|---|---|
| What loads results (observed) | JSON endpoints; envelope observed | Server-rendered GBL component POSTs | Documented unauthenticated XML | Unverified: EID-gated app | JS app over an unnamed JSON service |
| Course code | unverified | unverified | observed | unverified | unverified |
| Section | unverified | unverified | observed | unverified | unverified |
| Class number (CRN) | unverified | unverified | observed | unverified | unverified |
| Title | unverified | unverified | observed | unverified | unverified |
| Instructor | unverified | unverified | observed | unverified | unverified |
| Days and times | unverified | unverified | observed | unverified | unverified |
| Room | unverified | unverified | observed | unverified | unverified |
| Seats or enrollment | unverified | unverified | absent from observed response | unverified | unverified |
| Dates | unverified | unverified | observed | unverified | unverified |
| Modality | unverified | unverified | absent from observed response | unverified | unverified |

## 5. Adapter implications

- The only surface whose section rows were observed end to end is UIUC, and it needs no DOM adapter at all: CISAPI is documented, unauthenticated XML with stable element names and CRN-keyed ids. That is the ideal end state the survey described.
- Banner SSB's JSON envelope is real and stable, but this deployment returned no populated rows to unauthenticated probes; recording section keys requires a real browser session or the app's full parameter flow, and fixtures must come from observed responses, never from vendor documentation.
- PeopleSoft guest search is reachable but session-bound: generated index suffixes in element ids and per-session state fields mean per-school fixtures and a browser-driven flow; the results grid remains unobserved.
- UT Austin's schedule is EID-gated with free guest EIDs, so supporting it means session handling and a terms review, not public parsing.
- No response bodies are saved in this repository. Adapter fixtures should be recorded locally per school only after that school's terms are reviewed, per the survey's compliance posture.
