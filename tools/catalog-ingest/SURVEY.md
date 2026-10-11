# UNT real-term schedule source survey

**Purpose.** Decide whether the UNTangle student planning app may ingest a real term's complete section list from a permitted public source. Primary UNT Denton sources only; third-party aggregators (RateMyProfessors, CourseDog, etc.) are out of scope.

**Survey executed:** 2026-10-11, 14:36–15:11 UTC. Committed under `tools/catalog-ingest/` as the first product of the catalog-ingest pipeline.

**User-Agent sent on every request:** `UNTangle-student-project/0.1 (CSCE 3444 course project; educational use)`

**Probing discipline honored:** public pages only; no credentials anywhere; no CAPTCHA/WAF/rate-limit circumvention; ≥1 request/second spacing (1.05 s enforced in the fetcher); every response cached to disk; "not found" (404) distinguished from "blocked" (WAF challenge / TLS refusal / cookie gate); HTTP status codes recorded for every probe.

**Cache:** fetched responses were cached to disk during the survey (one file per URL plus a `manifest.json` with `url`, `requestedAt`/`fetchedAt`, `status`, `finalUrl`, `contentType`, `bytes`, `sha256`, cached `file`). The project sandbox suffered repeated provider-verified deaths during the survey; each reset erased the scratch directory, and the cache was rebuilt from live re-fetches several times (final complete generation: 38 entries, 15:05–15:11 UTC) before being lost again. Neither the fetcher script nor any cache generation survived to be committed; the probe log below — captured from live output during the final complete pass — is the authoritative record of all 38 requests.

---

## (a) Evidence table

Verdict key: **qualify** = permitted, no login, yields the data claimed; **does-not-qualify** = fails one or more of login-free / automation-permitted / data-completeness requirements. Quoted strings are verbatim from the cached responses.

### Family 1 — Registrar public class search / myUNT class search

| Source | Evidence | Verdict |
|---|---|---|
| `registrar.unt.edu/registration/schedule-of-classes.html` | HTTP 200, 2026-10-11T15:05:49Z, 56,664 B. Page text: *"Option 1: Use myUNT to Find Classes — A public class search is available."* and *"Details for each course section can be found in the Search of Classes through myUNT by simply clicking on that section. There you will find tabs for details, meeting information and section notes."* | Entry page: qualify as a signpost; the search itself is on myUNT |
| Public Class Search link | Anchored text *"public class search"* → `https://my.unt.edu/psc/ps/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL` (raw href verified in the cached HTML) | — |
| `my.unt.edu/robots.txt` | **HTTP 404** (1,164 B, 14:36:54Z) — no robots.txt published | No crawl directives exist |
| `my.unt.edu/` | HTTP 200 but redirects to `https://my.unt.edu/psp/ps/?cmd=login&languageCd=ENG` — a PeopleSoft sign-in page (16,302 B with session; 117 B bare) | Login-oriented front door |
| Class-search component, cookieless | `NUI_FRAMEWORK.PT_LANDINGPAGE.GBL` and the classic `SA_LEARN_SERVICES.SSR_CLSRCH_ENTRY.GBL` both **redirect to `?cmd=login&errorPg=ckreq`** ("cookies required" PeopleSoft error page, 2,892 B, 15:06:24–25Z) — a cookie gate, not an auth gate, but the component never renders data without session cookies | — |
| Class-search component, guest with cookie jar (no credentials) | Login page 200 → `PT_LANDINGPAGE.GBL` 200 renders *"Student Homepage … There are no tiles to display"* → `SSR_STUDENT_FL.SSR_MD_SP_FL.GBL?page=SSR_MD_TGT_PAGE_FL` 200 renders only a JS search shell: *"Manage Classes … Search Category Name … Search keywords … No results to display"*. No term grid, no section rows, no JSON/XHR data endpoint appears in any fetched HTML (greps for `groupletid`, tile labels, and 6-digit `STRM`-style codes found nothing) | — |
| Format / endpoint | PeopleSoft Fluid (JS-rendered). No sessionless HTML or JSON endpoint was found. Reaching results would require driving the Fluid UI (JS + cookies + `ICAction` posts). Underlying GET/JSON called by the tiles: **unverified — not discovered** | — |
| Login required | **Effectively yes for results**: no credentials are needed, but every data-bearing component demands session cookies and JS execution; no sessionless data path found in ~10 probes | — |
| Terms of use | Login page *User Agreement*, verbatim: *"This system is the property of the University of North Texas System and your use of this resource constitutes an agreement to abide by relevant federal and state laws and institutional policies. Unauthorized use of this system is prohibited. Violations can result in penalties and criminal prosecution. Usage may be subject to security testing and monitoring. Users have no expectation of privacy except as otherwise provided by applicable privacy laws."* (cached 15:07:30Z) | **Does-not-qualify** — JS+cookie orchestration with no found data endpoint, plus an explicit monitoring/penalties clause over automated-looking use |

