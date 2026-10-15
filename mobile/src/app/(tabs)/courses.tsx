import { router } from "expo-router";
import { Children, Fragment, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";

import { courses } from "@/lib/seed-data";
import type { Course } from "@/lib/types";
import {
  courseGroups,
  courseState,
  creditsText,
  currentTermLabel,
  planningTermLabel,
  type CourseState,
} from "@/plan/guest-plan";
import { usePlan } from "@/plan/plan-store";
import { color, hueOf, layout, radius, shadow, space } from "@/theme/tokens";
import { ViewHead } from "@/ui/chrome";
import { Chevron, PlusGlyph, StatusGlyph, type GlyphStatus } from "@/ui/glyphs";
import { drop, land, refuse } from "@/ui/haptics";
import { PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";

/** How many "You can take" rows show before "Show all". */
const FIRST_ROWS = 6;

function openCourse(code: string) {
  router.push({ pathname: "/course/[code]", params: { code } });
}

function glyphFor(state: CourseState): GlyphStatus {
  return state.kind;
}

/** One fact under the title: the grade, the term, or what it needs. */
function metaFor(state: CourseState, course: Course): string {
  switch (state.kind) {
    case "done":
      return `Grade ${state.grade}`;
    case "taking":
      return currentTermLabel;
    case "planned":
      return planningTermLabel;
    case "locked":
      return `Needs ${state.needs}`;
    case "available":
      return creditsText(course.creditHours);
  }
}

function CourseRow({ course, state, onAdd }: { course: Course; state: CourseState; onAdd?: () => void }) {
  return (
    <View style={styles.row}>
      <PressScale
        outerStyle={styles.flex}
        style={styles.rowMain}
        onPress={() => openCourse(course.code)}
        accessibilityLabel={`${course.code}, ${course.title}`}
      >
        <View style={styles.glyphCell}>
          <StatusGlyph status={glyphFor(state)} />
        </View>
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Txt variant="code">{course.code}</Txt>
            <Txt variant="body" tone={state.kind === "locked" ? "ink2" : "ink"} numberOfLines={1} style={styles.rowTitle}>
              {course.title.replace(/\s+\(.*$/, "")}
            </Txt>
          </View>
          <Txt variant="meta" tone="ink2" numberOfLines={1}>
            {metaFor(state, course)}
          </Txt>
        </View>
      </PressScale>
      {onAdd ? (
        <PressScale onPress={onAdd} style={styles.addButton} accessibilityLabel={`Add ${course.code}`} hitSlop={6}>
          <PlusGlyph />
        </PressScale>
      ) : null}
    </View>
  );
}

function Group({
  title,
  count,
  children,
  collapsible,
  initiallyOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  collapsible?: boolean;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  if (count === 0) return null;
  const head = (
    <View style={styles.groupHead}>
      <Txt variant="bodyStrong">{title}</Txt>
      {collapsible ? (
        <View style={styles.groupHeadRight}>
          {/* A count only on a closed group: an open one already shows its rows. */}
          {!open ? (
            <Txt variant="meta" tone="ink2">
              {count}
            </Txt>
          ) : null}
          <Chevron open={open} />
        </View>
      ) : null}
    </View>
  );
  return (
    <View style={styles.group}>
      {collapsible ? (
        <PressScale
          onPress={() => setOpen((value) => !value)}
          accessibilityLabel={title}
          accessibilityState={{ expanded: open }}
        >
          {head}
        </PressScale>
      ) : (
        head
      )}
      {open ? (
        <View style={styles.groupBody}>
          {Children.toArray(children).map((child, index) => (
            <Fragment key={index}>
              {index > 0 ? <View style={styles.separator} /> : null}
              {child}
            </Fragment>
          ))}
        </View>
      ) : null}
    </View>
  );
}

type Notice = { text: string; undo?: () => void; tone: "ink" | "attention" };

export default function CoursesScreen() {
  const { record, planned, picks, week, add, remove } = usePlan();
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const scroll = useRef<ScrollView>(null);

  const groups = useMemo(() => courseGroups(record, planned), [record, planned]);
  const needle = query.trim().toLowerCase();
  const results = useMemo(
    () =>
      needle
        ? courses
            .filter((course) => course.code.toLowerCase().includes(needle) || course.title.toLowerCase().includes(needle))
            .slice(0, 40)
        : [],
    [needle],
  );

  const addCourse = (code: string) => {
    if (add(code)) {
      land();
      setNotice({ text: `Added ${code}`, undo: () => remove(code), tone: "ink" });
    } else {
      refuse();
      setNotice({ text: `Every ${code} section clashes with your week.`, tone: "attention" });
    }
  };
  const removeCourse = (code: string) => {
    const section = picks[code];
    remove(code);
    drop();
    setNotice({ text: `Removed ${code}`, undo: () => add(code, section), tone: "ink" });
  };

  const plannedCodes = Object.keys(picks);
  const canTake = showAll ? groups.canTake : groups.canTake.slice(0, FIRST_ROWS);

  return (
    <ScrollView
      ref={scroll}
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
    >
      <ViewHead title={planningTermLabel} meta="Computer Science" tag="Sample student" />

      <View style={styles.searchWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search courses"
          placeholderTextColor={color.ink3}
          style={styles.search}
          autoCapitalize="characters"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          accessibilityLabel="Search courses"
        />
      </View>

      {needle ? (
        <View style={styles.group}>
          {results.length ? (
            results.map((course) => {
              const state = courseState(course.code, record, planned);
              return (
                <CourseRow
                  key={course.code}
                  course={course}
                  state={state}
                  onAdd={state.kind === "available" ? () => addCourse(course.code) : undefined}
                />
              );
            })
          ) : (
            <Txt variant="body" tone="ink2" style={styles.noResults}>
              No course matches “{query.trim()}”. Try a code like CSCE 2110.
            </Txt>
          )}
        </View>
      ) : (
        <>
          <View style={styles.tray}>
            <View style={styles.trayHead}>
              <Txt variant="title">{planningTermLabel}</Txt>
              <Txt variant="meta" tone="ink2">
                {creditsText(week.credits)}
              </Txt>
            </View>
            {plannedCodes.length ? (
              plannedCodes.map((code) => {
                const course = courses.find((candidate) => candidate.code === code);
                const hue = hueOf(week.colors.get(code));
                return (
                  <View key={code} style={styles.trayRow}>
                    <View style={[styles.trayBar, { backgroundColor: hue.solid }]} />
                    <PressScale outerStyle={styles.flex} style={styles.trayMain} onPress={() => openCourse(code)} accessibilityLabel={`${code}, ${course?.title ?? ""}`}>
                      <Txt variant="code">{code}</Txt>
                      <Txt variant="meta" tone="ink2" numberOfLines={1}>
                        {course?.title.replace(/\s+\(.*$/, "")}
                      </Txt>
                    </PressScale>
                    <PressScale onPress={() => removeCourse(code)} style={styles.removeButton} accessibilityLabel={`Remove ${code}`} hitSlop={6}>
                      <PlusGlyph minus tint={color.ink2} />
                    </PressScale>
                  </View>
                );
              })
            ) : (
              <Txt variant="body" tone="ink2" style={styles.trayEmpty}>
                Add a course to plan {planningTermLabel}.
              </Txt>
            )}
            {notice ? (
              <View style={styles.notice}>
                <Txt variant="meta" tone={notice.tone} style={styles.noticeText}>
                  {notice.text}
                </Txt>
                {notice.undo ? (
                  <PressScale
                    onPress={() => {
                      notice.undo?.();
                      setNotice(null);
                    }}
                    accessibilityLabel="Undo"
                    style={styles.undo}
                  >
                    <Txt variant="meta" tone="brand" style={styles.linkText}>
                      Undo
                    </Txt>
                  </PressScale>
                ) : null}
              </View>
            ) : null}
            {plannedCodes.length ? (
              <PressScale onPress={() => router.navigate("/week")} accessibilityRole="link" style={styles.openWeek}>
                <Txt variant="meta" tone="brand" style={styles.linkText}>
                  Open in Week
                </Txt>
              </PressScale>
            ) : null}
          </View>

          <Group title="You can take" count={groups.canTake.length}>
            {canTake.map((course) => (
              <CourseRow key={course.code} course={course} state={{ kind: "available" }} onAdd={() => addCourse(course.code)} />
            ))}
            {groups.canTake.length > FIRST_ROWS ? (
              <PressScale onPress={() => setShowAll((value) => !value)} style={styles.showAll}>
                <Txt variant="meta" tone="brand" style={styles.linkText}>
                  {showAll ? "Show fewer" : `Show all ${groups.canTake.length}`}
                </Txt>
              </PressScale>
            ) : null}
          </Group>
          <Group title="Taking now" count={groups.taking.length}>
            {groups.taking.map((course) => (
              <CourseRow key={course.code} course={course} state={{ kind: "taking" }} />
            ))}
          </Group>
          <Group title="Later" count={groups.later.length} collapsible initiallyOpen={false}>
            {groups.later.map(({ course, needs }) => (
              <CourseRow key={course.code} course={course} state={{ kind: "locked", needs }} />
            ))}
          </Group>
          <Group title="Done" count={groups.done.length} collapsible initiallyOpen={false}>
            {groups.done.map(({ course, grade }) => (
              <CourseRow key={course.code} course={course} state={{ kind: "done", grade }} />
            ))}
          </Group>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.ground },
  flex: { flex: 1 },
  content: { paddingBottom: space[10] },
  searchWrap: { paddingHorizontal: layout.gutter, paddingBottom: space[3] },
  search: {
    height: layout.target,
    borderRadius: radius.md,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 14,
    fontFamily: "DMSans_400Regular",
    fontSize: 16,
    color: color.ink,
  },
  tray: {
    marginHorizontal: layout.gutter,
    marginBottom: space[5],
    padding: space[4],
    paddingBottom: space[2],
    borderRadius: radius.lg,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow[1],
  },
  trayHead: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: space[2] },
  trayRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 52,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: color.line,
  },
  // The bar sits in its own column with a gap, so the code never touches it.
  trayBar: { width: 3, alignSelf: "stretch", marginVertical: 10, borderRadius: 2, marginRight: space[3] },
  trayMain: { paddingVertical: 6 },
  trayEmpty: { paddingVertical: space[3] },
  removeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.paper2,
  },
  notice: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: space[3],
    marginTop: space[1],
    paddingVertical: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    backgroundColor: color.paper2,
  },
  noticeText: { flex: 1 },
  undo: { minHeight: 32, justifyContent: "center", paddingHorizontal: 4 },
  openWeek: { alignSelf: "flex-start", minHeight: 44, justifyContent: "center" },
  linkText: { fontFamily: "DMSans_600SemiBold" },
  group: { marginBottom: space[4] },
  groupHead: {
    minHeight: 44,
    paddingHorizontal: layout.gutter,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  groupHeadRight: { flexDirection: "row", alignItems: "center", gap: space[2] },
  groupBody: {
    marginHorizontal: layout.gutter,
    borderRadius: radius.lg,
    backgroundColor: color.paper,
    borderWidth: 1,
    borderColor: color.line,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 58,
    paddingRight: space[3],
  },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: color.line, marginLeft: space[3] + 18 + space[3] },
  rowMain: { flexDirection: "row", alignItems: "center", paddingVertical: 9, paddingLeft: space[3] },
  glyphCell: { width: 18, marginRight: space[3] },
  rowText: { flex: 1, gap: 1 },
  rowTitleLine: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  rowTitle: { flex: 1 },
  addButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.brandSoft,
  },
  showAll: { minHeight: 44, justifyContent: "center", paddingHorizontal: space[4] },
  noResults: { paddingHorizontal: layout.gutter, paddingVertical: space[4] },
});
