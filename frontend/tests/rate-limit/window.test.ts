import { expect, test } from "bun:test";
import { budgets } from "@/lib/rate-limit/config";
import { createRateLimitWrapper } from "@/lib/rate-limit/server";
import { memoryStore } from "@/lib/rate-limit/store";
import { trustRealIp } from "./route-fixtures";

trustRealIp();

test("the memory store counts per route class and caller, and starts over each window", async () => {
  const store = memoryStore();
  expect(await store.hit("grades", "a", 7)).toBe(1);
  expect(await store.hit("grades", "a", 7)).toBe(2);
  expect(await store.hit("grades", "b", 7)).toBe(1);
  expect(await store.hit("mapRoute", "a", 7)).toBe(1);
  expect(await store.hit("grades", "a", 8)).toBe(1);
});

test("a caller over budget waits until the window ends", async () => {
  let now = 120_000 + 45_200;
  const limited = createRateLimitWrapper({ store: memoryStore(), session: async () => null, secret: "test", now: () => now })(
    "auth", () => new Response("ok"));
  const call = () => limited(new Request("http://localhost/", { headers: { "x-real-ip": "203.0.113.1" } }));
  for (let i = 0; i < budgets.auth.ip; i++) expect((await call()).status).toBe(200);
  const denied = await call();
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toBe("15");
  now = 180_000;
  expect((await call()).status).toBe(200);
});

test("a budget with a 10-minute window counts across minutes and waits for the window's own end", async () => {
  const tenMinutes = 600_000;
  let now = 5 * tenMinutes + 45_200;
  const store = memoryStore();
  const limited = createRateLimitWrapper({ store, session: async () => null, secret: "test", now: () => now })(
    "authEmail", () => new Response("ok"));
  const call = () => limited(new Request("http://localhost/", { headers: { "x-real-ip": "203.0.113.1" } }));
  expect(budgets.authEmail.windowSeconds).toBe(600);
  for (let i = 0; i < budgets.authEmail.ip; i++) {
    expect((await call()).status).toBe(200);
    now += 60_000; // a minute later is still the same window
  }
  const denied = await call();
  expect(denied.status).toBe(429);
  expect(denied.headers.get("Retry-After")).toBe(String(Math.ceil((6 * tenMinutes - now) / 1000)));
  now = 6 * tenMinutes;
  expect((await call()).status).toBe(200);
});

test("windows of different lengths in one memory store don't reset each other", async () => {
  const store = memoryStore();
  expect(await store.hit("authEmail", "a", 2, 600_000)).toBe(1);
  expect(await store.hit("grades", "a", 21, 60_000)).toBe(1);
  expect(await store.hit("grades", "a", 22, 60_000)).toBe(1);
  expect(await store.hit("authEmail", "a", 2, 600_000)).toBe(2);
});