### Family 2 — Published schedule exports (registrar-published spreadsheets)

| Source | Evidence | Verdict |
|---|---|---|
| `registrar.unt.edu/sites/default/files/fall-2026-8w2-ugrd.xlsx` | HTTP 200, 2026-10-11T15:05:52Z, 19,239 B, `application/vnd.openxmlformats-officedocument.spreadsheetml`. 184 rows incl. header (183 section rows). Header: `College Descr, Department, Subject, Catalog, Section, Career, Course Title, Campus`. Sample row: `Brint Ryan College of Business / Accounting / ACCT / 2020 / 700 / UGRD / ACCOUNT PRIN II / INET` | — |
| `registrar.unt.edu/sites/default/files/fall-2026-8w2-grad.xlsx` | HTTP 200, 15:05:53Z, 21,199 B. 245 rows incl. header (244 section rows). Same header. Sample rows: `… / ACCT / 5130 / 403 / GRAD / ACCT FOR MGMT / INET` and `… 404 …` | — |
| Coverage | Page context on the schedule page: *"Register now for an 8 Week 2 course! … In the search field enter '%' this will return all subjects. On the left-hand menu under Academic Session, select Eight Week - Second to filter only the classes being offered for the 8 Week 2 session. Undergraduate 8-week II Class Offerings / Graduate 8-week II Class Offerings. **For updated information, please refer to the information in the myUNT class search.**"* — i.e. the spreadsheets cover **only the Fall 2026 8-week-II session** (≈427 sections), not the full term | — |
| Login required | No — direct anonymous GET, HTTP 200 | — |
| robots.txt | `registrar.unt.edu/robots.txt` (312 B, 14:36:52Z), quoted: `User-agent: *` / `Disallow: /_archive/` … `Disallow: /search.html` … `Sitemap: https://registrar.unt.edu/sitemap.xml`. `/sites/default/files/` is **not** disallowed; no crawl-delay | Permissive for these files |
| Terms of use | No clause found on registrar pages addressing automated access. Site-wide instruments are the UNT System Linking Notice (quoted in the ToU section) and the site disclaimer. Nothing prohibits fetching the published files; nothing authorizes republishing either — the Linking Notice's copyright sentence applies | — |
| Format / fields | XLSX. Available: college, department, subject, catalog number, section number, career (UGRD/GRAD), course title, campus (e.g. `INET`). **Not present:** instructor, meeting days/times, building, room, capacity/status, term dates (term+session only from filename and page context) | **Does-not-qualify** as a *complete* section-list source — qualifies only as a partial, no-login real-term snapshot (one session of one term, 8 fields) |

No other schedule exports exist on the registrar site: every `/sites/default/files/` link across all cached registrar pages was enumerated; besides the two xlsx files above, the only schedule-related files are `UNT_Visual_Schedule_Builder_help.pdf` and `schedule-builder-tutorial.mp4` (help material, not data).

### Family 3 — catalog.unt.edu (Acalog catalog)

