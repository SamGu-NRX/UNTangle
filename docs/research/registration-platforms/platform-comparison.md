# Platform Comparison and First Adapter Recommendation

Companion to `registration-platform-survey.md` in this directory. This document completes the follow-up scope: a platform-by-platform comparison across the survey schools, a recommendation for which adapter to build first, and the distinction between platform-family coverage and per-school DOM compatibility. It reuses the survey's evidence; the only new data gathered for this pass is official enrollment evidence, gathered because the recommendation must be sized in students. Nothing here re-runs the survey's probes or research.

Evidence rules for this document:

- "Verified" means confirmed this session by an official page or a live HTTP probe, as recorded in the survey's source index or in the enrollment table below.
- "Reported, unverified" means secondary web sources say so and nothing official confirmed it. These claims are used only to size potential upside, never as support for a recommendation on their own.
- Enrollment arithmetic below is our own computation over the cited figures; the figures themselves are cited to official sources.

## 1. Enrollment evidence

Officially verified figures (each from the university's own page or an official university-system page):

| School | Enrollment | Term | Official source |
|---|---:|---|---|
| Ohio State | 67,255 | Autumn 2025 census | news.osu.edu enrollment release |
| UT Austin | 55,000 | Fall 2025, 12th class day | news.utexas.edu enrollment release |
| University of Houston | 48,972 | Fall 2025 | uh.edu enrollment release |
| Texas State | 44,250 | Fall 2025 (THECB data) | tamus.edu system data page |
| UNT | 43,567 | Fall 2025 | institutionalresearch.unt.edu Fall 2025 fact sheet |
| UTRGV | 35,812 | Fall 2025 first-day count (not yet official at 12th class day per the page's own note) | utrgv.edu newsroom |
| UC Berkeley | 33,122 undergraduates | Fall 2025 | opa.berkeley.edu Quick Facts |
| Arizona State | 78,000+ projected campus enrollment, excludes ASU Online | Fall 2025 projection | news.asu.edu enrollment release |

Not verified this session (no official figure surfaced; secondary estimates exist but are not used here): Texas A&M College Station, Texas Tech, UT Arlington, UT El Paso, Florida, UIUC, Rutgers, UCLA, Minnesota, UCSD, Washington, UCF, Penn State, Michigan, Arizona. Any student totals below that would depend on these schools are therefore stated as floors, not totals.

## 2. Platform-by-platform comparison

### Ellucian Banner, Self-Service Banner family

- Verified members in scope: UTRGV (live public SSB class search, HTTP 200 with Banner and Ellucian markers, no robots.txt), Texas State (official faculty guide names SSB at ssb.txstate.edu), Lamar (official registrar page names Self-Service Banner), Tarleton State (official registrar Banner page).
- Public no-login access: verified live at UTRGV, including the term-selection and class-search surface an extension would read. Texas State's SSB is login-oriented for registration; public search unconfirmed.
- DOM stability expectation: the SSB surface shares URL shapes (`/StudentRegistrationSsb/ssb/...`) across schools because it ships as one Ellucian product; legacy `bwskfcls`-style pages persist at some institutions (observed on a Purdue-hosted Ellucian page in the survey probes). Customization and version drift between schools are real, so per-school fixtures remain mandatory.
- Coverage math: verified-floor students at schools with a verified Banner label: UTRGV 35,812 plus Texas State 44,250 equals 80,062. Reported, unverified Banner labels at Texas A&M, Texas Tech, UT Arlington, UTSA, Sam Houston, Angelo State, Prairie View A&M, and Midwestern would raise the family's reach well past 300,000 students if they verify, but none of that counts until it does.
- Extension risk profile: lowest of the three families. Server-rendered or lightly hydrated pages, no bot challenge observed at UTRGV, no robots.txt obstacles at the verified member.

### Oracle PeopleSoft Campus Solutions family

- Verified in scope: Ohio State (official IT pages name the SIS and My Buckeye Link; PeopleSoft vendor label itself is secondary-only, downgraded in the citation audit) and Florida (official pages verify ONE.UF and the public Schedule of Courses; same vendor-label downgrade).
- Public no-login access: verified at both flagship members, with a caveat at each: Florida's robots.txt disallows /soc to crawlers, and Ohio State's public search lives at classes.osu.edu while enrollment tasks are login-only.
- Reported, unverified members: UNT, University of Houston, Penn State, Michigan, Arizona, UCF, UMass.
- Coverage math: verified-floor students at the two verified members cannot be stated as a family total without vendor labels: Ohio State 67,255 is verified enrollment at a school whose PeopleSoft label is not. Florida's enrollment figure was not found this session. UNT (43,567) and Houston (48,972) are verified enrollments at schools whose PeopleSoft labels are reported only.
- Extension risk profile: medium. Component-style pages (`CLASS_SEARCH.GBL` patterns) are internally consistent but the branded portals wrap them differently per school, and the survey found Penn State's public path hard to locate and Michigan behind a challenge.

### Custom public class-search applications

- Verified members: UT Austin (registrar-hosted public schedule), UIUC (Course Explorer plus the CISAPI public API, verified live returning unauthenticated XML), Berkeley, UCSD, Minnesota, UCLA, Rutgers, Ohio State's classes.osu.edu.
- Coverage math: UT Austin 55,000 plus Berkeley 33,122 gives a verified floor of 88,122 across just two of the eight members.
- Extension risk profile: highest per school. Each app is bespoke, so each school is its own adapter with no family reuse; the compensation is data quality, and UIUC's documented public API is the best surface found anywhere in the survey. Note that two of these (UCLA, Rutgers) sit on PeopleSoft-family institutions per secondary sources, so "custom app" here means the public front end, not the underlying SIS.

### Workday Student

- No in-scope school runs registration on Workday Student today. Confirmed go-lives elsewhere (LSU, Iowa State, Arkansas and Wisconsin systems, Minnesota State, per Workday newsroom and institution pages) make this a medium-term factor only. Recommended treatment: keep adapters data-driven so a future Workday school is a new adapter, not a rearchitecture.

### Others (Colleague and unclassified)

- Texas Woman's (Colleague, verified via official service-center page) and the schools the survey could not classify (Stephen F. Austin, Purdue, Georgia State among them) stay out of the ranking. Purdue's probe was inconclusive; Georgia State's classification rests on secondary sources only.

## 3. Family coverage versus per-school DOM compatibility

These are different claims and must not be conflated:

- Family coverage is about architecture reuse: a Banner SSB adapter skeleton, once built, addresses a known product surface at every SSB school, because Ellucian ships the same application. The verified floor for that reuse today is 80,062 students (UTRGV plus Texas State), with large reported upside.
- Per-school DOM compatibility is about what actually renders at a given school: themes, custom headers, version drift (Banner 8 versus 9 versus Ellucian Experience), campus-specific fields, and bot defenses. The survey found the same family behaving differently across schools: UTRGV's SSB is publicly reachable while Texas State's SSB is login-oriented; Michigan is behind a challenge while other PeopleSoft schools are open.
- Practical consequence: family membership estimates the cost of the next school's adapter but never removes its fixture. Every school ships with its own recorded DOM fixture and a live verification check, regardless of family. The reverse also holds: a custom-app school (UT Austin, UIUC) gets zero leverage from any family, which is why the custom family's strong enrollment floor buys the least adapter reuse.

## 4. Recommendation: build the UNT adapter first, then the Banner SSB family adapter

First adapter: a UNT-specific adapter for myUNT's class-search surface, built standalone.

Why first, despite this document ranking families by reach:

1. The product's first audience is UNT students (the repo's existing UNT-facing integrations, such as the Visual Schedule Builder work, point the same way), so the first adapter must serve UNT regardless of what any family ranking says. UNT's enrollment is verified at 43,567 for Fall 2025, the third-largest verified figure among Texas publics in scope.
2. UNT's SIS label (PeopleSoft) is reported, unverified, which is exactly why it cannot be the first instance of a PeopleSoft family adapter. Building it standalone avoids betting family leverage on an unverified label.
3. One narrow, out-of-band task follows from this and is recorded as next work: verify UNT's underlying registration platform from an official source, since it decides whether the second adapter is a PeopleSoft family adapter or something else.

Second adapter: the Banner SSB family adapter, using the UTRGV surface as the reference implementation.

Why this family second rather than PeopleSoft or custom:

1. Largest verified floor with family leverage: 80,062 students across two verified members, and the biggest reported upside (eight more Texas publics, 300,000-plus students if labels verify).
2. The reference surface is verified working without login, with no robots.txt obstacle and no bot challenge observed.
3. Per-school cost is lowest in the family because SSB ships as one product; the fixture-per-school rule in section 3 still applies.
4. PeopleSoft has a bigger single-school verified number (Ohio State, 67,255) but weaker family leverage: fewer verified public surfaces, more portal wrapping, and its other large members' enrollments are unverified. The custom family's verified floor (88,122) is slightly larger than Banner's, but every additional school in it is a full bespoke adapter, so it wins on data quality, not on coverage per unit of work.

What would reverse this call: an official source showing UNT runs something other than PeopleSoft (changes adapter two's family); verified public class search at a login-gated PeopleSoft flagship (raises PeopleSoft's floor); or a product decision to prioritize national users over Texas users (elevates Ohio State's single-school reach above family economics).

## 5. Claims register

Every load-bearing claim in this document and its evidence class:

- UTRGV runs Banner SSB with a public class search: verified (official registrar instructions plus live probe).
- Texas State, Lamar, Tarleton run Banner: verified (official registrar or faculty pages).
- TWU runs Colleague: verified (official service-center page).
- Ohio State and Florida SIS portals and public search surfaces: verified (official IT pages plus live probes); their PeopleSoft vendor labels: reported, unverified (downgraded during the citation audit).
- Banner labels at Texas A&M, Texas Tech, UT Arlington, UTSA, Sam Houston, Angelo State, Prairie View A&M, Midwestern; PeopleSoft labels at UNT, Houston, Penn State, Michigan, Arizona, UCF; custom SIS labels at UW, Georgia State: reported, unverified (secondary sources).
- Workday Student go-lives outside scope: verified to vendor and institution announcements (Workday newsroom, lsu.edu, miamioh.edu); none in scope today.
- All enrollment figures in section 1: verified to the cited official sources; all other schools' enrollments: not verified, not used.
- DOM stability expectations and the family-versus-school distinction in sections 2 and 3: analysis based on the verified probes, labeled as analysis, not sourced fact.
