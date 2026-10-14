# UNTangle mobile

The iOS-first Expo app for UNTangle: Courses, Week, and Day, with UNT-email
magic-link sign-in. Expo Router drives navigation; the schedule screens are
built from the same pure TypeScript modules the web frontend uses
(see `SHARED.md`).

## Commands

All commands run from this directory, and every bun invocation carries
`--no-env-file` so ambient `.env` files never leak into builds or tests:

```sh
bun --no-env-file run start        # expo start (dev server)
bun --no-env-file run test         # Jest over the data layer and schedule builders
bun --no-env-file run lint         # ESLint flat config
bun --no-env-file x tsc --noEmit   # typecheck
bun --no-env-file x expo export --platform web   # web bundle (what CI builds)
```

## Layout

- `src/app` - Expo Router routes: tabs for Courses/Week/Day, plus
  `/sign-in` and `/auth/callback` (the `untangle://auth/callback`
  deep-link target; the scheme is set in `app.config.ts`).
- `src/data` - API modules, each taking an injected fetch for tests:
  `planner.ts` (GET /api/planner), `sections.ts` (GET /api/sections/...),
  `magic-link.ts` (sign-in request and token verify), `session.ts`
  (SecureStore session cookie), `api-base.ts` + `http.ts` (base URL and
  injected-fetch request helper with cookie replay).
- `src/schedule` - glue between the API modules and the shared week
  builders: `sample-schedule.ts` (the labeled sample), `remote-catalog.ts`,
  and the `useScheduleView` hook.

## Verification environment note

Expo web on Linux is the only platform this repo's CI and sandbox can run;
there is no iOS simulator here. Native behavior (SecureStore, deep links on
device) is unit-tested against mocks and remains for real-device checks
listed in the Before TestFlight notes of the workspace PR.
