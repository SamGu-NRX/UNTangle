import * as ExpoCrypto from "expo-crypto";

import { randomBytes, sha256Base64Url } from "./native-crypto";
import { bytesToBase64Url } from "./pkce";

jest.mock("expo-crypto", () => ({
  getRandomValues: jest.fn((array: Uint8Array) => {
    for (let index = 0; index < array.length; index += 1) array[index] = index & 0xff;
    return array;
  }),
  digestStringAsync: jest.fn(async () => "a+b/c=="),
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
}));

describe("randomBytes", () => {
  it("returns the requested length through expo-crypto", () => {
    const bytes = randomBytes(32);
    expect(bytes).toHaveLength(32);
    expect(ExpoCrypto.getRandomValues).toHaveBeenCalledTimes(1);
    expect(bytes[0]).toBe(0);
    expect(bytes[31]).toBe(31);
  });
});

describe("sha256Base64Url", () => {
  it("maps the digest into the URL-safe alphabet without padding", async () => {
    await expect(sha256Base64Url("input")).resolves.toBe("a-b_c");
    expect(ExpoCrypto.digestStringAsync).toHaveBeenCalledWith(ExpoCrypto.CryptoDigestAlgorithm.SHA256, "input", { encoding: ExpoCrypto.CryptoEncoding.BASE64 });
  });
});

describe("the binding fits the PKCE contract", () => {
  it("produces values the verifier pattern accepts", async () => {
    const bytes = randomBytes(32);
    expect(bytesToBase64Url(bytes)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(sha256Base64Url("x")).resolves.toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
