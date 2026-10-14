import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useLinkingURL } from "expo-linking";
import { getSessionCookie, storeSessionCookie } from "@/data/session";
import { tokenFromFragment, verifyMagicLink } from "@/data/magic-link";

type CallbackState =
  | { status: "working" }
  | { status: "confirm" }
  | { status: "kept" }
  | { status: "signed-in" }
  | { status: "incomplete" }
  | { status: "invalid" }
  | { status: "network"; message: string };

type Notify = (state: CallbackState) => void;

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

async function verifyAndStore(token: string, cancelled: () => boolean, notify: Notify): Promise<void> {
  const result = await verifyMagicLink(token, fetch);
  if (cancelled()) return;
  if (result.ok) {
    await storeSessionCookie(result.response);
    if (!cancelled()) notify({ status: "signed-in" });
  } else if (result.reason === "network") {
    notify({ status: "network", message: result.message });
  } else {
    notify({ status: "invalid" });
  }
}

export default function AuthCallbackScreen() {
  const linkingUrl = useLinkingURL();
  const [state, setState] = useState<CallbackState>({ status: "working" });
  const tokenRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    const notify: Notify = (next) => {
      if (!cancelledRef.current) setState(next);
    };
    const fragment = fragmentOf(linkingUrl);
    const token = fragment ? tokenFromFragment(fragment) : null;

    if (!token) {
      notify({ status: "incomplete" });
      return;
    }
    tokenRef.current = token;
    (async () => {
      // A deep link can arrive while the student is already signed in.
      // Silently replacing that session would let a forwarded link switch
      // the account, so an existing session asks first.
      const existing = await getSessionCookie();
      if (cancelledRef.current) return;
      if (existing) {
        notify({ status: "confirm" });
        return;
      }
      await verifyAndStore(token, () => cancelledRef.current, notify);
    })();
    return () => {
      cancelledRef.current = true;
    };
  }, [linkingUrl]);

  const switchAccount = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) {
      setState({ status: "incomplete" });
      return;
    }
    setState({ status: "working" });
    await verifyAndStore(token, () => cancelledRef.current, setState);
  }, []);

  return (
    <View style={[styles.screen, styles.center]}>
      {state.status === "working" && <ActivityIndicator color="#00853e" size="large" />}
      {state.status === "working" && <Text style={styles.text}>Signing you in...</Text>}

      {state.status === "confirm" && (
        <>
          <Text style={styles.titleText}>Switch account?</Text>
          <Text style={styles.text}>
            You are already signed in on this device. This link signs you in to the account it was
            emailed to.
          </Text>
          <Pressable style={styles.primaryButton} onPress={switchAccount} accessibilityLabel="Switch to the account from the link">
            <Text style={styles.primaryText}>Switch account</Text>
          </Pressable>
          <Pressable onPress={() => setState({ status: "kept" })} accessibilityLabel="Keep the current sign-in">
            <Text style={styles.keepText}>Keep current sign-in</Text>
          </Pressable>
        </>
      )}

      {state.status === "kept" && (
        <>
          <Text style={styles.titleText}>Kept your current sign-in</Text>
          <Text style={styles.text}>Close this screen to keep using the app as you are.</Text>
        </>
      )}

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
  primaryButton: {
    backgroundColor: "#00853e",
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 20,
  },
  primaryText: { color: "#ffffff", fontWeight: "600" },
  keepText: { color: "#00853e", fontWeight: "600", marginTop: 12 },
});
