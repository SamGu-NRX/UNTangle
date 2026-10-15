import { useState, type ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";

import { color, layout, motion, radius } from "@/theme/tokens";

import { Txt } from "./text";

/**
 * Press feedback for everything tappable: scale .97 on press-in over 120ms,
 * the web's --t-press. A CSS transition, not a shared value, because it is a
 * two-state change with no finger tracking. Reduced motion is handled by
 * Reanimated's CSS transitions following the system setting.
 */
export function PressScale({
  onPress,
  children,
  style,
  outerStyle,
  disabled,
  accessibilityLabel,
  accessibilityRole = "button",
  accessibilityState,
  hitSlop = 8,
  testID,
}: {
  onPress?: () => void;
  children: ReactNode;
  /** The visual box that scales: background, padding, radius. */
  style?: StyleProp<ViewStyle>;
  /** Where the control sits among its siblings: flex, alignSelf, margins. */
  outerStyle?: StyleProp<ViewStyle>;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "tab" | "checkbox" | "switch" | "adjustable";
  accessibilityState?: { selected?: boolean; checked?: boolean; disabled?: boolean; expanded?: boolean };
  hitSlop?: number;
  testID?: string;
}) {
  const [pressed, setPressed] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      disabled={disabled}
      hitSlop={hitSlop}
      pressRetentionOffset={16}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...accessibilityState }}
      testID={testID}
      style={outerStyle}
    >
      <Animated.View style={[pressScale, pressed && !disabled && pressedScale, style]}>{children}</Animated.View>
    </Pressable>
  );
}

// Reanimated CSS transitions are plain style objects; StyleSheet.create doesn't type them.
const pressScale = {
  transform: [{ scale: 1 }],
  transitionProperty: "transform",
  transitionDuration: motion.press,
  transitionTimingFunction: motion.css.easeOut,
} as const;
const pressedScale = { transform: [{ scale: 0.97 }] } as const;

type ButtonKind = "primary" | "secondary" | "quiet";

/** Buttons: 44 tall on phone (DESIGN.md §6), radius 12. A busy button keeps its width and swaps its label for a spinner. */
export function Button({
  label,
  onPress,
  kind = "primary",
  icon,
  disabled,
  busy,
  accessibilityLabel,
  style,
  full,
}: {
  label: string;
  onPress?: () => void;
  kind?: ButtonKind;
  icon?: ReactNode;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
  full?: boolean;
}) {
  const fg = kind === "primary" ? "white" : "brand";
  return (
    <PressScale
      onPress={onPress}
      disabled={disabled || busy}
      accessibilityLabel={accessibilityLabel ?? label}
      outerStyle={[full && styles.full, style]}
      style={[styles.button, styles[kind], disabled && styles.disabled]}
    >
      <View style={[styles.inner, busy && styles.hidden]}>
        {icon}
        <Txt variant="bodyStrong" tone={disabled ? "ink2" : fg} numberOfLines={1}>
          {label}
        </Txt>
      </View>
      {busy ? <ActivityIndicator style={StyleSheet.absoluteFill} color={kind === "primary" ? "#fff" : color.brand} /> : null}
    </PressScale>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: layout.target,
    paddingHorizontal: 16,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  full: { alignSelf: "stretch" },
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  hidden: { opacity: 0 },
  primary: { backgroundColor: color.brand },
  secondary: { backgroundColor: color.paper, borderWidth: 1, borderColor: color.line2 },
  quiet: { backgroundColor: color.brandSoft },
  disabled: { backgroundColor: color.paper2, borderColor: color.paper2 },
});
