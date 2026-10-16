import type { PlanStorage } from "./saved-plan";

/** The guest plan's record on web, where expo-file-system has no implementation: one localStorage key. */
export const PLAN_KEY = "untangle.mobile.guest-plan";

export const planStorage: PlanStorage = {
  read: () => globalThis.localStorage.getItem(PLAN_KEY),
  write: (text) => globalThis.localStorage.setItem(PLAN_KEY, text),
};
