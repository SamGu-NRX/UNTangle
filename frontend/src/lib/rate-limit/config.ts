/** The default window, and better-auth's own limiter window (its rows are swept on this basis). */
export const windowMs = 60_000;
/** `windowSeconds` defaults to 60. */
export type Budget = { user?: number; ip: number; windowSeconds?: number };

/** The window length for one budget, in milliseconds. */
export function budgetWindowMs(budget: { windowSeconds?: number }): number {
  return (budget.windowSeconds ?? 60) * 1000;
}

/**
 * Requests per window (60 s unless `windowSeconds` says otherwise) for each route class.
 * Signed-in callers count against `user`, anonymous callers against `ip`; a class without
 * `user` counts everyone by IP. These are unmeasured
 * starting values: no production traffic has been looked at to choose them.
 */
export const budgets = {
  auth: { ip: 30 },
  // Unmeasured starting caps: grant creation and human approval are infrequent;
  // token polling needs room for the advertised five-second interval.
  deviceStart: { ip: 10, windowSeconds: 600 },
  deviceInspect: { ip: 30, windowSeconds: 600 },
  deviceApprove: { user: 10, ip: 10, windowSeconds: 600 },
  deviceToken: { ip: 120 },
  // The extension routes share the device routes' unmeasured per-IP cap: one
  // extension worker polls previews and resends commands through one token.
  extensionPreview: { ip: 120 },
  extensionCommand: { ip: 120 },
  // Each preview fetches an outside URL; this is an unmeasured starting value.
  calendarFeedPreview: { user: 10, ip: 5, windowSeconds: 600 },
  grades: { user: 60, ip: 180 },
  mapRoute: { user: 60, ip: 60 },
  mapResolve: { user: 60, ip: 60 },
  // /api/v1 document routes, counted by address before sign-in is checked;
  // each student is then counted against plannerRead or plannerSave. Many
  // phones can share one carrier NAT address, so this is a flood guard, not a
  // per-student limit. 600 a minute leaves room for about a hundred students
  // at the client's normal pace (docs/architecture/README.md: a pull a minute
  // while visible, plus saves), or five at their full per-student burst.
  // Beyond that, one address is more likely one misbehaving client than a
  // crowd. Unmeasured: no production traffic has been looked at.
  documentFlood: { ip: 600 },
  plannerRead: { user: 120, ip: 360 },
  plannerSave: { user: 60, ip: 180 },
  sections: { user: 60, ip: 180 },
  // Setting a password is rare: a few tries per signed-in user per 10 minutes.
  setPassword: { user: 5, ip: 10, windowSeconds: 600 },
} satisfies Record<string, Budget>;
export type RouteClass = keyof typeof budgets;

/**
 * Budgets counted per email recipient, not per caller, so they are kept out of `budgets`:
 * withRateLimit can't apply one by IP. lib/email-budget.ts counts these through the store
 * directly. `perRecipient` is per inbox and per email kind, per window; an unmeasured
 * starting value.
 */
export const recipientBudgets = {
  authEmail: { perRecipient: 3, windowSeconds: 600 },
} as const;

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

/** Better Auth 1.5.5 special rules and the installed magic-link plugin's override.
 * The atomic layer enforces these before handlers; Better Auth counts after handlers.
 */
export function authPathBudget(path: string): Budget | null {
  if (path.startsWith("/sign-in/magic-link") || path.startsWith("/magic-link/verify")) {
    return { ip: 5, windowSeconds: 60 };
  }
  if (["/sign-in", "/sign-up", "/change-password", "/change-email"].some(prefix => path.startsWith(prefix))) {
    return { ip: 3, windowSeconds: 10 };
  }
  if (["/request-password-reset", "/send-verification-email", "/email-otp/send-verification-otp", "/email-otp/request-password-reset"].includes(path) || path.startsWith("/forget-password")) {
    return { ip: 3, windowSeconds: 60 };
  }
  return null;
}
