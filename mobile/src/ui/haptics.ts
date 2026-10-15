import * as Haptics from "expo-haptics";
import { Platform } from "react-native";

/**
 * One haptic per committed action, fired in the same frame as its visual
 * and never as the only feedback. Web has no haptics; failures are ignored
 * because a missed tap of vibration must never break the action it follows.
 */
const native = Platform.OS === "ios" || Platform.OS === "android";

/** A value stepped: a segment, a slider stop, a day. */
export function tick() {
  if (native) Haptics.selectionAsync().catch(() => {});
}

/** Something landed: a course added, a section kept. */
export function land() {
  if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

/** A course removed from the term. */
export function drop() {
  if (native) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
}

/** An add that couldn't happen, such as every section clashing. */
export function refuse() {
  if (native) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
}
