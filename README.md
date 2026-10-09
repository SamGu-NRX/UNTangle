# UNTangle

UNTangle is a course-catalog and semester planner for University of North Texas students, built as a CSCE 3444 (Software Engineering) team project. It plans a UNT semester end to end in three steps — **01 Courses → 02 Schedule → 03 Map**: mark what you have taken, optimize one semester's schedule around a goal, then follow a campus walking route. You can browse as a guest (your plan stays in the browser) or sign in to keep it across devices.

## What it does

- **Course catalog and progress tracking.** A bundled UNT catalog (656 courses in `frontend/src/lib/generated/seed-data.json`, built from `courses/*.json`) with search and department filters. Mark each course Done / Taking / Not taken; prerequisite-locked courses unlock as you complete requirements (`frontend/src/lib/planner.ts`). Pick a major (8 presets in `frontend/src/lib/seed-data.ts`) and track core-course progress.
- **Transcript import.** Upload the unofficial myUNT transcript PDF (up to 12 MB) at `/courses/import`. It is read in your browser with pdf.js, identity fields are best-effort redacted (text) or band-masked (scanned pages), and the Puter browser AI SDK extracts the course rows. Nothing is applied until you review and approve it. Read the privacy note in [`frontend/README.md`](frontend/README.md) first — redaction and masking are not complete anonymization.
- **Schedule optimization.** Five one-click modes — Cluster mornings, Cluster nights, Compact days, Minimize walking, Strong professors (`frontend/src/components/schedule-client.tsx`) — pick the best conflict-free combination of bundled section meeting times (`frontend/src/lib/planner.ts`). Individual sections can be pinned, and time conflicts are flagged on the week grid.
- **Campus map with walking routes.** Class stops for a day are resolved against a bundled UNT building database (`frontend/src/lib/campus-locations.ts`; names/addresses from UNT Facilities, coordinates checked against OSM building footprints) and drawn on a Leaflet map with OpenStreetMap tiles. With an `ORS_API_KEY`, routes between stops use OpenRouteService foot-walking directions; without one, the map still draws straight-line segments between buildings, labeled "approximate." Print the itinerary or download it as a text brief (`frontend/src/components/map-client.tsx`).
- **Course and instructor grade pages.** Grade distributions (A–Z plus suppressed grades), average GPA, enrollment, per-term sections, and RateMyProfessors rating/difficulty/tags, served by the backend API (`frontend/src/app/courses/[subject]/[number]/page.tsx`, `frontend/src/app/instructors/[id]/page.tsx`). Catalog data is bundled at build time and grade data comes from the backend — neither is fetched live from UNT.
- **Accounts.** Email/password sign-in via better-auth (`frontend/src/lib/auth.ts`). Guests keep their planner in `sessionStorage`; signed-in users sync it to Postgres through `/api/planner` (`frontend/src/lib/persistence.ts`).

## Architecture

| Piece | What it is | Where |
|---|---|---|
| `frontend/` | Next.js 16 App Router app — React 19, Tailwind CSS 4, Leaflet, Recharts, better-auth with Drizzle ORM on PostgreSQL | this repo |
| `backend/` | Express API serving grade-distribution data, SQLite in development | git submodule → [sunnyD1000/UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer) |
| `scripts/dev.mjs` | `bun setup` / `bun dev` orchestrator: submodule, installs, ports, `.env` files, seeding | this repo |
| `courses/` | Raw UNT course-catalog JSON per department | this repo |
| `old/` | Static HTML design mockups from early development | this repo |

## Team

Built by **Sam Gu** ([@SamGu-NRX](https://github.com/SamGu-NRX)), **Sangharsha Dhakal** ([@sunnyD1000](https://github.com/sunnyD1000)), and **vishyj** ([@vishyj](https://github.com/vishyj)) for CSCE 3444 (Software Engineering) at the University of North Texas. The backend is developed in sunnyD1000's [UNT-Schedule-Optimizer](https://github.com/sunnyD1000/UNT-Schedule-Optimizer) repository and wired in here as a git submodule.

## Setup

### Prerequisites

- [Bun 1.3.10](https://bun.sh) (pinned as `packageManager` in `package.json`) and Node.js
- Git access to both repositories (the backend submodule points at a separate GitHub repo)
- A PostgreSQL database for accounts and saved plans (frontend auth + planner state)
- Optional keys for full functionality: `ORS_API_KEY`, `RESEND_API_KEY`, and a Puter account for transcript AI. [`frontend/README.md`](frontend/README.md) documents what degrades without each.

### 1. Install and set up

```bash
bun setup
```

`bun setup` runs `node scripts/dev.mjs --setup-only`, which performs, in order (`scripts/dev.mjs`):

1. `git submodule update --init --recursive` when `backend/package.json` is missing — this needs access to the sunnyD1000 repo.
2. `bun install --frozen-lockfile` at the workspace root and in `backend/` whenever their `node_modules` are missing.
3. Picks ports: the frontend prefers 3000, then 3001–3004 and 3010; the backend prefers 3001, then 3011, 3002, 3012, 3003, 3013 (`FRONTEND_PORT` / `BACKEND_PORT` override). A compatible backend that answers `/api/health` with `service: "untangle-backend"` is reused instead of started.
4. Creates `backend/.env` and `frontend/.env` from their `.env.example` files, then writes the chosen ports into them (`BACKEND_URL` and `BETTER_AUTH_URL` in `frontend/.env`; other keys you add are preserved).
5. Seeds the backend's local SQLite database (`backend/data/untangle.db`) when it has no grade-distribution rows. Skip with `--no-seed`.

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

`bun dev` repeats the same setup checks (submodule, installs, ports, `.env` sync, seeding), then starts the backend and frontend together. Run one side by itself with `bun run frontend:dev`, `bun run backend:dev`, or `bun run backend:seed`.

### Environment variables

Every variable the frontend reads — and which features degrade without each — is documented in [`frontend/README.md`](frontend/README.md), with a matching [`frontend/.env.example`](frontend/.env.example).

## Privacy

Transcript import sends transcript text or rendered page images to Puter after best-effort in-browser redaction or fixed-band image masking. Neither is a complete anonymization guarantee — see the privacy note in [`frontend/README.md`](frontend/README.md) before importing a real transcript.
