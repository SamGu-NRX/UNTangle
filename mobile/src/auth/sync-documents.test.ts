import { fetchSyncList } from "./sync-documents";
import type { FetchLike } from "../data/http";

const LIST_200 = [
  { documentId: "doc-1", kind: "schedule", revision: 3, deleted: false },
  { documentId: "doc-2", kind: "schedule", revision: 1, deleted: false },
];

function jsonResponse(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, headers: new Map(), json: async () => body } as unknown as Response;
}

function makeFetch(response: Response | Error): { fetchLike: FetchLike; calls: Array<{ url: string; init?: RequestInit }> } {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchLike = jest.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as FetchLike;
  return { fetchLike, calls };
}

describe("fetchSyncList", () => {
  it("GETs the sync route with the bearer token and returns the entries", async () => {
    const { fetchLike, calls } = makeFetch(jsonResponse(LIST_200));
    const result = await fetchSyncList("access-token-1", fetchLike);
    expect(result).toEqual({ ok: true, entries: LIST_200 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("http://localhost:3000/api/v1/sync");
    expect(calls[0]?.init?.method).toBe("GET");
    expect((calls[0]?.init?.headers as Record<string, string>).Authorization).toBe("Bearer access-token-1");
  });

  it("reports unauthorized on a refused token", async () => {
    const { fetchLike } = makeFetch(jsonResponse({ error: "invalid_token" }, 401));
    const result = await fetchSyncList("stale", fetchLike);
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("reports unavailable on a broken response body", async () => {
    const { fetchLike } = makeFetch(jsonResponse({ nope: true }));
    const result = await fetchSyncList("access-token-1", fetchLike);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: expect.any(String) });
  });

  it("reports unavailable on a network failure instead of throwing", async () => {
    const { fetchLike } = makeFetch(new Error("offline"));
    const result = await fetchSyncList("access-token-1", fetchLike);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: expect.any(String) });
  });

  it("reports unauthorized when the server answers non-401 with a token refusal", async () => {
    const { fetchLike } = makeFetch(jsonResponse({ error: "invalid_token" }, 403));
    const result = await fetchSyncList("stale", fetchLike);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: "Unexpected status 403" });
  });
});
