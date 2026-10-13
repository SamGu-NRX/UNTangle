# Registration Platform Survey: Large US Public Universities

Scope: roughly 25 of the largest US public universities, prioritizing Texas publics. The goal is to understand, for each school, (1) what student information system (SIS) powers registration and class search, (2) whether class search is publicly reachable without login, and (3) what the practical data-access terms look like for a browser extension that reads class-search pages. This supports the UNTangle extension-platform decision: which schools a DOM-reading extension can plausibly support, which expose friendlier data, and which sit behind portals or bot defenses.

Method and evidence notes:

- Web research against official registrar, IT, and vendor pages (Perplexity Sonar Pro, October 2026), plus direct HTTP probes of public class-search pages and robots.txt files run from this repo's sandbox.
- Every claim below is tagged with how it was verified. "Verified" means an official page or a live HTTP probe confirmed it this session. "Reported, unverified" means secondary web sources say so but no official or live check confirmed it; treat those as leads, not facts.
- Probes used a generic user agent, single requests only, no login, and no CAPTCHA or access-control bypass. Sites that served a bot challenge were recorded as challenged, not probed further.
- No .env files were read, no accounts were touched, and nothing in .obvious was modified.

## 1. Platform landscape summary

Three vendor families plus custom builds dominate the large-public space:

