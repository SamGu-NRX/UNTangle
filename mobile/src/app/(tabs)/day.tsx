import { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useScheduleView } from "@/schedule/use-schedule-view";
import { clockText, toMinutes } from "@/lib/plan-library/week";
import { classDays, type ClassDay, type ScheduleEvent } from "@/lib/types";

function DayEventRow({ event }: { event: ScheduleEvent }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardCode}>
        {event.courseCode} {event.sectionLabel}
      </Text>
      <Text style={styles.cardTitle}>{event.title}</Text>
      <Text style={styles.cardLine}>
        {clockText(toMinutes(event.start))}-{clockText(toMinutes(event.end))} - {event.location}
      </Text>
      <Text style={styles.cardMeta}>
        {event.buildingName} - {event.professor}
      </Text>
    </View>
  );
}

export default function DayScreen() {
  const view = useScheduleView();
  const [day, setDay] = useState<ClassDay>("Mon");

  if (view.status === "loading") {
    return (
      <View style={[styles.screen, styles.center]}>
        <ActivityIndicator color="#00853e" />
      </View>
    );
  }
  if (view.status === "error") {
    return (
      <View style={[styles.screen, styles.center]}>
        <Text style={styles.errorText}>{view.message}</Text>
      </View>
    );
  }

  const dayEvents = view.events
    .filter((event) => event.day === day)
    .sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {view.labeledSample ? (
        <View style={styles.sampleBanner}>
          <Text style={styles.sampleText}>
            Sample schedule{view.source === "sample" ? "" : " (some sections)"}
            {view.note ? ` - ${view.note}` : ""}
          </Text>
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.picker}>
        {classDays.map((candidate) => (
          <Pressable
            key={candidate}
            onPress={() => setDay(candidate)}
            style={[styles.pill, candidate === day && styles.pillActive]}
          >
            <Text style={[styles.pillText, candidate === day && styles.pillTextActive]}>{candidate}</Text>
          </Pressable>
        ))}
      </ScrollView>

      {dayEvents.length ? (
        dayEvents.map((event, index) => <DayEventRow key={`${event.sectionId}-${index}`} event={event} />)
      ) : (
        <Text style={styles.emptyText}>No classes on {day}.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f4" },
  content: { padding: 16, paddingBottom: 32 },
  center: { alignItems: "center", justifyContent: "center" },
  sampleBanner: { backgroundColor: "#fdf6e3", borderColor: "#e3c567", borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 12 },
  sampleText: { color: "#6b5410", fontSize: 13 },
  picker: { flexDirection: "row", gap: 8, marginBottom: 12 },
  pill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#d8ded9",
    backgroundColor: "#ffffff",
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  pillActive: { backgroundColor: "#00853e", borderColor: "#00853e" },
  pillText: { color: "#1a2420", fontSize: 13 },
  pillTextActive: { color: "#ffffff", fontWeight: "600" },
  card: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    padding: 14,
    marginBottom: 8,
  },
  cardCode: { fontSize: 15, fontWeight: "700", color: "#1a2420" },
  cardTitle: { fontSize: 14, color: "#1a2420", marginTop: 2 },
  cardLine: { fontSize: 13, color: "#3d4742", marginTop: 4 },
  cardMeta: { fontSize: 12, color: "#5b6660", marginTop: 2 },
  errorText: { color: "#a3300f" },
  emptyText: { color: "#5b6660" },
});
