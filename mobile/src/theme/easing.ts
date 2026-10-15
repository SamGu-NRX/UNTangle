import { Easing } from "react-native-reanimated";

/** The web's motion curves (globals.css --ease-*) as Reanimated easings for withTiming. */
export const easing = {
  out: Easing.bezier(0.23, 1, 0.32, 1),
  inOut: Easing.bezier(0.77, 0, 0.175, 1),
  sheet: Easing.bezier(0.32, 0.72, 0, 1),
} as const;