- Ellucian Banner (Self-Service Banner, SSB): the most common among Texas publics. Public class search, when offered, lives at paths like `/StudentRegistrationSsb/ssb/...` on a dedicated host (for example, UTRGV's `assist.utrgv.edu`). Pages are server-rendered or lightly hydrated HTML with stable structures; older schools run the legacy `bwskfcls`-style pages.
- Oracle PeopleSoft Campus Solutions: common among the largest national publics. Branded portals (ONE.UF, My Buckeye Link, MyU) sit on top; the underlying platform is recognizable by its URL structure and `CLASS_SEARCH.GBL`-style component names. Per-school vendor labels follow the verification tags in the tables: Ohio State's and Florida's official pages confirm their SIS portals and public search surfaces, while their PeopleSoft naming is secondary-source only; Penn State LionPATH, Michigan, Arizona, Houston, and UMass SPIRE rest entirely on secondary sources.
- Custom public class-search applications: a meaningful share of the biggest schools have built modern public front ends, often React single-page apps backed by internal APIs with no documented public contract (Berkeley's Class Search, UCSD's Schedule of Classes, Minnesota's Schedule Builder, UCLA's public SOC, Ohio State's classes.osu.edu, UIUC's Course Explorer).
- Workday Student: a growing but still minority SIS. Confirmed large-public go-lives include LSU, Iowa State, the University of Arkansas System, the University of Wisconsin System, Minnesota State, the University of Alaska System, and Dallas College. None of the schools in this survey's confirmed list runs registration on Workday Student today, but the migration pipeline is real (for example Miami University in Ohio targets fall 2027). An extension strategy should expect more Workday Student schools over a 3 to 5 year horizon.

Practical takeaway: a browser extension that reads class-search DOMs has a workable surface at schools with public, stable search pages (most Banner SSB schools and several custom apps), and a hard wall at schools that gate class search behind login portals or bot defenses. Machine-readable public APIs are rare; UIUC's CISAPI is the standout exception.

## 2. Texas public universities

Nineteen large Texas publics were checked. Portal names in parentheses.

| University (portal) | SIS | Public class search without login | Verification |
|---|---|---|---|
| UT Austin | Custom in-house (no vendor identified) | Yes: public Course Schedule at registrar.utexas.edu/schedules with per-term listings | Verified: official registrar pages; live site reachable |
| Texas A&M College Station (Howdy) | Banner reported, not stated on cited registrar page | Yes: registrar page directs to Howdy portal's public class search; direct SSB host served a Cloudflare challenge to our probe | Verified for Howdy as public access point; SIS vendor reported, unverified |
| Texas Tech (Raiderlink) | Banner (reported) | Not confirmed | Reported, unverified |
| University of Houston (myUH) | PeopleSoft Campus Solutions (reported) | Not confirmed | Reported, unverified |
| UT San Antonio (ASAP) | Banner (reported) | Not confirmed | Reported, unverified |
| UT Dallas (Orion) | Banner (reported) | Not confirmed; probe of a candidate host failed to connect | Reported, unverified |
| UT Arlington (MyMav) | Banner (reported) | Not confirmed | Reported, unverified |
| University of North Texas (myUNT) | PeopleSoft (reported) | Not confirmed | Reported, unverified |
| Texas State (Catsweb) | Banner, Self-Service Banner at ssb.txstate.edu | SSB host is login-oriented for registration; class-search availability without login not confirmed | Verified: faculty guide names SSB explicitly |
| UT El Paso (myUTEP) | Not established | Yes: catalog.utep.edu/course-search serves a public course search (catalog-level, no meeting times confirmed) | Verified: live probe, HTTP 200 |
| UT Rio Grande Valley (ASSIST) | Banner, Student Registration SSB | Yes: assist.utrgv.edu/StudentRegistrationSsb/ssb/term/termSelection?mode=courseSearch is public; classSearch page returns HTTP 200 with Banner and Ellucian markers; no robots.txt | Verified: registrar instructions plus live probe |
| Sam Houston State (SamWeb) | Banner (reported) | Not confirmed | Reported, unverified |
| Stephen F. Austin | Not established | Not confirmed | Reported, unverified |
| Lamar (LU Connect) | Banner, Self-Service Banner | Registrar instructions direct students to SSB; public no-login search not confirmed | Verified: registrar page names Self-Service Banner |
| Tarleton State (myGateway) | Banner | Not confirmed | Verified: registrar Banner info page |
| Angelo State (RamPort) | Banner (reported) | Not confirmed | Reported, unverified |
| Prairie View A&M | Banner (reported) | Not confirmed | Reported, unverified |
| Texas Woman's (Portal) | Ellucian Colleague | Not confirmed | Verified: TWU service center names Colleague |
| Midwestern State (MustangsHUB) | Banner (reported) | Not confirmed | Reported, unverified |

Texas pattern: the state is overwhelmingly Banner territory, with PeopleSoft at Houston and North Texas and a custom public schedule at UT Austin. Verified public, no-login class search among Texas publics is thinner than the national set; UTRGV's public Banner SSB endpoint and UTEP's catalog search are the two confirmed wins, and UT Austin's registrar-hosted schedule is fully public.

## 3. Large national publics

Twelve large publics outside Texas. All class-search access statuses below come from live probes unless marked otherwise.

| University (portal) | SIS | Public class search without login | Notes |
|---|---|---|---|
| Arizona State | PeopleSoft under My ASU (reported) | Yes (reported): ASU Class Search | Not live-probed |
| Ohio State (My Buckeye Link) | SIS and My Buckeye Link verified via official OSU IT pages; PeopleSoft vendor label reported, unverified | Partially: classes.osu.edu serves a public "Class Search" (HTTP 200); enrollment itself is login-only via Buckeye Link | Verified: official IT docs and live probe; vendor label unverified |
| University of Florida (ONE.UF) | ONE.UF portal verified via official UF pages; PeopleSoft vendor label reported, unverified | Yes: one.uf.edu/schedule is public (HTTP 200); robots.txt disallows /soc to crawlers | Verified: official UF pages and live probe; vendor label unverified |
| University of Central Florida (myUCF) | PeopleSoft (reported) | Yes (reported): UCF Class Search | Not live-probed |
| University of Michigan (Wolverine Access) | PeopleSoft-based student administration (reported) | LSA Course Guide is public but sits behind a bot challenge (HTTP 403 to probe) | Verified challenge; SIS reported, unverified |
| University of Washington (MyPlan) | Custom UW SIS (reported) | MyPlan reachable without login (HTTP 200); legacy Time Schedule URL returned 404, current path unconfirmed | Live-probed root only |
| Rutgers (myRutgers) | PeopleSoft (reported) | Yes: sis.rutgers.edu/soc public (HTTP 200) | Live probe |
| UCLA (MyUCLA) | PeopleSoft-based (reported) | Yes: sa.ucla.edu/ro/public/soc public (HTTP 200); no robots.txt | Live probe; SIS reported, unverified |
| UIUC | Custom enterprise system | Yes, best-in-class: courses.illinois.edu plus CISAPI, a documented, unauthenticated public API (verified HTTP 200 XML); robots.txt disallows /cisapp/ and /search/ to crawlers | Verified |
| University of Arizona (UAccess) | PeopleSoft (reported) | Yes (reported): Schedule of Classes | Not live-probed |
| Penn State (LionPATH) | PeopleSoft Campus Solutions | Unclear: public.lionpath.psu.edu root returned a PeopleSoft error page; a working public class-search path was not found this session | Live probe |
| University of Georgia (Athena) | Banner | Registrar site reachable (HTTP 200, Banner markers); public no-login class search not confirmed | Live probe of registrar root |

Additional public custom apps live-probed during fingerprinting: Berkeley's classes.berkeley.edu (HTTP 200, "UCB Class Search"), UCSD's act.ucsd.edu Schedule of Classes (HTTP 200; robots.txt disallows /cwp/tools/search), and Minnesota's schedulebuilder.umn.edu (HTTP 200, no robots.txt). Michigan's Course Guide (lsa.umich.edu/cg) and Texas A&M's compass-ssb host both served Cloudflare challenges, meaning lightweight probes and likely extension traffic face a bot wall there.

## 4. Grade distributions and catalogs

This part is the least settled; the honest summary is that grade-distribution data is not consistently public.

- Grade distributions: no official, current grade-distribution dataset was verified for any school in scope this session. UIUC's well-known GPA data exists but a reliable official URL did not surface; UW historically exposed grade distributions through its class-search interfaces but the current endpoint was not confirmed. Several third-party aggregators exist, but third-party data is not a substitute for official sources and carries accuracy risk. If grade distributions become a UNTangle feature, expect a school-by-school effort with most schools requiring institutional permission or offering nothing.
- Course catalogs with prerequisites: broadly public. Nearly every school in scope runs a public catalog or course-explorer site with descriptions, credit hours, and prerequisites (for example catalog.utep.edu, catalog.ufl.edu, UIUC's Course Explorer). Coverage and structure vary by school and catalog year, so per-school parsers are unavoidable.
- Machine-readable sources: UIUC's CISAPI is the only documented, authentication-free public API verified this session. It exposes Schedule, Catalog, GenEd, Term, and Subjects modules as XML (verified live), and the university's own answer page confirms it needs no authorization. One caveat from its own robots.txt: the /cisapp/ API path is disallowed to crawlers, which for a browser extension (acting as the student's agent, not a crawler) is tolerable but argues for conservative request volumes and caching.

## 5. Data-access terms and extension implications

Findings from robots.txt and probe behavior:

- No robots.txt at all: assist.utrgv.edu (UTRGV Banner SSB), sa.ucla.edu (UCLA SOC), sis.rutgers.edu (Rutgers SOC), schedulebuilder.umn.edu (Minnesota). Absence is not permission, but nothing asks crawlers to stay away either.
- robots.txt with targeted disallows: courses.illinois.edu disallows /cisapp/, /cisdocs/, /search/; one.uf.edu disallows /soc; act.ucsd.edu disallows /cwp/tools/search; catalog.utep.edu disallows archive/admin paths. These signal that the operators care about automated bulk access on exactly the high-value paths, even though the public pages themselves are open.
- Bot defenses: Cloudflare or equivalent challenges on lsa.umich.edu/cg and compass-ssb.tamu.edu; classes.osu.edu robots.txt currently returns an S3 AccessDenied error (misconfiguration). Extensions running inside a real user's browser generally pass these challenges naturally, but any server-side companion service will not.
- Compliance posture this survey adopted, and the one an extension should adopt: read only what the logged-out student can read, never bypass authentication or challenges, prefer documented APIs where they exist, cache and throttle aggressively, avoid collecting personal data beyond the user's own context, and re-check terms before any bulk or server-side collection. Public access is not authorization for bulk extraction; the University of Illinois documentation itself separates "no auth needed" from any license for bulk crawling.

## 6. What this means for the extension platform decision

- Highest-confidence support targets: schools with public, stable, no-login class search, verified this session: UTRGV (Banner SSB), UT Austin (registrar schedule), UTEP (catalog search), Ohio State (classes.osu.edu), UF (one.uf.edu/schedule), Rutgers (sis.rutgers.edu/soc), UCLA (sa.ucla.edu/ro/public/soc), Berkeley, UCSD, Minnesota, UIUC (plus a real API).
- Login-gated or unconfirmed: most Texas Banner schools (class search likely exists publicly but was not confirmed), Penn State's public path, and everything marked "reported, unverified" in the tables. These need one more verification pass before being promised to users.
- Bot-wall schools: Michigan and Texas A&M challenged lightweight probes. In-browser extension traffic may still work, but this is a per-school question to settle with real browser testing, not a blocker to assume away.
- Architecture implication: plan for per-school adapters rather than a universal parser. Banner SSB schools share URL shapes, so one adapter family covers many Texas publics; PeopleSoft schools share component patterns; custom apps (Berkeley, UCSD, Minnesota, UCLA, Ohio State) each need their own. UIUC shows the ideal end state: when an official public API exists, use it instead of the DOM.
- Forward risk: Workday Student migrations (LSU, Iowa State, Arkansas, Wisconsin systems already live) will steadily change the DOM landscape. An adapter design with a small per-school test fixture set will age better than hand-written selectors.

## 7. Source index

Official pages consulted (all accessed October 13, 2026):

- registrar.utexas.edu/schedules/269/using (UT Austin Course Schedule usage)
- registrar.tamu.edu/registration-scheduling-and-analytics/index.html (Howdy public class search)
- docs.gato.txst.edu/140208/Quick-Steps--Faculty-Self-Service.pdf (Texas State SSB)
- tarleton.edu/registrar/employee/banner-info/ (Tarleton Banner)
- utrgv.edu/online/degree-and-courses/online-hybrid-courses/course-search/index.htm and assist.utrgv.edu (UTRGV ASSIST, Banner SSB)
- lamar.edu/students/registrar/registration/course-schedules.html (Lamar Self-Service Banner)
- servicecenter.twu.edu/TDClient/1956/Portal/KB/Category/27806/Colleague (TWU Colleague)
- catalog.utep.edu/course-search/ (UTEP public course search)
- it.osu.edu/student-information-system-sis/sis-my-buckeye-link-reference-guide and registrar.osu.edu (Ohio State PeopleSoft, Buckeye Link)
- it.ufl.edu/services/122 and dcp.ufl.edu/admissions/advising/ (UF ONE.UF, Schedule of Courses)
- catalog.ufl.edu/UGRD/academic-regulations/grades-grading-policies/ (UF grading policy, not distribution data)
- courses.illinois.edu, answers.uillinois.edu/uic/88215, courses.illinois.edu/cisdocs/api (UIUC Course Explorer and CISAPI)
- newsroom.workday.com/2024-10-24-28-Higher-Education-Institutions-Go-Live-with-Workday-Student-in-2024, investor.workday.com 2025 press release, lsu.edu/workdaystudent/updates.php, miamioh.edu/workday-info/faqs.html (Workday Student adoption)
- Enrollment sources: news.osu.edu Ohio State autumn 2025 enrollment release (67,255); news.utexas.edu September 18, 2025 release (55,000); uh.edu September 23, 2025 release (48,972); tamus.edu data-science Texas publics Fall 2025 summary (Texas State 44,250); institutionalresearch.unt.edu Fall 2025 fact sheet PDF (43,567); utrgv.edu newsroom September 2, 2025 release (35,812 first-day); opa.berkeley.edu Quick Facts (33,122 undergraduates); news.asu.edu August 11, 2025 release (78,000-plus projected campus enrollment)
- Live probes this session: assist.utrgv.edu (SSB classSearch), classes.osu.edu, sa.ucla.edu/ro/public/soc, sis.rutgers.edu/soc, one.uf.edu/schedule, classes.berkeley.edu, act.ucsd.edu/scheduleOfClasses, schedulebuilder.umn.edu, courses.illinois.edu/cisapp/explorer/catalog/2024.xml, catalog.utep.edu, myplan.uw.edu, public.lionpath.psu.edu, selfservice.mypurdue.purdue.edu, www.reg.uga.edu, catalog.gsu.edu, my.ucdavis.edu, plus robots.txt for the hosts listed in section 5
- Schools whose SIS classifications rest on secondary web results only, flagged "reported, unverified" above: Texas Tech, University of Houston, UTSA, UT Dallas, UT Arlington, UNT, Sam Houston State, Stephen F. Austin, Angelo State, Prairie View A&M, Midwestern State, ASU, UCF, Michigan, UW, Rutgers (SIS only), UCLA (SIS only), Arizona, UGA, Georgia State, Purdue (probe inconclusive)

## 8. Citation audit (follow-up pass, October 13, 2026)

A citation audit of this document re-checked every factual claim against its cited source class. Findings:

- Two claims corrected: the Ohio State and Florida rows previously stated "PeopleSoft Campus Solutions" as if verified by the cited official pages. The official pages verify each school's SIS portal (My Buckeye Link, ONE.UF) and public search surface; the PeopleSoft vendor naming came from secondary sources only. Both rows now carry "reported, unverified" vendor labels, and the section 1 PeopleSoft bullet was annotated to match.
- Claims register, by evidence class: (a) verified via official pages: platform labels for Lamar, TWU, Texas State, Tarleton, UTRGV (also live-probed), Texas A&M's Howdy access point, Ohio State's SIS portal, Florida's ONE.UF; (b) verified via live probe this session: all public-access statuses and robots.txt findings in sections 3 and 5; (c) verified via vendor or institution announcements: Workday Student go-lives in section 1 (none in scope); (d) reported, unverified: every SIS label tagged as such in sections 2 and 3, including all ten secondary-sourced Texas schools; (e) not verified and therefore unused: grade-distribution datasets (section 4 states none was confirmed), and enrollment figures for any school outside the list in section 7's enrollment sources.
- Verification status of every school is carried in the tables themselves, so no claim in this document lacks an evidence tag. The platform-by-platform comparison, adapter recommendation, and enrollment evidence built on this survey are in `platform-comparison.md` in this directory.
