# UNTangle architecture

Readers: everyone building UNTangle, including Obvious Autobuild agents. This page says how the system is divided, which contracts hold it together, who owns what, and the order to build in. When a task brief and this page disagree, this page wins until the lead changes it.

Sources: two independent design proposals, by Claude Fable (architecture counsel) and GPT Astra (Codex), both written against `alpha` at 3d5e4a0. The lead merged them, and an independent Opus review checked the result against the code. Where the proposals disagreed, the decisions table at the end gives the choice and the reason.

## What exists today, and what has to change first

UNTangle is one Next.js 16 app in `frontend/`. It serves the UI and the API routes, stores data in Postgres through drizzle, and signs people in with better-auth (magic link first). Most domain logic is pure TypeScript in `frontend/src/lib/`: the planner, optimizer, reasons, prereq, pathing, preferences, instructors, calendar-feeds, policy, terms, campus routing and plan-library.

Four facts in the current code shape the plan:

- **Saved state is incomplete.** `planner_state` (`db/schema.ts`) is one row per user with a compare-and-set revision (`persistence.ts`). Preferences (`components/schedule/preferences-store.ts`) and saved schedules (`lib/saved-plans/store.ts`) live only in the browser's localStorage. A phone app built on today's server state would lose both.
- **Domain logic has leaked into components.** `components/courses/model/*` and `components/schedule/{week-model,constraint-logic,run-state}.ts` are pure logic. `lib/webmcp/tools.ts` and `lib/preferences/schema.ts` import from `@/components`. `lib/planner.ts` imports seed data and touches `window.sessionStorage`.
- **Section data has one third-party source.** `lib/sections/config.ts` fetches a 16 MB file per term from `vsb.untgrades.app`, a volunteer mirror, inside a request handler, and caches it per process. Grade-history pacing and its cache are also per process, so two server instances would double our load on untgrades.
- **Local data leaks between students.** The planner's one localStorage key (`lib/planner-store.ts:26`) holds a signed-in student's backup, including transcript rows. Signing out clears nothing, and the guest path reads that key. So the next guest on a shared computer sees the previous student's plan. The saved-plan library key is shared the same way.
- **Saves can be misreported.** A network error after the database commits is reported as "not saved" (`planner-save.ts`), because there is no receipt that a retry could look up.

## Shape

```text
frontend/                 Next.js web app and API host (stays where it is)
  src/app/api/v1/**       thin route files: schema check, rate limit, call a handler
  src/server/handlers/**  (Request, ctx) => Response; no next/* imports
  src/server/auth/**      better-auth for web; device grants for mobile and extension
  src/server/db/**        drizzle repositories and transactions
  src/platform/**         IndexedDB store, web worker for Auto, PDF.js, WebMCP
  src/components/**       web UI
apps/
  mobile/                 Expo (iOS first), EAS Update
  extension/              Manifest V3: content script, background worker, panel
packages/
  core/                   pure domain logic: no React, Next, Node, DOM, storage, or bundled data
  campus/                 institution adapters (UNT first): identifiers, prerequisite grammar, normalizers, map config
  contracts/              zod schemas for every /api/v1 route, the sync protocol and extension messages; typed client
  sync/                   client sync engine: document store port, outbox, receipts, status
  tokens/                 design tokens as CSS variables and a TS object (web, native, extension shadow root)
  ingest/                 Node only: source policies, fetchers, validators, release publishing
data/                     small reviewed artifacts with source records (catalog, degree plans, buildings)
```

Dependencies only point one way. Lint enforces it, and `packages/core`'s tsconfig has no DOM library, so `window`, `localStorage` and `fetch` types fail to compile there:

```text
tokens <- ui (web, native, extension)
core <- campus <- contracts <- sync <- frontend, apps/*
```

Code in `core` that needs I/O takes it as an argument (`FetchLike`, a clock, a store), the pattern `planner-save.ts` already uses. Core never imports campus data; the caller passes it in.

There's no desktop app. The web app at 1200px and wider is the desktop experience. A third native shell would add a credential store, an update channel and a test matrix without solving a student problem the web can't.

## Identifiers

Institution, campus site, catalog year and term are separate concepts. UNT Denton and UNT Frisco share an institution and a registration system but have different buildings. `CSCE 1030` and a class number are only unique inside an institution and term.

```ts
type Id<K extends string> = string & { readonly __kind: K };
type InstitutionId = Id<"institution">;   // "unt"
type CampusSiteId = Id<"campus-site">;    // "unt-denton", "unt-frisco"
type CatalogId = Id<"catalog">;           // "unt-2026-27"
type TermId = Id<"term">;                 // "spring-2027", as stored today; unique within an institution
type CourseId = Id<"course">;             // "CSCE 1030", plain, unique within an institution
type EnrollmentOptionId = Id<"enrollment-option">;  // institution + term + provider + component ids
```