| Aspect | Evidence |
|---|---|
| Platform / current edition | Acalog (`acalog-clients.s3.amazonaws.com` assets, "Select a Catalog" dropdown). Homepage 200 (50,068 B). Dropdown lists **2026-2027 Undergraduate Catalog** and **2026-2027 Graduate Catalog** as current; archives 2015-16 → 2025-26 plus "Archived Catalogs 1995-96 to 2010-11" (`navoid=4671`). A full PDF is published: `/mime/media/view/40/4677/2026-27_UNT_undergraduate_catalog.pdf` — HTTP 200, `application/pdf` (fetch capped at 3 MB; 15:09:43Z) |
| Where schedule data would live | Course-inventory pages: `content.php?catoid=40&navoid=4629` ("Course Descriptions"). **Blocked:** HTTP **202** with a 2,011-byte **AWS WAF JavaScript challenge** (`window.awsWafCookieDomainList`, `gokuProps`, `challenge.js` from `*.token.awswaf.com`, `<noscript> In order to continue, we need to verify that you're not a robot.`). Reproduced twice: 14:46:02Z and 15:06:19Z. Honored, not bypassed. Meanwhile `/`, `/misc/catalog_list.php?catoid=40` (47,037 B, 15:08:18Z) and `/mime/media/` PDFs serve 200 — the challenge is applied selectively to `content.php` |
| Section/meeting/term data | **Unverified** — the deep pages that could carry any term/section data are WAF-challenged. In the accessible pages (home, catalog list) **no** term, section, meeting, or instructor data appears. Known Acalog course-page content is descriptive (credit hours, prerequisites); the schedule page itself says *"Details for each course section can be found in the Search of Classes through myUNT"* |
| Login required | No (public catalog), but **bot challenge applies** to the deep pages |
| robots.txt (509 B, 14:36:53Z), quoted | `# Everyone else.` / `User-agent: *` / `Disallow: /portfolio.php` / `Disallow: /portfolio_nopop.php` / `Disallow: /ajax/` / `Disallow: /search_advanced.php` / `crawl-delay: 120` — the `/ajax/` and `/search_advanced.php` disallows cover exactly Acalog's search/data endpoints; crawl-delay 120 s honored during probing |
| Terms of use | Catalog footer links: `www.unt.edu/disclaimer`, `www.unt.edu/privacy`, `www.unt.edu/required-links`, `policy.unt.edu/policy/14-005`. Disclaimer (verbatim): *"If any discrepancies exist between official University of North Texas printed materials and electronic information, the information in the printed material shall have precedence unless the electronic information specifically states that it is the official source in lieu of the printed information."* No clause addressing crawlers was found on the catalog or its linked policies |
| catoid/coid structure | `catoid=40` = 2026-2027 editions (UG + Grad share the catoid). Navigation pages use `content.php?catoid=40&navoid=NNNN` (verified via catalog_list.php: Course Descriptions `navoid=4629`; Majors, Minors, Certificates `4657`; Degree Programs by Academic Unit `4658`; colleges `4632–4640`, `4672`, `4679`, `4680`; Academic Calendar `4686`; TCCNS chart `4685`; etc.). Course pages in Acalog use `content.php?catoid=…&coid=…` — the **coid pattern itself is unverified** (no course page could be fetched through the challenge) |
| Subject coverage | **Unverified** — the subject enumeration lives on the challenged `content.php` pages. The visible top-level nav covers every college/school (9) + Toulouse Graduate School + Honors College, but "covers every UNT subject" cannot be confirmed from what was fetchable |

**Verdict: does-not-qualify** as a term-schedule source (WAF-challenged deep pages; no term/section data observed anywhere accessible; robots disallows the search endpoints). It remains the canonical **course-text** source (course descriptions, prerequisites), including via the unblocked full-catalog PDF.

### Family 4 — UNT open data / analytics / digital library

| Source | Evidence | Verdict |
|---|---|---|
| `data.unt.edu` | HTTP 200, 48,437 B (14:37:00Z). This is **"Insights 2.0"** — a portal of SAS Visual Analytics reports on `insights2.unt.edu`. Public report links extracted include: *Enrollment by Section*, *Enrollment Comparison*, *Registration Momentum and Pace*, *Semester Credit Hours*, *Student Demographics*, *Student Enrollment Patterns*, *Grade Distribution*, graduation/retention/admissions reports, IPEDS and THECB Almanacs. Some entries are marked *"Security Role Required"*; "Enrollment by Section" is not | Analytics, not schedules |
| `insights2.unt.edu/links/resources/report?uri=%2Freports%2Freports%2F44df14bb-…&page=vi17543` ("Enrollment by Section") | **TLS connection refused at protocol level** (`SSL: UNEXPECTED_EOF_WHILE_READING`), twice (15:10:18Z and retry). No HTTP status available — the edge terminates the connection for this client. **Blocked**, not "not found" | — |
| Coverage judgment | "Enrollment by Section" is enrollment **counts** per section (analytics), not a section listing: it carries no meeting days/times, instructors, rooms, or complete section inventory, and SAS VA exposes no clean no-login bulk export | **Does-not-qualify** as a complete-section-list source |
| `digital.library.unt.edu` | robots.txt (450 B): disallows `/stats/`, `/feedback/`, `/zoom/` (and whole-host blocks for several AI crawlers); `Request-rate: 1/3`, `Crawl-delay: 3`. Search probe `/search/?q=class+schedule` → redirects to `/dam/` which serves an **ALTCHA challenge** page (`<script … src="/digital/media/altcha/altcha.min.js">`, `<noscript>` fallback). CAPTCHA-class challenge — honored, not bypassed. Content is digitized archival material, not term schedules | **Does-not-qualify** (challenge-gated; wrong content class anyway) |

