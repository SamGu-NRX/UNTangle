# UNTangle architecture

Readers: everyone building UNTangle, including Obvious Autobuild agents. This page says how the system is divided, which contracts hold it together, who owns what, and the order to build in. When a task brief and this page disagree, this page wins until the lead changes it.

Sources: two independent design proposals, by Claude Fable (architecture counsel) and GPT Astra (Codex), both written against `alpha` at 3d5e4a0. The lead merged them. Where they disagreed, the decisions table at the end gives the choice and the reason.

## What exists today, and what has to change first

UNTangle is one Next.js 16 app in `frontend/`. It serves the UI and the API routes, stores data in Postgres through drizzle, and signs people in with better-auth (magic link first). Most domain logic is pure TypeScript in `frontend/src/lib/`: the planner, optimizer, reasons, prereq, pathing, preferences, instructors, calendar-feeds, policy, terms, campus routing and plan-library.

Four facts in the current code shape the plan:

- **Saved state is incomplete.** `planner_state` (`db/schema.ts`) is one row per user with a compare-and-set revision (`persistence.ts`). Preferences (`components/schedule/preferences-store.ts`) and saved schedules (`lib/saved-plans/store.ts`) live only in the browser's localStorage. A phone app built on today's server state would lose both.
- **Domain logic has leaked into components.** `components/courses/model/*` and `components/schedule/{week-model,constraint-logic,run-state}.ts` are pure logic. `lib/webmcp/tools.ts` and `lib/preferences/schema.ts` import from `@/components`. `lib/planner.ts` imports seed data and touches `window.sessionStorage`.
- **Section data has one third-party source.** `lib/sections/config.ts` fetches a 16 MB file per term from `vsb.untgrades.app`, a volunteer mirror, inside a request handler, and caches it per process. Grade-history pacing and its cache are also per process, so two server instances would double our load on untgrades.
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
type TermId = Id<"term">;                 // "unt-spring-2027"
type CourseId = Id<"course">;             // institution-scoped
type EnrollmentOptionId = Id<"enrollment-option">;  // institution + term + provider + component ids
```

An enrollment option is the primary section plus its required linked components, as `sections/model.ts` already models it. Lecture and lab never become independently selectable rows. Display labels and instructor names are never identities.

## The campus adapter

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
| `preferences` | user and institution | hard limits, leanings, the 1 to 5 importance scale, presets, calendar busy-time selections |
| `version` | schedule; append-only | an immutable snapshot ("Before Auto", restore points, imports) |
| `roadmap` | user and institution | multi-term plan pinned to a degree-plan release |
| `subscriptions` | user | calendar feeds (private URLs encrypted at rest), notification settings |

Some state never syncs and stays on each device: the active tab, the selected day, scroll and sheet position, the schedule being viewed. Another device shouldn't move the screen you're reading.

Writes are commands with an operation id. They are not full-state overwrites.

```ts
interface Mutation { operationId: string; documentId: string; baseRevision: string; schemaVersion: 1; command: Command }
interface Receipt { operationId: string; requestHash: string; committedRevision: string; changeCursor: string }
```

The server applies a mutation in one transaction:
1. Authorize the caller and its scope.
2. Look up the receipt for this operation id. The identical request returns the existing receipt; a different body under the same id is rejected.
3. Compare the revision and validate the command.
4. Apply it, bump the revision, write the receipt, and append to a per-user change log, all at once.

The cursor is a per-user counter taken under a row lock, not a database sequence, so a client can never skip a change that commits late.

A client stores the local document and its pending operation in one local transaction: IndexedDB on web, SQLite on mobile, `chrome.storage` in the extension. After a timeout it retries the same operation id and body. "Synced" is shown only with a receipt in hand. These are the status states:

```text
Saved on this device -> Waiting to sync -> Synced
                             +-> Needs sign-in
                             +-> Resolve conflict
                             +-> Save not confirmed; retrying