Every document carries its `institutionId`. Inside an institution's documents, course and term keys stay plain strings such as `CSCE 1030` and `spring-2027`, so nobody invents a prefix and saved snapshots need no rewriting.

An enrollment option is the primary section plus its required linked components, as `sections/model.ts` already models it. Lecture and lab never become independently selectable rows. Display labels and instructor names are never identities.

## The campus adapter

The interface below is the target. It gets built in step 7, when UT Austin's real data can test it; until then, UNT code stays where it is, and only `institutionId` on documents is required now.

```ts
interface CampusAdapter {
  institutionId: InstitutionId;
  sites: readonly CampusSiteId[];
  timeZone: string;
  code: { parse(raw: string): CourseId | null; format(id: CourseId): string };
  terms: { list(): TermCalendar[]; current(now: Date): TermId | null };
  parsePrerequisite(text: string, ctx: { catalogId: CatalogId }): PrerequisiteParseResult;
  sections: Capability<{ normalize(raw: unknown, term: TermId): EnrollmentOption[] | Diagnostic }>;
  degreePlans: Capability<{ validate(plan: unknown): DegreePlan | ValidationFailure }>;
  policy: CreditPolicy;
  map: CampusConfig;                        // today's lib/campus/config.ts shape
  registration: { system: "peoplesoft-cs" | "banner-ssb" | "custom"; portalName: string; classSearchUrlPatterns: string[] };
  links: { catalogCourse(id: CourseId): string; rateMyProfessorsSearch?(name: string): string };
}
type Capability<T> = { kind: "supported"; service: T } | { kind: "unsupported"; reason: string };
```

Reading the registration page in the extension is a separate `PortalAdapter`, built from sanitized captures of a real page. It must never become a way for the server to fetch from the portal.

UT Austin is the proof that the adapter is real. Until its real identifiers and permitted sources run through unchanged core algorithms, multi-campus is unproven.

## Saved state: documents with receipts

The planner blob becomes separate documents. Each has its own revision:

| Document | One per | Holds |
|---|---|---|
| `academic-record` | user and institution | course statuses, approved transcript rows, manual credit, major, catalog year |
| `schedule` | user, institution and term; many allowed | name, courses, selected options, locks, Auto's last transaction |
| `preferences` | user and institution | hard limits, leanings, the 1 to 5 importance scale, presets, connected calendars |
| `version` | schedule; append-only | an immutable snapshot ("Before Auto", restore points, imports) |

Roadmaps and notification subscriptions get documents when their features are built, not before. Connected calendars were built into `preferences`: each holds its name, its title-free busy slots for one term and its feed address sealed by the server (`frontend/src/lib/calendar-feeds/README.md`), merged per calendar on a conflict. A separate document would have split one setting the student changes in one place across two writes.

Each fact lives in exactly one document. Planned courses for a term belong to that term's schedule. The academic record holds only facts about the student's history: completed courses, courses in progress now, transfer and exam credit. Today `PlannerState` marks a planned course `inProgress`, and the migration moves those courses into the schedule. Auto plans and unplans courses for a term, so in this model it writes only that term's schedule, and its Undo record (`lastAuto`) commits in the same write as its effect. It never changes the academic record. A write carries its document's `kind`, so the server can check the body of a document's first write; on later writes the kind must match the stored document.

Some state never syncs and stays on each device: the active tab, the selected day, scroll and sheet position, the schedule being viewed. Another device shouldn't move the screen you're reading.

**Writes are whole-document compare-and-set,** as `persistence.ts` does today, plus a receipt:

```ts
interface Write { operationId: string; documentId: string; kind: DocumentKind; baseRevision: number; schemaVersion: 1; body: unknown | null /* null deletes */ }
interface Receipt { userId: string; operationId: string; writeSha256: string; committedRevision: number }
```

The server handles a write in one transaction:
1. Authorize the caller.
2. Look up the receipt by `(userId, operationId)`. If it exists and its `writeSha256` matches, return it; if the hash differs, reject the write.
3. Compare the revision.
4. Write the body, bump the revision and store the receipt.

The hash covers the whole write (document id, kind, base revision, schema version and body) exactly as the client stored it in its outbox, so a retry always matches, and a reused operation id can't match a different write that happens to share a body, as every delete's `null` body does. Versions are create-only: a version write has base revision 0 and a body, and the contract rejects anything else.

