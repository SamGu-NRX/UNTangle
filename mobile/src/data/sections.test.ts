import { fetchCourseSections } from "./sections";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const payload = {
  status: "ok",
  provenance: "live",
  term: "spring-2027",
  courseCode: "CSCE 1030",
  sections: [],
};

describe("fetchCourseSections", () => {
  it("builds the sections path and request headers from term and course", async () => {
    const fetchLike = jest.fn().mockResolvedValue(jsonResponse(payload));
    await fetchCourseSections("spring-2027", "CSCE 1030", fetchLike);
    const [url, init] = fetchLike.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/sections/spring-2027/CSCE/1030");
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });

  it("returns the payload when the API echoes term and course", async () => {
    const result = await fetchCourseSections("spring-2027", "CSCE 1030", jest.fn().mockResolvedValue(jsonResponse(payload)));
    expect(result).toEqual(payload);
  });

  it("rejects an echoed term that does not match the request", async () => {
    const wrong = { ...payload, term: "fall-2026" };
    await expect(
      fetchCourseSections("spring-2027", "CSCE 1030", jest.fn().mockResolvedValue(jsonResponse(wrong))),
    ).rejects.toThrow(/Asked for spring-2027 CSCE 1030, got fall-2026/);
  });

  it("rejects an echoed course that does not match the request", async () => {
    const wrong = { ...payload, courseCode: "MATH 1650" };
    await expect(
      fetchCourseSections("spring-2027", "CSCE 1030", jest.fn().mockResolvedValue(jsonResponse(wrong))),
    ).rejects.toThrow(/Asked for spring-2027 CSCE 1030, got spring-2027 MATH 1650/);
  });

  it("throws a status error on non-2xx responses", async () => {
    await expect(
      fetchCourseSections("spring-2027", "CSCE 1030", jest.fn().mockResolvedValue(jsonResponse({}, 502))),
    ).rejects.toThrow("502");
  });
});
