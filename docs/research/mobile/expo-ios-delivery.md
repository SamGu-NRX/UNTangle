# UNTangle iOS Delivery with Expo — Research Note

**Date:** 2026-10-13
**Scope:** Feasibility and delivery strategy for an iOS client of UNTangle built with Expo, sharing existing TypeScript logic from `frontend/src/lib/`, with OTA updates via EAS Update and a free-map stack (MapLibre + OpenFreeMap).
**Type:** Research / decision-support. Nothing in this note changes runtime code.

**Load-bearing assumption:** This note assumes the goal is *sharing the existing scheduling, prerequisite, and campus-routing logic with a native mobile client* rather than rebuilding it. If the mobile app is a thin read-only viewer of web pages, the shared-package work (§2) shrinks dramatically and the map library choice (§5) matters more than everything else. Evidence that confirms or breaks the assumption: whether planner/prereq/optimizer flows (not just course browsing) are wanted on mobile.

---

## 0. Correction to prior framing

Earlier notes in this thread referred to Apple's executable-code rule as **guideline 3.3.2**. The current App Review Guidelines place the relevant provision at **2.5.2** ("Apps should be self-contained in their bundles, and may not … download … or execute code that introduces or changes features or functionality of the app"), with a narrow exception for certain educational apps. Any OTA strategy in this repo should be defended against 2.5.2, not 3.3.2. ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/))

## 1. Monorepo integration: Expo inside the existing Bun workspace