The one exception is the extension, which holds only a read-only view. It sends a single command, `add-option`, carrying the schedule revision the student saw when they confirmed. If the schedule has moved on since then, the server rejects the command, and the extension shows a fresh preview against the latest revision before the student confirms again. Applying it anyway would merge two schedule edits silently. No other commands exist in v1, so an over-the-air client never sends a command the server doesn't know.

**Pull is a list, not a change log.** A student has tens of documents. `GET /api/v1/sync` returns `(documentId, kind, revision, deleted)` for every one of them, and the client fetches whatever changed. With no cursor, there is no class of skipped-change bugs. Versions are listed by id, paged.

A client stores the local document and its pending write in one local transaction: IndexedDB on web, SQLite on mobile. Writes to one document go out one at a time. After a timeout, a client retries the same operation id and the same body. "Synced" is shown only once a receipt arrives. The status states:

```text
Saved on this device -> Waiting to sync -> Synced
                             +-> Needs sign-in
                             +-> Resolve conflict
                             +-> Save not confirmed; retrying
```

Receipts and deletion tombstones are kept for the document's lifetime in v1. Revisit that only if the tables grow.

**Conflicts depend on the document kind:**
- **Schedule:** never merged automatically in v1, because edits to different courses can still jointly break walking time, credits or locks. A clean client adopts the server copy. A dirty client keeps its draft and shows what differs, and the student picks one of three: use the latest, keep theirs as another schedule, or reapply chosen edits on top of the latest.
- **Preferences:** settled per field group. Each pending write keeps the body of the revision it was based on. On a conflict the client compares its draft with that base, group by group: a group it changed goes on top of the latest document, and every other group takes the latest value. A group both sides changed takes the client's value, since its write is the later one. Fields that constrain each other form one group and move together; for example, the earliest start and latest end are one group, so a merge can never leave an end before a start. Changing a preference on the phone never opens a conflict sheet on the laptop.
- **Academic record:** merged per course, three-way, against the base the client started from. A course only one side changed takes that side's value. A course both sides changed to different values goes to the student as one question per course. A stale offline edit can never silently overwrite a newer decision.

Delete-versus-edit is a conflict. An offline device can't resurrect a deleted schedule. Restoring a version creates a new revision; it never rewinds.

**Local data belongs to one identity.** Every local store (planner backup, library, preferences, outbox) is keyed by the signed-in user id or a guest id. The guest path never reads a user's keys, and signing out deletes that user's local copies from the browser. Sign-out first checks the outbox. If any write is waiting, unconfirmed or needs sign-in, it asks: "Some changes haven't synced. Sync now, or sign out and discard them?" Nothing in the outbox is deleted without that choice. Today a single shared key leaks one student's plan and transcript to the next person on the browser; `untangle/local-identity` fixes that before anything else builds on local state.

**Guests.** A guest works against the same local store under a guest identity, with sync off. On a shared computer, the next anonymous visitor must not inherit a previous guest's plan and transcript. An elapsed-time rule alone can't promise that, because a lab computer is often handed over minutes after the last edit. So the guest identity is tied to the browser session, and a handover inside one session gets its own guards:
- **The guest's session token lives in a cookie that ends when the browser closes.** The guest stores themselves outlive the session, and each write stamps its store with the token (`frontend/src/lib/guest-session.ts`). Tabs in one browser session share the token, which keeps the emailed sign-in link working. Guest data found under any other guest id is never shown: on load the app asks "Someone used UNTangle as a guest in this browser. Continue their work, or start fresh?" with no preview of the plan, and "start fresh" deletes it.
- **Idle lock:** after 30 minutes without interaction, a guest's screens are covered by the same question, again with no preview, before anything is drawn.
- **A transcript makes the risk concrete,** so a guest who imports one sees, before the import is stored: "This browser keeps your transcript until you clear it or close the browser. On a shared computer, sign in or clear it when you're done."
- **"Clear this browser"** is one step away on every screen, and guest data expires after 14 days without an edit as a backstop.

What remains: two students passing a browser back and forth within 30 minutes, without closing it, can't be told apart, and the import warning is the only guard there. The 30-minute and 14-day values are starting points with nothing measured behind them. Signing in follows `docs/architecture/guest-sync.md`, for each document kind: empty account means save automatically, with Undo; both sides have different work means one sheet with a question for each difference; a schedule or record that isn't chosen is kept as a saved copy in the account, and preferences that aren't chosen are replaced. Nothing is merged silently.

