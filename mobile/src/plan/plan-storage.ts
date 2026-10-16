import { File, Paths } from "expo-file-system";

import type { PlanStorage } from "./saved-plan";

/**
 * The guest plan's record on iOS and Android: one JSON file in the app's
 * documents directory, which the system never clears. expo-file-system is
 * already in every Expo build (the expo package depends on it), so this adds
 * no native code; its synchronous calls let the plan load before the first
 * render. Web has no expo-file-system and uses plan-storage.web.ts.
 *
 * A save writes the whole record to NEXT_NAME, then moves it over FILE_NAME,
 * so an app killed mid-write leaves the previous plan intact. The move is not
 * one step on its own: with overwrite, expo-file-system deletes the old file
 * and then moves the new one in (FileSystemPath.swift `move`). A kill between
 * the two leaves only NEXT_NAME, which by then holds the complete record, so
 * read() falls back to it when FILE_NAME is missing.
 */
const FILE_NAME = "guest-plan.json";
const NEXT_NAME = "guest-plan.next.json";

export const planStorage: PlanStorage = {
  read() {
    const saved = new File(Paths.document, FILE_NAME);
    if (saved.exists) return saved.textSync();
    const next = new File(Paths.document, NEXT_NAME);
    return next.exists ? next.textSync() : null;
  },
  write(text) {
    const next = new File(Paths.document, NEXT_NAME);
    next.write(text);
    next.moveSync(new File(Paths.document, FILE_NAME), { overwrite: true });
  },
};
