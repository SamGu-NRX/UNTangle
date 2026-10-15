import { expect, spyOn } from "bun:test";
import { betterAuth } from "better-auth";
import { createAuthEndpoint } from "better-auth/api";
import { createRateLimitWrapper } from "@/lib/rate-limit/wrapper";
import type { RateLimitStore } from "@/lib/rate-limit/store";

/** Compare the atomic guard with the pinned Better Auth handler on completed requests. */
export async function assertSensitiveWindowParity(store: RateLimitStore) {
  let time = 0;
  const clock = spyOn(Date, "now").mockImplementation(() => time);
  try {
    const counters = new Map<string, { key: string; count: number; lastRequest: number }>();
    const auth = betterAuth({
      baseURL: "http://localhost:3000",
      secret: "parity-test-secret-at-least-32-characters",
      rateLimit: {
        enabled: true,
        customStorage: {
          get: async key => counters.get(key) ?? null,
          set: async (key, value) => { counters.set(key, value); },
        },
      },
      advanced: { ipAddress: { ipAddressHeaders: ["x-real-ip"] } },
      plugins: [{
        id: "limiter-parity",
        endpoints: {
          completedSignIn: createAuthEndpoint("/sign-in/email", { method: "GET" }, async () => new Response("ok")),
        },
      }],
    });
    const route = createRateLimitWrapper({ store, secret: "parity", now: () => time, session: async () => null })("auth", () => new Response("ok"));
    const req = () => new Request("http://localhost:3000/api/auth/sign-in/email", { headers: { "x-real-ip": "203.0.113.2" } });
    const atomic: number[] = [];
    const reference: number[] = [];
    for (const at of [0, 0, 0, 5_000, 10_001]) {
      time = at;
      const response = await route(req());
      atomic.push(response.status);
      reference.push((await auth.handler(req())).status);
      if (at === 5_000) expect(response.headers.get("Retry-After")).toBe("5");
    }
    expect(reference).toEqual([200, 200, 200, 429, 200]);
    expect(atomic).toEqual([200, 200, 200, 429, 200]);
  } finally {
    clock.mockRestore();
  }
}
