export const windowMs = 60_000;
export type Budget = { user?: number; ip: number };

/**
 * Requests per minute for each route class. Signed-in callers count against `user`, anonymous
 * callers against `ip`; a class without `user` counts everyone by IP. These are unmeasured
 * starting values: no production traffic has been looked at to choose them.
 */
export const budgets = {
  auth: { ip: 30 },
  // Auth emails per recipient inbox, not per IP (lib/email-budget.ts): a sign-in link and one
  // resend a minute. Counted directly through the store, never through withRateLimit.
  authEmail: { ip: 2 },
  grades: { user: 60, ip: 180 },
  mapRoute: { user: 60, ip: 60 },
  mapResolve: { user: 60, ip: 60 },
  plannerRead: { user: 120, ip: 360 },
  plannerSave: { user: 60, ip: 180 },
  sections: { user: 60, ip: 180 },
} satisfies Record<string, Budget>;
export type RouteClass = keyof typeof budgets;

const proxyHeaders: Record<string, string | null> = {
  vercel: "x-vercel-forwarded-for",
  cloudflare: "cf-connecting-ip",
  "reverse-proxy": "x-real-ip",
  none: null,
};

/** The one header our proxy sets to the caller's address. Any other header could be forged. */
export function trustedIpHeader(env: Partial<NodeJS.ProcessEnv> = process.env): string | null {
  const proxy = env.RATE_LIMIT_TRUSTED_PROXY ?? (env.VERCEL === "1" ? "vercel" : "none");
  if (!Object.hasOwn(proxyHeaders, proxy)) {
    throw new Error(`RATE_LIMIT_TRUSTED_PROXY must be one of ${Object.keys(proxyHeaders).join(", ")}; got "${proxy}".`);
  }
  return proxyHeaders[proxy];
}

/** Without a trusted header every caller shares one IP bucket; without Postgres each instance counts alone. */
export function checkProductionEnv(env: Partial<NodeJS.ProcessEnv> = process.env) {
  if (!trustedIpHeader(env)) {
    throw new Error("Production needs RATE_LIMIT_TRUSTED_PROXY set to vercel, cloudflare or reverse-proxy (VERCEL=1 implies vercel).");
  }
  if (!env.DATABASE_URL) throw new Error("Production needs DATABASE_URL: rate-limit counters are shared through Postgres.");
}
