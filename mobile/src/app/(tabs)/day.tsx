import { router, useLocalSearchParams } from "expo-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { clockText } from "@/lib/plan-library/week";
import type { ClassDay } from "@/lib/types";
import { dayPlan, rangeText, sampleStart, type DayPlan, type Leg, type Stop } from "@/plan/day-plan";
import { planningTermLabel } from "@/plan/guest-plan";
import { usePlan } from "@/plan/plan-store";
import { gridDays } from "@/plan/preferences";
import { color, font, hueOf, layout, radius, space, type as typeScale } from "@/theme/tokens";
import { EmptyState, ProvenanceTag, Segmented } from "@/ui/chrome";
import { Button, PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";

const DAY_NAMES: Record<string, string> = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday" };
const JS_DAYS: ClassDay[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isGridDay(value: unknown): value is ClassDay {
  return typeof value === "string" && (gridDays as readonly string[]).includes(value);
}

/**
 * The hero answers "when do I leave". Spring 2027 hasn't started, so every
 * day is answered as a day other than today (DESIGN.md §4.4, "On Wednesday,
 * leave Kerr Hall by 8:49"): no "in 12 min" until the term is live.
 */
function Hero({ plan }: { plan: DayPlan }) {
  const name = DAY_NAMES[plan.day];
  const hero = plan.hero;
  if (hero.kind === "no-classes") {
    return (
      <View style={styles.hero}>
        <Txt variant="title">No classes {name}</Txt>
      </View>
    );
  }
  if (hero.kind === "leave" || hero.kind === "next-class" || hero.kind === "overlap") {
    const stop = plan.stops[hero.index];
    const code = stop.event.courseCode;
    if (hero.kind === "overlap") {
      return (
        <View style={styles.hero}>
          <Txt variant="title" tone="danger">
            {plan.stops[hero.index - 1]?.event.courseCode} and {code} overlap on {name}.
          </Txt>
        </View>
      );
    }
    const leaving = hero.kind === "leave";
    return (
      <View style={styles.hero} accessibilityRole="summary">
        <Txt variant="body" tone="ink2">
          {leaving ? `On ${name}, leave ${stop.leg.from.name} by` : `On ${name}, your first class starts at`}
        </Txt>
        <Txt style={styles.numeral} tone="brand">
          {clockText(leaving ? hero.leave : stop.start)}
        </Txt>
        <Txt variant="body" tone="ink2">
          {code} starts at {clockText(stop.start)} in {stop.place.code}
        </Txt>
        {leaving && hero.tight ? (
          <Txt variant="meta" tone="attention" style={styles.strong}>
            Right as class ends
          </Txt>
        ) : null}
      </View>
    );
  }
  return null;
}

function legLine(leg: Leg): { text: string; tone: "ink2" | "attention" | "danger" } {
  if (leg.minutes === null) return { text: "No walking time for this route", tone: "ink2" };
  if (leg.fit === "late" && leg.breakMinutes !== null) {
    return { text: `The walk is ${leg.minutes - leg.breakMinutes} min longer than the break`, tone: "danger" };
  }
  if (leg.fit === "tight") return { text: "Leave right as class ends", tone: "attention" };
  if (leg.leaveBy !== null) return { text: `Leave by ${clockText(leg.leaveBy)}`, tone: "ink2" };
  return { text: "Same building", tone: "ink2" };
}

function LegRow({ leg }: { leg: Leg }) {
  const line = legLine(leg);
  const tight = line.tone !== "ink2";
  const walked = leg.minutes !== null && leg.minutes > 0;
  return (
    <View style={styles.legRow}>
      <View style={styles.rail}>
        <View style={[styles.ribbon, !walked && styles.ribbonQuiet, tight && { backgroundColor: color.danger }]} />
      </View>
      <View style={styles.legText}>
        {walked ? (
          <Txt variant="bodyStrong" tone={tight ? line.tone : "ink"}>
            {leg.shuttle ? `${leg.minutes} min shuttle` : `${leg.minutes} min walk`}
          </Txt>
        ) : null}
        <Txt variant="meta" tone={line.tone} style={tight ? styles.strong : undefined}>
          {line.text}
        </Txt>
      </View>
    </View>
  );
}

function StopRow({ stop, number, hue }: { stop: Stop; number: number; hue: string }) {
  const room = stop.event.location.replace(stop.place.name, "").trim();
  return (
    <PressScale
      onPress={() => router.push({ pathname: "/course/[code]", params: { code: stop.event.courseCode } })}
      accessibilityLabel={`${stop.event.courseCode}, ${rangeText(stop.start, stop.end)}, ${stop.place.name}`}
      style={styles.stopRow}
    >
      <View style={styles.rail}>
        <View style={styles.badge}>
          <Txt style={styles.badgeText} tone="white">
            {number}
          </Txt>
        </View>
      </View>
      <View style={styles.stopCard}>
        <View style={[styles.stopBar, { backgroundColor: hue }]} />
        <View style={styles.stopText}>
          <View style={styles.stopTitle}>
            <Txt variant="code">{stop.event.courseCode}</Txt>
            <Txt variant="body" numberOfLines={1} style={styles.flex}>
              {stop.event.title.replace(/\s+\(.*$/, "")}
            </Txt>
          </View>
          <Txt variant="meta" tone="ink2">
            {rangeText(stop.start, stop.end)}
          </Txt>
          <Txt variant="meta" tone="ink2" numberOfLines={1}>
            {room ? `${stop.place.name}, room ${room}` : stop.place.name}
          </Txt>
        </View>
      </View>
    </PressScale>
  );
}

export default function DayScreen() {
  const { week } = usePlan();
  const { d } = useLocalSearchParams<{ d?: string }>();
  const classDays = useMemo(() => new Set(week.events.map((event) => event.day)), [week.events]);
  const firstDay = useMemo(() => {
    const today = JS_DAYS[new Date().getDay()];
    if (isGridDay(today) && classDays.has(today)) return today;
    return gridDays.find((day) => classDays.has(day)) ?? "Mon";
  }, [classDays]);
  const [day, setDay] = useState<ClassDay>(isGridDay(d) ? d : firstDay);
  // Week's day headers open Day on that day.
  useEffect(() => {
    if (isGridDay(d)) setDay(d);
  }, [d]);

  const plan = useMemo(() => dayPlan(week.events, day, sampleStart, null), [week.events, day]);
  const walking = plan.stops.reduce((sum, stop) => sum + (stop.leg.shuttle ? 0 : (stop.leg.minutes ?? 0)), 0);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.switcher}>
        <Segmented
          label="Day of the week"
          value={day}
          onChange={setDay}
          marks={classDays as ReadonlySet<ClassDay>}
          options={gridDays.map((value) => ({ value, label: value, a11y: DAY_NAMES[value] }))}
        />
      </View>

      <Hero plan={plan} />

      {plan.stops.length ? (
        <>
          <View style={styles.summary}>
            <Txt variant="meta" tone="ink2">
              {walking} min walking
            </Txt>
            <ProvenanceTag label="Sample sections" />
          </View>
          <View style={styles.itinerary}>
            <View style={styles.startRow}>
              <View style={styles.rail}>
                <View style={styles.startDot} />
              </View>
              <Txt variant="bodyStrong">{sampleStart.name}</Txt>
            </View>
            {plan.stops.map((stop, index) => (
              <Fragment key={`${stop.event.courseCode}-${stop.start}`}>
                <LegRow leg={stop.leg} />
                <StopRow stop={stop} number={index + 1} hue={hueOf(week.colors.get(stop.event.courseCode)).solid} />
              </Fragment>
            ))}
          </View>
        </>
      ) : (
        <EmptyState
          title={`Nothing to walk to on ${DAY_NAMES[day]}.`}
          body={`Your ${planningTermLabel} classes meet on other days.`}
          action={<Button kind="secondary" label="Open Week" onPress={() => router.navigate("/week")} />}
        />
      )}
    </ScrollView>
  );
}

const RAIL = 28;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  content: { paddingBottom: space[10] },
  flex: { flex: 1 },
  switcher: { paddingHorizontal: layout.gutter, paddingTop: space[4] },
  hero: {
    marginHorizontal: layout.gutter,
    marginTop: space[4],
    padding: space[5],
    borderRadius: radius.lg,
    backgroundColor: color.brandSoft,
    gap: 2,
  },
  numeral: { ...typeScale.numeral, marginVertical: 2 },
  strong: { fontFamily: font.semibold },
  summary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: layout.gutter,
    paddingTop: space[5],
    paddingBottom: space[2],
  },
  itinerary: { paddingHorizontal: layout.gutter },
  rail: { width: RAIL, alignItems: "center", alignSelf: "stretch" },
  startRow: { flexDirection: "row", alignItems: "center", minHeight: 36, gap: space[3] },
  startDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2.5, borderColor: color.brand, backgroundColor: color.paper, marginTop: 12 },
  legRow: { flexDirection: "row", gap: space[3], minHeight: 52 },
  ribbon: { width: 2, flex: 1, borderRadius: 1, backgroundColor: color.brand },
  ribbonQuiet: { backgroundColor: color.line2 },
  legText: { flex: 1, justifyContent: "center", paddingVertical: space[2] },
  stopRow: { flexDirection: "row", gap: space[3] },
  badge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginTop: 14,
    backgroundColor: color.brand,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { fontFamily: font.bold, fontSize: 12, lineHeight: 16 },
  stopCard: {
    flex: 1,
    flexDirection: "row",
    borderRadius: radius.md,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
  },
  stopBar: { width: 3, marginLeft: 6, marginVertical: 10, borderRadius: 2 },
  stopText: { flex: 1, paddingVertical: 10, paddingLeft: space[3], paddingRight: space[3], gap: 1 },
  stopTitle: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
});
