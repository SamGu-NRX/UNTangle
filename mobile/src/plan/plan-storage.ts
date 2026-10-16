import { File, Paths } from "expo-file-system";

import type { PlanStorage } from "./saved-plan";

/**
 * The guest plan's record on iOS and Android: one JSON file in the app's
 * documents directory, which the system never clears. expo-file-system is
 * already in every Expo build (the expo package depends on it), so this adds
 * no native code; its synchronous calls let the plan load before the first
 * render. Web has no expo-file-system and uses plan-storage.web.ts.
 */
const FILE_NAME = "guest-plan.json";

export const planStorage: PlanStorage = {
  read() {
    const file = new File(Paths.document, FILE_NAME);
    return file.exists ? file.textSync() : null;
  },
  write(text) {
    new File(Paths.document, FILE_NAME).write(text);
  },
};
