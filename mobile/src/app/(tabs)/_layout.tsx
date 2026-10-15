import { Tabs } from "expo-router";
import type { ComponentProps } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppHeader } from "@/ui/chrome";
import { TabGlyph } from "@/ui/glyphs";
import { tick } from "@/ui/haptics";
import { Txt } from "@/ui/text";
import { color, layout } from "@/theme/tokens";

/** expo-router vendors React Navigation, so the tab bar's props come from its Tabs type. */
type BottomTabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

const TABS = [
  { name: "courses", label: "Courses" },
  { name: "week", label: "Week" },
  { name: "day", label: "Day" },
] as const;

/**
 * The tab bar (DESIGN.md §8.1): three tabs in zoom order, 56 plus the safe
 * area, the active tab in brand. Switching lenses never animates; it happens
 * a hundred times a day and the lenses are peers, not a hierarchy.
 */
function TabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const tab = TABS.find((candidate) => candidate.name === route.name);
        if (!tab) return null;
        const active = state.index === index;
        return (
          <Pressable
            key={route.key}
            style={styles.tab}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: active }}
            onPress={() => {
              const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
              if (!active && !event.defaultPrevented) {
                tick();
                navigation.navigate(route.name);
              }
            }}
          >
            <TabGlyph name={tab.name} active={active} />
            <Txt variant="meta" tone={active ? "brand" : "ink2"} style={[styles.label, active && styles.labelActive]}>
              {tab.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{
        header: () => <AppHeader />,
        animation: "none",
        sceneStyle: { backgroundColor: color.ground },
      }}
    >
      <Tabs.Screen name="courses" options={{ title: "Courses" }} />
      <Tabs.Screen name="week" options={{ title: "Week" }} />
      <Tabs.Screen name="day" options={{ title: "Day" }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: color.paper,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line2,
  },
  tab: { flex: 1, height: layout.tabBar, alignItems: "center", justifyContent: "center", gap: 3 },
  label: { fontSize: 11, lineHeight: 14 },
  labelActive: { fontFamily: "DMSans_600SemiBold" },
});
