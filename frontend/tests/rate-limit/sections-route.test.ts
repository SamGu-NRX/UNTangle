import { expect, mock, test } from "bun:test";
import { budgets } from "@/lib/rate-limit/config";
import { pinClockMidWindow, trustRealIp } from "./route-fixtures";

mock.module("server-only", () => ({}));
trustRealIp();

test("the sections route answers 429 once an anonymous caller passes its budget", async () => {
  process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
  pinClockMidWindow();
  const { GET } = await import("@/app/api/sections/[term]/[subject]/[number]/route");
  // An unknown term answers 400 before any upstream fetch.
  const params = { term: "x", subject: "CSCE", number: "1030" };
  const call = () => GET(new Request("http://localhost/api/sections/x/CSCE/1030", { headers: { "x-real-ip": "192.0.2.77" } }),
    { params: Promise.resolve(params) });
  for (let i = 0; i < budgets.sections.ip; i++) expect((await call()).status).toBe(400);
  expect((await call()).status).toBe(429);
});

test("the class-number route is rate limited like the per-course route", async () => {
  process.env.RATE_LIMIT_TRUSTED_PROXY = "reverse-proxy";
  pinClockMidWindow();
  const { GET } = await import("@/app/api/sections/[term]/class/[number]/route");
  const params = { term: "x", number: "21843" };
  const call = () => GET(new Request("http://localhost/api/sections/x/class/21843", { headers: { "x-real-ip": "192.0.2.78" } }),
    { params: Promise.resolve(params) });
  for (let i = 0; i < budgets.sections.ip; i++) expect((await call()).status).toBe(400);
  expect((await call()).status).toBe(429);
});
