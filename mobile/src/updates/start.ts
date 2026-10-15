import * as Updates from "expo-updates";
import { AppState } from "react-native";

import { resolveEasPair } from "./eas-project";
import { isSafeToApply } from "./safe-moment";
import { createUpdateController, type UpdateController } from "./update-controller";

/**
 * Real wiring for the update flow: check at launch, recheck on return to the
 * foreground after the app has sat in the background for a while, and download
 * in the background. Nothing here restarts the app: the guest's plan lives
 * only in memory (plan-store), so a restart when the app backgrounds would
 * wipe a student's picks after a quick app switch. A downloaded update
 * applies at the next cold start, which is expo-updates' own default, and
 * controller.applyWhenSafe stays reserved for when plans persist to SQLite
 * (docs/mobile/ota.md). Called once from the root layout; the returned
 * cleanup unsubscribes.
 *
 * The app can stay resident for days, so a launch-only check would miss
 * updates published while it was in memory. Anything shorter reads as noise:
 * brief app switches should not trigger network checks.
 */
export const FOREGROUND_RECHECK_AFTER_MS = 15 * 60 * 1000;

export function shouldRecheckOnForeground(
  backgroundedAtMs: number | null,
  activeAtMs: number,
  updateIsReady: boolean,
): boolean {
  if (updateIsReady) return false;
  return backgroundedAtMs !== null && activeAtMs - backgroundedAtMs >= FOREGROUND_RECHECK_AFTER_MS;
}

export function startUpdateChecks(): () => void {
  // Expo inlines EXPO_PUBLIC_* only when bundled source reads
  // process.env.EXPO_PUBLIC_X with dot notation; a lookup by name compiles to
  // nothing, and a real build would always see the placeholder.
  const eas = resolveEasPair(
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID,
    process.env.EXPO_PUBLIC_EAS_UPDATE_URL,
    { allowPlaceholder: true },
  );
  if (eas.isPlaceholder) {
    // Placeholder until `eas init` runs and the env is set: stay silent, keep
    // the app fully usable. docs/mobile/ota.md has the setup steps.
    console.warn(
      "[updates] no EAS project configured (EXPO_PUBLIC_EAS_PROJECT_ID missing); over-the-air updates are disabled.",
    );
    return () => {};
  }

  const controller = createUpdateController({
    client: Updates,
    isSafeToApply,
    isDev: __DEV__,
    log: (message) => console.info(`[updates] ${message}`),
  });

  void controller.check();

  let backgroundedAtMs: number | null = null;
  const subscription = AppState.addEventListener("change", (appState) => {
    if (appState === "background") {
      backgroundedAtMs = Date.now();
      // Download while backgrounded, never reloadAsync here: the update waits
      // for the next cold start (docs/mobile/ota.md).
      void controller.check();
      return;
    }
    if (appState === "active") {
      const shouldCheck = shouldRecheckOnForeground(
        backgroundedAtMs,
        Date.now(),
        controller.state === "ready",
      );
      backgroundedAtMs = null;
      if (shouldCheck) void controller.check();
    }
  });

  return () => subscription.remove();
}

export type { UpdateController };
