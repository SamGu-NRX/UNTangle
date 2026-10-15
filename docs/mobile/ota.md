# Over-the-air updates (EAS Update)

How UNTangle's iOS app ships JavaScript fixes without an App Store release,
and the guard that keeps an update from being published to installs that can
never run it. The delivery research behind these choices is
`docs/research/mobile/expo-ios-delivery.md`; the runtime contract lives in the
Mobile section of `docs/architecture/README.md`.

## How it works

`mobile/src/updates/` holds four modules:

- **`update-controller.ts`** — a small state machine over `expo-updates`
  (`idle → checking → downloading → current | ready`). At launch and on each
  return from a long backgrounding it checks for an update, downloads one if
  present, and holds it. Nothing restarts the app today: the download sits in
  `ready` until the next cold start applies it, and `applyWhenSafe` is the
  explicit apply path reserved for when plans persist to SQLite.
- **`safe-moment.ts`** — a refcounted registry of *unsafe moments*. Any code
  about to do work that a mid-run restart would corrupt (a plan import, a
  conflict review, the Auto options card) opens a hold with `beginUnsafeMoment("import-review")` and
  closes it with `endUnsafeMoment(...)`. The app is safe to restart only when
  the count is zero.
- **`start.ts`** — the launch wiring: starts the controller, checks at launch,
  rechecks after a long backgrounding, and triggers a background download when
  the app backgrounds. It never restarts the app: while the student's plan
  lives only in memory, a restart on backgrounding would wipe their picks
  after a quick app switch. A downloaded update applies at the next cold
  start, and screens can hold the flow still with an unsafe moment while a
  review is open.
- **`eas-project.ts`** — resolves `EXPO_PUBLIC_EAS_PROJECT_ID` and
  `EXPO_PUBLIC_EAS_UPDATE_URL` for `app.config.ts`. Empty environments get a
  placeholder so the CI export (which runs without EAS variables) keeps
  working; a real publish refuses to run without real values, and a partial or
  malformed pair is an error in both modes.

The controller takes its `expo-updates` client and safety predicate as
arguments, so tests run the whole flow with a fake client and a controllable
`isSafeToApply` (see `update-controller.test.ts`).

## Configuration

`mobile/app.config.ts` sets `updates.url` from the environment and uses the
`fingerprint` runtime-version policy: an update is bound to the exact native
fingerprint it was built against. The two environment variables must be set
together, in two places: a local `mobile/.env.local` (gitignored) for
development, and the EAS cloud environment so build workers bundle the real
values — the exact commands are steps 4–5 of the setup section below:

```
EXPO_PUBLIC_EAS_PROJECT_ID=<uuid from eas init>
EXPO_PUBLIC_EAS_UPDATE_URL=https://u.expo.dev/<same uuid>
```

`eas.json` maps build profiles to channels: `development → development`,
`preview → preview`, `production → production`. Users only ever receive
updates from the production channel.

## Setup only Sam can do (one time)

Each step below needs a password, an Apple or Expo account session, or a
decision about UNTangle's identity — none of it is scriptable for a teammate.
Run in this order from `mobile/` unless noted.

1. **Enroll the Apple Developer account** —
   https://developer.apple.com/programs/ (sign in, complete enrollment, and
   accept the latest agreement under https://developer.apple.com/account). No
   CLI command; EAS cannot build or submit for iOS until the account is
   active.
