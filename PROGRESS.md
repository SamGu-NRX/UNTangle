# Progress snapshot: UNTangle-alpha (20261118)

The local checkout `~/Programming Projects/UNTangle-alpha` was removed on 2026-11-18 to free disk space on Sam's Mac, after everything in it was pushed here. This file records where the work stood.

## What it is

UNTangle: UNTangle is a course-catalog and semester planner for University of North Texas students, built as a CSCE 3444 (Software Engineering) team project. It plans a UNT semester end to end in three steps — **01 Courses → 02 Schedule → 03 Map**: mark what you have taken, optimize one semester's schedule around a goal, then follow a campus walking route. You can browse as a guest (your plan stays in the browser) or sign in to keep it across devices.



## State

- Checkout branch: `(detached)` at `a004f2e29c`
- Snapshot branch: `archive/progress-20261118-UNTangle-alpha` (HEAD plus the uncommitted work listed below)
- Last commits:
- a004f2e2 2026-10-14 ci: limit the workflow token to reading the repository
- bf87c22d 2026-10-14 ci: gate live Postgres tests on an explicit input and pin actions by SHA
- 79a94b24 2026-10-14 ci: raise the unit test timeout to 20s for slower CI runners
- 7cc9682e 2026-10-14 ci: run typecheck, lint, tests, and build on every PR into alpha
- d1109bda 2026-10-14 fix(policy): cite the 2026-2027 catalog and use its wording for the 21-hour tier
- 32a50032 2026-10-14 fix(policy): keep GPA conditions in the model and harden the source walker
- 87a5432c 2026-10-14 feat(policy): add sourced UNT credit-load thresholds and zone classifier
- 4692b326 2026-10-13 Merge #60 (plain-language schedule preferences parser) at cbba6c9 into alpha

The working tree was clean; nothing uncommitted was captured.

Git-ignored files that can't be rebuilt (.env files, local data) were copied to `~/MacSetup/worktree-leftovers-20261118/UNTangle-alpha` on the Mac. They are not on GitHub or Drive.

## What's left

Nothing recorded beyond the commits above.

## How to resume

```sh
git clone https://github.com/SamGu-NRX/UNTangle.git "$HOME/Programming Projects/UNTangle-alpha"
git -C "$HOME/Programming Projects/UNTangle-alpha" checkout archive/progress-20261118-UNTangle-alpha
```

Then copy the kept ignored files back: `cp -R "$HOME/MacSetup/worktree-leftovers-20261118/UNTangle-alpha/." "$HOME/Programming Projects/UNTangle-alpha/"`, and reinstall dependencies.

## Thread

No T3 thread was found for this checkout.
