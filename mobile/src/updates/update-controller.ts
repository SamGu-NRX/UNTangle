/**
 * The over-the-air update flow: check on launch and on return to the
 * foreground, download in the background, and hold the downloaded update
 * until something applies it at a safe moment. A restart replaces the whole
 * JavaScript runtime: the guest's plan is saved on the device (saved-plan.ts),
 * but an open review is not, so today nothing in the app calls
 * applyWhenSafe: a downloaded update applies at the next cold start, which is
 * expo-updates' own default, and applyWhenSafe is the explicit path reserved
 * for when plans persist to SQLite. Its safety rule stands anyway, tested here: a screen reviewing an
 * import, resolving a conflict or approving Auto holds an unsafe moment
 * (safe-moment.ts) and no restart may land inside one
 * (docs/architecture/README.md, "Mobile").
 *
 * The expo-updates calls sit behind UpdatesClient so every branch is
 * unit-testable without a device.
 */

export type UpdateState = "idle" | "checking" | "downloading" | "ready" | "restarting" | "current";

export interface UpdateCheckResult {
  readonly isAvailable: boolean;
  readonly isRollBackToEmbedded: boolean;
}

export interface UpdateFetchResult {
  readonly isNew: boolean;
  readonly isRollBackToEmbedded: boolean;
}

export interface UpdatesClient {
  readonly isEnabled: boolean;
  readonly checkForUpdateAsync: () => Promise<UpdateCheckResult>;
  readonly fetchUpdateAsync: () => Promise<UpdateFetchResult>;
  readonly reloadAsync: () => Promise<void>;
}

export interface UpdateControllerOptions {
  readonly client: UpdatesClient;
  /** False while any screen holds an unsafe moment open. */
  readonly isSafeToApply: () => boolean;
  /** True in development builds and tests, where expo-updates never runs. */
  readonly isDev: boolean;
  readonly log?: (message: string) => void;
}

/** What applyWhenSafe decided, in the order the caller can act on it. */
export type ApplyAttempt = "applied" | "unsafe" | "no-update" | "in-progress";

export type UpdateStateListener = (state: UpdateState) => void;

export function createUpdateController(options: UpdateControllerOptions) {
  const { client, isSafeToApply, isDev } = options;
  const log = options.log ?? (() => {});
  let state: UpdateState = "idle";
  let checkInFlight: Promise<void> | null = null;
  let installInFlight = false;
  const listeners = new Set<UpdateStateListener>();

  const setState = (next: UpdateState) => {
    if (state === next) return;
    state = next;
    for (const listener of Array.from(listeners)) listener(next);
  };

  /** A rollback directive arrives as isAvailable false with the rollback flag. */
  const saysUpdate = (result: UpdateCheckResult) => result.isAvailable || result.isRollBackToEmbedded;

  async function check(): Promise<void> {
    if (isDev || !client.isEnabled) {
      log("updates are off here (development build or Expo Go); nothing checked");
      return;
    }
    if (checkInFlight) return checkInFlight;

    const run = (async () => {
      setState("checking");
      let checked: UpdateCheckResult;
      try {
        checked = await client.checkForUpdateAsync();
      } catch (error) {
        log(`could not check for updates: ${describe(error)}`);
        setState("idle");
        return;
      }
      if (!saysUpdate(checked)) {
        setState("current");
        return;
      }

      // A rollback directive exists to pull a broken bundle off the device;
      // it needs no download, only a restart at the next safe moment.
      if (checked.isAvailable) {
        setState("downloading");
        let fetched: UpdateFetchResult;
        try {
          fetched = await client.fetchUpdateAsync();
        } catch (error) {
          log(`could not download the update: ${describe(error)}`);
          setState("idle");
          return;
        }
        // isNew is always false for a rollback, so it cannot be the sole gate.
        if (!fetched.isNew && !fetched.isRollBackToEmbedded) {
          setState("current");
          return;
        }
      }

      setState("ready");
      log("update downloaded; it applies at the next cold start");
    })();

    checkInFlight = run;
    try {
      await run;
    } finally {
      if (checkInFlight === run) checkInFlight = null;
    }
  }

  /**
   * The explicit apply path: restarts into a downloaded update when no unsafe
   * moment is open. Nothing calls it today (see the module comment); when the
   * plan persists to SQLite, backgrounding wires it back in. Refuses while an
   * unsafe moment is open and stays ready, so the next caller retries instead
   * of dropping the download.
   */
  function applyWhenSafe(): ApplyAttempt {
    if (installInFlight) return "in-progress";
    if (state !== "ready") return "no-update";
    if (!isSafeToApply()) {
      log("holding the downloaded update: an unsafe moment is open");
      return "unsafe";
    }
    installInFlight = true;
    setState("restarting");
    void client.reloadAsync().catch((error) => {
      log(`downloaded, but the restart failed: ${describe(error)}`);
      installInFlight = false;
      // Back to ready, not idle: the update is still on disk and the next
      // safe backgrounding retries. It also applies at the next cold start.
      setState("ready");
    });
    return "applied";
  }

  return {
    check,
    applyWhenSafe,
    get state(): UpdateState {
      return state;
    },
    subscribe(listener: UpdateStateListener): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type UpdateController = ReturnType<typeof createUpdateController>;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
