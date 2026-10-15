import * as SecureStore from "expo-secure-store";

import { createSecureTokenStore, DEVICE_TOKENS_KEY } from "./secure-token-store";

jest.mock("expo-secure-store", () => ({
  setItemAsync: jest.fn(async () => undefined),
  getItemAsync: jest.fn(async () => null),
  deleteItemAsync: jest.fn(async () => undefined),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

const tokens = {
  version: 1 as const,
  accessToken: "a".repeat(43),
  refreshToken: "b".repeat(43),
  grantId: "grant-1",
  scopes: ["documents:read"],
  accessExpiresAt: 5_000,
};

function mock() {
  return jest.mocked(SecureStore);
}

describe("createSecureTokenStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("saves the JSON envelope in the Keychain with after-first-unlock availability", async () => {
    const secure = mock();
    const store = createSecureTokenStore();
    await store.save(tokens);
    expect(secure.setItemAsync).toHaveBeenCalledTimes(1);
    const [key, value, options] = secure.setItemAsync.mock.calls[0] ?? [];
    expect(key).toBe(DEVICE_TOKENS_KEY);
    expect(JSON.parse(String(value))).toEqual(tokens);
    expect(options).toEqual({ keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY });
  });

  it("loads the stored tokens back", async () => {
    const secure = mock();
    secure.getItemAsync.mockResolvedValueOnce(JSON.stringify(tokens));
    const store = createSecureTokenStore();
    await expect(store.load()).resolves.toEqual(tokens);
  });

  it("returns null when nothing is stored", async () => {
    const store = createSecureTokenStore();
    await expect(store.load()).resolves.toBeNull();
  });

  it("clears instead of crashing on damaged stored content", async () => {
    const secure = mock();
    secure.getItemAsync.mockResolvedValueOnce("{not json");
    const store = createSecureTokenStore();
    await expect(store.load()).resolves.toBeNull();
    expect(secure.deleteItemAsync).toHaveBeenCalledWith(DEVICE_TOKENS_KEY);
  });

  it("refuses to load a payload the guards would reject", async () => {
    const secure = mock();
    secure.getItemAsync.mockResolvedValueOnce(JSON.stringify({ ...tokens, refreshToken: 42 }));
    const store = createSecureTokenStore();
    await expect(store.load()).resolves.toBeNull();
    expect(secure.deleteItemAsync).toHaveBeenCalled();
  });

  it("deletes the key on clear", async () => {
    const secure = mock();
    const store = createSecureTokenStore();
    await store.clear();
    expect(secure.deleteItemAsync).toHaveBeenCalledWith(DEVICE_TOKENS_KEY);
  });
});
