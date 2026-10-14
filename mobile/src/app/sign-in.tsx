import { useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { requestMagicLink } from "@/data/magic-link";

type FormState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "sent" }
  | { status: "error"; message: string };

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [form, setForm] = useState<FormState>({ status: "idle" });

  const submit = () => {
    setForm({ status: "sending" });
    requestMagicLink(email, fetch)
      .then((result) => {
        if (result.ok) {
          setForm({ status: "sent" });
        } else {
          setForm({ status: "error", message: result.message });
        }
      })
      .catch((error: unknown) =>
        setForm({ status: "error", message: error instanceof Error ? error.message : "Network request failed" }),
      );
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "web" ? undefined : "padding"} style={styles.screen}>
      <View style={styles.card}>
        <Text style={styles.title}>Sign in with a magic link</Text>
        <Text style={styles.copy}>
          UNTangle emails a sign-in link to your UNT address. Open it on this device and the app takes
          over; open it on a computer and the web app offers a handoff back here.
        </Text>

        {form.status === "sent" ? (
          <View style={styles.sentBox}>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.copy}>
              The link goes to the UNTangle web landing page first, which never uses the token - it
              offers an "Open in the UNTangle app" button that hands the still-unclaimed token here.
            </Text>
          </View>
        ) : (
          <View>
            <TextInput
              style={styles.input}
              placeholder="NetID@my.unt.edu"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
            />
            {form.status === "error" ? <Text style={styles.errorText}>{form.message}</Text> : null}
            <Pressable
              style={[styles.button, form.status === "sending" && styles.buttonDisabled]}
              onPress={submit}
              disabled={form.status === "sending"}
              accessibilityLabel="Email me a sign-in link"
            >
              {form.status === "sending" ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.buttonText}>Email me a sign-in link</Text>
              )}
            </Pressable>
          </View>
        )}

        <Text style={styles.finePrint}>UNT email addresses only. No passwords are ever asked for.</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#f4f6f4", justifyContent: "center", padding: 16 },
  card: { backgroundColor: "#ffffff", borderRadius: 14, padding: 18 },
  title: { fontSize: 19, fontWeight: "700", color: "#1a2420", marginBottom: 8 },
  copy: { fontSize: 14, color: "#3d4742", lineHeight: 20, marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: "#d8ded9",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 8,
    color: "#1a2420",
  },
  button: { backgroundColor: "#00853e", borderRadius: 10, paddingVertical: 12, alignItems: "center", marginTop: 4 },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#ffffff", fontWeight: "700", fontSize: 15 },
  errorText: { color: "#a3300f", fontSize: 13, marginBottom: 8 },
  sentBox: { backgroundColor: "#e6f0e8", borderRadius: 10, padding: 12, marginBottom: 4 },
  sentTitle: { color: "#1f5c37", fontWeight: "700", marginBottom: 4 },
  finePrint: { fontSize: 12, color: "#5b6660", marginTop: 8 },
});
