# API and third-party request budgets

This reference is for route owners and deployment maintainers. `withRateLimit` charges both a caller identity and an IP for every API request, including malformed requests and cache hits. A denial returns JSON with status 429, `Retry-After` in whole seconds, and `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and `RateLimit-Policy`. Reset is the number of seconds until the oldest accepted request expires. Denied calls do not extend a window. Wrapped responses are private and uncached because their headers contain caller-specific counters and may issue a guest cookie.

## Identity and proxy trust

A better-auth session supplies the signed-in user id. An anonymous caller receives `untangle_guest`, a random id and expiry signed with HMAC-SHA256. The cookie is HttpOnly, SameSite=Lax, expires after 30 days and is Secure in production. Invalid, tampered or expired cookies get a new id. User, guest and IP identifiers are HMAC-hashed before storage. Every request also consumes the IP allowance, so clearing or cycling guest cookies does not bypass it.

`RATE_LIMIT_TRUSTED_PROXY` selects exactly one deployment-owned header:

| Value | Header | Deployment requirement |
| --- | --- | --- |
| `vercel` | `x-vercel-forwarded-for` | Request must enter through Vercel. Default when `VERCEL=1`. |
| `cloudflare` | `cf-connecting-ip` | Origin must accept traffic only through Cloudflare. |
| `reverse-proxy` | `x-real-ip` | Proxy must overwrite this header and prevent direct access to the origin. |
| `none` | None | Default elsewhere. All callers share the `unknown` IP bucket. |

Missing, malformed and comma-separated header values use `unknown`. Arbitrary `x-forwarded-for` values are ignored. IPv6 spellings normalize and share a /64 allowance. IPv4-mapped IPv6 uses the IPv4 allowance. The `unknown` bucket can deny unrelated guests together, but never grants an untrusted caller a fresh IP allowance. See [Vercel request headers](https://vercel.com/docs/headers/request-headers#x-vercel-forwarded-for) for the hosting header contract.

## Starting budgets

These numbers are starting points. No production usage measurement supports them. Windows are sliding, not fixed or continuously refilled.

| Class | Per user or guest per minute | Per IP per minute | Routes |
| --- | ---: | ---: | --- |
| `plannerSave` | 60 | 180 | POST `/api/planner` |
| `grades` | 60 | 180 | All four `/api/grades/*` endpoints combined |
| `mapRoute` | 60 | 60 | POST `/api/map/route` |
| `mapResolve` | 60 | 60 | POST `/api/map/resolve` |
| `sections` | 60 | 180 | Reserved for upcoming `/api/sections` |
| `expensive` | 10 | 30 | Reserved for expensive work |
| `general` | 120 | 360 | GET `/api/planner` and `/api/map/worker` combined |

Both map endpoints keep their former 60/minute IP ceilings. Map windows remain independent per configured campus, and aliases share the canonical campus id. Existing map caches, validation and fallback behavior remain in their handlers. Budget definitions and the reasons for their initial values live in `config.ts`.

Route owners export `withRateLimit("sections", handler)` or `withRateLimit("expensive", handler)`. Handler arguments and Next.js params pass through unchanged. Better-auth's handler is excluded from this wrapper.

## Runtime configuration and migration

| Variable | Meaning |
| --- | --- |
| `RATE_LIMIT_SECRET` | Server-only HMAC secret, at least 32 bytes. Required in production. Changing it resets guest identities and hashed counters. |
| `RATE_LIMIT_STORE` | `memory` or `postgres`. Default is memory in development/tests and Postgres in production. Production rejects memory. |
| `DATABASE_URL` | Required for the shared Postgres store. Uses the existing drizzle connection pool. |
| `RATE_LIMIT_TEST_DATABASE_URL` | Optional test-only URL for a local database named `untangle_rate_limit_test`. The live test creates and removes its own schema. |
| `RATE_LIMIT_TRUSTED_PROXY` | Header trust policy above. |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Existing better-auth deployment variables. |
| `VERCEL`, `NODE_ENV` | Hosting/runtime variables that choose default proxy policy and store. |

Apply `frontend/drizzle/0006_abuse_limits.sql` through the normal drizzle migration process before serving this code. Its journal and snapshot are included. No environment file is needed by this module. It reads server configuration when handling traffic. Production auth initialization also verifies the database store choice, excluding the Next.js build phase.

The memory store exists for development and tests. It prunes expired entries and refuses new keys at its cap instead of evicting live limits. Postgres uses one atomic `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` per key. Row locking covers pruning, checking and recording the accepted request. The database clock defines production windows. Expired rows are cleaned in batches opportunistically, with an expiry index. Store/config/session failures return 503 with `Retry-After: 60` and log the server error. There is no production fallback to process-local memory. IP is charged before session lookup. The two counters are conservative: an identity denial can still spend an IP token.

## Better-auth finding

The lockfile pins better-auth 1.5.5. Before this change, its production limiter used the default in-memory store. It is now explicitly enabled in production with `storage: "database"`, using `auth_rate_limit` on the same Postgres database and pool as the API store. Its existing budgets remain 100/10s generally, 3/10s for sign-in/sign-up/change-password/change-email, and 3/60s for reset and verification operations.

Version 1.5.5 has separate `get` and `set` storage calls. Concurrent auth requests can pass a stale count; using Postgres does not make that implementation atomic. Database write errors in that version are logged rather than blocking auth requests. The newer `customStorage.consume` API is absent in this pinned version. No dependency upgrade is included. Auth also skips its own limiter if it cannot detect an IP in production; configure the trusted proxy correctly. Internal `auth.api.getSession` calls do not consume auth endpoint budgets. See the [versioned limiter source](https://github.com/better-auth/better-auth/blob/v1.5.5/packages/better-auth/src/api/rate-limiter/index.ts) and [IP detection source](https://github.com/better-auth/better-auth/blob/v1.5.5/packages/better-auth/src/utils/get-request-ip.ts). The API wrapper's `unknown` fallback and atomic counters apply to our non-auth routes independently.

## Direct browser integration

Grades and sections owners can replace a direct public provider fetch with:

```ts
import { thirdPartyFetch, ClientRateLimitError } from "@/lib/rate-limit/client";

const response = await thirdPartyFetch("https://untgrades.app/api/mcp", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params }),
}, { cacheTtlMs: 300_000 });
```

The wrapper returns an ordinary `Response`. `ClientRateLimitError.retryAfter` gives whole seconds before another uncached call can run. Provider error responses still return to the caller. A visible `Retry-After` establishes a browser-wide pause. A 429 or 503 without an exposed header backs off for 60 seconds, a conservative starting value without measurement. Calls are never retried automatically. Providers must expose `Retry-After` through CORS for precise timing.

The shared browser budget starts with 30 tokens and refills 0.5 tokens/second across grades MCP and VSB calls. These are starting points without provider-load measurement. Cache TTL defaults to five minutes. Memory and IndexedDB cache hits consume no tokens, even during backoff. Concurrent identical requests share a Web Lock and one response. A key includes URL, method, all request headers and the body, so separate MCP tool arguments cannot collide. Callers should reuse stable MCP request ids for repeat reads if they want cache hits. Successful public responses up to 2 MiB are cached, with at most 200 entries. Private/no-store responses and errors are not cached. TTL expiration triggers a fresh budgeted request.

Only HTTPS public GET/POST calls to `untgrades.app` and `vsb.untgrades.app` are accepted. Cookies are omitted and authorization headers are rejected. Do not route transcript, planner, account or other private data through this cache. Avoid provider endpoints with side effects. Direct mode requires Web Locks, localStorage and IndexedDB. Unsupported browsers and storage failures stop the call with a specific error, rather than granting an unshared budget. LocalStorage persists tokens across reloads; each mutation reads it under a Web Lock. Storage events invalidate each tab's memory cache.

This browser budget is cooperative load control. Students can edit localStorage or write their own clients; it cannot authenticate them to a third-party provider. The server limits protect UNTangle's own API independently. The provider's CORS allowlist is not authentication.

## Verification commands

Bun's `--no-env-file` disables automatic environment-file loading. Next.js 16 also reads environment files by default, even when `__NEXT_PROCESSED_ENV` is set. The `scripts/without-env-files.cjs` verification preload replaces its loader before any file lookup. Checks run under the heavy lease and `lockf`:

```sh
bun --no-env-file test
bun --no-env-file x tsc --noEmit
NODE_OPTIONS="--require=\"$PWD/scripts/without-env-files.cjs\"" bun --no-env-file x next build
```

Identity and store tests cover signatures, expiry, IP trust/fallback, sliding-window math, concurrent memory consumers and production configuration. Route checks run in an isolated child process and exhaust every current non-auth API route. Browser tests simulate tabs sharing storage and locks, including concurrent consumption, response cache hits, TTL expiry and provider backoff. The Postgres query-boundary test mocks returned rows. Set `RATE_LIMIT_TEST_DATABASE_URL` to run the additional live migration/concurrency test against the local test database. Without that variable, Bun skips the live test. IndexedDB tests use the `fake-indexeddb` dev dependency; they exercise its transactions and cursor eviction without a browser.

The implementation was also checked against a temporary PostgreSQL 15 cluster. The migration applied, and 40 competing calls through four store instances admitted exactly five under a five-request budget. Expiry and opportunistic cleanup restored allowance. The cluster was stopped after verification.
