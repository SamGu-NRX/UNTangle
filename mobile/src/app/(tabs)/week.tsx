import { router } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import type { ClassDay } from "@/lib/types";
import { runAuto, type AutoResult } from "@/plan/auto";
import { dayPlan, sampleStart } from "@/plan/day-plan";
import { creditsText, planningTermLabel, weekOf, type Picks } from "@/plan/guest-plan";
import { usePlan } from "@/plan/plan-store";
import { gridDays } from "@/plan/preferences";
import { color, layout, radius, shadow, space } from "@/theme/tokens";
import { EmptyState, ViewHead } from "@/ui/chrome";
import { CloseGlyph, SlidersGlyph } from "@/ui/glyphs";
import { land, refuse, tick } from "@/ui/haptics";
import { Button, PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";
import { WeekGrid } from "@/ui/week-grid";

const DAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };

const noteIn = FadeIn.duration(200).reduceMotion(ReduceMotion.Never);
const noteOut = FadeOut.duration(150).reduceMotion(ReduceMotion.Never);

/** "Moves CSCE 2110 and MATH 2700." or, when nothing moves, that this is the current week. */
function movesText(moves: readonly string[]): string {
  if (moves.length === 0) return "Same sections as your week now.";
  const list = moves.length === 1 ? moves[0] : `${moves.slice(0, -1).join(", ")} and ${moves[moves.length - 1]}`;
  return `Moves ${list}.`;
}

export default function WeekScreen() {
  const { picks, week, prefs, replace } = usePlan();
  const [auto, setAuto] = useState<AutoResult | null>(null);
  const [index, setIndex] = useState(0);
  const [used, setUsed] = useState<{ label: string; before: Picks } | null>(null);

  const option = auto?.kind === "options" ? auto.options[index] : null;
  const shown = useMemo(() => (option ? weekOf(option.picks) : week), [option, week]);

  // The first tight walk, said once under the grid, with the fix: Preferences' short walks.
  const tight = useMemo(() => {
    for (const day of gridDays) {
      const stop = dayPlan(shown.events, day, sampleStart, null).stops.find(
        (candidate, i) => i > 0 && (candidate.leg.fit === "tight" || candidate.leg.fit === "late"),
      );
      if (stop) return { code: stop.event.courseCode, day };
    }
    return null;
  }, [shown.events]);

  const openCourse = (code: string) => router.push({ pathname: "/course/[code]", params: { code } });
  const openDay = (day: ClassDay) => {
    tick();
    router.navigate({ pathname: "/day", params: { d: day } });
  };

  const pressAuto = () => {
    const result = runAuto(picks, prefs);
    if (result.kind === "options") land();
    else refuse();
    setUsed(null);
    setIndex(0);
    setAuto(result);
  };
  const useOption = () => {
    if (!option) return;
    land();
    setUsed({ label: `Using option ${index + 1}`, before: picks });
    replace(option.picks);
    setAuto(null);
  };

  if (Object.keys(picks).length === 0) {
    return (
      <View style={styles.screen}>
        <ViewHead title={planningTermLabel} />
        <EmptyState
          title={`Add a course to plan ${planningTermLabel}.`}
          action={<Button label="Open Courses" onPress={() => router.navigate("/courses")} />}
        />
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <ViewHead title={planningTermLabel} meta={creditsText(shown.credits)} tag="Sample sections" />

      <View style={styles.actions}>
        <Button
          kind="secondary"
          label="Preferences"
          icon={<SlidersGlyph />}
          onPress={() => router.push("/preferences")}
          style={styles.action}
        />
        <Button label="Auto" onPress={pressAuto} style={styles.action} accessibilityLabel="Auto: arrange sections around your preferences" />
      </View>

      {auto ? (
        <Animated.View entering={noteIn} exiting={noteOut} style={styles.autoCard}>
          {auto.kind === "options" && option ? (
            <>
              <View style={styles.autoHead}>
                <Txt variant="bodyStrong">
                  Option {index + 1} of {auto.options.length}
                </Txt>
                <PressScale onPress={() => setAuto(null)} style={styles.close} accessibilityLabel="Close options" hitSlop={8}>
                  <CloseGlyph />
                </PressScale>
              </View>
              <Txt variant="body" tone="ink2">
                {movesText(option.moves)}
              </Txt>
              <View style={styles.autoActions}>
                {auto.options.length > 1 ? (
                  <Button
                    kind="secondary"
                    label="Next"
                    onPress={() => {
                      tick();
                      setIndex((value) => (value + 1) % auto.options.length);
                    }}
                    style={styles.action}
                    accessibilityLabel={`Show option ${((index + 1) % auto.options.length) + 1}`}
                  />
                ) : null}
                <Button label="Use this" onPress={useOption} style={styles.action} accessibilityLabel={`Use option ${index + 1}`} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.autoHead}>
                <Txt variant="bodyStrong">Nothing fits these preferences.</Txt>
                <PressScale onPress={() => setAuto(null)} style={styles.close} accessibilityLabel="Close" hitSlop={8}>
                  <CloseGlyph />
                </PressScale>
              </View>
              {auto.kind === "none" && auto.why ? (
                <Txt variant="body" tone="ink2">
                  {auto.why}
                </Txt>
              ) : null}
              <Button kind="secondary" label="Edit preferences" onPress={() => router.push("/preferences")} style={styles.editPrefs} />
            </>
          )}
        </Animated.View>
      ) : used ? (
        <Animated.View entering={noteIn} exiting={noteOut} style={styles.notice}>
          <Txt variant="meta" style={styles.noticeText}>
            {used.label}
          </Txt>
          <PressScale
            onPress={() => {
              replace(used.before);
              setUsed(null);
            }}
            accessibilityLabel="Undo"
            style={styles.undo}
          >
            <Txt variant="meta" tone="brand" style={styles.link}>
              Undo
            </Txt>
          </PressScale>
        </Animated.View>
      ) : null}

      <View style={styles.gridWrap}>
        <WeekGrid
          blocks={shown.blocks}
          events={shown.events}
          colors={shown.colors}
          prefs={prefs}
          moved={option ? new Set(option.moves) : undefined}
          onOpenCourse={openCourse}
          onOpenDay={openDay}
        />
      </View>

      {tight ? (
        <Txt variant="meta" tone="danger" style={styles.tight}>
          The walk to {tight.code} on {DAY_NAMES[tight.day]} is tight.
        </Txt>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { paddingBottom: space[10] },
  actions: { flexDirection: "row", gap: space[2], paddingHorizontal: layout.gutter, paddingBottom: space[3] },
  action: { flex: 1 },
  autoCard: {
    marginHorizontal: layout.gutter,
    marginBottom: space[3],
    padding: space[4],
    gap: space[2],
    borderRadius: radius.lg,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow[2],
  },
  autoHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  close: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: color.paper2 },
  autoActions: { flexDirection: "row", gap: space[2], marginTop: space[1] },
  editPrefs: { alignSelf: "flex-start", marginTop: space[1] },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: layout.gutter,
    marginBottom: space[3],
    paddingHorizontal: space[3],
    minHeight: 44,
    borderRadius: radius.md,
    backgroundColor: color.brandSoft,
  },
  noticeText: { flex: 1 },
  undo: { minHeight: 36, justifyContent: "center", paddingHorizontal: 4 },
  link: { fontFamily: "DMSans_600SemiBold" },
  gridWrap: { paddingHorizontal: 8 },
  tight: { paddingHorizontal: layout.gutter, paddingTop: space[3] },
});
