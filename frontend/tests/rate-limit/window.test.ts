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
