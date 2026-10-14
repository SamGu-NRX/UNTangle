# UNTangle frontend

Next.js 16 (App Router) frontend for UNTangle — course catalog, schedule optimizer, campus map, transcript import, and grade pages. React 19, Tailwind CSS 4, Leaflet, Recharts, and better-auth with Drizzle ORM on PostgreSQL. Full-stack run instructions, including the backend submodule, are in the [root README](../README.md).

## Scripts

| Command | What it does |
|---|---|
| `bun run dev` | Next.js dev server (root `bun dev` orchestrates this together with the backend) |
| `bun run build` / `bun run start` | Production build / serve |
| `bun run lint` | ESLint (`eslint-config-next`) |
| `bunx drizzle-kit push` | Apply the Drizzle schema (`src/lib/db/schema.ts`) to Postgres |

There are no test scripts or test dependencies yet. Type-check with `bunx tsc --noEmit`.

## Environment variables

`frontend/.env` is loaded by Next.js automatically; [`frontend/.env.example`](.env.example) is the template. This is the complete list of variables read from `frontend/src`, generated with:

```bash
grep -rhoE "process\.env\.[A-Z0-9_]+" frontend/src | sort -u
```

| Variable | Read at | Default when unset | Behavior without it |
|---|---|---|---|
| `BACKEND_URL` | `src/lib/backend-api.ts` | none — falls through to `NEXT_PUBLIC_BACKEND_URL`, then `localhost` candidates | Server-side grade fetches probe `localhost:3001`, `3002`, `3011`; course and instructor pages return a standard 404 (no custom error UI) if no backend answers |
| `NEXT_PUBLIC_BACKEND_URL` | `src/lib/backend-api.ts` | none | Same degradation as `BACKEND_URL`; as a `NEXT_PUBLIC_*` value it is also inlined into client bundles |
| `BETTER_AUTH_URL` | `src/lib/auth.ts` | `http://localhost:3000` | Used as the auth base URL and trusted origin; a wrong value breaks sign-in and reset flows when the app is not served on that origin (root `bun dev` writes this for you) |
| `BETTER_AUTH_SECRET` | `src/lib/auth.ts` | a public development string | Without a real value, sessions are signed with a known secret — fine locally, not deployable |
| `DATABASE_URL` | `src/lib/db/index.ts`, `drizzle.config.ts` | none | The pg Pool falls back to the discrete `PG*` variables for auth; but saved-plan sync (`/api/planner`, `src/lib/persistence.ts`) is disabled — planner state stays in `sessionStorage` per tab |
| `PGHOST` | `src/lib/db/index.ts`, `drizzle.config.ts` | `127.0.0.1` | Part of the fallback Postgres configuration used when `DATABASE_URL` is unset |
| `PGPORT` | `src/lib/db/index.ts`, `drizzle.config.ts` | `5432` | Same |
| `PGDATABASE` | `src/lib/db/index.ts`, `drizzle.config.ts` | `untangle` | Same |
| `PGUSER` | `src/lib/db/index.ts`, `drizzle.config.ts` | your OS username, then `postgres` | Same |
| `PGPASSWORD` | `src/lib/db/index.ts`, `drizzle.config.ts` | none | Without a reachable Postgres (either config form), sign-in and saved-plan sync fail entirely; guest mode and the catalog/planner/map still work |
| `ORS_API_KEY` | `src/app/api/map/resolve/route.ts`, `src/app/api/map/route/route.ts` | none | No OpenRouteService geocoding (locations outside the bundled building list stay unresolved) and no foot-walking routes — the map draws straight-line segments with haversine distances, labeled "approximate", and no duration is shown. The fallback never calls ORS |
| `NEXT_PUBLIC_MAP_TILE_URL` | `src/components/map-leaflet-canvas.tsx` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` | Map renders on the default OpenStreetMap tiles |
| `NEXT_PUBLIC_MAP_ATTRIBUTION` | `src/components/map-leaflet-canvas.tsx` | OSM contributors attribution | Map shows the default OSM attribution |
| `NEXT_PUBLIC_MAP_MAX_ZOOM` | `src/components/map-leaflet-canvas.tsx` | `19` | Map caps at zoom 19 |
| `RESEND_API_KEY` | `src/lib/email.ts` | none | Password-reset emails fail (the send throws); sign-in and sign-up still work |
| `RESEND_FROM_EMAIL` | `src/lib/email.ts` | `UNTangle <onboarding@resend.dev>` | Reset emails are sent from the Resend development sender |
| `USER` | `src/lib/db/index.ts` | — | Not app configuration: it is only the last-resort fallback for `PGUSER` when `PGUSER` is unset |

Notes:

- `NEXT_PUBLIC_*` values are inlined at compile time — restart `dev`/`build` after changing them. The others are read at runtime.
- `drizzle.config.ts` (outside `src/`) also reads `DATABASE_URL` and the `PG*` variables for `drizzle-kit`.
- The root `scripts/dev.mjs` rewrites `BACKEND_URL` and `BETTER_AUTH_URL` in `frontend/.env` on every `bun dev` run (any other keys you add are preserved).

## Privacy: transcript import and Puter

The transcript import at `/courses/import` sends data to a third-party AI service. What actually happens, with code references:

1. **Local extraction first.** `pdfjs-dist` extracts the PDF's embedded text entirely in your browser (`src/components/transcript-import-client.tsx`). If the embedded text is sparse (fewer than 600 characters or fewer than 4 course-code matches), the pages are rendered to JPEG images in the browser instead.
2. **Text path redaction.** Before any text leaves the browser, `redactTranscriptText` (`src/lib/transcript-import.ts`) best-effort removes labeled identity fields with regexes: `Name:`, `Student ID:`, `UNT ID`/`EMPLID`/`Student Number`/`ID`, date of birth, `Student Address:`, email addresses, and SSN-like (3-2-4) or phone-like (3-3-4) digit runs.
3. **Image path masking.** Rendered pages are masked positionally, not semantically (`redactRenderedTranscriptPage`): the top 20% of page 1 and the top 7.5% of later pages are painted white with a "student identity redacted" banner. Identity text anywhere else on a page is **not** removed.
4. **What is sent to Puter.** The app loads the Puter browser SDK (`https://js.puter.com/v2/`) and sends either the redacted text (a redacted excerpt capped at 8,000 characters when candidate rows were found, otherwise 26,000, plus the candidate rows as JSON capped at 18,000) or the masked page images — which may be OCR'd through Puter (`puter.ai.img2txt`) and/or attached directly as image input, with OCR output re-redacted before the next attempt — to GPT-5.x model aliases, in order, with a 14-second timeout per attempt. When Puter file storage is available, masked images are first uploaded to Puter file storage and deleted again after analysis on a best-effort basis; when it is not, the images are passed directly as in-browser data URLs. Puter requires you to be signed in to its service for AI use.
5. **Fallback.** If Puter is unavailable, you are signed out of it, or every model attempt fails, a local regex parser (`parseCourseImportText`) extracts course rows from readable PDF text with no network call. Scanned PDFs cannot fall back this way and fail instead.
6. **Limits.** Neither step 2 nor step 3 is a complete anonymization guarantee. The redaction is label-anchored — for example, `Name:` is only redacted when it is followed by `Student ID:`, and `Student Address:` only up to `Print Date:` — so unexpected labels or formats pass through, and identity text outside the masked bands is never touched. The course, term, and grade rows themselves are always part of what is sent; the prompt even tells the model that identity fields "may be masked." Do not import a transcript you are not comfortable sending to Puter's AI providers.
7. **What is kept.** The PDF and its raw text never leave your browser except as described above. Only the course rows you approve are applied to your planner; like the rest of your planner data, they sync to the server when you are signed in.

Course/instructor grade data is unrelated to this flow: it is fetched from the backend API server-side.
