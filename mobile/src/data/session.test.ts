jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios", select: (options: Record<string, unknown>) => options.ios },
  NativeModules: { ExpoFetch: { fetch: jest.fn() } },
}));

import * as SecureStore from "expo-secure-store";
import { getSessionCookie, parseSessionCookie, storeSessionCookie } from "./session";

function responseWithSetCookie(setCookie: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Map([["set-cookie", setCookie]]),
  } as unknown as Response;
}

describe("parseSessionCookie", () => {
  it("reduces one Set-Cookie value to its name=value pair", () => {
    expect(parseSessionCookie(["better-auth.session_token=abc; Path=/; HttpOnly"])).toBe(
      "better-auth.session_token=abc",
    );
  });

  it("keeps a cookie value that itself contains equals signs", () => {
    expect(parseSessionCookie(["better-auth.session_token=a=b.c; Path=/"])).toBe(
      "better-auth.session_token=a=b.c",
    );
  });

  it("joins several cookies into one Cookie header value", () => {
    expect(parseSessionCookie(["a=1; Path=/", "b=2; Path=/"])).toBe("a=1; b=2");
  });

  it("returns null when nothing parseable is present", () => {
    expect(parseSessionCookie([])).toBeNull();
    expect(parseSessionCookie(["   "])).toBeNull();
  });
});

describe("storeSessionCookie and getSessionCookie on native", () => {
  it("persists the parsed cookie through SecureStore", async () => {
    await storeSessionCookie(responseWithSetCookie("better-auth.session_token=abc; Path=/"));
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      expect.any(String),
      "better-auth.session_token=abc",
    );
  });

  it("does not persist anything when the response sets no cookie", async () => {
    jest.mocked(SecureStore.setItemAsync).mockClear();
    await storeSessionCookie({ ok: true, status: 200, headers: new Map() } as unknown as Response);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("replays the stored cookie for API requests", async () => {
    jest.mocked(SecureStore.getItemAsync).mockResolvedValue("better-auth.session_token=tok");
    await expect(getSessionCookie()).resolves.toBe("better-auth.session_token=tok");
  });
});
