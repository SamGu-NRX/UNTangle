import {
  EasProjectConfigError,
  PLACEHOLDER_PROJECT_ID,
  resolveEasPair,
  resolveEasProject,
} from "./eas-project";

const REAL_ID = "1f2e3d4c-5b6a-7988-9900-aabbccddeeff";
const REAL_URL = `https://u.expo.dev/${REAL_ID}`;

describe("resolveEasProject", () => {
  test("an empty environment yields the placeholder when allowed", () => {
    const eas = resolveEasProject({}, { allowPlaceholder: true });
    expect(eas).toEqual({
      projectId: PLACEHOLDER_PROJECT_ID,
      updateUrl: `https://u.expo.dev/${PLACEHOLDER_PROJECT_ID}`,
      isPlaceholder: true,
    });
  });

  test("an empty environment throws a clear error when strict", () => {
    expect(() => resolveEasProject({}, { allowPlaceholder: false })).toThrow(EasProjectConfigError);
    expect(() => resolveEasProject({}, { allowPlaceholder: false })).toThrow(/EXPO_PUBLIC_EAS_PROJECT_ID/);
    expect(() => resolveEasProject({}, { allowPlaceholder: false })).toThrow(/eas init/);
  });

  test("one value without the other throws, placeholder mode included", () => {
    expect(() => resolveEasProject({ EXPO_PUBLIC_EAS_UPDATE_URL: REAL_URL }, { allowPlaceholder: true })).toThrow(
      /EXPO_PUBLIC_EAS_PROJECT_ID/,
    );
    expect(() => resolveEasProject({ EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID }, { allowPlaceholder: true })).toThrow(
      /EXPO_PUBLIC_EAS_UPDATE_URL/,
    );
  });

  test("a non-UUID project id throws", () => {
    expect(() =>
      resolveEasProject(
        { EXPO_PUBLIC_EAS_PROJECT_ID: "not-a-uuid", EXPO_PUBLIC_EAS_UPDATE_URL: REAL_URL },
        { allowPlaceholder: false },
      ),
    ).toThrow(/must be the project id UUID/);
  });

  test("a URL off the u.expo.dev host throws", () => {
    expect(() =>
      resolveEasProject(
        { EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID, EXPO_PUBLIC_EAS_UPDATE_URL: "https://evil.example.com/x" },
        { allowPlaceholder: false },
      ),
    ).toThrow(/must start with/);
  });

  test("a real project passes through untouched", () => {
    const eas = resolveEasProject(
      { EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID, EXPO_PUBLIC_EAS_UPDATE_URL: REAL_URL },
      { allowPlaceholder: false },
    );
    expect(eas).toEqual({ projectId: REAL_ID, updateUrl: REAL_URL, isPlaceholder: false });
  });

  test("a URL pointing at a different project throws", () => {
    expect(() =>
      resolveEasProject(
        { EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID, EXPO_PUBLIC_EAS_UPDATE_URL: "https://u.expo.dev/ffffffff-1111-4222-8333-444444444444" },
        { allowPlaceholder: false },
      ),
    ).toThrow(/different project/);
    expect(() =>
      resolveEasProject(
        { EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID, EXPO_PUBLIC_EAS_UPDATE_URL: `${REAL_URL}/` },
        { allowPlaceholder: false },
      ),
    ).toThrow(/different project/);
  });

  test("a trailing-slash URL is rejected, not silently normalized", () => {
    expect(() =>
      resolveEasProject(
        { EXPO_PUBLIC_EAS_PROJECT_ID: REAL_ID, EXPO_PUBLIC_EAS_UPDATE_URL: "https://u.expo.dev/ffffffff-1111-4222-8333-444444444444" },
        { allowPlaceholder: false },
      ),
    ).toThrow(/expected/);
  });

  test("resolveEasPair takes the values read with dot notation", () => {
    expect(resolveEasPair(REAL_ID, REAL_URL, { allowPlaceholder: true })).toEqual({
      projectId: REAL_ID,
      updateUrl: REAL_URL,
      isPlaceholder: false,
    });
    expect(resolveEasPair(undefined, undefined, { allowPlaceholder: true })).toEqual({
      projectId: PLACEHOLDER_PROJECT_ID,
      updateUrl: `https://u.expo.dev/${PLACEHOLDER_PROJECT_ID}`,
      isPlaceholder: true,
    });
  });

  test("surrounding whitespace is trimmed", () => {
    const eas = resolveEasProject(
      { EXPO_PUBLIC_EAS_PROJECT_ID: ` ${REAL_ID} `, EXPO_PUBLIC_EAS_UPDATE_URL: ` ${REAL_URL} ` },
      { allowPlaceholder: false },
    );
    expect(eas.projectId).toBe(REAL_ID);
    expect(eas.updateUrl).toBe(REAL_URL);
  });
});
