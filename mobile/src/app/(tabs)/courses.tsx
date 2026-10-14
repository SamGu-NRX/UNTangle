import { useRef, useState } from "react";
import { ActivityIndicator, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { fetchCourseSections } from "@/data/sections";
import { clockText } from "@/lib/plan-library/week";
import { planningTerm } from "@/lib/planner-sections";
import { courses } from "@/lib/seed-data";
import type { CourseSections, Meeting, Section } from "@/lib/sections/model";
import type { Course } from "@/lib/types";

type DetailState =
  | { code: string; status: "loading" }
  | { code: string; status: "error"; message: string }
  | { code: string; status: "ready"; result: CourseSections };

function availabilityLabel(result: CourseSections): string {
  switch (result.status) {
    case "ok":
      return "Live section data";
    case "stale":
      return "Live section data (cached)";
    case "unavailable":
      return result.availability === "sample" ? "Sample data" : "No section data";
  }
}

function meetingLine(meeting: Meeting): string | null {
  if (meeting.day === null || meeting.startMinutes === null || meeting.endMinutes === null) return null;
  return `${meeting.day} ${clockText(meeting.startMinutes)}-${clockText(meeting.endMinutes)} ${meeting.room}`;
}

function SectionRow({ section }: { section: Section }) {
  const seats =
    section.seats.open === null || section.seats.total === null
      ? "seats unknown"
      : `${section.seats.open} of ${section.seats.total} seats open`;
  const instructor = section.instructor.display ?? section.instructor.raw ?? "Instructor TBA";
  const meetings = section.meetings.map(meetingLine).filter(Boolean) as string[];
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionCode}>
        {section.sectionCode}
        {section.option ? ` (option ${section.option})` : ""}
      </Text>
      <Text style={styles.sectionLine}>
        {instructor} {seats === "" ? "" : `- ${seats}`}
      </Text>
      {meetings.length ? (
        meetings.map((line, index) => (
          <Text key={index} style={styles.sectionMeeting}>
            {line}
          </Text>
        ))
      ) : (
        <Text style={styles.sectionMeeting}>No scheduled meetings</Text>
      )}
    </View>
  );
}

function CourseCard({ course }: { course: Course }) {
  return (
    <View style={styles.card}>
      <Text style={styles.courseCode}>{course.code}</Text>
      <Text style={styles.courseTitle}>{course.title}</Text>
      <Text style={styles.courseMeta}>
        {course.creditHours} credit hours - {course.department}
        {course.planned ? " - in the default plan" : ""}
      </Text>
    </View>
  );
}

export default function CoursesScreen() {
  const [query, setQuery] = useState("");
  const [detail, setDetail] = useState<DetailState | null>(null);
  // Monotonic id per detail request: a slow response for an older course must
  // not overwrite a newer one, and a closed panel must not be reopened by its
  // own in-flight request.
  const detailRequestRef = useRef(0);

  const needle = query.trim().toLowerCase();
  const filtered = needle
    ? courses.filter(
        (course) => course.code.toLowerCase().includes(needle) || course.title.toLowerCase().includes(needle),
      )
    : courses;

  const openCourse = (course: Course) => {
    detailRequestRef.current += 1;
    const requestId = detailRequestRef.current;
    setDetail({ code: course.code, status: "loading" });
    fetchCourseSections(planningTerm.id, course.code, fetch)
      .then((result) => {
        if (detailRequestRef.current !== requestId) return;
        setDetail({ code: course.code, status: "ready", result });
      })
      .catch((error: unknown) => {
        if (detailRequestRef.current !== requestId) return;
        setDetail({
          code: course.code,
          status: "error",
          message: error instanceof Error ? error.message : "Could not load sections.",
        });
      });
  };

  const closeDetail = () => {
    detailRequestRef.current += 1;
    setDetail(null);
  };

  return (
    <View style={styles.screen}>
      {detail ? (
        <ScrollView style={styles.detail} contentContainerStyle={styles.detailContent}>
          <View style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{detail.code}</Text>
            <Pressable onPress={closeDetail} accessibilityLabel="Close course sections">
              <Text style={styles.closeText}>Close</Text>
            </Pressable>
          </View>
          {detail.status === "loading" && <ActivityIndicator color="#00853e" />}
          {detail.status === "error" && (
            <Text style={styles.errorText}>Could not load sections: {detail.message}</Text>
          )}
          {detail.status === "ready" && (
            <View>
              <Text style={styles.provenance}>{availabilityLabel(detail.result)}</Text>
              {detail.result.sections.length ? (
                detail.result.sections.map((section) => <SectionRow key={section.id} section={section} />)
              ) : (
                <Text style={styles.sectionLine}>No sections listed for {planningTerm.label}.</Text>
              )}
            </View>
          )}
        </ScrollView>
      ) : null}

      <TextInput
        style={styles.search}
        placeholder={`Search ${planningTerm.label} courses`}
        value={query}
        onChangeText={setQuery}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <FlatList
        data={filtered}
        keyExtractor={(course) => course.code}
        renderItem={({ item }) => (
          <Pressable onPress={() => openCourse(item)}>
            <CourseCard course={item} />
          </Pressable>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No courses match that search.</Text>}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f4" },
  search: {
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 8,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#d8ded9",
  },
  list: { paddingBottom: 24 },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginVertical: 6,
    padding: 14,
  },
  courseCode: { fontSize: 16, fontWeight: "700", color: "#1a2420" },
  courseTitle: { fontSize: 15, color: "#1a2420", marginTop: 2 },
  courseMeta: { fontSize: 12, color: "#5b6660", marginTop: 4 },
  detail: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 12,
    // Bounded so a long section list scrolls inside the panel instead of
    // pushing the search and catalog off screen.
    maxHeight: "55%",
    padding: 14,
  },
  detailContent: { padding: 0 },
  detailHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  detailTitle: { fontSize: 16, fontWeight: "700", color: "#1a2420" },
  closeText: { color: "#00853e", fontWeight: "600" },
  provenance: { fontSize: 12, color: "#5b6660", marginTop: 2, marginBottom: 8 },
  sectionRow: { marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#e2e7e3", paddingTop: 8 },
  sectionCode: { fontSize: 14, fontWeight: "600", color: "#1a2420" },
  sectionLine: { fontSize: 13, color: "#3d4742", marginTop: 2 },
  sectionMeeting: { fontSize: 13, color: "#5b6660", marginTop: 2 },
  errorText: { color: "#a3300f", marginTop: 8 },
  emptyText: { color: "#5b6660", textAlign: "center", marginTop: 24 },
});