**Migration.** The order matters: a legacy write that lands after a row is migrated would be acknowledged and then lost, so a user's legacy writes stop in the same transaction that migrates their row.
1. **Old clients first.** Ship a web release whose old-API client treats an "upgrade required" response as final: it shows "UNTangle was updated. Reload to keep editing." and does no retry.
2. Deploy the document tables and readers.
3. Migrate each user's legacy row in one transaction that locks the row, writes the documents and records a migration marker. The legacy `/api/planner` write path takes the same row lock and answers "upgrade required" once the marker exists, so no legacy write can succeed after its row is migrated. Old writes never overwrite documents. The row becomes three documents: an academic record, a schedule named "Main", and preferences holding the row's optimization goal.
   - **Term:** `PlannerState` has no term field, so stamp the term the plan was made for, taken from its sections' term. Fall back to the current term only when a plan has no sections.
   - **Fields:** keep every field that has a home. `catalogId` starts null; the student or a transcript import sets it.
   - **Planned courses:** courses the legacy row marks `inProgress` without an in-progress transcript row move into Main's `courses`.
4. **Local data.** Constraints and weights live only in localStorage today, so the server starts preferences with the defaults. A local key counts as the student's only if it's stored under their own identity, which `untangle/local-identity` (#77) does for everything written since it shipped. The first signed-in web client offers those values as an ordinary preferences write. Older keys carry no owner, and that is the leak the identity work closes, so they are never offered to any account, even when they differ from the defaults: an ownerless key is moved into an account only when its contents canonically equal that account's own server copy, as #77 does, and every other one stays quarantined and is deleted after 30 days. A student whose settings predate #77 sets them again; that loss is the price of never handing one student's settings to another.

Polling on focus, on app foreground, and once a minute while visible keeps devices current. Add server-sent events only if students report stale phones.

## API

Every client route lives under `/api/v1/`, with request and response schemas in `packages/contracts`. The server validates with those schemas, and the typed client is built from the same ones. A contract test replays recorded fixtures through both. Route files are a few lines: rate limit, schema check, then a handler that imports nothing from Next. Splitting out a separate service later is then a file move, not a rewrite. Until there's a reason, Next stays the API host.

Surface:
- `sync` (push mutations, pull changes);
- `sections/{institution}/{term}/{course}`;
- `grades/*`;
- `map/{route,resolve}`;
- `catalog/{institution}/manifest`;
- `calendar-feeds/preview`;
- `device/{start,approve,inspect,token,refresh,revoke}`;
- `account` (export, delete).

## Sign-in for each client

| Client | Credential | Where it lives |
|---|---|---|
| Web | the existing better-auth session cookie | HttpOnly, host-only, SameSite=Lax |
| Mobile | an opaque device token of kind `mobile`; the server stores only its hash | iOS Keychain through SecureStore |
| Extension | an opaque device token of kind `extension` | `chrome.storage.local` with its access level set to trusted extension contexts, so it survives browser restarts for the grant's lifetime but is never visible to content scripts |

Mobile and the extension don't use better-auth's `bearer()` plugin. In the installed 1.5.5, it rewrites a bearer token into an ordinary full session cookie, with no scopes and no rotation (`better-auth/dist/plugins/bearer/index.mjs:19-57`). Instead there's one small first-party device-grant service. It is built in step 3b, just before the mobile and extension betas; the lead owns it, and it gets an independent security review before release.

1. The client creates a PKCE verifier and sends its S256 challenge and the grant kind (and, for the extension, the schedule role `main`) to `device/start`. The server stores only hashes and returns a device code for the client, an 8-character user code for the student, the approval page's address (`/device`), a 10-minute expiry and a 5-second polling interval.
2. The student opens `/device` in a browser and enters the user code (`/device?user_code=` fills it in). A magic link from email could open in a different browser, so the page signs the student in with a one-time code by email instead (better-auth's `email-otp` plugin, in 1.5.5), unless they're already signed in there. Meanwhile the client polls `device/token` with the device code and the verifier.
3. The page shows the account, the device and what it can do. Approving is a same-origin POST, protected the way cookie writes are today: a required custom header, which forces a preflight, plus SameSite=Lax and an Origin check.
4. The page returns a single-use code that expires in 60 seconds.
5. The client exchanges code plus verifier. One Postgres transaction consumes the code and creates the grant.

There are two fixed grant kinds, not free-form scopes:
- **`mobile`:** reads and changes the student's documents.
- **`extension`:** reads a projection of the account's Main and sends `add-option`, nothing else. The grant names the Main role, `main`, not a document. Each preview and add names a term (an add's option id carries it). For a term the web planner plans (`plannedTerms` in `server/extension/main-schedule.ts`, today only `planningTerm`), the server picks that term's Main the way the web planner does (`pickPlannerDocument` in `lib/planner-documents.ts`), and a first add to a term with no Main creates it with the id and body the web planner's first write would use. Another term's preview says which term UNTangle plans, and its add is refused, so the extension never makes a Main that Week doesn't show. When the planner plans more terms, `plannedTerms` has to be widened by hand to match.

Neither can delete the account or change credentials; those always need a fresh browser sign-in.

Each grant records the account's security generation, and any mismatch ends the grant. The generation is bumped by:
- password reset;
- changing a password;
- "sign out everywhere" and "sign out other sessions";
- setting a password (`lib/account-password.ts`);
- the cleanup in `lib/auth-config.ts` that deletes an unverified account's sessions and password when the real inbox owner signs in. Without this, an attacker's device grant would survive the cleanup that ends their cookie.

better-auth's own session revocation doesn't touch grants, so this wiring is a release gate.

A grant hands out an access token and a refresh token that lasts as long as the grant. Each refresh returns a new pair and marks the old refresh token used. Presenting a used refresh token revokes the whole grant, so every token from that grant stops working; a stolen refresh token and its legitimate copy can't both stay alive.

These lifetimes are starting values, with nothing measured behind them:
- access token: 5 minutes, never past the grant's own expiry;
- mobile: 7 days idle, 30 days absolute. Each refresh restarts the idle clock, capped at the absolute expiry;
- extension: 30 days absolute and no idle limit, since its access is read-mostly and students shouldn't need an email code daily during registration week.

CORS:
- Device calls carry `Authorization` and omit credentials. A request with both a device token and an account cookie is rejected.
- `Access-Control-Allow-Origin` is set only for the exact released extension origins, with `Vary: Origin`.
- An origin header is never authentication.
- myUNT is never a trusted origin.

## The extension

It's built from three pieces:
- **Content script:** on myUNT class search only. It reads an allowlist of fields through the portal adapter and draws minimal overlays in a shadow root, styled with `tokens`.
- **Background worker:** holds the token, keeps a read-only projection of the chosen schedule and a queue of pending adds, and talks to the API. It runs no sync engine. A Manifest V3 worker can be stopped at any time, so a confirmed add is written to `chrome.storage.local` (the command, its operation id and the schedule revision the student saw) before it is sent, and removed only when its receipt or rejection arrives. A restarted worker resends what's left.
- **Trusted panel:** shows details and confirms actions.

Permissions are `storage` and `identity`, the UNTangle API host, and `content_scripts.matches` for the exact myUNT class-search hosts. PeopleSoft renders results in frames, so the exact frame origins come from a live capture before release. The manifest test pins the host list. The extension never asks for `<all_urls>`, cookies, history or request interception, and never runs on a login or identity-provider host.

The page is untrusted input:
- **Messages:** the worker checks the sender, tab and frame URL, the message schema and an allowlist of operations. It builds API URLs itself from typed ids; it never fetches a URL the page supplies.
- **Adding a section:** a click on the page only proposes an add. The panel confirms it.
- **Private details:** the page can read anything the overlay draws, so overlays show only a conflict marker. Event details and private busy-time labels stay in the panel.

Cart filling comes later and gets its own review. It happens only in the student's signed-in tab, with a preview and a check before each step.

## Mobile

Expo with native navigation and native sheets. Documents and the outbox live in SQLite, credentials in SecureStore. The app opens a downloaded schedule with no network. Cached sections show their age, and anything that depends on seats is marked uncertain when that data is stale.

**Auto** runs through a `ComputeRuntime` interface: a web worker on web, and on native a resumable search that yields between bounded work units. Measure on a real device before adding a native threading dependency. Walking times cross the boundary as data (a precomputed matrix), not as functions.

**Over-the-air updates** use EAS Update with the fingerprint runtime policy, separate preview and production channels, and staged rollouts. An update applies only at a safe moment, never while the student is reviewing an import, resolving a conflict or approving Auto. The production release workflow must refuse to publish an update whose fingerprint matches no production binary in the stores. `eas update` doesn't check this itself, so the workflow does, before it publishes. Apple rule 2.5.2 still limits what an update can add. EAS costs beyond the free tier need Sam's approval.

PDF import stays in the browser flow at first.

## Reference data: published releases

Clients never fetch upstream sources. Scheduled jobs in `packages/ingest`, run by GitHub Actions cron so it stays free, follow these steps:
1. Fetch within each source's policy.
2. Parse and validate the data.
3. Compare the result with the last good release.
4. Publish a complete versioned release:
   - upload the files under content-hash names first;
   - flip the pointer in Postgres last.

   The job uses a database role that can write only the release tables.

A partial response or a parser failure never replaces a good release and never turns into "no classes".

A GitHub Actions `concurrency:` group keeps two runs of a job from overlapping. Postgres holds a shared budget only where many app instances call a source on demand. Today that means untgrades, whose cache and pacing move from a local disk folder into Postgres in step 1, since a serverless host may not keep a disk.

Releases built from the VSB mirror are served only through `/api/v1`, never as public files, until the mirror's operator agrees to redistribution. The storage host for release files is chosen in step 4.

Source policies are a reviewed table in `packages/ingest`, checked in review and by tests, not a runtime permission system.

```ts
interface SourcePolicy {
  sourceId: string;
  acquisition: "server" | "browser-capture" | "curated" | "link-only";
  approval: "allowed" | "review-required" | "disabled";
  retention: "none" | "ttl-cache" | "versioned";
  redistribution: "allowed" | "restricted" | "unverified";
  minIntervalMs: number | null; maxRequestsPerHour: number | null; maxConcurrency: number;
  policyEvidenceUrl: string | null; policyCheckedAt: string | null;
}
interface SourceRecord<T> {
  value: T; sourceId: string; publicUrl: string | null; evidenceSha256: string | null;
  datasetVersion: string; parserVersion: string;
  sourceObservedAt: string | null;   // when the upstream says the data was true; null when it doesn't say
  fetchedAt: string;                 // when we fetched it; never shown as "updated"
}
type DataResult<T> =
  | { kind: "available"; record: SourceRecord<T>; freshness: "fresh" | "stale" | "unknown" }
  | { kind: "confirmed-absent"; checkedAt: string }
  | { kind: "unavailable"; reason: "unsupported" | "blocked" | "upstream" | "invalid-data"; retryAfterSeconds: number | null };
```

Fetching an unchanged file today doesn't mean its seat counts were true today. When a source gives no observation time, freshness is shown as unknown.

| Source | How we get it | Where it's kept | Rules |
|---|---|---|---|
| UNT catalog | browser capture by a maintainer, per catalog year | reviewed release in `data/` | catalog.unt.edu refuses plain HTTP clients; polite, one page per second |
| Sections (VSB mirror) | central fetch per term, with conditional requests; 15-minute starting interval | current release plus a few prior ones | mirror; its limits and redistribution rights aren't established |
| Grade history | on demand, untgrades MCP only | TTL cache in Postgres; never bulk, never in `data/` | 20 per minute and 300 per hour across all instances; honor Retry-After; no copying their code |
| RateMyProfessors | a link only | nothing | no fetching or storing |
| Syllabi | reviewed host list, robots-aware, conditional requests | hashes, short quotes, locators, extractor version | public by Texas Education Code 51.974; no bulk crawl until permissions are recorded |
| Degree plans and policy | curated from official pages | reviewed releases in `data/` | every value cites its page and date |
| Calendar feeds | the existing SSRF-safe fetcher; 30-minute starting interval for directory feeds; a student's connected calendar is read again when Week opens and it is over 6 hours old | dated busy slots in the `preferences` document (Postgres when signed in, the device for a guest) | private feed URLs are encrypted (AES-256-GCM under `CALENDAR_FEED_KEY`, sealed to the account, or for a guest to the browser's HttpOnly cookie, for at most 90 days) and never logged; only the sealed token is stored |
| Campus map (OSM) | the existing geodata kit | versioned static graphs | keep ODbL attribution |

