import { useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, ReduceMotion } from "react-native-reanimated";

import type { Hue } from "@/lib/course-colors";
import { clockText, type WeekBlock } from "@/lib/plan-library/week";
import type { ClassDay, ScheduleEvent } from "@/lib/types";
import { dayPlan, placeOf, sampleStart } from "@/plan/day-plan";
import { busyBlocks, DAY_OFF, gridDays, isDayOff, type Preferences } from "@/plan/preferences";
import { color, font, hueOf, layout, radius } from "@/theme/tokens";

import { Txt } from "./text";

const GUTTER = 38;
const HEAD = 36;
/** A label pill needs this many pixels of gap; a shorter gap shows only the ribbon. */
const PILL_ROOM = 18;
/** Gaps longer than this get no ribbon: the student isn't rushing between those classes. */
const RIBBON_MAX_GAP = 30;

/** The visible hours: one before the earliest class to one after the latest, never narrower than 8 to 5. */
export function gridRange(blocks: readonly { start: number; end: number }[]): { first: number; last: number } {
  if (blocks.length === 0) return { first: 8, last: 17 };
  const first = Math.min(...blocks.map((block) => block.start));
  const last = Math.max(...blocks.map((block) => block.end));
  return { first: Math.min(8, Math.floor(first / 60) - 1), last: Math.max(17, Math.ceil(last / 60) + 1) };
}

function hourLabel(hour: number): string {
  if (hour === 12) return "12 PM";
  if (hour === 8) return "8 AM";
  return String(hour > 12 ? hour - 12 : hour);
}

const crossfadeIn = FadeIn.duration(160).reduceMotion(ReduceMotion.Never);
const crossfadeOut = FadeOut.duration(120).reduceMotion(ReduceMotion.Never);

/**
 * The phone Week: Mon to Fri, 56px hours, course blocks in their department
 * tint with the color bar inset as its own pill so the code never touches
 * it. The code stacks subject over number so it shows in full in a 60px
 * column. A walk ribbon joins back-to-back classes; tight ones are red.
 * A changed section crossfades (MOTION.md §3: opacity only, no movement).
 */
