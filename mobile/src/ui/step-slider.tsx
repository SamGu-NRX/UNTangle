import { useEffect, useRef, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { easing } from "@/theme/easing";
import { color, motion } from "@/theme/tokens";

import { tick } from "./haptics";

const KNOB = 28;

/**
 * A slider over a few named stops: drag or tap the track. The knob follows
 * the finger on the UI thread and the value commits only when the finger
 * crosses a stop, with one selection haptic per stop. Release springs to the nearest
 * stop carrying the finger's velocity. VoiceOver adjusts it a stop at a time.
 */
export function StepSlider({
  steps,
  value,
  onChange,
  label,
  valueText,
}: {
  /** Number of stops, at least 2. */
  steps: number;
  /** The selected stop, 0 to steps - 1. */
  value: number;
  onChange: (step: number) => void;
  label: string;
  valueText: string;
}) {
  const [width, setWidth] = useState(0);
  const reduced = useReducedMotion();
  const span = Math.max(width - KNOB, 1);
  const x = useSharedValue(0);
  const start = useSharedValue(0);
  const step = useSharedValue(value);
  const pitch = span / (steps - 1);

  // The knob follows the value. It jumps on first layout and animates only
  // when the value itself changes, so a programmatic move never sweeps
  // across stops the student didn't pick.
  const shown = useRef<number | null>(null);
  useEffect(() => {
    step.set(value);
    const target = value * pitch;
    const animate = !reduced && shown.current !== null && shown.current !== value;
    x.set(animate ? withTiming(target, { duration: motion.hover, easing: easing.out }) : target);
    shown.current = value;
  }, [value, pitch, reduced, step, x]);

  const commit = (next: number) => {
    tick();
    onChange(next);
  };

  /** Commits the stop under the knob once per stop crossed, only from a gesture. */
  const follow = () => {
    "worklet";
    const current = Math.min(Math.max(Math.round(x.get() / pitch), 0), steps - 1);
    if (current !== step.get()) {
      step.set(current);
      scheduleOnRN(commit, current);
    }
  };

  const settle = (velocity: number) => {
    "worklet";
    const target = Math.min(Math.max(Math.round(x.get() / pitch), 0), steps - 1) * pitch;
    x.set(withSpring(target, { ...motion.snap, velocity, overshootClamping: true }));
  };

  const pan = Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onStart(() => {
      start.set(x.get());
    })
    .onUpdate((event) => {
      x.set(Math.min(Math.max(start.get() + event.translationX, 0), span));
      follow();
    })
    .onEnd((event) => {
      settle(event.velocityX);
    });
  const tap = Gesture.Tap().onEnd((event) => {
    x.set(Math.min(Math.max(event.x - KNOB / 2, 0), span));
    follow();
    settle(0);
  });

  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const fill = useAnimatedStyle(() => ({ transform: [{ scaleX: (x.get() + KNOB / 2) / Math.max(width, 1) }] }));

  return (
    <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
      <View
        style={styles.track}
        onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ text: valueText }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const next = value + (event.nativeEvent.actionName === "increment" ? 1 : -1);
          if (next >= 0 && next < steps) commit(next);
        }}
      >
        <View style={styles.rail}>
          <Animated.View style={[styles.fill, { width }, fill]} />
        </View>
        {width > 0
          ? Array.from({ length: steps }, (_, i) => (
              <View key={i} style={[styles.stop, { left: KNOB / 2 + i * pitch - 2 }]} pointerEvents="none" />
            ))
          : null}
        {width > 0 ? <Animated.View style={[styles.knob, knob]} pointerEvents="none" /> : null}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  track: { height: 44, justifyContent: "center" },
  rail: {
    position: "absolute",
    left: KNOB / 2,
    right: KNOB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: color.paper3,
    overflow: "hidden",
  },
  // Scaled from its left edge, so the fill never re-lays-out while dragging.
  fill: { position: "absolute", left: -KNOB / 2, top: 0, bottom: 0, backgroundColor: color.brand, transformOrigin: "left" },
  stop: { position: "absolute", width: 4, height: 4, borderRadius: 2, backgroundColor: color.line2 },
  knob: {
    position: "absolute",
    left: 0,
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line2,
    boxShadow: "0 2px 6px rgba(20, 40, 22, 0.18)",
  },
});