```

**Conflicts.** v1 does not auto-merge two concurrent edits to the same schedule. Edits to different courses can still jointly break walking time, credits or locks. When a conflict arrives:
- A clean client adopts the server copy.
- A dirty client keeps its draft and shows what differs. The student picks one of three: use the latest, keep theirs as another schedule, or reapply chosen edits on top of the latest.

Delete-versus-edit is a conflict. An offline device can't resurrect a deleted schedule. Restoring a version creates a new revision; it never rewinds.

**Guests.** A guest works against the same local store under a guest identity, with sync off. Signing in follows `docs/architecture/guest-sync.md`: empty account means save automatically, with Undo; both sides have different work means one question; whatever isn't chosen is kept as a saved copy. Nothing is merged silently.

**Migration.** Deploy the document tables and readers first. Then migrate each user's legacy row atomically into an academic record plus a schedule named "Main", keeping a migration marker. After that, old `/api/planner` writes get an explicit upgrade response. They must never overwrite documents with a full state that lacks the new fields.

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
- `devices/{authorize,token,revoke}`;
- `account` (export, delete).

## Sign-in for each client

| Client | Credential | Where it lives |
|---|---|---|
| Web | the existing better-auth session cookie | HttpOnly, host-only, SameSite=Lax |
| Mobile | an opaque device token with explicit scopes; the server stores only its hash | iOS Keychain through SecureStore |
| Extension | a separate opaque token with narrower scopes | `chrome.storage.session`, trusted extension contexts only |

Mobile and the extension don't use better-auth's `bearer()` plugin. In the installed 1.5.5, it turns a bearer token into an ordinary full session, with no scopes and no rotation. Astra checked this against the package source in `node_modules`. Instead there's one small first-party device-grant service, owned by the lead and reviewed independently before release:

1. The client creates a PKCE verifier and a random state. The server records the S256 challenge, client id, exact redirect URI, requested scopes and expiry.
2. The client opens an UNTangle approval page in the system browser. The normal magic-link sign-in runs there.
3. The page shows the account, the device and the access requested. Approving is a same-origin, CSRF-protected POST.
4. The page returns a single-use code that expires in 60 seconds.
5. The client exchanges code plus verifier. One Postgres transaction consumes the code and creates the grant.

Each grant records the account's security generation. Password reset, account recovery and "sign out everywhere" bump that generation, which ends every grant. better-auth's own session revocation does not end grants, so that wiring is a release gate.

Scopes: mobile can read and change the student's documents. The extension gets only a read-only projection of the chosen schedule plus "add a section". Account deletion and credential changes always need a fresh browser sign-in. These are starting values with nothing measured behind them:
- mobile grants: 7 days idle, 30 days absolute;
- extension grants: 12 hours, cleared when the browser restarts;
- no refresh tokens in v1.

CORS and CSRF are separate controls:
- Cookie mutations need an exact web origin and a CSRF token.
- Device calls carry `Authorization` and omit credentials. A request with both a device token and an account cookie is rejected.
- `Access-Control-Allow-Origin` is set only for the exact released extension origins, with `Vary: Origin`. An origin header is never treated as authentication.
- myUNT is never a trusted origin.

## The extension

It's built from three pieces:
- **Content script:** on myUNT class search only. It reads an allowlist of fields through the portal adapter and draws minimal overlays in a shadow root, styled with `tokens`.
- **Background worker:** holds the token, runs sync and talks to the API.
- **Trusted panel:** shows details and confirms actions.

Permissions are `activeTab`, `scripting`, `storage` and `identity`, plus the UNTangle API host. It never asks for `<all_urls>`, cookies, history or request interception, and it never runs on a login or identity-provider host. A manifest test enforces this.

The page is untrusted input:
- **Messages:** the worker checks the sender, tab and frame URL, the message schema and an allowlist of operations. It builds API URLs itself from typed ids; it never fetches a URL the page supplies.
- **Adding a section:** a click on the page only proposes an add. The panel confirms it.
- **Private details:** the page can read anything the overlay draws, so overlays show only a conflict marker. Event details and private busy-time labels stay in the panel.

Cart filling comes later and gets its own review. It happens only in the student's signed-in tab, with a preview and a check before each step.

## Mobile

Expo with native navigation and native sheets. Documents and the outbox live in SQLite, credentials in SecureStore. The app opens a downloaded schedule with no network. Cached sections show their age, and anything that depends on seats is marked uncertain when that data is stale.

**Auto** runs through a `ComputeRuntime` interface: a web worker on web, and on native a resumable search that yields between bounded work units. Measure on a real device before adding a native threading dependency. Walking times cross the boundary as data (a precomputed matrix), not as functions.

**Over-the-air updates** use EAS Update with the fingerprint runtime policy, separate preview and production channels, and staged rollouts. An update applies only at a safe moment, never while the student is reviewing an import, resolving a conflict or approving Auto. CI fails a PR that changes native dependencies without bumping the binary. Apple rule 2.5.2 still limits what an update can add. EAS costs beyond the free tier need Sam's approval.

PDF import stays in the browser flow at first.

## Reference data: published releases

Clients never fetch upstream sources. Scheduled jobs in `packages/ingest`, run by GitHub Actions cron so it stays free, follow these steps:
1. Fetch within each source's policy.
2. Parse and validate the data.
3. Compare the result with the last good release.
4. Publish a complete versioned release atomically: static artifacts, plus a pointer and metadata in Postgres.

A partial response or a parser failure never replaces a good release and never turns into "no classes". Postgres also holds shared budgets and leases, so two app instances can't double the load on a source.

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
| Calendar feeds | the existing SSRF-safe fetcher; 30-minute starting interval for directory feeds | dated occurrences in Postgres | private feed URLs are encrypted and never logged |
| Campus map (OSM) | the existing geodata kit | versioned static graphs | keep ODbL attribution |

Feature rules that follow from evidence:
- **Auto and calendars:** Auto treats calendar events as dated occurrences over the schedule's real date range. Today's approximate weekly blocks are not authoritative.
- **Instructor-aware Auto:** a separate criterion applied after hard limits and preferences. Grade history never goes into the generic `rating` field. When some options in a course lack accepted evidence, that course's grade term is left out for every option.
- **Filters:** "unknown" never satisfies a filter. A section with unknown seats doesn't pass "open seats only".
- **Syllabus facts:** a fact is a claim backed by an exact quote. Missing attendance language means unknown, not optional.

## Who builds what

The lead owns, one writer at a time:
- the root manifests and lockfile;
- `packages/contracts` and every public export;
- database migrations;
- auth and the device-grant service;
- the sync engine, the server mutation path, and the planner provider's integration with them;
- `packages/tokens`, the UI primitives on web and native, and the three shells (web, mobile tab shell, extension overlay root);
- the four surfaces where taste matters most: the Day hero and map camera, Auto's reveal, the week grid, and the extension's conflict overlay.

Obvious agents build bounded pieces against frozen contracts:
- moving one pure module into `core`;
- one adapter or normalizer;
- one ingest fetcher;
- one degree plan;
- one calendar or syllabus pipeline;
- one portal parser from sanitized captures;
- one list-shaped screen from an approved screen recipe.

A task is written only after its interface, fixtures and a failing acceptance test are on `alpha`. The agent's job is to make that test pass without editing it. If an agent needs a contract change, it proposes one in its PR; it doesn't work around the boundary.

UI work by agents follows `docs/design/` (surfaces, copy, components, the recipe template, and the do-not list). A UI PR shows real app screenshots at 390 and 1440, passes the visual QA checklist (`docs/design/visual-qa.md`), and keeps every rule in `DESIGN.md` and `MOTION.md`.

Branches:
- **Production-bound work:** starts from `alpha`. The lead lands it after review and CI.
- **Exploratory work:** starts from `edge`, opens its PR into `edge`, and merges after CI and a light check. Nothing moves from `edge` to `alpha` in bulk; a good result is promoted through an ordinary PR.
- **`main`:** gets `alpha` after the ship check.

CI already runs typecheck, lint, tests and the build on alpha, main and edge. With the foundations it adds:
- the import-boundary lint;
- a contract compatibility test;
- disposable-Postgres tests, required for any change to auth, sync or migrations;
- the extension manifest check;
- a mobile export dry run.

## Order of work

Each step has a gate. There are no calendar dates.

1. **Contracts:** identifiers, document schemas, source policy records, the package skeleton and the boundary lint. Gate: representative fixtures decode identically on server, web and native tooling.
2. **Core and durable state:** move pure modules into `core` behind re-exports; documents, receipts, the change log, the migration and local outboxes. Gate: concurrent saves, dropped responses and restarts all recover without loss.
3. **Auth and the web client:** device grants and their security tests; web moves to `/api/v1` and documents. Gate: an old client can't erase new fields, and revocation reaches every device.
4. **Parallel lanes:** the mobile shell, the extension parser and panel, the section release pipeline, the grade budget and cache in Postgres, degree plans and calendar persistence.
5. **One complete cross-device slice:** make a schedule on web, edit it offline on the phone, reconnect safely, and add a section from a fixture-backed extension flow. Gate: live myUNT compatibility is verified before anyone claims portal support.
6. **Evidence-backed features,** each after its source pipeline and test corpus exist: smart filters, instructor tie-break, calendar busy time, syllabus facts, notifications.
7. **UT Austin.**

Work that needs none of steps 1 to 3 can start now:
- catalog gap filling;
- the campus calendar directory;
- degree plans;
- sanitized portal captures;
- research.

## Decisions where the two proposals differed

| Question | Fable | Astra | Chosen, and why |
|---|---|---|---|
| Extension and mobile sign-in | better-auth `bearer()` and the Expo plugin | a first-party device grant with PKCE and scopes | **Astra.** It read the installed 1.5.5 source. A bearer token is a full session with no scopes, which is too much power for a content-script-adjacent client. Fable flagged its own answer as unverified. |
| Concurrent edits | an automatic three-way merge per document kind | no automatic merge of one schedule in v1 | **Astra.** Edits to different courses can jointly break walking time, credits or locks. Conflicts are rare for one student, so asking is cheap. |
| Idempotency | change ids, with a later clock winning | operation ids with stored receipts, checked before the revision | **Astra.** It fixes today's misreported saves and survives dropped responses. |
| Change cursor | `bigserial` | a per-user counter under a row lock | **Astra.** A sequence value can commit out of order and make a client skip a change. |
| Reference data | static artifacts built by GitHub Actions cron | an ingestion worker with Postgres leases and budgets, publishing releases | **Both.** Releases and evidence fields from Astra, the free cron runner and static artifacts from Fable. Postgres holds budgets and pointers. |
| Repo layout | move the app to `apps/web` | keep `frontend/` in place | **Astra,** for now. It's less churn while dozens of agents work. Rename later if it helps. |
| Campus model | one `CampusId` per campus | institution, site, catalog and term as separate ids | **Astra.** UNT Denton and Frisco share a registration system but not buildings. |
| Guest sign-in | adopt guest work automatically, renaming on a clash | ask when both sides have work | **Ask,** as in `guest-sync.md`. Nothing is merged silently, and whatever isn't chosen is kept. |
| Design guidance for agents | five short documents and a recipe gate | lead owns UX acceptance | **Fable's documents,** with the lead approving each recipe. |
| Desktop | no | deferred | **No.** |