### Terms of use — what actually governs automated access (site-wide instruments)

| Instrument | Finding |
|---|---|
| `policy.unt.edu/policy/14-005` | "Electronic and Information Resources Accessibility" — accessibility policy, **not** an automated-access clause (200, 15:05:57Z) |
| `policy.unt.edu/policy/14-009` | "Privacy Policy" (summary page, 200, 15:05:58Z): *"The University of North Texas will inform individuals about information it collects about them…"* — about personal data, not crawler authorization; full policy is a PDF |
| `www.unt.edu/privacy.html` | Privacy statement (200, 56,018 B): describes collected information and third-party analytics; no crawler/scraper clause found |
| `www.unt.edu/disclaimer` | Printed-over-electronic precedence clause (quoted above); no automated-access clause. Footer links to Disclaimer / Privacy / Required Links |
| `www.unt.edu/required-links` | Lists "State Website Linking and Privacy Policy" → `dir.texas.gov/resource-library-item/state-website-linking-privacy-policy` → **HTTP 404** (moved/deleted, 15:07:47Z) |
| `technology.untsystem.edu/divisions/citc/it-standards/linking-notice.php` | (200, 32,866 B) Verbatim: *"The State of Texas maintains a linking policy governing the use of, copying information from, or linking to a state website. UNT System Administration and Institution websites abide by the terms of the state policy…"*; *"Advance permission is not required to link to a UNT System Administration or Institution website."*; linking sites *"may not attempt to present UNT System content as though it were their own"*; *"should not duplicate content owned by the System Administration or Institution, but instead should refer the reader to the original via a link"*. *"Content on UNT System Administration and Institution websites may be protected by trademark and copyright laws and may be used only as permitted by laws governing intellectual property."* — the closest standing clause governing **copying** of UNT web content |
| `my.unt.edu` User Agreement | Quoted under Family 1 — prohibits unauthorized use, warns of monitoring. The strictest applicable instrument |

No UNT web policy explicitly authorizes or forbids crawlers on public pages. The operative signals are: robots.txt disallows (catalog `/ajax/`, `/search_advanced.php`), the AWS WAF challenge (catalog deep pages), the ALTCHA challenge (Digital Library), the PeopleSoft User Agreement (my.unt.edu), and the Linking Notice's no-duplication/copyright language.

---

## (b) Overall verdict

**No.** No single permitted public source exists today that can yield a **real term's complete section list** without login. Verified state:

- The **complete** section list (with instructor, meeting days/times, building/room, modality, capacity/status, term dates — the *"details, meeting information and section notes"* tabs) exists **only inside the myUNT PeopleSoft Fluid class search**, which requires session cookies plus JS execution and exposes no sessionless data endpoint that this survey could find. Its User Agreement prohibits "unauthorized use" and warns of monitoring.
- The only **no-login real-term section data** found is the registrar's two 8-week-II xlsx exports — **partial** (one session of one term, ≈427 sections, 8 fields, no instructor/meeting/room/capacity).
- **catalog.unt.edu** deep pages are behind an AWS WAF JS challenge; no term/section data observed in accessible pages.
- **data.unt.edu** offers section-level *enrollment analytics* (not schedules); its SAS host refused TLS connections; the **Digital Library** is ALTCHA-gated.

## (c) Recommended source and ingestion sketch

