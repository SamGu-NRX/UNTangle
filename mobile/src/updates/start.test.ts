import * as Updates from "expo-updates";
import type { UpdateCheckResult, UpdateCheckResultNotAvailableReason } from "expo-updates";
import { AppState } from "react-native";

import { beginUnsafeMoment, endUnsafeMoment } from "./safe-moment";
import { startUpdateChecks } from "./start";

/**
 * The real wiring, tested against the mocked expo-updates module and a mocked
 * AppState: the contract the device depends on lives here, not only in the
 * controller, so a drift in the wiring (for example a reload on backgrounding)
 * surfaces as a test failure, not as lost student plans.
 */
jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

const mockedUpdates = jest.mocked(Updates, { shallow: true });

const REAL_ID = "1f2e3d4c-5b6a-7988-9900-aabbccddeeff";
const REAL_URL = `https://u.expo.dev/${REAL_ID}`;

// The full SDK result shape: the mocked client is typed with the real
// signature, so a partial object would fail tsc even though the controller
// only reads isAvailable and isRollBackToEmbedded.
const NO_UPDATE_AVAILABLE: UpdateCheckResult = {
  isAvailable: false,
  manifest: undefined,
  isRollBackToEmbedded: false,
  reason: "noUpdateAvailableOnServer" as UpdateCheckResultNotAvailableReason,
};

async function flush(): Promise<void> {
  for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
}

function lastAppStateListener(): (state: string) => void {
  const calls = mockedAddEventListener.mock.calls;
  return calls[calls.length - 1][1];
}

let mockedAddEventListener: jest.Mock;

describe("startUpdateChecks", () => {
  const savedId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  const savedUrl = process.env.EXPO_PUBLIC_EAS_UPDATE_URL;

  beforeEach(() => {
    (globalThis as { __DEV__?: boolean }).__DEV__ = false;
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID = REAL_ID;
    process.env.EXPO_PUBLIC_EAS_UPDATE_URL = REAL_URL;
    mockedUpdates.checkForUpdateAsync.mockReset();
    mockedUpdates.fetchUpdateAsync.mockReset();
    mockedUpdates.reloadAsync.mockReset();
    mockedUpdates.checkForUpdateAsync.mockResolvedValue(NO_UPDATE_AVAILABLE);
    // Spy on the real react-native AppState instead of replacing the module:
    // a bare factory mock breaks jest-expo's expo-modules-core chain.
    AppState.addEventListener = jest.fn(() => ({ remove: jest.fn() }));
    mockedAddEventListener = AppState.addEventListener as unknown as jest.Mock;
  });

  afterAll(() => {
    if (savedId === undefined) delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    else process.env.EXPO_PUBLIC_EAS_PROJECT_ID = savedId;
    if (savedUrl === undefined) delete process.env.EXPO_PUBLIC_EAS_UPDATE_URL;
    else process.env.EXPO_PUBLIC_EAS_UPDATE_URL = savedUrl;
  });

  test("checks at launch and never restarts the app", async () => {
    const cleanup = startUpdateChecks();
    await flush();
    expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);
    expect(mockedUpdates.reloadAsync).not.toHaveBeenCalled();
    cleanup();
  });

  test("an unconfigured environment disables checks with a warning", async () => {
    delete process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
    delete process.env.EXPO_PUBLIC_EAS_UPDATE_URL;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const cleanup = startUpdateChecks();
      await flush();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("no EAS project configured"));
      expect(mockedUpdates.checkForUpdateAsync).not.toHaveBeenCalled();
      cleanup();
    } finally {
      warn.mockRestore();
    }
  });

  test("backgrounding downloads, and no reloadAsync runs on any transition", async () => {
    const cleanup = startUpdateChecks();
    await flush();
    expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(1);

    const listener = lastAppStateListener();
    listener("background");
    await flush();
    // The background check downloads the update.
    expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
    listener("active");
    await flush();
    // Brief app switches do not trigger another network check.
    expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(2);
    listener("background");
    await flush();
    expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalledTimes(3);
    // Nothing restarts the app: a downloaded update applies at the next cold
    // start, never while the student's memory-only plan is on screen.
    expect(mockedUpdates.reloadAsync).not.toHaveBeenCalled();
    cleanup();
  });

  test("no reload happens while an unsafe moment is open", async () => {
    const cleanup = startUpdateChecks();
    await flush();
    const listener = lastAppStateListener();

    beginUnsafeMoment("auto");
    try {
      listener("background");
      await flush();
      listener("active");
      await flush();
      listener("background");
      await flush();
      // The Auto card holds the update flow even across app switches.
      expect(mockedUpdates.checkForUpdateAsync).toHaveBeenCalled();
      expect(mockedUpdates.reloadAsync).not.toHaveBeenCalled();
    } finally {
      endUnsafeMoment("auto");
    }
    cleanup();
  });

  test("the returned cleanup unsubscribes from AppState", () => {
    const cleanup = startUpdateChecks();
    const subscription = mockedAddEventListener.mock.results[0].value as { remove: jest.Mock };
    cleanup();
    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });
});
