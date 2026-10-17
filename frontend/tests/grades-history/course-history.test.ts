/**
 * Browser-side course-history reading: one bounded request per course (a
 * stalled connection resolves unavailable instead of hanging forever), and
 * one fetch per course per session (catalog updates re-map cached results
 * instead of refetching every history).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { fetchCourseHistory, fetchMissingHistories } from "@/lib/grades-history/course-history";
import { toGradeData } from "@/lib/grades-history/normalize";
import type { HistoryResult, CourseHistory } from "@/lib/grades-history/types";

const okResult: HistoryResult<CourseHistory> = {
  status: "ok",
  source: "untgrades.app",
  data: { course: { subject: "CSCE", number: "1030", title: "Computer Science I" }, terms: [], sectionCount: 3, gpa: 3.1, counts: {}, total: 0, grades: toGradeData({}) },
};

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("fetchCourseHistory", () => {
  test("reads the course's history endpoint and returns the parsed result", async () => {
    const requested: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return new Response(JSON.stringify(okResult), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const result = await fetchCourseHistory("CSCE", "1030");
    expect(requested[0]).toBe("/api/grades/courses/CSCE/1030");
    expect(result.status).toBe("ok");
  });

  test("resolves unavailable when the request outlives the timeout, instead of hanging", async () => {
    // A real fetch rejects when its signal aborts; a stalled connection is
    // the same shape, just much later than the bound.
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }) as typeof fetch;
    const result = await fetchCourseHistory("CSCE", "1030", { timeoutMs: 20 });
    expect(result.status).toBe("unavailable");
    if (result.status === "unavailable") expect(result.error.message).toContain("timed out");
  }, 1000);

  test("still rejects when the caller's own signal aborts", async () => {
    globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
      });
    }) as typeof fetch;
    const controller = new AbortController();
    const pending = fetchCourseHistory("CSCE", "1030", { signal: controller.signal, timeoutMs: 5000 });
    controller.abort();
    await expect(pending).rejects.toThrow();
  }, 1000);
});

describe("fetchMissingHistories", () => {
  test("fetches each missing code once, reuses cached promises, and never refetches", async () => {
    const fetched: string[] = [];
    const fetchOne = (code: string) => {
      fetched.push(code);
      return Promise.resolve(okResult);
    };
    const first = fetchMissingHistories(["ANTH 1010", "ANTH 1150"], new Map(), fetchOne);
    expect(fetched).toEqual(["ANTH 1010", "ANTH 1150"]);
    const second = fetchMissingHistories(["ANTH 1010", "ANTH 1150"], first, fetchOne);
    expect(fetched).toEqual(["ANTH 1010", "ANTH 1150"]);
    expect(second.get("ANTH 1010")).toBe(first.get("ANTH 1010"));
    await Promise.all([...second.values()]);
  });

  test("fetches only the new codes and prunes the ones no longer requested", async () => {
    const fetched: string[] = [];
    const fetchOne = (code: string) => {
      fetched.push(code);
      return Promise.resolve(okResult);
    };
    const first = fetchMissingHistories(["ANTH 1010", "ANTH 1150"], new Map(), fetchOne);
    const second = fetchMissingHistories(["ANTH 1010", "CSCE 1030"], first, fetchOne);
    expect([...second.keys()]).toEqual(["ANTH 1010", "CSCE 1030"]);
    expect(fetched).toEqual(["ANTH 1010", "ANTH 1150", "CSCE 1030"]);
    await Promise.all([...second.values()]);
  });

  test("caches failures too, so one dead course never restarts the fetch loop", async () => {
    let calls = 0;
    const fetchOne = (code: string) => {
      calls += 1;
      return code === "ANTH 1010" ? Promise.reject(new Error("down")) : Promise.resolve(okResult);
    };
    const first = fetchMissingHistories(["ANTH 1010", "ANTH 1150"], new Map(), fetchOne);
    await Promise.all([...first.values()].map((p) => p.catch(() => null)));
    const second = fetchMissingHistories(["ANTH 1010", "ANTH 1150"], first, fetchOne);
    await Promise.all([...second.values()].map((p) => p.catch(() => null)));
    expect(calls).toBe(2);
  });
});