Feature rules that follow from evidence:
- **Auto and calendars:** Auto treats calendar events as dated occurrences over the schedule's real date range. Today's approximate weekly blocks are not authoritative.
- **Instructor-aware Auto:** a separate criterion applied after hard limits and preferences. Grade history never goes into the generic `rating` field. When some options in a course lack accepted evidence, that course's grade term is left out for every option.
- **Filters:** "unknown" never satisfies a filter. A section with unknown seats doesn't pass "open seats only".
- **Syllabus facts:** a fact is a claim backed by an exact quote. Missing attendance language means unknown, not optional.

## Who builds what

The lead owns, one writer at a time:
- the root manifests and lockfile;
- `packages/contracts`, and the package export maps (set once with wildcard subpaths, so moving a module into `core` doesn't touch a lead file);
- database migrations. From 0015 on, each sets `lock_timeout` for its own statements, so a migration that would wait behind a long transaction fails instead of blocking every query queued behind it;
- auth and the device-grant service;
- the sync engine, the server mutation path, and the planner provider's integration with them;
- `packages/tokens`, the web UI primitives, and the three shells: the web shell, the mobile tab shell and the extension overlay root. Native primitives go to a specialist, under the lead's review;
- the four surfaces where taste matters most: the Day hero and map camera, Auto's reveal, the week grid, and the extension's conflict overlay.

Obvious agents build bounded pieces against frozen contracts:
- moving one pure module into `core`;
- one adapter or normalizer;
- one ingest fetcher;
- one degree plan;
- one calendar or syllabus pipeline;
- one portal parser from sanitized captures;
- one list-shaped screen from an approved screen recipe.

**The task rule.** A task is written only after its interface, fixtures and acceptance test are on `alpha`. `alpha`'s CI must stay green, so a new acceptance test is listed in `tests/pending-acceptance.txt`, and CI skips everything on that list. The agent makes the test pass. Its only allowed test-side edit is deleting its own line from the list, and a CI check fails any other change to an acceptance test.

How it works:
- A line in the list is a test file's path from the repo root, which skips the file, or `path::name`, which skips one test by the full name Bun prints.
- Every package's `test` script runs `tools/repo-rules/src/run-tests.ts`. It gives `bun test` the package's test files minus the listed ones. A file with listed test names runs on its own, with a name pattern that leaves those tests out. A listed path that doesn't exist, or that no package's tests cover, fails the run.
- The Task rule job (`.github/workflows/pr-rules.yml`) runs through `pull_request_target`, so its workflow comes from the default branch and its script and list from the PR's base commit. A PR can't edit it. It fails a PR that edits, moves or deletes a listed test, deletes the list, or adds a line to it.
- The lead lists a new acceptance test with the test and its line in one PR. Sam's approval (below, under "Branches") lifts the check for that PR.

Where a task family repeats, the lead writes one harness that covers every member instead of one test per task. For example, a degree-plan validator checks every file in `plans/`, so each new plan is a data-only PR.

**Contract changes:**
- If an agent needs a contract change, it proposes one in its PR description; it doesn't work around the boundary.
- A CI path check fails any agent PR that touches a lead-owned path. It is the Path ownership job in `.github/workflows/pr-rules.yml`: it applies to PRs from `obv/*` branches, reads the globs in `.github/lead-owned-paths.txt` from the PR's base commit, and is lifted by Sam's approval.
- Briefs forbid adding dependencies.

UI work by agents follows `docs/design/`, starting with its README. A UI task gets a filled recipe (`docs/design/recipe-template.md`), approved by the lead before code. A UI PR shows real app screenshots at 390 and 1440, and those screenshots pass the visual QA checklist (`docs/design/visual-qa.md`). Mobile screens are lead- or specialist-built until agents have a working iOS simulator.

Branches:
- **Production-bound work:** starts from `alpha`. It lands after review, CI and Sam's approval.
- **Exploratory work:** starts from `edge` and opens its PR into `edge`. The lead merges it once CI is green and a light check passes; it doesn't need Sam's approval. A nightly workflow merges `alpha` into `edge`, so exploration sees accepted work. Nothing moves from `edge` to `alpha` in bulk; a good result is promoted through an ordinary PR.
- **`main`:** gets `alpha` after the ship check.

**Sam's approval.** Sam approves a PR himself, once it has been iterated to a good point, by approving it in a PR review. GitHub enforces this, not CI. `.github/CODEOWNERS` names Sam as the owner of every path, and the rulesets on `alpha` and `main` (`.github/rulesets/`) require one approving review from a code owner on the PR's latest push, so a review belongs to one PR, and a push dismisses it. The rulesets also require the CI jobs and the Task rule and Path ownership statuses from GitHub Actions, on a branch that is up to date with its base, and allow no direct push, force-push or deletion. `edge` has no such ruleset.

Sam's approval also lifts the Task rule and Path ownership checks. `.github/workflows/pr-rules.yml` runs both checks from the PR's base commit, then posts each result as a commit status on the PR's head commit. A failed check posts success instead when Sam's latest review that approves or requests changes is an approval of that head commit. A later request for changes or a dismissal cancels it; a comment-only review doesn't. A review re-runs the workflow, so the statuses follow his reviews.
- Agents never submit PR reviews, never merge into alpha or main, and never use `gh pr merge --admin`. Only Sam approves.
- Agents running on Sam's machine use his GitHub token, so GitHub can't tell them apart from him. Admins can bypass the rulesets when merging a PR, so such an agent could merge as Sam with `--admin`. For those agents, the rule above holds only because they follow it.
- GitHub doesn't let anyone approve their own PR. A PR opened with Sam's account, which is every PR a local agent opens, can't get his approval, so it merges only when Sam merges it himself with his admin bypass.
- TODO(Sam): give agents their own GitHub identity, a machine user or a GitHub App, without his permissions, so their PRs can get his review and GitHub can tell their actions from his.

CI runs typecheck, lint, tests and the build on PRs and pushes for alpha and main, and for edge through edge's own copy of the workflow. Today these jobs run in `frontend/` only. Step 1 makes them run for every package, so code moved into `packages/core` is still checked. Step 1 also picks one lockfile: the root `bun.lock`, with `frontend/bun.lock` removed once a root frozen install is shown to be enough. With the foundations, CI adds:
- the import-boundary lint;
- a contract compatibility test;
- disposable-Postgres tests, required for any change to auth, sync or migrations;
- the extension manifest check;
- a mobile export dry run.

## Order of work

Each step has a gate. There are no calendar dates.

0. **Now, before anything builds on local state:**
   - per-identity local storage (`untangle/local-identity`);
   - CI for every package;
   - one lockfile;
   - the untgrades cache and budget moved into Postgres.
1. **Skeleton and contracts:** identifiers, document schemas, source policy records, the package skeleton with export maps, and the boundary lint. Gate: representative fixtures decode identically on server, web and native tooling.

   As soon as step 1 lands, these lanes open for agents:
   - moving pure modules into `core`, one per PR;
   - extracting route handlers from route files;
   - filter predicates;
   - importance-to-weights;
   - calendar occurrence expansion;
   - the instructor tie-break criterion;
   - the section release pipeline.
2. **Durable state:** documents, receipts, the migration and local outboxes, built after the module moves so the two don't collide. Gate: concurrent saves, dropped responses and restarts all recover without loss.
3. **Clients.**
   - **3a. Web on documents:** web moves to `/api/v1` and the document model. Gate: an old client can't erase new fields.
   - **3b. Device grants:** grants and their security tests, just before the mobile and extension betas. Gate: revocation reaches every device.
4. **Parallel lanes:**
   - the mobile shell;
   - the extension parser and panel;
   - degree plans;
   - calendar persistence;
   - the storage host for releases.
5. **Evidence-backed features,** each once its pipeline from steps 1 and 4 and its test corpus exist: smart filters, instructor tie-break, calendar busy time, notifications. Syllabus facts wait for an extractor that beats the 2026-10-14 study (`docs/research/syllabus/`).
6. **One complete cross-device slice:** make a schedule on web, edit it offline on the phone, reconnect safely, and add a section from a fixture-backed extension flow. Gate: live myUNT compatibility is verified before anyone claims portal support.
7. **UT Austin,** which is when the campus adapter interface is built.

Work agents can do now, with none of the above:
- catalog gap filling;
- the campus calendar directory;
- degree plans;
- research.

Two things need Sam or the lead rather than an agent: catalog captures, which need a maintainer's browser, and portal captures, which need a UNT login and contain that student's own record.

## Decisions where the two proposals differed

| Question | Fable | Astra | Chosen, and why |
|---|---|---|---|
| Extension and mobile sign-in | better-auth `bearer()` and the Expo plugin | a first-party device grant with PKCE and scopes | **Astra.** It read the installed 1.5.5 source. A bearer token is a full session with no scopes, which is too much power for a content-script-adjacent client. Fable flagged its own answer as unverified. |
| Concurrent edits | an automatic three-way merge per document kind | no automatic merge of one schedule in v1 | **Astra.** Edits to different courses can jointly break walking time, credits or locks. Conflicts are rare for one student, so asking is cheap. |
| Idempotency | change ids, with a later clock winning | operation ids with stored receipts, checked before the revision | **Astra.** It fixes today's misreported saves and survives dropped responses. |
| Writes and pull | change ids, a `bigserial` cursor | commands, receipts, a per-user cursor under a row lock | **Simpler than both, after review.** Whole-document compare-and-set with user-scoped receipts, and pull as a list of revisions. Without automatic merging, commands add nothing, and a list has no cursor-skip bugs. |
| Reference data | static artifacts built by GitHub Actions cron | an ingestion worker with Postgres leases and budgets, publishing releases | **Both.** Releases and evidence fields from Astra, the free cron runner and static artifacts from Fable. Postgres holds budgets and pointers. |
| Repo layout | move the app to `apps/web` | keep `frontend/` in place | **Astra,** for now. It's less churn while dozens of agents work. Rename later if it helps. |
| Campus model | one `CampusId` per campus | institution, site, catalog and term as separate ids | **Astra.** UNT Denton and Frisco share a registration system but not buildings. |
| Guest sign-in | adopt guest work automatically, renaming on a clash | ask when both sides have work | **Ask,** as in `guest-sync.md`. Nothing is merged silently, and a schedule or record that isn't chosen is kept. |
| Design guidance for agents | five short documents and a recipe gate | lead owns UX acceptance | **Fable's documents,** with the lead approving each recipe. |
| Desktop | no | deferred | **No.** |
| Approval-page sign-in | (not specified) | magic link in the approval window | **Email code.** A magic link opens in a different browser context than the approval window. |
| Extension host access | `matches` on class-search patterns | `activeTab`, with optional host permission later | **Exact myUNT hosts in `matches`.** `activeTab` needs a click per page and may not reach PeopleSoft's frames. |
