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
- **Root `package.json`:** the root package is private and its `workspaces` property lists glob patterns for every workspace in the monorepo ([Expo: Work with monorepos](https://docs.expo.dev/guides/monorepos/)). The docs show `["apps/*", "packages/*"]` as the conventional example and note an existing app can be copied under `apps/` — but the globs are yours to define, so UNTangle keeps `frontend/` where it is and adds globs for the new directories:

```json
"workspaces": ["frontend", "apps/*", "packages/*"]
```

Resulting shape:

```text
frontend/            # existing Next.js app - stays in place, remains a workspace
apps/
  mobile/            # new Expo app (bun create expo apps/mobile)
packages/
  unt-core/          # shared TS extracted from frontend/src/lib (see section 2)
```
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
frontend/            # existing Next.js app - stays in place
apps/
  mobile/            # new Expo app
packages/
  unt-core/          # pure TS: prereq engine, optimizer core, campus engine/geo/graph
  unt-core/web/      # web adapter: Web Worker for optimizer search
  unt-core/native/   # native adapter: see below
```

- **Dependency direction:** apps → adapters → `unt-core`. Never `unt-core` → Expo/Next/Node/browser.
- **Optimizer on native:** replace the Web Worker client with a `ComputeRuntime`-style port (message-passing interface). Options for the native side: run the search on the JS thread if budgets are small, or a dedicated-thread native module. The optimizer's algorithm itself (`optimize.ts`, `search.ts`, `score.ts`) stays untouched in the core — only the *spawn mechanism* changes per platform.
- **Campus resolver on native:** use the existing `resolve-handler.ts` as an HTTP endpoint (it already is one) or drop `NextResponse` for a framework-neutral handler the Next app wraps.

**Verification:** `packages/unt-core` has zero imports of `react-dom`, `next`, `expo`, Node built-ins, or `Worker`; its tests (ported from the current lib tests) pass when run under both the Next.js app and a React Native test runner.

## 3. OTA updates with EAS Update: what can and cannot ship without a store release

EAS Update ships a new JavaScript bundle and assets to installed builds; it never replaces the native binary ([Expo: EAS Update introduction](https://docs.expo.dev/eas-update/introduction/)). The gate is the **runtime version**: Expo's docs define it as "a property that guarantees compatibility between a build's native code and an update" ([Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)). An update downloads and runs only when its `runtimeVersion` matches the runtime embedded in the installed build.

### 3.1 CAN change over OTA (no App Store release required)

Anything delivered as JavaScript or bundled assets that stays compatible with the native runtime already in the shipped build:

- React components and screens; navigation behavior implemented in JS
- TS business logic - for UNTangle, the prereq engine, optimizer logic, and schedule views
- Styles and layout; bundled assets (images, fonts); text and feature flags
- Bug fixes that need no native change
- Server endpoint configuration represented in the update's JS

### 3.2 CANNOT change over OTA (new build + App Store release)

Anything that touches the native layer. Expo states the rule directly: "any time native code is updated, we're required to make a new build before publishing an update" ([Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)):

- Adding, removing, or upgrading a native module (e.g. a new map or storage library)
- Expo SDK or React Native upgrades that change native code
- Permissions, entitlements, Info.plist keys, URL schemes, background modes
- Bundle identifier, signing configuration, capabilities, native extensions
- Launch screen or app icon configuration; any Swift/Objective-C/Kotlin code

### 3.3 Managing the native/JS boundary

- **Runtime policy:** the `appVersion` policy ties the runtime version to the app version; the `fingerprint` policy increments it "whenever anything that may impact the native runtime changes," trading more frequent builds for near-elimination of mismatch risk ([Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)).
- **Channels and branches:** the channel is baked into the native build and maps to an update branch (`production` → production, `preview` → preview). An update reaches a device only when branch matches channel *and* runtime version matches ([Expo: Branch management](https://docs.expo.dev/eas-update/branch-management/)).
- **Rollback:** republish a prior compatible update on the same branch, or fall back to the binary's embedded bundle; `expo-updates` error recovery can also auto-revert to the previously working update after failed launches ([Expo: Rollbacks](https://docs.expo.dev/eas-update/rollbacks/), [Expo: Updates SDK](https://docs.expo.dev/versions/latest/sdk/updates/)).
- **Gradual rollout:** publish to a small percentage of users and monitor error rates before promoting fully - Expo documents rollouts for exactly this ([Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/)).

**Practical rule for UNTangle:** because the shared logic (section 2) is pure TS, prereq-suggestion tuning, optimizer scoring changes, and schedule-view iteration are OTA-shippable *as long as* they run on the native modules already inside the shipped build. The moment a change needs a new library - a different map renderer, a new storage module - it is a build-and-store event, not an update.

## 4. Apple constraints on OTA (2.5.2)

Apple's guideline 2.5.2 requires apps to be self-contained and forbids downloading or executing code that changes the app's features or functionality, subject to a narrow educational exception ([Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)). EAS Update is designed for exactly the permitted case — updating JS/assets within the functionality and native capabilities already reviewed — but:

- Updates must not unlock materially new features that would require review (the narrow exception is limited to educational apps).
- JS updates are not automatically exempt; Apple evaluates what the downloaded code does.
- Updates that unlock or sell functionality must also satisfy Apple's payment rules (IAP requirements).
- OTA is a delivery mechanism, not a review bypass: Apple evaluates what the app does, including what its downloaded updates do. EAS Update is designed to keep JS/asset changes inside 2.5.2's permitted scope; it confers no exemption by itself.

**Assessment:** UNTangle's planner/prereq/optimizer OTA iterations stay within the permitted model while they remain JS/assets inside the already-reviewed feature set - no new native surface, no payments, no entitlement changes. An update that surfaces a materially new capability should ship as a new build through review instead.

## 5. Maps without API keys or paid plans: MapLibre React Native + OpenFreeMap

- **Library:** `@maplibre/maplibre-react-native` binds MapLibre Native (BSD-2-Clause) to React Native ([MapLibre Native](https://maplibre.org/projects/native/)). Rendering happens on-device; the library does not supply tiles, styles, geocoding, or routing — you bring your own.
- **Style/tiles:** OpenFreeMap serves styles and vector tiles with no API key and no paid plan; the documented style URL is `https://tiles.openfreemap.org/styles/liberty` ([OpenFreeMap](https://openfreemap.org/)).
- **Expo compatibility:** this is a native module — it does **not** work in Expo Go. It requires a development build (`expo prebuild` + `expo run:ios`/`run:android`) or an EAS build.
- **Attribution is still required.** "No API key" does not mean "no attribution": OpenFreeMap, OpenStreetMap (ODbL), and style/font contributors must be credited in the map UI, and OpenFreeMap's own service terms (fair use, caching, commercial use) govern production deployment. MapLibre Native itself is BSD-2-Clause, which permits proprietary use with its conditions.
- **Relation to existing web stack:** the web app already renders with MapLibre GL JS on OpenFreeMap tiles (`frontend/src/components/map/`, since #25), so the same style JSON and layer definitions in `campus-style.ts` and `map-layers.ts` can be shared with MapLibre Native. Platform-specific code is limited to the renderer component, gestures and camera.

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

## 8. Citation audit (2026-10-13)

**Verified by fetching the live page in full this session:**

- [Expo: Work with monorepos](https://docs.expo.dev/guides/monorepos/) - first-class Bun/npm/pnpm/Yarn workspaces support; automatic Metro configuration (delete manual `watchFolders`, `resolver.nodeModulesPath`, `resolver.extraNodeModules`, `disableHierarchicalLookup`, then run `npx expo start --clear` once); the root `workspaces` property takes glob patterns (`["apps/*", "packages/*"]` is the documented example, so keeping `frontend/` as its own glob is consistent with the documented mechanism); `bun create expo apps/cool-app`; "If you have an existing app, you can copy all those files into a directory inside apps."
- [Expo: Runtime versions](https://docs.expo.dev/eas-update/runtime-versions/) - "Runtime versions are a property that guarantees compatibility between a build's native code and an update"; "any time native code is updated, we're required to make a new build before publishing an update"; `appVersion` vs `fingerprint` policy trade-off; gradual-rollout and error-recovery guidance.
- [Expo: metro.config.js](https://docs.expo.dev/versions/latest/config/metro/) - web-workers section verified via a search excerpt of this page: alpha, web-only, native usage errors with "Property 'Worker' doesn't exist." (Section not re-fetched in full this session.)

**Relied on research summaries citing the page, not fetched in full - flag before quoting exact numbers:**

- [expo.dev/pricing](https://expo.dev/pricing) - EAS free-tier build-credit and concurrency specifics. Section 6 deliberately directs the reader to this page instead of quoting numbers.
- [OpenFreeMap](https://openfreemap.org/) - "no API key, no paid plan" and the `liberty` style URL come from summaries of the site and docs; service-terms details (fair use, caching, commercial use) were not read verbatim - review before production.
- [Apple: Membership details](https://developer.apple.com/programs/whats-included/) - the 10,000-external-tester TestFlight figure comes from a page excerpt.
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/) - the 2.5.2 wording is quoted from a page excerpt of the current guidelines. The current guidelines page does not carry an executable-code provision numbered 3.3.2; this note did not verify whether 3.3.2 was the number in some older revision of the document.
- MapLibre React Native binding - MapLibre Native is BSD-2-Clause per maplibre.org, but the `@maplibre/maplibre-react-native` package's own license was not read from the package repository; check it before adoption.

## Sources

All sources inspected 2026-10-13. The three pages listed in section 8 were fetched in full; the rest were inspected via research summaries with page excerpts:

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
