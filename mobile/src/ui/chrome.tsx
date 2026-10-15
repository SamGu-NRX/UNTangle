import { useEffect, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

import { easing } from "@/theme/easing";
import { color, layout, motion, radius, space } from "@/theme/tokens";

import { tick } from "./haptics";
import { PressScale } from "./press";
import { Txt } from "./text";

/** Where data came from, once per lens (copy.md): a 20px dotted tag. */
export function ProvenanceTag({ label }: { label: string }) {
  return (
    <View style={styles.tag} accessibilityRole="text">
      <Txt variant="meta" tone="ink2" style={styles.tagText}>
        {label}
      </Txt>
    </View>
  );
}

/**
 * The phone header: wordmark left, the guest state and Sign in right. Guest
 * mode is the only mode until device sign-in ships, so the pill says so
 * plainly instead of naming a schedule that isn't saved anywhere.
 */
export function AppHeader() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.header, { paddingTop: insets.top }]}>
      <View style={styles.headerRow}>
        <Txt variant="wordmark" tone="brand" accessibilityRole="header">
          UNTangle
        </Txt>
        <View style={styles.headerRight}>
          <View style={styles.guestPill}>
            <View style={styles.guestDot} />
            <Txt variant="meta" tone="ink2">
              Guest
            </Txt>
          </View>
          <PressScale onPress={() => router.push("/sign-in")} accessibilityLabel="Sign in" style={styles.signIn}>
            <Txt variant="meta" tone="brand" style={styles.signInText}>
              Sign in
            </Txt>
          </PressScale>
        </View>
      </View>
    </View>
  );
}

/** A lens's title row: the term, one fact under it, and the lens's one action. */
export function ViewHead({ title, meta, tag, action }: { title: string; meta?: string; tag?: string; action?: ReactNode }) {
  return (
    <View style={styles.viewHead}>
      <View style={styles.viewHeadText}>
        <Txt variant="h1" accessibilityRole="header">
          {title}
        </Txt>
        <View style={styles.viewHeadMeta}>
          {meta ? (
            <Txt variant="meta" tone="ink2">
              {meta}
            </Txt>
          ) : null}
          {tag ? <ProvenanceTag label={tag} /> : null}
        </View>
      </View>
      {action}
    </View>
  );
}

/**
 * Equal segments with one pill that slides under the chosen one (MOTION.md
 * §3: transform, 160ms ease-out). The pill is absolute and childless, so
 * moving it re-lays-out nothing. Labels never animate.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  marks,
}: {
  options: ReadonlyArray<{ value: T; label: string; a11y?: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
  /** Values that get a 4px dot under their label, such as days with classes. */
  marks?: ReadonlySet<T>;
}) {
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((option) => option.value === value));
  const segment = width > 0 ? (width - 6) / options.length : 0;
  const x = useSharedValue(0);
  const reduced = useReducedMotion();
  useEffect(() => {
    x.set(reduced ? index * segment : withTiming(index * segment, { duration: motion.hover, easing: easing.out }));
  }, [index, segment, reduced, x]);
  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View style={styles.segTrack} onLayout={onLayout} accessibilityRole="tablist" accessibilityLabel={label}>
      {segment > 0 ? <Animated.View style={[styles.segPill, { width: segment }, pill]} /> : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            style={styles.seg}
            onPress={() => {
              if (!selected) {
                tick();
                onChange(option.value);
              }
            }}
            accessibilityRole="tab"
            accessibilityLabel={option.a11y ?? option.label}
            accessibilityState={{ selected }}
          >
            <Txt variant={selected ? "bodyStrong" : "body"} tone={selected ? "ink" : "ink2"} style={styles.segText}>
              {option.label}
            </Txt>
            <View style={[styles.segMark, marks?.has(option.value) && { backgroundColor: selected ? color.brand : color.ink4 }]} />
          </Pressable>
        );
      })}
    </View>
  );
}

/** An honest empty or error state: what belongs here, and one button that puts it there. */
export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Txt variant="title">{title}</Txt>
      {body ? (
        <Txt variant="body" tone="ink2" style={styles.emptyBody}>
          {body}
        </Txt>
      ) : null}
      {action}
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line2,
    borderRadius: radius.xs + 2,
    paddingHorizontal: 6,
    minHeight: 20,
    justifyContent: "center",
  },
  tagText: { fontSize: 11.5, lineHeight: 16 },
  header: {
    backgroundColor: color.ground,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  headerRow: {
    height: layout.header,
    paddingHorizontal: layout.gutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerRight: { flexDirection: "row", alignItems: "center", gap: space[2] },
  guestPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: color.paper2,
  },
  guestDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color.ink4 },
  signIn: {
    height: 32,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.paper,
    justifyContent: "center",
  },
  signInText: { fontFamily: "DMSans_600SemiBold" },
  viewHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: space[3],
    paddingHorizontal: layout.gutter,
    paddingTop: space[5],
    paddingBottom: space[3],
  },
  viewHeadText: { flex: 1, gap: 4 },
  viewHeadMeta: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: space[2] },
  segTrack: {
    flexDirection: "row",
    backgroundColor: color.paper3,
    borderRadius: radius.md,
    padding: 3,
  },
  segPill: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: radius.sm + 1,
    backgroundColor: color.paper,
    boxShadow: "0 1px 2px rgba(20, 40, 22, 0.10)",
  },
  seg: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center", paddingTop: 4 },
  segText: { fontSize: 14 },
  segMark: { width: 4, height: 4, borderRadius: 2, marginTop: 2, backgroundColor: "transparent" },
  empty: { paddingHorizontal: layout.gutter, paddingVertical: space[8], gap: space[2], alignItems: "flex-start" },
  emptyBody: { marginBottom: space[2] },
});
