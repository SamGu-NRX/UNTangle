import * as Updates from "expo-updates";
import { AppState } from "react-native";

import { isSafeToApply } from "./safe-moment";
import { createUpdateController, type UpdateController } from "./update-controller";
import { PLACEHOLDER_PROJECT_ID, resolveEasProject } from "./eas-project";

/**
 * Real wiring for the update flow: check at launch, recheck on return to the
 * foreground after the app has sat in the background for a while, and restart
 * into a downloaded update when the app backgrounds at a safe moment. Called
 * once from the root layout; the returned cleanup unsubscribes.
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
  const eas = resolveEasProject(process.env, { allowPlaceholder: true });
  if (eas.isPlaceholder || eas.projectId === PLACEHOLDER_PROJECT_ID) {
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
      // The restart is invisible here, and screens cannot hold an unsafe
      // moment open across a backgrounding, so this is the apply moment.
      controller.applyWhenSafe();
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