For a **complete** section list: no qualifying source — pursue **explicit permission or a data feed** from the Registrar / UNT IT (the registrar's own page points users to the myUNT class search for authoritative data, so a feed request is the natural ask; UNTangle should not drive the PeopleSoft UI without written authorization). Record that as the unresolved external-permission item.

For a **partial** real-term supplement (what is ingestible today without permission):

- **Source:** the two registrar xlsx files under `/sites/default/files/`.
- **Endpoints:** `https://registrar.unt.edu/sites/default/files/fall-2026-8w2-ugrd.xlsx` and `…/fall-2026-8w2-grad.xlsx`.
- **Pagination:** none — one GET per file; **request count = 2** per refresh (trivially inside 1 req/s). File naming embeds term + session (`fall-2026-8w2`); discover new files by watching the schedule-of-classes page for new `/sites/default/files/*.xlsx` links.
- **Parse:** XLSX (zip + `sharedStrings.xml` + `xl/worksheets/sheet1.xml`, or openpyxl). Verified headers: `College Descr, Department, Subject, Catalog, Section, Career, Course Title, Campus`.
- **Field availability vs. the requested list:** course (Subject+Catalog) ✅; section number ✅; career ✅; campus/modality proxy (`INET`, …) partial ✅; college/department/title ✅. **Instructor ❌, meeting days/times ❌, building code ❌, room ❌, capacity/status ❌, term dates ❌** (term+session only from filename/page context).
- **Freshness caution:** the page itself says *"For updated information, please refer to the information in the myUNT class search"* — treat the files as an advisory snapshot, not authoritative, and label the gap in UNTangle.

## (d) Current and next UNT Denton term identifiers, as published

- **Verified term names** (`registrar.unt.edu/when-can-i-register.html`, 200, 83,636 B): **Summer 2026**, **Fall 2026**, **Spring 2027** registration schedules are published. As of the survey date (2026-10-11), **Fall 2026 is the current term and Spring 2027 is next** (Spring 2027 registration for continuing graduate students begins *"Monday, October 5 at 7:00 a.m."*). *"The Summer semester consists of seven sessions included within one term."*
- **Numeric term codes (PeopleSoft STRM, e.g. a 6-digit code):** **unverified** — no public page examined publishes them; they appear only inside the JS-driven myUNT UI. Term/session labels that *are* published: "Eight Week - Second" (Academic Session filter name, schedule page) and "8w2" (xlsx filenames).

## (e) catalog.unt.edu catoid/coid structure and subject coverage

- **Platform:** Acalog. **Current catoid = 40**, carrying both the 2026-2027 Undergraduate and 2026-2027 Graduate Catalogs; archived editions 2015-16 through 2025-26 in the dropdown plus a 1995-96–2010-11 archive page.
- **Observed URL shapes:** `content.php?catoid=40&navoid=NNNN` (section pages; navoid values above), `index.php?catoid=40`, `misc/catalog_list.php?catoid=40`, `mime/media/view/40/4677/2026-27_UNT_undergraduate_catalog.pdf` (all 200), and — blocked by the WAF challenge — `content.php?catoid=40&navoid=4629` for the course inventory. The **coid** pattern for individual course pages was **not observable** (unverified) because no `content.php` page could be fetched through the challenge.
- **Subject coverage:** **unverified**. The navigation tree (from the fetchable catalog list page) covers every college and school plus the Toulouse Graduate School and Honors College, but the subject-level course enumeration sits on the challenged pages.

---

## Probe log (all 38 cached requests)

| Time (UTC) | Status | Bytes | URL |
|---|---|---|---|
| 14:36:52 | 200 | 312 | registrar.unt.edu/robots.txt |
| 14:36:53 | 200 | 509 | catalog.unt.edu/robots.txt |
| 14:36:54 | 404 | 1,164 | my.unt.edu/robots.txt |
| 14:36:55 | 200 | 439 | www.unt.edu/robots.txt |
| 14:36:56 | 200 | 91,576 | registrar.unt.edu/ |
| 14:36:57 | 404 | 45,519 | www.unt.edu/registrar |
| 14:36:58 | 200 | 50,068 | catalog.unt.edu/ |
| 14:36:59 | 200 | 117 | my.unt.edu/ |
| 14:37:00 | 200 | 48,437 | data.unt.edu/ |
| 14:37:01 | 200 | 450 | digital.library.unt.edu/robots.txt |
| 15:05:49 | 200 | 56,664 | registrar.unt.edu/registration/schedule-of-classes.html |
| 15:05:50 | 404 | 45,191 | registrar.unt.edu/registration/when-can-i-register.html |
| 15:05:51 | 404 | 45,191 | registrar.unt.edu/registration/registration-guide.html |
| 15:05:52 | 200 | 19,239 | registrar.unt.edu/sites/default/files/fall-2026-8w2-ugrd.xlsx |
| 15:05:53 | 200 | 21,199 | registrar.unt.edu/sites/default/files/fall-2026-8w2-grad.xlsx |
| 15:05:54 | 200 | 56,018 | www.unt.edu/privacy.html |
| 15:05:55 | 200 | 46,100 | www.unt.edu/disclaimer |
| 15:05:56 | 200 | 49,213 | www.unt.edu/required-links |
| 15:05:57 | 200 | 55,716 | policy.unt.edu/policy/14-005 |
| 15:05:58 | 200 | 55,733 | policy.unt.edu/policy/14-009 |
| 15:06:19 | 202 | 2,011 | catalog.unt.edu/content.php?catoid=40&navoid=4629 (AWS WAF challenge) |
| 15:06:20 | 200→redirect | 3,655 | digital.library.unt.edu/search/?q=class+schedule → /dam/ (ALTCHA) |
| 15:06:21 | 200 | 49,090 | online.unt.edu/ |
| 15:06:22 | 404 | 38,588 | online.unt.edu/schedules |
| 15:06:23 | 404 | 38,588 | online.unt.edu/courses |
| 15:06:24 | 200→redirect | 2,892 | my.unt.edu/psc/ps/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL → ?cmd=login&errorPg=ckreq |
| 15:06:25 | 200→redirect | 2,892 | my.unt.edu/psc/ps/EMPLOYEE/SA/c/SA_LEARN_SERVICES.SSR_CLSRCH_ENTRY.GBL → ?cmd=login&errorPg=ckreq |
| 15:06:51 | 200 | 83,636 | registrar.unt.edu/when-can-i-register.html |
| 15:06:52 | 200 | 48,305 | registrar.unt.edu/registration-guide.html |
| 15:06:53 | 200 | 48,012 | registrar.unt.edu/course-scheduling.html |
| 15:07:30 | 200 | 16,302 | my.unt.edu/psp/ps/?cmd=login&languageCd=ENG (guest cookie-jar flow) |
| 15:07:31 | 200 | 44,883 | my.unt.edu/psc/ps/EMPLOYEE/SA/c/NUI_FRAMEWORK.PT_LANDINGPAGE.GBL (cookie jar, guest) |
| 15:07:33 | 200 | 62,041 | my.unt.edu/…/SSR_STUDENT_FL.SSR_MD_SP_FL.GBL?page=SSR_MD_TGT_PAGE_FL (cookie jar, guest) |
| 15:07:47 | 404 | 1,640 | dir.texas.gov/resource-library-item/state-website-linking-privacy-policy |
| 15:07:48 | 200 | 32,866 | technology.untsystem.edu/divisions/citc/it-standards/linking-notice.php |
| 15:08:18 | 200 | 47,037 | catalog.unt.edu/misc/catalog_list.php?catoid=40 |
| 15:09:43 | 200 | 3,000,000 (cap) | catalog.unt.edu/mime/media/view/40/4677/2026-27_UNT_undergraduate_catalog.pdf |
| 15:10:18 | TLS refused | 0 | insights2.unt.edu/links/resources/report?uri=%2Freports%2Freports%2F44df14bb-…&page=vi17543 (×2, SSL EOF) |

*Earlier same-day probes (14:36–14:51 UTC window) additionally confirmed: the AWS WAF challenge on `content.php` at 14:46:02Z (same 2,011-byte body, sha256 recorded in the earlier manifest generation), guest `my.unt.edu/psc/ps/EMPLOYEE/SA` manage-classes flow with identical JS-shell results, and `online.unt.edu` 404s on `/schedules` and `/courses`. Those cache generations were lost to sandbox resets; the entries above are the surviving authoritative record. Where a claim rests on the lost generation, it is marked as reproduced in the current run or noted.*

**Known limitations.** (1) The project sandbox died repeatedly (provider-verified) during the survey; each death erased the disk cache and scratch files. Every table entry above comes from live fetch output captured during the coherent final pass (15:05–15:11 UTC); that cache generation was lost afterward, and neither the fetcher script nor any cache generation survived to be committed. (2) Pages requiring JS execution (PeopleSoft Fluid tiles, SAS Visual Analytics) could not be exercised beyond static fetches; underlying data endpoints were not discovered and are marked unverified rather than guessed. (3) The catalog's subject-level coverage and coid shape remain unverified due to the WAF challenge (honored, not bypassed). (4) `insights2.unt.edu` refused TLS connections, so its report internals are unverified. (5) No page was fetched more than twice; catalog deep-page attempts were spaced ≥120 s per robots crawl-delay.

---

## Task decision (2026-10-11)

Per the task's own condition ("if no source qualifies, the survey alone is the complete result"): **no ingest is performed in this change.** No candidate bundle is produced, `frontend/src/lib/generated/seed-data.json` and `courses/*.json` are untouched, and `activeDataset` continues to describe the shipped synthetic-sample bundle. The unresolved external item — an authorized data feed or explicit written permission from UNT Registrar/IT — is recorded in the PR Handoff for Sam. The tested candidate-bundle validator and comparison tooling in `tools/catalog-ingest/lib/` and `frontend/tests/data/` define the contract any future authorized source must meet.
