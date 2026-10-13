import { expect, test } from "bun:test";
import { createThirdPartyClient, ClientRateLimitError, retryAfterMilliseconds, type ClientDependencies } from "@/lib/rate-limit/client";
import { MemoryResponseCache } from "@/lib/rate-limit/client-cache";

function tabs(provider: (request: Request) => Response = () => Response.json({ value: 1 })) {
  let now = 1000;
  let requests = 0;
  const values = new Map<string, string>();
  const tails = new Map<string, Promise<unknown>>();
  const cache = new MemoryResponseCache(() => now);
  const deps: ClientDependencies = {
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } },
    lock: async (name, work) => {
      const previous = tails.get(name) ?? Promise.resolve();
      const result = previous.catch(() => {}).then(work);
      tails.set(name, result);
      return result;
    },
    cache, now: () => now,
    fetch: async (input) => { requests++; return provider(new Request(input)); },
  };
  const budget = { capacity: 2, refillPerSecond: 1, cacheTtlMs: 1000 };
  return { a: createThirdPartyClient(deps, budget), b: createThirdPartyClient(deps, budget),
    reload: () => createThirdPartyClient(deps, budget), advance: (ms: number) => { now += ms; }, count: () => requests, values };
}
const url = "https://vsb.untgrades.app/data";

test("simulated concurrent tabs share persisted tokens and refill without double spending", async () => {
  const t = tabs();
  const results = await Promise.allSettled([t.a(url + "?a"), t.b(url + "?b"), t.a(url + "?c")]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
  const failure = results.find((result) => result.status === "rejected");
  expect(failure?.status === "rejected" && failure.reason.retryAfter).toBe(1);
  expect(t.count()).toBe(2);
  t.advance(1000);
  expect((await t.reload()(url + "?d")).status).toBe(200);
  expect(t.count()).toBe(3);
});

test("provider Retry-After backs off other tabs, including HTTP dates", async () => {
  const t = tabs(() => Response.json({ error: "limited" }, { status: 429, headers: { "Retry-After": "5" } }));
  expect((await t.a(url)).status).toBe(429);
  await expect(t.b(url + "?other")).rejects.toMatchObject({ name: "ClientRateLimitError", retryAfter: 5 });
  t.advance(4000);
  await expect(t.b(url + "?other")).rejects.toMatchObject({ retryAfter: 1 });
  expect(t.count()).toBe(1);
  t.advance(1000);
  expect((await t.b(url + "?other")).status).toBe(429);
  expect(retryAfterMilliseconds("Thu, 01 Jan 1970 00:00:10 GMT", 1000)).toBe(9000);
  expect(retryAfterMilliseconds("garbage", 1000)).toBeNull();
});

test("hidden provider Retry-After still backs off for 60 seconds", async () => {
  const t = tabs(() => new Response("limited", { status: 429 }));
  await t.a(url);
  await expect(t.b(url + "?other")).rejects.toMatchObject({ retryAfter: 60 });
  expect(t.count()).toBe(1);
});

test("memory, persistent cache and concurrent repeat views spend only once, until TTL expires", async () => {
  const t = tabs();
  const [a, b] = await Promise.all([t.a(url), t.b(url)]);
  expect(await a.json()).toEqual({ value: 1 });
  expect(await b.json()).toEqual({ value: 1 });
  expect(await (await t.reload()(url)).json()).toEqual({ value: 1 });
  expect(t.count()).toBe(1);
  t.advance(1000);
  expect(await (await t.a(url)).json()).toEqual({ value: 1 });
  expect(t.count()).toBe(2);
});

test("cache hits work during provider backoff and MCP bodies have distinct keys", async () => {
  const t = tabs((request) => request.url.endsWith("blocked") ? new Response("busy", { status: 503 }) : Response.json({ value: 1 }));
  await t.a(url);
  await t.a(url + "?blocked");
  expect(await (await t.b(url)).json()).toEqual({ value: 1 });
  await expect(t.b(url + "?fresh")).rejects.toBeInstanceOf(ClientRateLimitError);
  const m = tabs();
  const input = "https://untgrades.app/api/mcp";
  await m.a(input, { method: "POST", body: JSON.stringify({ method: "tools/call", params: { course: "A" } }) });
  await m.b(input, { method: "POST", body: JSON.stringify({ method: "tools/call", params: { course: "B" } }) });
  expect(m.count()).toBe(2);
});

test("private responses and errors are not cached; unauthorized origins fail before fetch", async () => {
  const t = tabs(() => Response.json({ value: 1 }, { headers: { "Cache-Control": "private" } }));
  await t.a(url); await t.b(url);
  expect(t.count()).toBe(2);
  await expect(t.a("https://evil.test/data")).rejects.toThrow("public GET/POST");
  await expect(t.a(url, { headers: { authorization: "Bearer private" } })).rejects.toThrow("public GET/POST");
  expect(t.count()).toBe(2);
});

test("zero TTL bypasses an existing cache and malformed persisted state cannot grant tokens", async () => {
  const t = tabs();
  await t.a(url);
  await t.b(url, undefined, { cacheTtlMs: 0 });
  expect(t.count()).toBe(2);
  t.values.set("untangle:third-party-budget:v1", "corrupt");
  await expect(t.reload()(url + "?new")).rejects.toThrow("Stored third-party budget is invalid");
  expect(t.count()).toBe(2);
});

test("invalid huge Retry-After cannot poison persisted backoff", async () => {
  const t = tabs(() => new Response("limited", { status: 429, headers: { "Retry-After": "9".repeat(400) } }));
  expect((await t.a(url)).status).toBe(429);
  await expect(t.b(url + "?other")).rejects.toMatchObject({ retryAfter: 60 });
  t.advance(60_000);
  expect((await t.reload()(url + "?other")).status).toBe(429);
  expect(t.count()).toBe(2);
});

test("null-body success responses remain valid after repeat requests", async () => {
  const t = tabs(() => new Response(null, { status: 205 }));
  expect((await t.a(url)).status).toBe(205);
  expect((await t.b(url)).status).toBe(205);
  expect(t.count()).toBe(2);
});
