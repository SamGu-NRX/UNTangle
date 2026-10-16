# UNTangle mobile

The iOS-first Expo app for UNTangle: Courses, Week, and Day. It runs as a
guest on a labeled sample student until device sign-in ships; it holds no
sign-in credential. Expo Router drives navigation; the schedule screens are
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

- `src/app` - Expo Router routes: tabs for Courses, Week and Day, and three
  routes presented as form sheets: `course/[code]`, `preferences` and
  `sign-in` (which explains that sign-in arrives with device sign-in).
- `src/theme` - the v3 tokens from `frontend/src/app/globals.css`;
  `tokens.test.ts` fails when the two drift apart.
- `src/plan` - the guest's plan: the sample record and course groups
  (`guest-plan.ts`), Week preferences (`preferences.ts`), Auto on the web's
  optimizer (`auto.ts`), Day's stops and leave-by times (`day-plan.ts`),
  and the plan as the device saves it (`saved-plan.ts`, written to a file on
  iOS and Android and to localStorage on web by `plan-storage.ts`).
- `src/ui` - press feedback, haptics, the tab and status glyphs, the week
  grid and the stepped slider.
- `src/data` - unauthenticated API modules with an injected fetch, kept for
  when device sign-in gives the app a credential.
- `src/updates` - over-the-air updates: the check/download controller, the
  safe-moment registry, and the EAS project resolution. See
  `../docs/mobile/ota.md` for how they fit together and how updates are
  published.

## Verification environment note

Expo web is the only platform this repo's CI can run; there is no iOS
simulator there. The web export is a single page (`web.output: "single"` in
`app.config.ts`). Native-only behavior still needs a device: the form-sheet
detents and grabber, haptics, the slider's drag and release, and the
press-scale timing.
