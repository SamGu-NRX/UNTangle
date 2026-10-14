import { useEffect, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, View } from "react-native";
import { useLinkingURL } from "expo-linking";
import { storeSessionCookie } from "@/data/session";
import { tokenFromFragment, verifyMagicLink } from "@/data/magic-link";
import type { FetchLike } from "@/data/http";

type CallbackState =
  | { status: "working" }
  | { status: "signed-in" }
  | { status: "incomplete" }
  | { status: "invalid" }
  | { status: "network"; message: string };

/** The fragment of the URL this screen was opened with, or null. */
function fragmentOf(url: string | null): string | null {
  if (Platform.OS === "web") {
    if (typeof window === "undefined") return null;
    return window.location.hash || null;
  }
  if (!url) return null;
  const hashIndex = url.indexOf("#");
  return hashIndex >= 0 ? url.slice(hashIndex) : null;
}

export default function AuthCallbackScreen() {
  const linkingUrl = useLinkingURL();
  const [state, setState] = useState<CallbackState>({ status: "working" });

  useEffect(() => {
    let cancelled = false;
    const fetchLike: FetchLike = fetch;
    const fragment = fragmentOf(linkingUrl);
    const token = fragment ? tokenFromFragment(fragment) : null;

    if (!token) {
      setState({ status: "incomplete" });
      return;
    }
    (async () => {
      const result = await verifyMagicLink(token, fetchLike);
      if (cancelled) return;
      if (result.ok) {
        await storeSessionCookie(result.response);
        if (!cancelled) setState({ status: "signed-in" });
      } else if (result.reason === "network") {
        setState({ status: "network", message: result.message });
      } else {
        setState({ status: "invalid" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linkingUrl]);

  return (
    <View style={[styles.screen, styles.center]}>
      {state.status === "working" && <ActivityIndicator color="#00853e" size="large" />}
      {state.status === "working" && <Text style={styles.text}>Signing you in...</Text>}

      {state.status === "signed-in" && (
        <>
          <Text style={styles.titleText}>You are signed in</Text>
          <Text style={styles.text}>Close this screen and open the Week or Day tab to see your plan.</Text>
        </>
      )}

      {state.status === "incomplete" && (
        <>
          <Text style={styles.titleText}>This link is incomplete</Text>
          <Text style={styles.text}>
            No sign-in token came with this request. Start again from the sign-in screen.
          </Text>
        </>
      )}

      {state.status === "invalid" && (
        <>
          <Text style={styles.titleText}>This sign-in link is invalid or expired</Text>
          <Text style={styles.text}>
            Sign-in links work once and for a limited time. Request a fresh one from the sign-in screen.
          </Text>
        </>
      )}

      {state.status === "network" && (
        <>
          <Text style={styles.titleText}>Could not reach UNTangle</Text>
          <Text style={styles.text}>{state.message}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f4", padding: 24 },
  center: { alignItems: "center", justifyContent: "center" },
  titleText: { fontSize: 17, fontWeight: "700", color: "#1a2420", marginBottom: 8, textAlign: "center" },
  text: { fontSize: 14, color: "#3d4742", textAlign: "center", lineHeight: 20 },
});
