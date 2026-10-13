export type Budget = { maxRequests: number; windowMs: number };
export type RouteBudget = { identity: Budget; ip: Budget };

const minute = 60_000;
export const routeBudgets = {
  // Protect planner writes and revisions. Starting points, not measured usage.
  plannerSave: { identity: { maxRequests: 60, windowMs: minute }, ip: { maxRequests: 180, windowMs: minute } },
  // Protect the grades upstream across all grades endpoints. Starting points, not measured usage.
  grades: { identity: { maxRequests: 60, windowMs: minute }, ip: { maxRequests: 180, windowMs: minute } },
  // Preserve the existing 60/minute route IP ceiling, adding identity. Starting points, not measured usage.
  mapRoute: { identity: { maxRequests: 60, windowMs: minute }, ip: { maxRequests: 60, windowMs: minute } },
  // Preserve the existing 60/minute geocoder IP ceiling, adding identity. Starting points, not measured usage.
  mapResolve: { identity: { maxRequests: 60, windowMs: minute }, ip: { maxRequests: 60, windowMs: minute } },
  // Protect upcoming section lookups. Starting points, not measured usage.
  sections: { identity: { maxRequests: 60, windowMs: minute }, ip: { maxRequests: 180, windowMs: minute } },
  // Protect future CPU-heavy or paid upstream work. Starting points, not measured usage.
  expensive: { identity: { maxRequests: 10, windowMs: minute }, ip: { maxRequests: 30, windowMs: minute } },
  // Protect planner reads and worker delivery. Starting points, not measured usage.
  general: { identity: { maxRequests: 120, windowMs: minute }, ip: { maxRequests: 360, windowMs: minute } },
} satisfies Record<string, RouteBudget>;
export type RouteClass = keyof typeof routeBudgets;

// Protect the shared grades MCP/VSB provider across both clients. Starting point, not measured usage.
export const thirdPartyBudget = { capacity: 30, refillPerSecond: 0.5, cacheTtlMs: 300_000 };

export function storeChoice(env: Partial<NodeJS.ProcessEnv> = process.env): "memory" | "postgres" {
  const choice = env.RATE_LIMIT_STORE ?? (env.NODE_ENV === "production" ? "postgres" : "memory");
  if (choice !== "memory" && choice !== "postgres") throw new Error("RATE_LIMIT_STORE must be memory or postgres.");
  if (env.NODE_ENV === "production" && choice !== "postgres") {
    throw new Error("Production rate limits require RATE_LIMIT_STORE=postgres.");
  }
  if (choice === "postgres" && !env.DATABASE_URL) {
    throw new Error("Postgres rate limits require DATABASE_URL and migration 0006_abuse_limits.");
  }
  return choice;
}
