# Per-caller API limits

`withRateLimit(routeClass, handler)` counts each request before the handler runs. Signed-in callers count against their user id, so classmates behind one campus NAT keep separate budgets. Anonymous callers count against their IP, with IPv6 grouped by /64. The `auth` class (POST `/api/auth/*`) counts everyone by IP and never looks up a session. Budgets live in `config.ts`. They are unmeasured starting values.

Counters are fixed windows: one minute unless a budget sets `windowSeconds` (`setPassword` and the per-recipient `authEmail` budget use 10 minutes). In production they live in Postgres (`api_rate_limit`), so every instance shares them. Each hit is one `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`. Callers are stored as an HMAC keyed from `BETTER_AUTH_SECRET`, never as raw IPs or user ids. Each row carries its own expiry (`expires_at`); about once a minute each instance deletes expired rows and spent rows in better-auth's `auth_rate_limit`. Development and tests use a process-local memory store.

Over budget, the route answers 429 with `Retry-After` (seconds to the window's end) and `Cache-Control: no-store`. If the store fails, it answers 503 and the handler does not run. A successful response is the handler's own; the wrapper adds no headers to it.

better-auth's per-IP limiter still runs behind the `auth` budget. It reads before a request and counts after it, so a burst can slip past it; our budget is the atomic one.

| Variable | Production | Meaning |
| --- | --- | --- |
| `RATE_LIMIT_TRUSTED_PROXY` | Required unless `VERCEL=1` | `vercel` (`x-vercel-forwarded-for`), `cloudflare` (`cf-connecting-ip`) or `reverse-proxy` (`x-real-ip`). The proxy must overwrite that header. `none`, the default elsewhere, puts every anonymous caller in one bucket, and production rejects it. |
| `DATABASE_URL` | Required | The shared counters. Apply migration `0006_abuse_limits` before deploying. |
| `BETTER_AUTH_SECRET` | Required | Already required by auth. It also keys the caller HMAC. |

The server throws when it loads auth in production without these. Off production, a misspelled proxy value still throws.

`tests/rate-limit/postgres-live.test.ts` and `tests/auth/postgres-live.test.ts` (sign-in link claims) run only when `RATE_LIMIT_TEST_DATABASE_URL` points at a local Postgres. Each works in a schema it creates and drops, with the migrations it needs applied.
