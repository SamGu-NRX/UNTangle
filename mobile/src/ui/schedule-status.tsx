import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";

/**
 * The Week and Day screens' shared status surfaces: the labeled-sample /
 * data-provenance banner (with the sign-in entry point when the sample shows
 * because the student is signed out) and the retryable error state.
 */
export function ScheduleBanner({
  note,
  labeledSample,
  source,
  signInHint,
}: {
  note: string | null;
  labeledSample: boolean;
  source: "your-plan" | "sample";
  signInHint: boolean;
}) {
  const text = labeledSample
    ? `Sample schedule${source === "sample" ? "" : " (some sections)"}${note ? ` - ${note}` : ""}`
    : note;
  if (text === null) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
      {signInHint ? (
        <Link href="/sign-in" asChild>
          <Pressable accessibilityLabel="Sign in to see your saved plan">
            <Text style={styles.signInText}>Sign in</Text>
          </Pressable>
        </Link>
      ) : null}
    </View>
  );
}

export function ScheduleError({ message, retry }: { message: string; retry: () => void }) {
  return (
    <View style={styles.center}>
      <Text style={styles.errorText}>{message}</Text>
      <Pressable onPress={retry} accessibilityLabel="Retry loading the schedule">
        <Text style={styles.retryText}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#fdf6e3",
    borderColor: "#e3c567",
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    marginBottom: 12,
  },
  bannerText: { color: "#6b5410", fontSize: 13 },
  signInText: { color: "#00853e", fontWeight: "600", marginTop: 6 },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorText: { color: "#a3300f", textAlign: "center", padding: 16 },
  retryText: { color: "#00853e", fontWeight: "600", marginTop: 8 },
});
