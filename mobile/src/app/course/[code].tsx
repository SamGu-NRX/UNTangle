import { router, useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { courses } from "@/lib/seed-data";
import type { Section } from "@/lib/sections/model";
import {
  conflictsWith,
  courseByCode,
  courseState,
  creditsText,
  currentTermLabel,
  planningTermLabel,
  sectionNumber,
  sectionsOf,
  sectionTimes,
  type CourseState,
} from "@/plan/guest-plan";
import { usePlan } from "@/plan/plan-store";
import { color, font, layout, radius, space } from "@/theme/tokens";
import { EmptyState, ProvenanceTag } from "@/ui/chrome";
import { CloseGlyph, PlusGlyph, StatusGlyph } from "@/ui/glyphs";
import { drop, land, refuse } from "@/ui/haptics";
import { Button, PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";

const WORD: Record<CourseState["kind"], string> = {
  done: "Done",
  taking: "Taking",
  planned: "Planned",
  available: "You can take this",
  locked: "Locked",
};

/** Courses in this catalog that list `code` as a prerequisite: what passing it opens. */
function unlocksOf(code: string): string[] {
  return courses
    .filter((course) => course.prerequisites.includes(code))
    .map((course) => course.code)
    .slice(0, 6);
}

function CodeChip({ code, state }: { code: string; state: CourseState }) {
  const missing = state.kind === "locked" || state.kind === "available";
  return (
    <PressScale
      onPress={() => router.setParams({ code })}
      accessibilityLabel={`Open ${code}`}
      style={[styles.chip, missing && styles.chipMissing]}
    >
      <StatusGlyph status={state.kind} size={14} />
      <Txt variant="meta" tone={missing ? "attention" : "ink"} style={styles.chipText}>
        {code}
      </Txt>
    </PressScale>
  );
}

function SectionRow({ section, code }: { section: Section; code: string }) {
  const { picks, add, remove } = usePlan();
  const times = sectionTimes(section);
  const picked = picks[code] === section.id;
  const clashes = conflictsWith(section, picks, code);
  const number = sectionNumber(section);
  const instructor = section.instructor.display ?? section.instructor.raw;
  const choose = () => {
    if (clashes.length) return refuse();
    add(code, section.id);
    land();
  };
  return (
    <View style={styles.sectionRow}>
      <View style={styles.flex}>
        <Txt variant="bodyStrong">Section {number}</Txt>
        {times ? (
          <Txt variant="meta" tone="ink2">
            {times.days} {times.time}
          </Txt>
        ) : (
          <Txt variant="meta" tone="ink2">
            No set time
          </Txt>
        )}
        {clashes.length ? (
          <Txt variant="meta" tone="danger" style={styles.strong}>
            Clashes with {clashes.join(" and ")}
          </Txt>
        ) : instructor ? (
          <Txt variant="meta" tone="ink2" numberOfLines={1}>
            {instructor}
          </Txt>
        ) : null}
      </View>
      {picked ? (
        <PressScale
          onPress={() => {
            remove(code);
            drop();
          }}
          style={[styles.sectionAction, styles.sectionPicked]}
          accessibilityLabel={`Remove section ${number} of ${code}`}
        >
          <Txt variant="meta" tone="white" style={styles.strong}>
            Added
          </Txt>
        </PressScale>
      ) : (
        <PressScale
          onPress={choose}
          disabled={clashes.length > 0}
          style={[styles.sectionAction, clashes.length > 0 && styles.sectionBlocked]}
          accessibilityLabel={clashes.length ? `Section ${number} clashes with ${clashes.join(" and ")}` : `Add section ${number} of ${code}`}
        >
          <PlusGlyph tint={clashes.length ? color.danger : color.brand} />
        </PressScale>
      )}
    </View>
  );
}

export default function CourseSheet() {
  const { code: raw } = useLocalSearchParams<{ code: string }>();
  const code = typeof raw === "string" ? raw : "";
  const insets = useSafeAreaInsets();
  const { record, planned, picks, add, remove } = usePlan();
  const [more, setMore] = useState(false);
  const course = courseByCode(code);
  const state = courseState(code, record, planned);
  const sections = useMemo(() => sectionsOf(code), [code]);
  const unlocks = useMemo(() => unlocksOf(code), [code]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/courses"));

  if (!course) {
    return (
      <View style={styles.sheet}>
        <EmptyState
          title={code ? `${code} isn't in the UNT catalog UNTangle has.` : "That course link is empty."}
          action={<Button kind="secondary" label="Search courses" onPress={() => router.replace("/courses")} />}
        />
      </View>
    );
  }

  const prerequisites = course.prerequisites.filter((pre) => courseByCode(pre));
  const inPlan = picks[code] !== undefined;
  const fits = sections.some((section) => conflictsWith(section, picks, code).length === 0);
  const addCourse = () => {
    if (add(code)) land();
    else refuse();
  };

  return (
    <ScrollView style={styles.sheet} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space[8] }]}>
      <View style={styles.head}>
        <View style={styles.flex}>
          <Txt style={styles.code} tone="brand">
            {code}
          </Txt>
          <Txt variant="title" style={styles.title}>
            {course.title.replace(/\s+\(.*$/, "")}
          </Txt>
        </View>
        <PressScale onPress={close} style={styles.close} accessibilityLabel={`Close ${code}`} hitSlop={8}>
          <CloseGlyph />
        </PressScale>
      </View>
      <View style={styles.statusLine}>
        <StatusGlyph status={state.kind} size={16} />
        <Txt variant="meta" tone="ink2">
          {state.kind === "done"
            ? `Done, grade ${state.grade}`
            : state.kind === "taking"
              ? `Taking in ${currentTermLabel}`
              : state.kind === "locked"
                ? `Needs ${state.needs}`
                : WORD[state.kind]}
        </Txt>
        <Txt variant="meta" tone="ink2" style={styles.credits}>
          {creditsText(course.creditHours)}
        </Txt>
      </View>

      <View style={styles.block}>
        {inPlan ? (
          <Button
            kind="secondary"
            label={`Remove from ${planningTermLabel}`}
            onPress={() => {
              remove(code);
              drop();
            }}
            full
          />
        ) : state.kind === "available" ? (
          <Button label={`Add to ${planningTermLabel}`} onPress={addCourse} disabled={!fits} full />
        ) : null}
        {state.kind === "available" && !inPlan && !fits ? (
          <Txt variant="meta" tone="danger" style={styles.below}>
            Every section clashes with your week. Remove a course or pick a section below.
          </Txt>
        ) : null}
      </View>

      {prerequisites.length ? (
        <View style={styles.block}>
          <Txt variant="label" tone="ink2">
            Needs one of
          </Txt>
          <View style={styles.chips}>
            {prerequisites.map((pre) => (
              <CodeChip key={pre} code={pre} state={courseState(pre, record, planned)} />
            ))}
          </View>
        </View>
      ) : null}
      {unlocks.length ? (
        <View style={styles.block}>
          <Txt variant="label" tone="ink2">
            Opens
          </Txt>
          <View style={styles.chips}>
            {unlocks.map((next) => (
              <CodeChip key={next} code={next} state={courseState(next, record, planned)} />
            ))}
          </View>
        </View>
      ) : null}

      {course.description ? (
        <View style={styles.block}>
          <Txt variant="body" tone="ink2" numberOfLines={more ? undefined : 3}>
            {course.description}
          </Txt>
          <PressScale onPress={() => setMore((value) => !value)} style={styles.more} accessibilityLabel={more ? "Show less" : "Show the whole description"}>
            <Txt variant="meta" tone="brand" style={styles.strong}>
              {more ? "Less" : "More"}
            </Txt>
          </PressScale>
        </View>
      ) : null}

      <View style={styles.block}>
        <View style={styles.sectionsHead}>
          <Txt variant="bodyStrong">Sections in {planningTermLabel}</Txt>
          <ProvenanceTag label="Sample" />
        </View>
        {sections.length ? (
          <View style={styles.sectionList}>
            {sections.map((section, index) => (
              <View key={section.id}>
                {index > 0 ? <View style={styles.separator} /> : null}
                <SectionRow section={section} code={code} />
              </View>
            ))}
          </View>
        ) : (
          <Txt variant="body" tone="ink2">
            No sections listed for {planningTermLabel} yet.
          </Txt>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.paper },
  content: { paddingHorizontal: layout.gutter + 4, paddingTop: space[6] },
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  code: { fontFamily: font.bold, fontSize: 22, lineHeight: 28 },
  title: { marginTop: 2 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  statusLine: { flexDirection: "row", alignItems: "center", gap: space[2], marginTop: space[2] },
  credits: { marginLeft: "auto" },
  block: { marginTop: space[5], gap: space[2] },
  below: { marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: color.paper2,
  },
  chipMissing: { backgroundColor: color.attentionSoft },
  chipText: { fontFamily: font.semibold },
  more: { alignSelf: "flex-start", minHeight: 36, justifyContent: "center" },
  strong: { fontFamily: font.semibold },
  sectionsHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[2] },
  sectionList: { borderRadius: radius.md, borderWidth: 1, borderColor: color.line, overflow: "hidden" },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginLeft: space[3] },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: 10, paddingHorizontal: space[3], minHeight: 64 },
  sectionAction: {
    minWidth: 44,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.brandSoft,
  },
  sectionPicked: { backgroundColor: color.brand },
  sectionBlocked: { backgroundColor: color.paper, borderWidth: 1.5, borderColor: color.danger },
});
