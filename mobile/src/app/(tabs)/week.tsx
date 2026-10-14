import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from "react-native";
import { useScheduleView } from "@/schedule/use-schedule-view";
import { clockText, gridDays, type WeekBlock } from "@/lib/plan-library/week";
import type { Hue } from "@/lib/course-colors";
import { hueColor } from "@/ui/hue";

function statsLine(stats: { days: number; first: number | null; last: number | null }): string | null {
  if (stats.days === 0 || stats.first === null || stats.last === null) return null;
  return `${stats.days} days - classes from ${clockText(stats.first)} to ${clockText(stats.last)}`;
}

function DaySection({ label, blocks, colors }: { label: string; blocks: WeekBlock[]; colors: Map<string, Hue> }) {
  return (
    <View style={styles.daySection}>
      <Text style={styles.dayLabel}>{label}</Text>
      {blocks.map((block) => {
        const hue = hueColor(colors.get(block.code));
        return (
          <View key={block.key} style={[styles.block, { backgroundColor: hue.tint, borderLeftColor: hue.solid }]}>
            <Text style={[styles.blockCode, { color: hue.solid }]}>
              {block.code} ({clockText(block.start)}-{clockText(block.end)})
            </Text>
          </View>
        );
      })}
    </View>
  );
}

export default function WeekScreen() {
  const view = useScheduleView();

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

  const days = gridDays(view.blocks);
  const line = statsLine(view.stats);

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

      {days.length ? (
        days.map((day) => (
          <DaySection
            key={day}
            label={day}
            blocks={view.blocks.filter((block) => block.day === day)}
            colors={view.colors}
          />
        ))
      ) : (
        <Text style={styles.emptyText}>No classes on this schedule.</Text>
      )}

      {line ? <Text style={styles.statsLine}>{line}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f4" },
  content: { padding: 16, paddingBottom: 32 },
  center: { alignItems: "center", justifyContent: "center" },
  sampleBanner: { backgroundColor: "#fdf6e3", borderColor: "#e3c567", borderWidth: 1, borderRadius: 10, padding: 10, marginBottom: 12 },
  sampleText: { color: "#6b5410", fontSize: 13 },
  daySection: { marginBottom: 16 },
  dayLabel: { fontSize: 15, fontWeight: "700", color: "#1a2420", marginBottom: 6 },
  block: {
    borderRadius: 8,
    borderLeftWidth: 4,
    padding: 10,
    marginBottom: 6,
  },
  blockCode: { fontSize: 14, fontWeight: "600" },
  statsLine: { fontSize: 13, color: "#5b6660", marginTop: 4 },
  errorText: { color: "#a3300f" },
  emptyText: { color: "#5b6660" },
});
