import { router } from "expo-router";
import { useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { ClassDay } from "@/lib/types";
import { clockWithPeriod, rangeWithPeriod } from "@/plan/day-plan";
import { creditsText, sectionNumber, sectionsOf } from "@/plan/guest-plan";
import { usePlan } from "@/plan/plan-store";
import {
  busyBlocks,
  DAY_OFF,
  busySummary,
  cellKey,
  clearBusy,
  daysText,
  gridDays,
  gridHours,
  isDayOff,
  leaningOrder,
  leanings,
  leaningText,
  toggleCell,
  toggleDayOff,
  type LeaningKey,
} from "@/plan/preferences";
import { color, font, hueOf, layout, motion, radius, space } from "@/theme/tokens";
import { Segmented } from "@/ui/chrome";
import { CloseGlyph, LockGlyph, PlusGlyph } from "@/ui/glyphs";
import { land, tick } from "@/ui/haptics";
import { PressScale } from "@/ui/press";
import { StepSlider } from "@/ui/step-slider";
import { Txt } from "@/ui/text";

const CELL = 24;
const GUTTER = 40;
const START_OPTIONS = [
  { value: "any", label: "Any time" },
  { value: "540", label: "9 AM" },
  { value: "600", label: "10 AM" },
  { value: "660", label: "11 AM" },
] as const;
type StartValue = (typeof START_OPTIONS)[number]["value"];

const wellIn = FadeIn.duration(160).reduceMotion(ReduceMotion.Never);

function Section({ title, sub, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Txt variant="title" accessibilityRole="header">
        {title}
      </Txt>
      <Txt variant="meta" tone="ink2" style={styles.sectionSub}>
        {sub}
      </Txt>
      {children}
    </View>
  );
}

/**
 * Hard limits, painted: tap an hour to block it, tap a day to take it off.
 * Hours before "No class before" are shaded. Busy runs draw as one block in
 * the clay tint, the way Week draws them.
 */
function PaintedGrid() {
  const { prefs, setPrefs } = usePlan();
  const hours = Array.from({ length: gridHours.last - gridHours.first }, (_, i) => gridHours.first + i);
  const blocks = busyBlocks(prefs).filter((block) => block.label !== DAY_OFF);
  const clay = hueOf(2);
  const paint = (day: ClassDay, hour: number) => {
    tick();
    setPrefs((current) => toggleCell(current, day, hour));
  };
  return (
    <View style={styles.paint}>
      <View style={styles.paintHead}>
        <View style={{ width: GUTTER }} />
        {gridDays.map((day) => {
          const off = isDayOff(prefs, day);
          return (
            <Pressable
              key={day}
              style={styles.paintDay}
              onPress={() => {
                tick();
                setPrefs((current) => toggleDayOff(current, day));
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: off }}
              accessibilityLabel={`${day} off`}
            >
              <Txt variant="label" tone={off ? "brand" : "ink"}>
                {day}
              </Txt>
              <Txt variant="meta" tone="ink2" style={[styles.offWord, !off && styles.invisible]}>
                Off
              </Txt>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.paintBody}>
        <View style={{ width: GUTTER }}>
          {hours.map((hour, index) =>
            index === 0 || index % 2 === 1 ? null : (
              <Txt key={hour} variant="meta" tone="ink2" style={[styles.paintHour, { top: index * CELL - 8 }]}>
                {clockWithPeriod(hour * 60).replace(":00", "")}
              </Txt>
            ),
          )}
        </View>
        {gridDays.map((day) => {
          const off = isDayOff(prefs, day);
          return (
            <View key={day} style={[styles.paintColumn, off && styles.paintOff]}>
              {hours.map((hour) => {
                const early = prefs.startAfter !== null && hour * 60 < prefs.startAfter;
                const busy = cellKey(day, hour) in prefs.busy;
                return (
                  <Pressable
                    key={hour}
                    style={[styles.cell, early && !off && styles.cellEarly]}
                    onPress={() => paint(day, hour)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: busy }}
                    accessibilityLabel={`${day} ${clockWithPeriod(hour * 60)}`}
                  />
                );
              })}
              {off
                ? null
                : blocks
                    .filter((block) => block.day === day)
                    .map((block) => (
                      <View
                        key={block.start}
                        pointerEvents="none"
                        style={[
                          styles.paintBlock,
                          {
                            top: ((block.start - gridHours.first * 60) / 60) * CELL + 1,
                            height: ((block.end - block.start) / 60) * CELL - 2,
                            backgroundColor: clay.tint,
                          },
                        ]}
                      >
                        <View style={[styles.paintBar, { backgroundColor: clay.solid }]} />
                        {block.end - block.start >= 120 ? (
                          <Txt variant="meta" style={styles.paintLabel} numberOfLines={1}>
                            {block.label}
                          </Txt>
                        ) : null}
                      </View>
                    ))}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** The leaning cards' pictures: drawn views that move with the value, so a card shows what it does. */
function LeanPicture({ lean, value }: { lean: LeaningKey; value: number }) {
  const ink = color.ink2;
  switch (lean) {
    case "time": {
      const at = (value + 2) / 4;
      return (
        <View style={styles.picTime}>
          <View style={styles.picHorizon} />
          <View style={[styles.picSun, { left: `${8 + at * 76}%` }]} />
        </View>
      );
    }
    case "fewerDays": {
      const filled = Math.max(2, 5 - value);
      return (
        <View style={styles.picDays}>
          {[0, 1, 2, 3, 4].map((i) => (
            <View key={i} style={[styles.picDay, { backgroundColor: i < filled ? hueOf(((i % 6) + 1) as 1).solid : color.paper }]} />
          ))}
        </View>
      );
    }
    case "compact": {
      const gap = (4 - value) * 2 + 2;
      return (
        <View style={[styles.picStack, { gap }]}>
          {[3, 1, 2].map((hue) => (
            <View key={hue} style={[styles.picBar, { backgroundColor: hueOf(hue as 1).solid }]} />
          ))}
        </View>
      );
    }
    case "walking": {
      const length = 44 - value * 7;
      return (
        <View style={styles.picWalk}>
          <View style={[styles.picStop, { backgroundColor: ink }]} />
          <View style={[styles.picPath, { width: length }]} />
          <View style={[styles.picStop, { backgroundColor: color.brand }]} />
        </View>
      );
    }
    case "rating":
      return (
        <Txt style={styles.picStars} accessibilityElementsHidden importantForAccessibility="no">
          <Txt style={{ color: hueOf(4).solid }}>{"★".repeat(value + 1)}</Txt>
          <Txt style={{ color: color.line2 }}>{"★".repeat(4 - value)}</Txt>
        </Txt>
      );
  }
}

function Leanings() {
  const { prefs, setPrefs } = usePlan();
  const [open, setOpen] = useState<LeaningKey | null>(null);
  const openLean = open ? leanings[open] : null;
  return (
    <>
      <View style={styles.cards}>
        {leaningOrder.map((key) => {
          const value = prefs.leanings[key];
          const selected = open === key;
          return (
            <PressScale
              key={key}
              onPress={() => {
                tick();
                setOpen(selected ? null : key);
              }}
              accessibilityState={{ expanded: selected }}
              accessibilityLabel={`${leanings[key].title}, ${leaningText(key, value).value}`}
              outerStyle={[styles.cardSlot, key === "time" && styles.cardWide]}
              style={[styles.card, selected && styles.cardOpen]}
            >
              <View style={[styles.pic, selected && styles.picOpen]}>
                <LeanPicture lean={key} value={value} />
              </View>
              <Txt variant="bodyStrong" style={styles.cardTitle} numberOfLines={2}>
                {leanings[key].title}
              </Txt>
              <Txt variant="meta" tone={selected ? "brand" : "ink2"} numberOfLines={1}>
                {leaningText(key, value).value}
              </Txt>
            </PressScale>
          );
        })}
      </View>
      {open && openLean ? (
        <Animated.View key={open} entering={wellIn} style={styles.well}>
          <View style={styles.wellHead}>
            <Txt variant="bodyStrong">{openLean.title}</Txt>
            <PressScale onPress={() => setOpen(null)} style={styles.wellClose} accessibilityLabel={`Close ${openLean.title}`} hitSlop={8}>
              <CloseGlyph size={12} />
            </PressScale>
          </View>
          <StepSlider
            steps={openLean.max - openLean.min + 1}
            value={prefs.leanings[open] - openLean.min}
            label={openLean.title}
            valueText={leaningText(open, prefs.leanings[open]).value}
            onChange={(step) =>
              setPrefs((current) => ({ ...current, leanings: { ...current.leanings, [open]: step + openLean.min } }))
            }
          />
          <View style={styles.wellEnds}>
            <Txt variant="meta" tone="ink2">
              {openLean.left}
            </Txt>
            <Txt variant="meta" tone="ink2">
              {openLean.right}
            </Txt>
          </View>
          <Txt variant="body" tone="ink2">
            {leaningText(open, prefs.leanings[open]).says}
          </Txt>
        </Animated.View>
      ) : null}
    </>
  );
}

// Reanimated CSS transitions are plain style objects; StyleSheet.create doesn't type them.
const toggleTrack = {
  width: 44,
  height: 26,
  borderRadius: 13,
  padding: 3,
  backgroundColor: color.paper3,
  transitionProperty: "backgroundColor",
  transitionDuration: motion.press,
} as const;
const toggleTrackOn = { backgroundColor: color.brand } as const;
const toggleKnob = {
  width: 20,
  height: 20,
  borderRadius: 10,
  backgroundColor: color.paper,
  boxShadow: "0 1px 2px rgba(20, 40, 22, 0.2)",
  transform: [{ translateX: 0 }],
  transitionProperty: "transform",
  transitionDuration: motion.hover,
  transitionTimingFunction: motion.css.easeOut,
} as const;
const toggleKnobOn = { transform: [{ translateX: 18 }] } as const;

function Toggle({ on, onChange, label }: { on: boolean; onChange: () => void; label: string }) {
  return (
    <Pressable onPress={onChange} accessibilityRole="switch" accessibilityState={{ checked: on }} accessibilityLabel={label} hitSlop={10}>
      <Animated.View style={[toggleTrack, on && toggleTrackOn]}>
        <Animated.View style={[toggleKnob, on && toggleKnobOn]} />
      </Animated.View>
    </Pressable>
  );
}

export default function PreferencesSheet() {
  const insets = useSafeAreaInsets();
  const { prefs, setPrefs, picks, week } = usePlan();
  const summary = busySummary(prefs);
  const start: StartValue = prefs.startAfter === null ? "any" : (String(prefs.startAfter) as StartValue);
  const close = () => (router.canGoBack() ? router.back() : router.replace("/week"));
  const plannedCodes = Object.keys(picks);

  return (
    <View style={styles.sheet}>
      <View style={styles.top}>
        <View style={styles.flex}>
          <Txt variant="h1" accessibilityRole="header">
            Preferences
          </Txt>
          <Txt variant="meta" tone="ink2">
            Auto builds your week around these.
          </Txt>
        </View>
        <PressScale onPress={close} style={styles.close} accessibilityLabel="Close preferences" hitSlop={8}>
          <CloseGlyph />
        </PressScale>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[10] }]}>
        <Section title="Times you can't have class" sub="Auto never puts a class here.">
          <Txt variant="label" tone="ink2" style={styles.fieldLabel}>
            No class before
          </Txt>
          <Segmented
            label="No class before"
            value={start}
            onChange={(value) => setPrefs((current) => ({ ...current, startAfter: value === "any" ? null : Number(value) }))}
            options={START_OPTIONS}
          />
          <Txt variant="meta" tone="ink2" style={styles.hint}>
            Tap an hour to block it. Tap a day to take it off.
          </Txt>
          <PaintedGrid />
          {summary.map((row) => (
            <View key={`${row.label}-${row.start}`} style={styles.busyRow}>
              <View style={[styles.busySwatch, { backgroundColor: hueOf(2).solid }]} />
              <View style={styles.flex}>
                <Txt variant="bodyStrong">{row.label}</Txt>
                <Txt variant="meta" tone="ink2">
                  {daysText(row.days)}, {rangeWithPeriod(row.start, row.end)}
                </Txt>
              </View>
              <PressScale
                onPress={() => {
                  tick();
                  setPrefs((current) => clearBusy(current, row));
                }}
                style={styles.rowButton}
                accessibilityLabel={`Remove ${row.label}, ${daysText(row.days)}`}
              >
                <CloseGlyph size={12} />
              </PressScale>
            </View>
          ))}
        </Section>

        <Section title="What matters" sub="Auto leans toward these when it can. Tap one to change it.">
          <Leanings />
        </Section>

        <Section title="Courses and sections" sub="Settings for specific classes in your plan.">
          <View style={styles.creditRow}>
            <View style={styles.flex}>
              <Txt variant="bodyStrong">At most {creditsText(prefs.maxCredits)}</Txt>
              <Txt variant="meta" tone={week.credits > prefs.maxCredits ? "attention" : "ink2"}>
                Your plan has {week.credits}.
              </Txt>
            </View>
            <View style={styles.stepper}>
              <PressScale
                onPress={() => {
                  tick();
                  setPrefs((current) => ({ ...current, maxCredits: Math.max(3, current.maxCredits - 1) }));
                }}
                style={styles.stepButton}
                accessibilityLabel="One fewer credit"
                disabled={prefs.maxCredits <= 3}
              >
                <PlusGlyph minus tint={color.ink} />
              </PressScale>
              <PressScale
                onPress={() => {
                  tick();
                  setPrefs((current) => ({ ...current, maxCredits: Math.min(21, current.maxCredits + 1) }));
                }}
                style={styles.stepButton}
                accessibilityLabel="One more credit"
                disabled={prefs.maxCredits >= 21}
              >
                <PlusGlyph tint={color.ink} />
              </PressScale>
            </View>
          </View>
          <Txt variant="label" tone="ink2" style={styles.fieldLabel}>
            Keep these sections
          </Txt>
          {plannedCodes.map((code) => {
            const kept = prefs.kept.includes(code);
            const section = sectionsOf(code).find((candidate) => candidate.id === picks[code]);
            return (
              <View key={code} style={styles.keepRow}>
                <View style={[styles.keepIcon, kept && styles.keepIconOn]}>
                  <LockGlyph tint={kept ? color.brand : color.ink3} />
                </View>
                <View style={styles.flex}>
                  <Txt variant="bodyStrong">{code}</Txt>
                  <Txt variant="meta" tone="ink2">
                    {section ? `Section ${sectionNumber(section)}` : "No section yet"}
                  </Txt>
                </View>
                <Toggle
                  on={kept}
                  label={`Keep ${code}'s section`}
                  onChange={() => {
                    land();
                    setPrefs((current) => ({
                      ...current,
                      kept: kept ? current.kept.filter((other) => other !== code) : [...current.kept, code],
                    }));
                  }}
                />
              </View>
            );
          })}
        </Section>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  invisible: { opacity: 0 },
  top: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space[3],
    paddingHorizontal: layout.gutter + 4,
    paddingTop: space[6],
    paddingBottom: space[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: color.line,
  },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  content: { paddingHorizontal: layout.gutter + 4 },
  section: { paddingTop: space[5], paddingBottom: space[5], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line },
  sectionSub: { marginTop: 2, marginBottom: space[3] },
  fieldLabel: { marginBottom: space[2], marginTop: space[1] },
  hint: { marginTop: space[4], marginBottom: space[2] },
  paint: { borderRadius: radius.md, borderWidth: 1, borderColor: color.line, paddingRight: 4, paddingBottom: 6, overflow: "hidden" },
  paintHead: { flexDirection: "row" },
  paintDay: { flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" },
  offWord: { fontSize: 11, lineHeight: 13 },
  paintBody: { flexDirection: "row" },
  paintHour: { position: "absolute", right: 6, fontSize: 11, lineHeight: 16 },
  paintColumn: { flex: 1, borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: color.line },
  paintOff: { backgroundColor: color.paper3 },
  cell: { height: CELL, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  cellEarly: { backgroundColor: color.paper2 },
  paintBlock: { position: "absolute", left: 2, right: 2, borderRadius: 6, flexDirection: "row", overflow: "hidden" },
  paintBar: { width: 3, marginLeft: 3, marginVertical: 3, borderRadius: 2 },
  paintLabel: { fontSize: 11, lineHeight: 14, paddingLeft: 4, paddingTop: 3, fontFamily: font.semibold, flex: 1 },
  busyRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56, marginTop: space[2] },
  busySwatch: { width: 3, height: 32, borderRadius: 2 },
  rowButton: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  cardSlot: { width: "48%", flexGrow: 1 },
  card: {
    flex: 1,
    padding: 8,
    paddingBottom: 10,
    gap: 2,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.paper,
  },
  cardWide: { width: "100%" },
  cardOpen: { borderColor: color.brand2, boxShadow: `0 0 0 1px ${color.brand2}` },
  cardTitle: { marginTop: 6, fontSize: 14, lineHeight: 18 },
  pic: { height: 56, borderRadius: 10, backgroundColor: color.paper2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  picOpen: { backgroundColor: color.brandSoft },
  picTime: { width: "80%", height: 30 },
  picHorizon: { position: "absolute", left: 0, right: 0, bottom: 6, height: 1.5, backgroundColor: color.ink4 },
  picSun: { position: "absolute", top: 4, width: 14, height: 14, borderRadius: 7, backgroundColor: "#d9a43a" },
  picDays: { flexDirection: "row", gap: 3 },
  picDay: { width: 9, height: 26, borderRadius: 2, borderWidth: 1, borderColor: color.line2 },
  picStack: { width: 36 },
  picBar: { height: 7, borderRadius: 2 },
  picWalk: { flexDirection: "row", alignItems: "center" },
  picStop: { width: 9, height: 9, borderRadius: 2 },
  picPath: { height: 0, borderTopWidth: 2, borderStyle: "dashed", borderColor: color.brand, marginHorizontal: 3 },
  picStars: { fontSize: 15, letterSpacing: 1 },
  well: { marginTop: space[3], padding: space[4], borderRadius: radius.md, backgroundColor: color.brandSoft, gap: space[1] },
  wellHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  wellClose: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: color.paper },
  wellEnds: { flexDirection: "row", justifyContent: "space-between", marginTop: -4, marginBottom: space[2] },
  creditRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56, marginBottom: space[3] },
  stepper: { flexDirection: "row", borderRadius: radius.md, backgroundColor: color.paper2, padding: 2 },
  stepButton: { width: 44, height: 40, alignItems: "center", justifyContent: "center" },
  keepRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 56 },
  keepIcon: { width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  keepIconOn: { backgroundColor: color.brandSoft },
});
