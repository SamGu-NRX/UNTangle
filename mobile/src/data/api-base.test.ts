import { API_BASE_DEFAULT, resolveApiBase } from "./api-base";

describe("resolveApiBase", () => {
  it("defaults to the local development server without an override", () => {
    expect(resolveApiBase(undefined)).toBe(API_BASE_DEFAULT);
    expect(API_BASE_DEFAULT).toBe("http://localhost:3000");
  });

  it("honors EXPO_PUBLIC_UNTANGLE_API_URL and strips a trailing slash", () => {
    expect(resolveApiBase("https://api.untangle.app/")).toBe("https://api.untangle.app");
  });

  it("ignores a blank or whitespace override", () => {
    expect(resolveApiBase("   ")).toBe(API_BASE_DEFAULT);
  });
});