export function WeekGrid({
  blocks,
  events,
  colors,
  prefs,
  moved,
  onOpenCourse,
  onOpenDay,
}: {
  blocks: readonly WeekBlock[];
  events: readonly ScheduleEvent[];
  colors: Map<string, Hue>;
  prefs: Preferences;
  /** Courses an Auto option moves: drawn with a dashed outline while previewed. */
  moved?: ReadonlySet<string>;
  onOpenCourse: (code: string) => void;
  onOpenDay: (day: ClassDay) => void;
}) {
  const busy = useMemo(() => busyBlocks(prefs).filter((block) => block.label !== DAY_OFF), [prefs]);
  const range = gridRange([...blocks, ...busy]);
  const hours = Array.from({ length: range.last - range.first }, (_, i) => range.first + i);
  const height = hours.length * layout.hour;
  const y = (minute: number) => ((minute - range.first * 60) / 60) * layout.hour;
  const daysWithClasses = new Set(blocks.map((block) => block.day));

  return (
    <View style={styles.grid}>
      <View style={styles.headRow}>
        <View style={{ width: GUTTER }} />
        {gridDays.map((day) => (
          <Pressable
            key={day}
            style={styles.dayHead}
            onPress={() => onOpenDay(day)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${day} in Day`}
          >
            <Txt variant="label" tone={daysWithClasses.has(day) ? "ink" : "ink2"}>
              {day}
            </Txt>
          </Pressable>
        ))}
      </View>
      <View style={[styles.body, { height }]}>
        <View style={{ width: GUTTER }}>
          {hours.map((hour, index) =>
            index === 0 ? null : (
              <Txt key={hour} variant="meta" tone="ink2" style={[styles.hour, { top: index * layout.hour - 8 }]}>
                {hourLabel(hour)}
              </Txt>
            ),
          )}
        </View>
        {gridDays.map((day) => {
          const off = isDayOff(prefs, day);
          const stops = dayPlan(events, day, sampleStart, null).stops;
          return (
            <View key={day} style={[styles.column, off && styles.columnOff]}>
              {hours.map((hour, index) => (
                <View key={hour} style={[styles.hourLine, { top: index * layout.hour }, index === 0 && styles.hourLineFirst]} />
              ))}
              {off ? (
                <Txt variant="meta" tone="ink2" style={styles.offLabel}>
                  Off
                </Txt>
              ) : null}
              {busy
                .filter((block) => block.day === day)
                .map((block) => (
                  <View key={`${block.label}-${block.start}`} style={[styles.busy, { top: y(block.start) + 1, height: y(block.end) - y(block.start) - 2 }]}>
                    <Txt variant="meta" tone="ink2" numberOfLines={1} style={styles.busyText}>
                      {block.label}
                    </Txt>
                  </View>
                ))}
              {stops.map((stop, index) => {
                const previous = stops[index - 1];
                if (!previous || stop.leg.minutes === null || stop.leg.minutes === 0) return null;
                const gap = stop.start - previous.end;
                if (gap <= 0 || gap > RIBBON_MAX_GAP) return null;
                const top = y(previous.end);
                const span = y(stop.start) - top;
                const tight = stop.leg.fit === "tight" || stop.leg.fit === "late";
                const tint = tight ? color.danger : color.brand;
                return (
                  <View key={`walk-${stop.event.courseCode}`} style={[styles.ribbonWrap, { top, height: span }]} pointerEvents="none">
                    <View style={[styles.ribbon, { backgroundColor: tint }]} />
                    {span >= PILL_ROOM ? (
                      <View style={[styles.walkPill, tight && styles.walkPillTight]}>
                        <Txt variant="meta" tone={tight ? "danger" : "ink2"} style={styles.walkText}>
                          {stop.leg.minutes} min
                        </Txt>
                      </View>
                    ) : null}
                  </View>
                );
              })}
              {blocks
                .filter((block) => block.day === day)
                .map((block) => {
                  const hue = hueOf(colors.get(block.code));
                  const [subject, number] = block.code.split(" ");
                  const top = y(block.start);
                  const tall = y(block.end) - top;
                  const event = events.find((candidate) => candidate.courseCode === block.code && candidate.day === day);
                  return (
                    <Animated.View
                      key={`${block.code}-${block.sectionId}-${block.start}`}
                      entering={crossfadeIn}
                      exiting={crossfadeOut}
                      style={[styles.blockWrap, { top: top + 1, height: tall - 2 }]}
                    >
                      <Pressable
                        style={[
                          styles.block,
                          { backgroundColor: hue.tint },
                          moved?.has(block.code) && { borderColor: hue.solid, borderStyle: "dashed", borderWidth: 1.5 },
                        ]}
                        onPress={() => onOpenCourse(block.code)}
                        accessibilityRole="button"
                        accessibilityLabel={`${block.code}, ${day} ${clockText(block.start)} to ${clockText(block.end)}`}
                      >
                        <View style={[styles.bar, { backgroundColor: hue.solid }]} />
                        <View style={styles.blockText}>
                          <Txt style={[styles.code, { color: color.ink }]} numberOfLines={1}>
                            {subject}
                          </Txt>
                          <Txt style={[styles.code, { color: color.ink }]} numberOfLines={1}>
                            {number}
                          </Txt>
                          {tall >= 64 && event?.buildingId ? (
                            <Txt variant="meta" tone="ink2" style={styles.place} numberOfLines={1}>
                              {placeOf(event).code}
                            </Txt>
                          ) : null}
                        </View>
                      </Pressable>
                    </Animated.View>
                  );
                })}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: {
    backgroundColor: color.paper,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: color.line,
    paddingRight: 4,
    paddingBottom: 8,
    overflow: "hidden",
  },
  headRow: { flexDirection: "row", height: HEAD },
  dayHead: { flex: 1, alignItems: "center", justifyContent: "center", minHeight: 44, marginTop: -4 },
  body: { flexDirection: "row" },
  hour: { position: "absolute", right: 6, fontSize: 11, lineHeight: 16 },
  column: { flex: 1, position: "relative", borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.line },
  columnOff: { backgroundColor: color.paper2 },
  hourLine: { position: "absolute", left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: color.line },
  hourLineFirst: { backgroundColor: color.line2 },
  offLabel: { position: "absolute", top: 8, alignSelf: "center", fontSize: 12 },
  busy: {
    position: "absolute",
    left: 2,
    right: 2,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: color.line2,
    backgroundColor: color.paper2,
    paddingHorizontal: 5,
    paddingTop: 3,
  },
  busyText: { fontSize: 11, lineHeight: 14 },
  ribbonWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", justifyContent: "center", zIndex: 2 },
  ribbon: { position: "absolute", top: 0, bottom: 0, width: 2, borderRadius: 1 },
  walkPill: {
    paddingHorizontal: 5,
    height: 16,
    justifyContent: "center",
    borderRadius: 8,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
  },
  walkPillTight: { borderColor: color.danger },
  walkText: { fontSize: 11, lineHeight: 13, fontFamily: font.semibold },
  blockWrap: { position: "absolute", left: 2, right: 2, zIndex: 1 },
  block: { flex: 1, borderRadius: radius.sm, flexDirection: "row", overflow: "hidden" },
  // The bar is inset from the block's corners, so it never curls with them.
  bar: { width: 3, marginLeft: 3, marginVertical: 4, borderRadius: 2 },
  blockText: { flex: 1, paddingLeft: 5, paddingRight: 3, paddingTop: 4 },
  code: { fontFamily: font.bold, fontSize: 12, lineHeight: 15 },
  place: { fontSize: 11, lineHeight: 15, marginTop: 2 },
});