2. **Create the App Store Connect app** — in App Store Connect
   (https://appstoreconnect.apple.com), My Apps → "+" → New App, with the
   bundle id step 7's build will use. Before building, set that real
   identifier as `ios.bundleIdentifier` in `mobile/app.config.ts` — the
   checked-in value is the placeholder `app.untangle.mobile.placeholder`.
3. `npx eas-cli login` — sign in to the Expo account that will own the
   UNTangle project.
4. `eas init` — creates the EAS project and prints the project id and update
   URL. Put both into the two variables below in `mobile/.env.local`
   (gitignored):

   ```
   EXPO_PUBLIC_EAS_PROJECT_ID=<uuid from eas init>
   EXPO_PUBLIC_EAS_UPDATE_URL=https://u.expo.dev/<same uuid>
   ```

5. **`eas env:create` for both variables in production and in preview**, so
   EAS build workers bundle the real values:

   ```
   eas env:create --non-interactive --environment production --name EXPO_PUBLIC_EAS_PROJECT_ID --value <uuid>
   eas env:create --non-interactive --environment production --name EXPO_PUBLIC_EAS_UPDATE_URL --value https://u.expo.dev/<uuid>
   eas env:create --non-interactive --environment preview --name EXPO_PUBLIC_EAS_PROJECT_ID --value <uuid>
   eas env:create --non-interactive --environment preview --name EXPO_PUBLIC_EAS_UPDATE_URL --value https://u.expo.dev/<uuid>
   ```

   (current eas-cli prints that `env:create` is deprecated in favor of
   `env:set`, which also updates existing variables; both create the
   variables.)
6. `eas credentials -p ios` — generate and assign the iOS distribution
   certificate and provisioning profile; accept the defaults to let EAS
   manage them.
7. `eas build --profile production --platform ios` — the first production
   build, on the production channel. Until it exists nothing can receive an
   update, so the publish guard refuses every publish.
8. `eas submit` — once the build finishes, send it to App Store Connect /
   TestFlight (eas-cli prompts for the build and the app from step 2).

## Publishing an update

From the repo root:

```
bun --no-env-file scripts/mobile/ota-publish.ts --message "fix day hero copy"
```

The script is a **dry run by default**. It

1. computes the local runtime fingerprint
   (`npx expo-updates fingerprint:generate --platform ios`),
2. asks `eas build:list --json` for finished iOS store builds that carry that
   fingerprint (`--status finished --distribution store --fingerprint-hash`,
   `--limit 50`, eas-cli's cap), and keeps those on the production channel,
3. **refuses to publish** unless at least one finished production build shares
   the update's fingerprint. With no matching build the update would be
   invisible to every install — that almost always means the change needs a
   new `eas build`, not an update — and it prints the fingerprints of the
   newest 50 finished store builds before refusing,
4. otherwise prints the exact `eas-cli update` command `--apply` would run,
   shell-quoted so it can be copied as is.

Add `--apply` to publish, and `--rollout-percentage 25` for a staged rollout
(whole numbers, 1–100). iOS is the only publish target: the script rejects any
other `--platform` value with an error. Android profiles and channels exist in
config, but Android has never been built or device-tested.

### Offline and CI validation

Two flags swap the network calls for saved files so the guard can be
exercised without an EAS session:

- `--fingerprint-file <path>` — a saved `fingerprint:generate` output
  (the fixtures in `scripts/mobile/fixtures/` embed the fingerprint this
  branch was validated against).
- `--build-list-file <path>` — a saved `eas build:list --json` output. The
  guard applies the same channel, store and fingerprint checks to it, since
  a saved list may not have been filtered.

The checked-in build lists are **synthetic**: no EAS project exists yet, so
nothing was captured from a live account. Their shape follows eas-cli 24.14.0's
source: `build:list --json` prints a bare array of the GraphQL `BuildFragment`
(`src/graphql/types/Build.ts`) through `printJsonOnlyOutput`
(`src/build/queries.ts`), which drops `__typename` and every null field.
Enum values are upper case (`"IOS"`, `"FINISHED"`, `"STORE"`), the channel is
`updateChannel.name` and the fingerprint is `fingerprint.hash`. Replace them
with a real capture once the first production build exists.

### Exit codes

- `0` — dry run planned the publish, or `--apply` published.
- `1` — a guard refusal or EAS failure (missing environment variables, no
  production builds, fingerprint mismatch, an `eas build:list` or `eas update`
  failure). Nothing was published.
- `2` — a local setup problem (a saved file could not be read or holds no
  build array).

## What the app does on the device

- Development builds and sessions with updates disabled never check.
- A failed check or download is silent and retried on the next trigger; the
  user is never blocked.
- A rollback directive (`isRollBackToEmbedded`) readies without downloading.
- A downloaded update is applied at the next cold start — the app never
  restarts itself while the plan is memory-only, so a review or a quick app
  switch can never lose the student's picks. `applyWhenSafe` keeps the
  explicit safety rule for the SQLite future: it refuses while an unsafe
  moment is open and stays `ready` so the next caller retries, never twice.

## Validation on this branch

- `bun --no-env-file run turbo run typecheck lint test` — 27/27 tasks pass
  (mobile now ships a `typecheck` script, so turbo runs the same tsc gate CI
  does), including the 10 mobile suites (108 tests), among them the
  startup-wiring suite (`start.test.ts`), which asserts that no transition
  ever calls `reloadAsync`.
- `bunx expo config --type public` renders the placeholder pair with no
  environment and the real pair with both variables set; partial or malformed
  pairs fail config resolution with a message naming both variables.
- `bunx expo export --platform ios` bundles cleanly without EAS variables
  (this is the same export CI runs).
- The publish guard was exercised offline: a matching build list passes and
  prints the exact `eas-cli update` command, including `--environment
  production`; a stale list refuses with every fingerprint on file; a missing
  saved file, a malformed saved fingerprint, a non-iOS `--platform`, and a
  missing environment all refuse with clear messages (guard refusals exit 1,
  local setup problems exit 2).
- The fingerprint fixture embeds `677b489a545ef723b22b76b0830877e24022f4e9`,
  computed with `npx --no-install expo-updates fingerprint:generate --platform
  ios` in `mobile/` against this branch's checkout (the earlier
  `c5c7d1271d1eec47c736fd68981ab8962f47c916` went stale when the mobile
  `typecheck` script changed `mobile/package.json` — it changes with any
  config or dependency change).

## Deliberately not done yet

- Every step in "Setup only Sam can do" is still pending — no Apple Developer
  enrollment, App Store Connect app, or EAS project exists for UNTangle, so a
  live-channel update has never run and the guard's live path is validated
  offline only.
- Android is configured (profiles, channels, export guard) but untested on a
  device; iOS is the shipping target.
