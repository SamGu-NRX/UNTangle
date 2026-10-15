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
values (`eas env:set --environment production --name
EXPO_PUBLIC_EAS_PROJECT_ID --value <uuid>`, then the same for the update
URL — `eas env:create` is deprecated in current eas-cli, use `env:set`):

```
EXPO_PUBLIC_EAS_PROJECT_ID=<uuid from eas init>
EXPO_PUBLIC_EAS_UPDATE_URL=https://u.expo.dev/<same uuid>
```

`eas.json` maps build profiles to channels: `development → development`,
`preview → preview`, `production → production`. Users only ever receive
updates from the production channel.

## First production build (one time)

1. In `mobile/`, run `eas init` and put the printed project id and update URL
   into the two environment variables above.
2. `eas build --profile production --platform ios` and submit to TestFlight /
   the App Store. Until the first production build exists there is nothing
   that can receive updates.

## Publishing an update

From the repo root:

```
bun --no-env-file scripts/mobile/ota-publish.ts --message "fix day hero copy"
```

The script is a **dry run by default**. It

1. computes the local runtime fingerprint
   (`npx expo-updates fingerprint:generate --platform ios`),
2. asks `eas build:list --json` for the stores' finished production builds,
3. **refuses to publish** unless at least one finished production build shares
   the update's fingerprint. With no matching build the update would be
   invisible to every install — that almost always means the change needs a
   new `eas build`, not an update — and it prints every fingerprint it saw
   before refusing,
4. otherwise prints the exact `eas-cli update` command it would run.

Add `--apply` to publish, and `--rollout-percentage 25` for a staged rollout
(whole numbers, 1–100). iOS is the only publish target: the script rejects any
other `--platform` value with an error. Android profiles and channels exist in
config, but Android has never been built or device-tested.

### Offline and CI validation

Two flags swap the network calls for saved files so the guard can be
exercised without an EAS session:

- `--fingerprint-file <path>` — a saved `fingerprint:generate` output
  (the synthetic fixtures in `scripts/mobile/fixtures/` embed the fingerprint
  this branch was validated against).
- `--build-list-file <path>` — a saved `eas build:list --json` output.

The checked-in fixtures are **synthetic** shapes, labeled as such inside each
file; they were never captured from a live EAS account.

### Exit codes

- `0` — dry run planned the publish, or `--apply` published.
- `1` — a guard refusal or EAS failure (missing environment variables, no
  production builds, fingerprint mismatch, `eas update` failure). Nothing was
  published.
- `2` — a local setup problem (a saved file could not be read).

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

- `bun --no-env-file run turbo run typecheck lint test` — 26/26 tasks pass,
  including the 10 mobile suites (108 tests), among them the startup-wiring
  suite (`start.test.ts`), which asserts that no transition ever calls
  `reloadAsync`.
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
- The fingerprint fixtures embed `c5c7d1271d1eec47c736fd68981ab8962f47c916`,
  computed with `npx --no-install expo-updates fingerprint:generate --platform
  ios` in `mobile/` against this branch's checkout; it changes with any config
  or dependency change and the fixtures note that.

## Deliberately not done yet

- No EAS project exists for UNTangle, so `eas init`, the first production
  build, and a live-channel update are still pending — the guard's live path
  is validated offline only.
- Android is configured (profiles, channels, export guard) but untested on a
  device; iOS is the shipping target.
