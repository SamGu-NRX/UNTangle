import { createHmac } from "node:crypto";
import { authPathBudget, budgetWindowMs, budgets, trustedIpHeader, type Budget, type RouteClass } from "./config";
import { clientIp } from "./ip";
import type { RateLimitStore } from "./store";

// The wrapper itself, with its store, session lookup and secret passed in.
// server.ts builds the app's instance; this module has no app imports, so
// tests can use it without loading the auth or database modules.

type Handler<Args extends unknown[]> = (request: Request, ...args: Args) => Response | Promise<Response>;
type Options = {
  store: RateLimitStore;
  session: (request: Request) => Promise<{ user: { id: string } } | null>;
  secret: string;
  now?: () => number;
};

export function createRateLimitWrapper({ store, session, secret, now = Date.now }: Options) {
  // Callers are stored as HMACs, so the table never holds a raw IP or user id.
  const key = createHmac("sha256", secret).update("untangle rate limit").digest();
  const hash = (caller: string) => createHmac("sha256", key).update(caller).digest("base64url");

  return <Args extends unknown[]>(route: RouteClass, handler: Handler<Args>) =>
    async (request: Request, ...args: Args): Promise<Response> => {
      const budget: Budget = budgets[route];
      let retryAfter = 60;
      let allowed: boolean;
      try {
        const userId = budget.user && (await session(request))?.user.id;
        const [caller, limit]: [string, number] = budget.user && userId
          ? [`user:${userId}`, budget.user]
          : [`ip:${clientIp(request, trustedIpHeader())}`, budget.ip];
        // Session lookup may cross a window boundary. Count in the window where the hit happens.
        const time = now();
        const windowMs = budgetWindowMs(budget);
        const window = Math.floor(time / windowMs);
        retryAfter = Math.ceil(((window + 1) * windowMs - time) / 1000);
        allowed = (await store.hit(route, hash(caller), window, windowMs)) <= limit;
        const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "").replace(/\/+$/, "");
        const sensitive = route === "auth" ? authPathBudget(path) : null;
        if (allowed && sensitive) {
          const sensitiveTime = now();
          const sensitiveMs = budgetWindowMs(sensitive);
          const counter = await store.hitLastRequest(`auth:${path}`, hash(caller), sensitiveTime, sensitiveMs, sensitive.ip);
          retryAfter = Math.ceil((counter.expiresAt - sensitiveTime) / 1000);
          allowed = counter.allowed;
        }
      } catch (error) {
        console.error("Rate limiting unavailable", error);
        return Response.json({ error: "Abuse prevention unavailable. Try again later." },
          { status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" } });
      }
      if (allowed) return handler(request, ...args);
      return Response.json({ error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(retryAfter), "Cache-Control": "no-store" } });
    };
}
