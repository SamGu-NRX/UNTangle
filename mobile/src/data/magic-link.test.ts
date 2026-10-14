import { requestMagicLink, tokenFromFragment, verifyMagicLink } from "./magic-link";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("requestMagicLink", () => {
  it("rejects a non-UNT address without any network call", async () => {
    const fetchLike = jest.fn();
    const result = await requestMagicLink("someone@gmail.com", fetchLike);
    expect(result).toMatchObject({ ok: false, reason: "invalid-email" });
    expect(fetchLike).not.toHaveBeenCalled();
  });

  it("posts the email with the web landing page as the callbackURL", async () => {
    const fetchLike = jest.fn().mockResolvedValue(jsonResponse({}));
    await requestMagicLink("jdoe@my.unt.edu", fetchLike);
    const [url, init] = fetchLike.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/auth/sign-in/magic-link");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      email: "jdoe@my.unt.edu",
      callbackURL: "/auth/link",
    });
  });

  it("reports ok when the API accepts the request", async () => {
    const result = await requestMagicLink("jdoe@my.unt.edu", jest.fn().mockResolvedValue(jsonResponse({})));
    expect(result).toEqual({ ok: true });
  });

  it("reports a rejection when the API refuses", async () => {
    const result = await requestMagicLink("jdoe@my.unt.edu", jest.fn().mockResolvedValue(jsonResponse({}, 429)));
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
  });
});

describe("verifyMagicLink", () => {
  it("gets the verify endpoint with an encoded token", async () => {
    const fetchLike = jest.fn().mockResolvedValue(jsonResponse({ user: {} }));
    await verifyMagicLink("tok/en +x", fetchLike);
    const [url, init] = fetchLike.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://localhost:3000/api/auth/magic-link/verify?token=tok%2Fen%20%2Bx");
    expect(init.headers).toMatchObject({ Accept: "application/json" });
  });

  it("maps a non-2xx response to invalid-or-expired", async () => {
    const result = await verifyMagicLink("gone", jest.fn().mockResolvedValue(jsonResponse({}, 400)));
    expect(result).toEqual({ ok: false, reason: "invalid-or-expired" });
  });

  it("maps network failures to a network error", async () => {
    const result = await verifyMagicLink("gone", jest.fn().mockRejectedValue(new Error("offline")));
    expect(result).toEqual({ ok: false, reason: "network", message: "offline" });
  });
});

describe("tokenFromFragment", () => {
  it("reads the token parameter from an auth-callback fragment", () => {
    expect(tokenFromFragment("#token=abc123&draft=false")).toBe("abc123");
  });

  it("tolerates a leading hash and decodes the value", () => {
    expect(tokenFromFragment("token=a%2Fb")).toBe("a/b");
  });

  it("returns null without a token parameter", () => {
    expect(tokenFromFragment("#draft=false")).toBeNull();
    expect(tokenFromFragment("")).toBeNull();
  });
});