Expo documents first-class support for Bun workspaces monorepos ([Expo: Work with monorepos](https://docs.expo.dev/guides/monorepos/)):

- **Layout:** the conventional shape is `apps/*` for applications and `packages/*` for shared code. For UNTangle that means `apps/mobile/` for the Expo app and `packages/shared/` (or similar) for extracted `frontend/src/lib` logic.
- **Root `package.json`:** declare `"workspaces": ["apps/*", "packages/*"]` on a private root package; add `frontend/` to the same array so the existing app stays a workspace.
- **Shared package consumption:** internal packages are consumed with Bun's `workspace:*` protocol, which makes Metro resolve the workspace package rather than any published package of the same name.
- **Metro:** Expo's Metro config has *built-in* monorepo support for Bun workspaces. The docs explicitly say **not** to hand-roll `watchFolders`, `resolver.nodeModulesPaths`, `resolver.extraNodeModules`, or `disableHierarchicalLookup` anymore — remove those if present and clear the cache once (`bunx expo start --clear`).
- **Bun lockfile:** EAS decides the package manager from the lockfile present; keep a single `bun.lock` at the repo root and delete lockfiles from other package managers ([Expo: Using Bun](https://docs.expo.dev/guides/using-bun/)).
- **EAS commands:** run EAS CLI from the app directory (`apps/mobile`), and keep `eas.json` (and `credentials.json`, if used) in that directory ([Expo: Set up EAS Build with a monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/)).

**Verification:** a new Expo app under `apps/mobile` runs via `bun expo start` on a clean `bun install`, and `bun install --frozen-lockfile` succeeds at the root with the new workspaces.

## 2. Sharing `frontend/src/lib` logic: portable core vs. adapters

A `frontend/src/lib` audit found three domains with the logic the mobile client needs most:

| Domain | Files | Portability |
|---|---|---|
| Prerequisite engine | `lib/prereq/` (`ast.ts`, `engine.ts`, `index.ts`, `suggestions.ts`, `types.ts`, `unt.ts`) | **Portable.** Self-contained; only imports within the package plus `@/lib/seed-data`. |
| Schedule optimizer (core) | `lib/optimizer/` (`optimize.ts`, `prepare.ts`, `score.ts`, `search.ts`, `presets.ts`, `types.ts`, `weeks.ts`, `explain.ts`) | **Portable with one exception** — see Workers below. |
| Campus routing engine | `lib/campus/` (`engine.ts`, `geo.ts`, `graph.ts`, `route-legs.ts`, `speeds.ts`, `walking-times.ts`) | **Portable with one exception** — `resolve-handler.ts` is Next-specific. |

### 2.1 What blocks direct reuse

React Native has no DOM, no `window`/`document` globals, no Node built-ins, and **no Web Workers** — Expo Metro's web-worker support is alpha and web-only; using `Worker` on native errors with `Property 'Worker' doesn't exist` ([Expo: metro.config.js](https://docs.expo.dev/versions/latest/config/metro/)). Grep across `frontend/src/lib` found exactly the offenders:

- `lib/optimizer/worker/client.ts` — Web Worker client for the optimizer's search.
- `lib/campus/resolve-handler.ts` — imports `NextResponse`; it is a Next.js route handler, not shared logic (it can stay behind the web app and be called as an HTTP API from mobile).
- Server-only modules (`lib/auth-server.ts`, `lib/db/`, `lib/email*.ts`, `lib/grades-history/server.ts`, `lib/magic-link-claims.ts`, `lib/rate-limit/`) — Node-side by design; mobile should hit the backend over HTTP, not import these.
- `planner.ts` / `planner-store.ts` — matched the grep for `document|window|Worker|node:`; needs a per-file pass before extraction (hits may be minor, e.g. type names or comments — inspect each file when extracting).

### 2.2 Recommended structure

Follow the "domain core + platform adapters" pattern from Expo/RN guidance ([React Native: Document nodes](https://reactnative.dev/docs/document-nodes) clarifies RN is *not* a DOM; [Expo Metro config](https://docs.expo.dev/versions/latest/config/metro/) for the worker constraint):

```text
packages/
  unt-core/          # pure TS: prereq engine, optimizer core, campus engine/geo/graph
  unt-core/web/      # web adapter: Web Worker for optimizer search
  unt-core/native/   # native adapter: see below
apps/
  frontend/          # existing Next.js app (moved or aliased)
  mobile/            # Expo app
```

- **Dependency direction:** apps → adapters → `unt-core`. Never `unt-core` → Expo/Next/Node/browser.
- **Optimizer on native:** replace the Web Worker client with a `ComputeRuntime`-style port (message-passing interface). Options for the native side: run the search on the JS thread if budgets are small, or a dedicated-thread native module. The optimizer's algorithm itself (`optimize.ts`, `search.ts`, `score.ts`) stays untouched in the core — only the *spawn mechanism* changes per platform.
- **Campus resolver on native:** use the existing `resolve-handler.ts` as an HTTP endpoint (it already is one) or drop `NextResponse` for a framework-neutral handler the Next app wraps.

**Verification:** `packages/unt-core` has zero imports of `react-dom`, `next`, `expo`, Node built-ins, or `Worker`; its tests (ported from the current lib tests) pass when run under both the Next.js app and a React Native test runner.

## 3. OTA updates with EAS Update

EAS Update ships a new JavaScript bundle and assets to installed builds; it never replaces the native binary ([Expo: EAS Update introduction](https://docs.expo.dev/eas-update/introduction/)).

- **Runtime versions:** an update downloads only when its `runtimeVersion` matches the runtime embedded in the installed build. Expo recommends the `appVersion` policy (`"runtimeVersion": { "policy": "appVersion" }`) or `fingerprint` ([Expo: runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)). Bump the native build (and thus the runtime) whenever native modules, the Expo SDK, permissions, or app configuration change.
- **Channels and branches:** the channel is baked into the native build and maps to an update branch (`production` → production, `preview` → preview). Publishing to a branch doesn't reach a device unless the branch matches its channel *and* the runtime version matches ([Expo: branch management](https://docs.expo.dev/eas-update/branch-management/)).
- **What OTA can change:** JS components/screens, TS business logic, navigation behavior, styles, bundled assets, feature flags, and endpoint configuration — anything that stays compatible with the installed native runtime.
- **What requires a store release:** new/upgraded native modules, SDK upgrades that change native code, permission/entitlement/Info.plist changes, bundle identifier or signing changes, launch-screen or icon changes, any native code ([Expo: EAS Build / Submit](https://docs.expo.dev/build/introduction/)).
- **Rollback:** two distinct tools — republish a prior compatible update on the same branch, or fall back to the binary's embedded bundle. Neither can undo a native change or span a runtime-version boundary ([Expo: rollbacks](https://docs.expo.dev/eas-update/rollbacks/)). Documented recovery behavior can also auto-revert to the embedded bundle after failed launches ([Expo: Updates SDK](https://docs.expo.dev/versions/latest/sdk/updates/)).

**Practical rule for UNTangle:** because the valuable shared logic (§2) is pure TS, most iteration — prereq suggestions, optimizer tuning, schedule views — is OTA-shippable. Map tiles, routing, and storage come from libraries fixed at build time.

## 4. Apple constraints on OTA (2.5.2)

Apple's guideline 2.5.2 requires apps to be self-contained and forbids downloading or executing code that changes the app's features or functionality, subject to a narrow educational exception ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). EAS Update is designed for exactly the permitted case — updating JS/assets within the functionality and native capabilities already reviewed — but:

- Updates must not unlock materially new features that would require review (the narrow exception is limited to educational apps).
- JS updates are not automatically exempt; Apple evaluates what the downloaded code does.
- Updates that unlock or sell functionality must also satisfy Apple's payment rules (IAP requirements).

**Assessment:** UNTangle's planner/prereq/optimizer OTA iterations are squarely within the permitted model — no new native surface, no payments, no entitlement changes.

## 5. Maps without API keys or paid plans: MapLibre React Native + OpenFreeMap

- **Library:** `@maplibre/maplibre-react-native` binds MapLibre Native (BSD-2-Clause) to React Native ([MapLibre Native](https://maplibre.org/projects/native/)). Rendering happens on-device; the library does not supply tiles, styles, geocoding, or routing — you bring your own.
- **Style/tiles:** OpenFreeMap serves styles and vector tiles with no API key and no paid plan; the documented style URL is `https://tiles.openfreemap.org/styles/liberty` ([OpenFreeMap](https://openfreemap.org/)).
- **Expo compatibility:** this is a native module — it does **not** work in Expo Go. It requires a development build (`expo prebuild` + `expo run:ios`/`run:android`) or an EAS build.
- **Attribution is still required.** "No API key" does not mean "no attribution": OpenFreeMap, OpenStreetMap (ODbL), and style/font contributors must be credited in the map UI, and OpenFreeMap's own service terms (fair use, caching, commercial use) govern production deployment. MapLibre Native itself is BSD-2-Clause, which permits proprietary use with its conditions.
- **Relation to existing web stack:** the web app currently uses Leaflet. MapLibre Native is a separate renderer; styles are not portable between Leaflet and MapLibre, so treat map styling as a per-platform concern even though the underlying style JSON (Mapbox style spec) could be shared if the web app ever moves to MapLibre GL JS.

**Verification:** a dev-build map screen renders the OpenFreeMap `liberty` style on iOS with attribution visible, and the repo includes the required license notices.

## 6. EAS Build → TestFlight: requirements and costs

- **Apple Developer Program membership is required** for App Store Connect and TestFlight distribution — a free Apple account does not substitute. Membership is **US$99 per membership year** ([Apple: program enrollment](https://developer.apple.com/programs/enroll/)).
- **Credentials:** EAS can manage signing certificates and provisioning profiles from your Apple account (with App Store Connect permissions), or you supply them manually ([Expo: Apple roles & permissions](https://docs.expo.dev/app-signing/apple-developer-program-roles-and-permissions/)).
- **eas.json:** use a `production` profile with `"distribution": "store"` for TestFlight builds; `preview`/internal-distribution is for direct device installs.
- **Flow:** create the App Store Connect app record with the same bundle ID → `eas build --platform ios --profile production` → `eas submit` → TestFlight. TestFlight supports up to 10,000 external testers ([Apple: membership details](https://developer.apple.com/programs/whats-included/)).
- **EAS costs:** EAS pricing is separate from Apple's fee. The free plan includes limited monthly build credits, limited concurrent builds, and lower queue priority; verify current quota numbers at [expo.dev/pricing](https://expo.dev/pricing) before committing to a build cadence, since Expo adjusts plan limits.

**Monorepo note:** run all EAS commands from `apps/mobile/` with `eas.json` in that directory, and keep the single root `bun.lock` so EAS selects Bun ([Expo: EAS Build with a monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/)).

## 7. Summary of the recommended path

1. Restructure to Bun workspaces per Expo's guide: `apps/mobile` (Expo), `packages/unt-core` (extracted `lib/prereq`, `lib/optimizer` core, `lib/campus` engine), with the existing `frontend/` remaining a workspace.
2. Keep the web Worker behind a `ComputeRuntime` port so the optimizer runs on both platforms; keep `resolve-handler.ts` and server-only modules out of the shared package.
3. Configure EAS Update with the `appVersion` runtime policy and `production`/`preview` channels; treat native-module or permission changes as new-build events.
4. Use `@maplibre/maplibre-react-native` with OpenFreeMap's `liberty` style for keyless maps; expect a dev build, not Expo Go, and keep attribution.
5. Budget the US$99/year Apple Developer Program for TestFlight; keep `eas.json` in `apps/mobile` and one root `bun.lock`.

## Sources

All sources inspected 2026-10-13 via web research (Perplexity Sonar summaries with citations):

- [Expo: Work with monorepos](https://docs.expo.dev/guides/monorepos/)
- [Expo: Using Bun](https://docs.expo.dev/guides/using-bun/)
- [Expo: Set up EAS Build with a monorepo](https://docs.expo.dev/build-reference/build-with-monorepos/)
- [Expo: EAS Update introduction](https://docs.expo.dev/eas-update/introduction/)
- [Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)
- [Expo: Branch management](https://docs.expo.dev/eas-update/branch-management/)
- [Expo: Rollbacks](https://docs.expo.dev/eas-update/rollbacks/)
- [Expo: Updates SDK reference](https://docs.expo.dev/versions/latest/sdk/updates/)
- [Expo: metro.config.js (web workers, alpha, web-only)](https://docs.expo.dev/versions/latest/config/metro/)
- [React Native: Document nodes (no browser DOM)](https://reactnative.dev/docs/document-nodes)
- [Apple: App Review Guidelines (2.5.2)](https://developer.apple.com/app-store/review/guidelines/)
- [MapLibre Native](https://maplibre.org/projects/native/)
- [OpenFreeMap](https://openfreemap.org/)
- [Apple: Program enrollment (US$99/year)](https://developer.apple.com/programs/enroll/)
- [Apple: Membership details (TestFlight limits)](https://developer.apple.com/programs/whats-included/)
- [Expo: EAS pricing](https://expo.dev/pricing)

Repo-local evidence (file audit, this session): `frontend/src/lib/` directory listing; grep hits for `document\.|window\.|new Worker|node:` in `lib/planner.ts`, `lib/course-catalog/build.ts`, `lib/email-budget.ts`, `lib/grades-history/cache.ts`, `lib/grades-history/server.ts`, `lib/magic-link-claims.ts`, `lib/optimizer/worker/client.ts`, `lib/planner-store.ts`; `NextResponse` import in `lib/campus/resolve-handler.ts`; intra-package imports in `lib/prereq/README.md`.
