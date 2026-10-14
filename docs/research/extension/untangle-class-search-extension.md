# UNTangle class-search browser extension: shipping design note

**Date:** October 14, 2026
**Scope:** The `extension/` workspace package introduced with this note: a Manifest V3 browser extension that surfaces UNTangle facts beside myUNT class-search results. This note covers the permissions the extension requests and why, how it would ship to the Chrome Web Store, and the gaps that remain open. It does not cover the frontend application's own deployment.
**Type:** Design note (research). Everything marked verified was observed in this repository's sandbox; everything marked unverified is stated as such and not filled in from memory.

**Load-bearing assumption.** The content script parses PeopleSoft results-row markup that has never been observed in production. The research record (`docs/research/registration-platforms/section-row-anatomy.md`) documents that only the myUNT class-search entry form was ever reached; the results grid itself is unverified. The parser therefore keys on the stable `SSR_CLSRCH_` and `CLASS_SRCH_WRK2_` id prefixes observed on the entry page and tolerates generated `$n$` suffixes, and the mock page mirrors those conventions. A single probe of the real portal with a signed-in student session - which this repository's login rule forbids this work from performing - would confirm or break the parsing layer. Until then, every claim about production rendering rests on that assumption.

## 1. Permissions requested and why

The manifest requests the following, and nothing else:

| Permission | Kind | Why it is needed | Why less would not work |
| --- | --- | --- | --- |
| `storage` | API permission | `chrome.storage.session` caches the planner snapshot, resolved sections, and per-instructor grade histories for the browsing session, and remembers the UNTangle origin override the popup can set. Without it every row scroll would re-hit the planner and grades routes. | `storage` carries no access to page data or credentials; dropping it would mean re-fetching facts on every render and breaking rate-limit courtesy. |
| `http://localhost:4317/*` and `http://127.0.0.1:3217/*` | Host permissions | The development and test targets: the mock myUNT server and the local UNTangle stub/app origin used by the automated journey and local development. | Without them the content script cannot attach to the mock and the service worker cannot reach the stub, so the entire offline test path disappears. |
| `https://*.unt.edu/*` | Host permission | The wildcard covers whichever UNT portal hosts serve class search without hardcoding an unverified production hostname. The content script stays dormant on every UNT page until it detects a results grid. | Scoping to a guessed concrete hostname would ship a broken extension when the real host differs; the wildcard is the honest expression of "not yet verified" (see section 3). |

Deliberately absent: `cookies`, `tabs`, `scripting`, `webRequest`, `webNavigation`, and `activeTab`. The extension never reads, stores, or sends UNT login credentials. It rides the student's existing Better Auth session cookie (`better-auth.session_token`) only through credentialed service-worker fetches (`credentials: "include"`) from the extension's own service worker, exactly as the student's own browser would send them while visiting the app. The popup shows session state derived from the planner GET outcome; it contains no credential form and persists no token.

Verification: `grep '"permissions"' extension/manifest.json` returns `"storage"` only, and `grep -c 'cookies\|tabs\|scripting\|webRequest' extension/manifest.json` returns 0. The safety review in the pull request re-ran both.

## 2. How it would ship to the Chrome Web Store

**Packing.** `bun --no-env-file run build` in `extension/` emits the complete store package into `extension/dist/` (manifest, bundled service worker and content script, popup page and script). The store upload is a zip of that directory's contents; no bundling step beyond the repo's own build is required. The listing version would start at the manifest's `0.1.0`.

**Privacy disclosures for session-cookie reuse.** The privacy policy tab would declare: the extension processes class-search rows you view and your own UNTangle planner state; it sends requests to the UNTangle application using your existing signed-in session, so no credentials are collected, transmitted to the developer, or stored anywhere but the browser's own cookie jar; cached facts live in `chrome.storage.session`, are never synced, and die with the browsing session. The single-permission, no-remote-code posture supports the "does not sell or use user data for unrelated purposes" certification statements.

**Permission justification.** Each host permission needs a written justification in the review form. The localhost entries justify development and testing; production submission should trim them (see gaps). The `*.unt.edu` wildcard justification: the extension annotates UNT's own class-search pages in place, requests least-privilege API access for the specific app origin at runtime, and never submits page data anywhere except the student's own UNTangle planner. Store review historically scrutinizes broad wildcards; if rejected, the fallback is the specific production hostname once verified (gaps, below).

**Remote-code policy.** The MV3 `content_security_policy` defaults plus the repo's build discipline mean no remote code: every script in `dist/` is bundled at build time, no `eval`, no fetched scripts, no third-party code execution. The store's remote-code attestation is satisfiable as-is.

Verification: this section names files and commands that exist in the repo - `extension/manifest.json` and the build script were read this session, and the build output inventory was checked (`manifest.json`, `background.js`, `content.js`, `popup.html`, `popup.js` in `extension/dist/`). Store-review outcomes themselves are inherently unverified until a submission happens.

## 3. The gaps

1. **Production PeopleSoft DOM is unverified.** The parser mirrors the documented stable id prefixes and tolerates generated suffixes, but no production results grid has been seen. A signed-in probe of the real portal is the first validation step after merge and is explicitly outside this task's login rules.
2. **SameSite=Lax may block the session cookie cross-site in production.** In the mock and localhost test everything is same-site, so the credentialed fetches work. Against a real `*.unt.edu` portal host and a UNTangle app on a different registrable domain, Lax may omit the cookie from the extension's cross-site fetches, which would make planner-backed features report signed-out. The recorded fallback is the `chrome.cookies` API with explicit user disclosure - a permission deliberately not requested until the production behavior is known. This is the first production validation item.
3. **Full-state planner writes race the student's open tab.** The Add flow reads, merges, and writes the whole planner state with `X-Planner-Base-Revision` and a bounded three-attempt retry on 409. Two writers (the extension and an open UNTangle tab) can still trade 409s; the row then reports an honest conflict-write failure rather than silently overwriting.
4. **Grade history depends on the upstream untgrades.app service.** The grades routes proxy an external service with its own throttling; `no-history` and `unavailable` envelope states are rendered as their own states, and per-instructor session caching limits burst traffic, but upstream outages will show as unavailable panels by design.
5. **Production origins are unknown.** The UNTangle origin is a build-time constant defaulting to the localhost convention; the real deployed origin and the real myUNT hostnames that serve class search are owner decisions recorded as open questions in the spec, and both must be pinned before a store submission.
6. **Real-application end-to-end is not exercised.** The journey runs against the mock myUNT page and a contract-accurate localhost stub with type-only imports pinning the API shapes. The extension has never driven the real UNTangle application or the real portal; that path is intentionally untested here and is the first thing to verify in a signed-in environment.

Verification: each numbered gap states its own evidence boundary; items 1, 2, 5, and 6 are unverified production claims by nature, items 3 and 4 are verified code behaviors with the honest failure states covered by unit tests (`extension/tests/planner-client.test.ts`, `extension/tests/grades-client.test.ts`).
