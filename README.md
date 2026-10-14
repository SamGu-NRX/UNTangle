# UNTangle

UNTangle is a course-catalog and semester planner for University of North Texas students, built as a CSCE 3444 (Software Engineering) team project. It plans a UNT semester end to end in three steps — **01 Courses → 02 Schedule → 03 Map**: mark what you have taken, optimize one semester's schedule around a goal, then follow a campus walking route. You can browse as a guest (your plan stays in the browser) or sign in to keep it across devices.

## What it does

- **Course catalog and progress tracking.** A bundled UNT catalog (656 courses in `frontend/src/lib/generated/seed-data.json`, built from `courses/*.json`) with search and department filters. Mark each course Done / Taking / Not taken; prerequisite-locked courses unlock as you complete requirements (`frontend/src/lib/planner.ts`). Pick a major (8 presets in `frontend/src/lib/seed-data.ts`) and track core-course progress.
- **Transcript import.** "Import courses from myUNT" opens myUNT's unofficial transcript page in a separate window; you download the PDF there and choose it (or drop it on the page) back in UNTangle. The PDF (up to 12 MB) is read in your browser with pdf.js, labeled identity fields are best-effort redacted, and a local parser finds the course rows. Nothing leaves the browser, and nothing is applied until you review and approve it. Details are in the privacy note in [`frontend/README.md`](frontend/README.md).
- **Schedule optimization.** Five one-click modes — Cluster mornings, Cluster nights, Compact days, Minimize walking, Strong professors (`frontend/src/components/schedule-client.tsx`) — pick the best conflict-free combination of bundled section meeting times (`frontend/src/lib/planner.ts`). Individual sections can be pinned, and time conflicts are flagged on the week grid.
- **Campus map with walking routes.** Class stops for a day are resolved against a bundled UNT building database (`frontend/src/lib/campus-locations.ts`; names/addresses from UNT Facilities, coordinates checked against OSM building footprints) and drawn on a Leaflet map with OpenStreetMap tiles. With an `ORS_API_KEY`, routes between stops use OpenRouteService foot-walking directions; without one, the map still draws straight-line segments between buildings, labeled "approximate." Print the itinerary or download it as a text brief (`frontend/src/components/map-client.tsx`).
- **Course grade history.** The course detail panel shows the grade distribution and GPA for the course overall and for each instructor, read server-side from untgrades.app through the `/api/grades/*` routes (`frontend/src/lib/grades-history`). Old `/instructors/{id}` links redirect to Courses. Catalog data is bundled at build time; neither source is fetched live from UNT.
- **Accounts.** Sign-in via better-auth (`frontend/src/lib/auth.ts`): a one-time email link for UNT addresses (`@unt.edu` / `@my.unt.edu`, enforced in `frontend/src/lib/unt-auth.ts`) or email/password, with password-reset emails sent through Resend. Guests keep their planner in `sessionStorage`; signed-in users sync it to Postgres through `/api/planner` (`frontend/src/lib/persistence.ts`).

## Architecture

| Piece | What it is | Where |
|---|---|---|
| `frontend/` | Next.js 16 App Router app — React 19, Tailwind CSS 4, Leaflet, Recharts, better-auth with Drizzle ORM on PostgreSQL | this repo |
| `scripts/dev.mjs` | `bun setup` / `bun dev` orchestrator: installs, port, `frontend/.env` | this repo |
| `courses/` | Raw UNT course-catalog JSON per department | this repo |
| `old/` | Static HTML design mockups from early development | this repo |

## Team

Built by **Sam Gu** ([@SamGu-NRX](https://github.com/SamGu-NRX)), **Sangharsha Dhakal** ([@sunnyD1000](https://github.com/sunnyD1000)), and **vishyj** ([@vishyj](https://github.com/vishyj)) for CSCE 3444 (Software Engineering) at the University of North Texas. The original Express backend lived in Sangharsha's [UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer) repository. It is retired, and [`docs/backend-legacy.md`](docs/backend-legacy.md) records what to keep from it for our own server.

## Setup

### Prerequisites

- [Bun 1.3.10](https://bun.sh) (pinned as `packageManager` in `package.json`) and Node.js
- A PostgreSQL database for accounts and saved plans (frontend auth + planner state)
- Keys: `ORS_API_KEY` (optional), and `RESEND_API_KEY` plus `RESEND_FROM_EMAIL` for sign-in email (required in production; in development the sign-in link goes to the server log). [`frontend/README.md`](frontend/README.md) documents what each does.

### 1. Install and set up

```bash
bun setup
```

`bun setup` runs `node scripts/dev.mjs --setup-only`, which performs, in order (`scripts/dev.mjs`):

1. `bun install --frozen-lockfile` at the workspace root whenever `node_modules` is missing.
2. Picks a port: 3000, then 3001–3004 and 3010 (`FRONTEND_PORT` overrides).
3. Creates `frontend/.env` from `frontend/.env.example` if it is missing, then writes `BETTER_AUTH_URL` for the chosen port (other keys you add are preserved).

### 2. Configure the frontend database

`bun setup` does not provision Postgres. Set one of these in `frontend/.env` (all variables are documented in [`frontend/README.md`](frontend/README.md)):

```
DATABASE_URL=postgres://user:password@127.0.0.1:5432/untangle
```

or the discrete `PGHOST` / `PGPORT` / `PGDATABASE` / `PGUSER` / `PGPASSWORD` form, then apply the schema:

```bash
cd frontend && bunx drizzle-kit push
```

### 3. Run

```bash
bun dev
```

`bun dev` repeats the same setup checks, then starts the frontend. `bun run frontend:dev` starts Next.js without them.

### Environment variables

Every variable the frontend reads — and which features degrade without each — is documented in [`frontend/README.md`](frontend/README.md), with a matching [`frontend/.env.example`](frontend/.env.example).

### Repository notes

- `.husky/pre-commit` calls `scripts/format-staged.sh`, which is not in the repository. The hook is inert in normal clones (nothing installs or activates it), but do not enable husky without restoring that script.

### Continuous integration

Every pull request into `alpha` (and every push to `alpha`) runs GitHub Actions CI (`.github/workflows/ci.yml`): typecheck, lint, unit tests, and a production build that uses dummy placeholder environment variables instead of any repository secrets. Opt-in live Postgres tests run separately via `workflow_dispatch`.

## Privacy

Transcript import runs in the browser: the PDF is read, redacted and parsed locally, and nothing about it is sent anywhere. Only the course rows you approve are kept in your plan. See the privacy note in [`frontend/README.md`](frontend/README.md).
