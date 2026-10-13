import { getServerSession } from "@/lib/auth-server";
import { routeBudgets, storeChoice, type RouteClass, type RouteBudget } from "./config";
import { resolveIdentity, signingSecret, type ApiSession, type Identity } from "./identity";
import { MemoryRateLimitStore, type RateLimitStore } from "./store";

const memoryStore = new MemoryRateLimitStore();
let postgresStore: Promise<RateLimitStore> | undefined;
async function configuredStore(): Promise<RateLimitStore> {
  if (storeChoice() === "memory") return memoryStore;
  postgresStore ??= Promise.all([import("./postgres"), import("@/lib/db")]).then(([{ PostgresRateLimitStore }, { db }]) =>
    new PostgresRateLimitStore((query) => db.execute(query)));
  return postgresStore;
}

type Dependencies = {
  store: () => Promise<RateLimitStore>;
  session: (request: Request) => Promise<ApiSession>;
  identity: (request: Request, session: ApiSession) => Identity;
};
const dependencies: Dependencies = {
  store: configuredStore,
  session: getServerSession,
  identity: (request, session) => resolveIdentity(request, session, { secret: signingSecret() }),
};

export function createRateLimitWrapper(deps: Dependencies) {
  return function wrap<Args extends unknown[]>(routeClass: RouteClass, handler: (request: Request, ...args: Args) => Promise<Response> | Response,
    budget: RouteBudget = routeBudgets[routeClass], scope: (request: Request) => string = () => "") {
    return async (request: Request, ...args: Args): Promise<Response> => {
      let identity: Identity;
      let headers: Headers;
      let allowed: boolean;
      try {
        const store = await deps.store();
        // IP is charged before the session lookup, including when authentication storage is unavailable.
        identity = deps.identity(request, null);
        const routeKey = `${routeClass}:${scope(request)}`;
        const ip = await store.consume(`ip:${routeKey}:${identity.ipKey}`, budget.ip);
        let result = ip;
        let policy = budget.ip;
        if (ip.allowed) {
          identity = deps.identity(request, await deps.session(request));
          const user = await store.consume(`identity:${routeKey}:${identity.key}`, budget.identity);
          if (!user.allowed || user.remaining / budget.identity.maxRequests <= ip.remaining / budget.ip.maxRequests) {
            result = user;
            policy = budget.identity;
          }
        }
        allowed = result.allowed;
        headers = new Headers({
          "Cache-Control": "private, no-store",
          "RateLimit-Limit": String(policy.maxRequests), "RateLimit-Remaining": String(result.remaining),
          "RateLimit-Reset": String(result.resetAfter), "RateLimit-Policy": `${policy.maxRequests};w=${Math.ceil(policy.windowMs / 1000)}`,
        });
        if (!allowed) headers.set("Retry-After", String(result.retryAfter));
        if (identity.setCookie) headers.append("Set-Cookie", identity.setCookie);
      } catch (error) {
        console.error("API rate limiting unavailable", error);
        return Response.json({ error: "Abuse prevention unavailable. Try again later." }, {
          status: 503, headers: { "Retry-After": "60", "Cache-Control": "no-store" },
        });
      }
      if (!allowed) return Response.json({ error: "Too many requests" }, { status: 429, headers });
      const response = await handler(request, ...args);
      headers.forEach((value, name) => {
        if (name === "set-cookie") response.headers.append(name, value);
        else response.headers.set(name, value);
      });
      // Guest identity cookies and per-caller counters must not be replayed by shared caches.
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    };
  };
}

export const withRateLimit = createRateLimitWrapper(dependencies);
