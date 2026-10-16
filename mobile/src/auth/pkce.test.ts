import { base64ToBase64Url, bytesToBase64Url, createPkcePair, PKCE_VALUE_PATTERN } from "./pkce";

describe("bytesToBase64Url", () => {
  it("encodes 32 zero bytes as 43 characters of A", () => {
    expect(bytesToBase64Url(new Uint8Array(32))).toBe("A".repeat(43));
  });

  it("encodes full 255 triples as underscores", () => {
    expect(bytesToBase64Url(new Uint8Array([255, 255, 255]))).toBe("____");
  });

  it("pads a final lone byte without = and stays inside the alphabet", () => {
    // 255 >> 2 is 63 (_), and (255 & 3) << 4 lands on index 48 (w).
    const out = bytesToBase64Url(new Uint8Array([255]));
    expect(out).toBe("_w");
    expect(out).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("turns 32 bytes of 255 into a server-shaped value", () => {
    expect(bytesToBase64Url(new Uint8Array(32).fill(255))).toMatch(PKCE_VALUE_PATTERN);
  });
});

describe("base64ToBase64Url", () => {
  it("maps + and / and strips padding", () => {
    expect(base64ToBase64Url("a+b/c==")).toBe("a-b_c");
  });
});

describe("createPkcePair", () => {
  it("makes a verifier from the injected bytes and a challenge from the injected digest", async () => {
    const bytes = new Uint8Array(32).map((_, index) => index & 0xff);
    const verifier = bytesToBase64Url(bytes);
    const digest = base64ToBase64Url(bytesToBase64Url(new Uint8Array(32).fill(7)));
    const pair = await createPkcePair(() => bytes, async () => bytesToBase64Url(new Uint8Array(32).fill(7)));
    expect(pair.verifier).toBe(verifier);
    expect(pair.challenge).toBe(digest);
    expect(pair.verifier).toMatch(PKCE_VALUE_PATTERN);
    expect(pair.challenge).toMatch(PKCE_VALUE_PATTERN);
  });

  it("refuses a digest the server would reject", async () => {
    await expect(createPkcePair(() => new Uint8Array(32), async () => "too-short")).rejects.toThrow(/challenge/);
  });
});
