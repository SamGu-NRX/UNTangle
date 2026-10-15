# Task: calendar occurrences

Build `meetingOccurrences` and `feedOccurrences` in `packages/core/src/occurrences.ts`. Both place things on real dates in the campus time zone, so Auto can check classes against calendar events date by date instead of by approximate weekly blocks.

- `meetingOccurrences` expands a section's weekly meetings over a session's class days, skipping its no-class days.
- `feedOccurrences` turns what the app's calendar-feed parser yields into one piece per local day. The parser has already expanded recurrences, EXDATEs and overrides.

## What to read first

- `packages/core/src/occurrences.ts`: the types and doc comments are the spec, including the DST and midnight rules. Keep every exported name and signature.
- `frontend/src/lib/calendar-feeds/README.md` and `types.ts`: what a parsed feed holds. All-day occurrences name calendar dates in UTC midnights. Don't convert them through the time zone.
- `frontend/src/lib/calendar-feeds/datetime.ts`: pure zone helpers built on `Intl`. You may copy what you need into core. Moving the whole module is a separate core move.
- `frontend/src/lib/terms/terms.ts`: where session dates and holidays come from.

## The tests you make pass

`packages/core/tests/occurrences/occurrences.test.ts`. Its fixtures are in the same folder: `campus-feed.ics`, the app parser's output for it in `fixtures.ts`, real Spring 2027 meetings, and the Spring 2027 and Fall 2026 calendars. They cover both 2026-27 DST changes, holidays, all-day and multi-day events, an event that crosses midnight and one that ends exactly at midnight.

## Files you may change

- `packages/core/src/occurrences.ts`, and new modules under `packages/core/src/`.
- `tests/pending-acceptance.txt`: delete the line `packages/core/tests/occurrences/occurrences.test.ts`, and nothing else.

## Constraints

- Don't change the test file or anything else in its folder.
- Core is pure: no imports from frontend, Node, Bun, the DOM or data files, and no ambient clock. `Intl.DateTimeFormat` is available; there is no bundled time zone database.
- Add no dependencies, and touch no lead-owned path (`.github/lead-owned-paths.txt`). Propose contract changes in your PR description.
- Don't wire this into Auto or the calendar UI. That's a later task.
- The PR that listed this test was approved by Sam's approving review on the PR's head commit. Never submit a review, never merge and never use `--admin`.

## Done means

- From the repo root, `bun install --frozen-lockfile` and `bunx turbo run typecheck lint test` pass, with your line gone from the pending list.
- A PR from an `obv/calendar-occurrences` branch into `alpha`.
