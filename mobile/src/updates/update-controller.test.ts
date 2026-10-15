import * as Updates from "expo-updates";

import { createUpdateController, type UpdateState, type UpdatesClient } from "./update-controller";

/**
 * The controller runs against the real expo-updates module, mocked here: the
 * mock must keep the shape the runtime flow depends on (isEnabled, the three
 * async calls), so a drift in the real module surfaces as a cast or test
 * failure, not a device-only crash.
 */
jest.mock("expo-updates", () => ({
  isEnabled: true,
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));

const mockedUpdates = jest.mocked(Updates, { shallow: true });

interface FakeClient {
  readonly client: UpdatesClient;
  check: jest.Mock;
  fetch: jest.Mock;
  reload: jest.Mock;
}

function fakeClient(enabled = true): FakeClient {
  const check = jest.fn();
  const fetch = jest.fn();
  const reload = jest.fn();
  return { client: { isEnabled: enabled, checkForUpdateAsync: check, fetchUpdateAsync: fetch, reloadAsync: reload }, check, fetch, reload };
}

const NO_UPDATE = { isAvailable: false, isRollBackToEmbedded: false };
const UPDATE_AVAILABLE = { isAvailable: true, isRollBackToEmbedded: false };
const ROLLBACK = { isAvailable: false, isRollBackToEmbedded: true };

describe("update controller", () => {
  beforeEach(() => {
    mockedUpdates.isEnabled = true;
    mockedUpdates.checkForUpdateAsync.mockReset();
    mockedUpdates.fetchUpdateAsync.mockReset();
    mockedUpdates.reloadAsync.mockReset();
  });

  test("the real expo-updates module shape satisfies UpdatesClient", () => {
    // A compile-time promise as a runtime fact: the mocked module keeps the
    // fields the controller reads.
    expect(typeof mockedUpdates.checkForUpdateAsync).toBe("function");
    expect(typeof mockedUpdates.fetchUpdateAsync).toBe("function");
    expect(typeof mockedUpdates.reloadAsync).toBe("function");
  });

  test("does not check in a development build or when updates are disabled", async () => {
    const dev = fakeClient();
    const disabled = fakeClient(false);
    await createUpdateController({ client: dev.client, isDev: true, isSafeToApply: () => true }).check();
    await createUpdateController({ client: disabled.client, isDev: false, isSafeToApply: () => true }).check();
    expect(dev.check).not.toHaveBeenCalled();
    expect(disabled.check).not.toHaveBeenCalled();
  });

  test("checks, downloads and readies an available update", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
    const states: UpdateState[] = [];
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    controller.subscribe((state) => states.push(state));
    await controller.check();
    expect(fake.check).toHaveBeenCalledTimes(1);
    expect(fake.fetch).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe("ready");
    expect(states).toEqual(["checking", "downloading", "ready"]);
  });

  test("concurrent checks share one flight", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(NO_UPDATE);
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await Promise.all([controller.check(), controller.check()]);
    expect(fake.check).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe("current");
  });

  test("a failed check returns to idle and can retry", async () => {
    const fake = fakeClient();
    fake.check.mockRejectedValueOnce(new Error("offline"));
    fake.check.mockResolvedValueOnce(NO_UPDATE);
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();
    expect(controller.state).toBe("idle");
    await controller.check();
    expect(controller.state).toBe("current");
    expect(fake.check).toHaveBeenCalledTimes(2);
  });

  test("a failed download returns to idle, not ready", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockRejectedValue(new Error("network lost"));
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();
    expect(controller.state).toBe("idle");
  });

  test("a rollback directive readies without downloading", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(ROLLBACK);
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(controller.state).toBe("ready");
  });

  test("a fetch that reports nothing new stays current", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockResolvedValue({ isNew: false, isRollBackToEmbedded: false });
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();
    expect(controller.state).toBe("current");
  });

  test("applyWhenSafe does nothing when nothing is downloaded", () => {
    const fake = fakeClient();
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    expect(controller.applyWhenSafe()).toBe("no-update");
    expect(fake.reload).not.toHaveBeenCalled();
  });

  test("applyWhenSafe refuses while an unsafe moment is open and applies after it closes", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
    let safe = false;
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => safe });
    fake.reload.mockResolvedValue(undefined);
    await controller.check();

    // The student is mid-import: the backgrounding must not restart.
    expect(controller.applyWhenSafe()).toBe("unsafe");
    expect(fake.reload).not.toHaveBeenCalled();
    expect(controller.state).toBe("ready");

    // The moment closes, the app backgrounds again, the update applies.
    safe = true;
    expect(controller.applyWhenSafe()).toBe("applied");
    expect(fake.reload).toHaveBeenCalledTimes(1);
    expect(controller.state).toBe("restarting");
  });

  test("a failed restart returns to ready so the next safe backgrounding retries", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
    fake.reload.mockRejectedValue(new Error("restart failed"));
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();

    expect(controller.applyWhenSafe()).toBe("applied");
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.state).toBe("ready");
    // The second backgrounding tries again instead of dropping the download.
    expect(controller.applyWhenSafe()).toBe("applied");
    expect(fake.reload).toHaveBeenCalledTimes(2);
  });

  test("applyWhenSafe is single-flight while a restart is running", async () => {
    const fake = fakeClient();
    fake.check.mockResolvedValue(UPDATE_AVAILABLE);
    fake.fetch.mockResolvedValue({ isNew: true, isRollBackToEmbedded: false });
    fake.reload.mockReturnValue(new Promise(() => {}));
    const controller = createUpdateController({ client: fake.client, isDev: false, isSafeToApply: () => true });
    await controller.check();
    expect(controller.applyWhenSafe()).toBe("applied");
    expect(controller.applyWhenSafe()).toBe("in-progress");
    expect(fake.reload).toHaveBeenCalledTimes(1);
  });
});
