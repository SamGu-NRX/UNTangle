import { fetchPlannerState } from "./planner";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("fetchPlannerState", () => {
  it("returns the saved state and revision on 200", async () => {
    const payload = { state: { selectedSections: { "CSCE 1030": "s1" } }, revision: 7, persistent: true };
    const fetchLike = jest.fn().mockResolvedValue(jsonResponse(payload));
    const result = await fetchPlannerState(fetchLike);
    expect(result).toEqual({
      ok: true,
      state: { selectedSections: { "CSCE 1030": "s1" } },
      revision: 7,
      persistent: true,
    });
    const [url, init] = fetchLike.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/planner");
    expect(init.method).toBe("GET");
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });

  it("passes a null saved state through as ok with null", async () => {
    const payload = { state: null, revision: 0, persistent: false };
    const result = await fetchPlannerState(jest.fn().mockResolvedValue(jsonResponse(payload)));
    expect(result).toEqual({ ok: true, state: null, revision: 0, persistent: false });
  });

  it("maps 401 to unauthorized", async () => {
    const result = await fetchPlannerState(jest.fn().mockResolvedValue(jsonResponse({}, 401)));
    expect(result).toEqual({ ok: false, reason: "unauthorized" });
  });

  it("maps 409 to a conflict with the served revision", async () => {
    const result = await fetchPlannerState(
      jest.fn().mockResolvedValue(jsonResponse({ revision: 11 }, 409)),
    );
    expect(result).toEqual({ ok: false, reason: "conflict", currentRevision: 11 });
  });

  it("maps an unexpected status to unavailable with the status in the message", async () => {
    const result = await fetchPlannerState(jest.fn().mockResolvedValue(jsonResponse({}, 500)));
    expect(result).toEqual({ ok: false, reason: "unavailable", message: "Unexpected status 500" });
  });

  it("surfaces network failures as unavailable", async () => {
    const failing = jest.fn().mockRejectedValue(new Error("network down"));
    const result = await fetchPlannerState(failing);
    expect(result).toEqual({ ok: false, reason: "unavailable", message: "network down" });
  });
});
