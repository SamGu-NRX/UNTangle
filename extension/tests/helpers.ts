import type { ParsedSectionRow } from "../src/shared/messages";
import type { FetchLike, SessionCache } from "../src/lib/planner-client";

/** Scripted fetch: records requests, answers from the test's handler. */
export type RecordedRequest = { url: string; init: RequestInit | undefined };

export function fakeFetch(handler: (index: number, request: RecordedRequest) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const request: RecordedRequest = { url: input, init };
    requests.push(request);
    return handler(requests.length - 1, request);
  };
  return { fetchImpl, requests };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export { jsonResponse };

/** In-memory stand-in for chrome.storage.session. */
export class MemoryCache implements SessionCache {
  private readonly map = new Map<string, unknown>();

  async get(key: string): Promise<unknown> {
    return this.map.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.map.set(key, value);
  }
}

/** A parsed section row with every field the worker sends. */
export function rowFixture(overrides: Partial<ParsedSectionRow> = {}): ParsedSectionRow {
  return {
    rowId: "SSR_CLSRCH_R1",
    term: "spring-2027",
    courseSubject: "CSCE",
    courseNumber: "1030",
    sectionNumber: "001",
    classNumber: "14523",
    meetings: [
      { day: "Mon", startMinutes: 540, endMinutes: 590 },
      { day: "Wed", startMinutes: 540, endMinutes: 590 },
      { day: "Fri", startMinutes: 540, endMinutes: 590 },
    ],
    datesRaw: "01/19/2027 - 05/07/2027",
    instructorRaw: "Smith, John R.",
    isAsync: false,
    isTba: false,
    ...overrides,
  };
}
