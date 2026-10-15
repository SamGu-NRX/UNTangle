import { useState, type ReactNode } from "react";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { deviceErrorLabel } from "@/auth/device-api";
import { useAuth } from "@/auth/auth-store";
import { color, layout, radius, space } from "@/theme/tokens";
import { CloseGlyph } from "@/ui/glyphs";
import { Button, PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";

/**
 * Device sign-in (docs/architecture/README.md, "Sign-in for each client"):
 * this screen shows the 8-character user code, hands the student to the
 * approval page in the system browser, and waits while the auth module polls.
 * No token arrives through this screen, a link, or a scheme; the grant lands
 * in the Keychain through the auth module or not at all.
 */

/** "AB2CD3EF" reads as "AB2C D3EF", matching how the approval page shows it. */
function groupedUserCode(userCode: string): string {
  return userCode.length === 8 ? `${userCode.slice(0, 4)} ${userCode.slice(4)}` : userCode;
}

function signInFailureText(reason: "denied" | "expired" | "cancelled" | "failed", error?: string, message?: string): string {
  if (reason === "denied") return "You chose Deny on the web, so this phone stays signed out.";
  if (reason === "expired") return "That code expired. Start again for a new one.";
  if (reason === "failed") {
    if (message) return message;
    if (error) return deviceErrorLabel(error as Parameters<typeof deviceErrorLabel>[0]);
  }
  return "Sign-in stopped before this phone was approved.";
}

export default function SignInSheet() {
  const insets = useSafeAreaInsets();
  const { auth, state } = useAuth();
  const close = () => (router.canGoBack() ? router.back() : router.replace("/courses"));
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const start = () => {
    setStarting(true);
    setFailure(null);
    auth
      .beginSignIn()
      .then(result => {
        if (!result.ok) setFailure(signInFailureText(result.reason, result.reason === "failed" ? result.error : undefined, result.reason === "failed" ? result.message : undefined));
      })
      .catch(() => setFailure("Sign-in stopped before this phone was approved."))
      .finally(() => setStarting(false));
  };

  const signOut = () => {
    void auth.signOut();
  };

  let body: ReactNode;
  if (state.status === "awaiting-approval") {
    body = (
      <>
        <Txt variant="body" style={styles.lede}>
          On any device, open UNTangle and sign in, then approve this phone. The page asks for this code:
        </Txt>
        <View style={styles.codeBox}>
          <Txt variant="numeral" style={styles.code} accessibilityRole="text" accessibilityLabel={`Your sign-in code is ${groupedUserCode(state.start.userCode)}`}>
            {groupedUserCode(state.start.userCode)}
          </Txt>
        </View>
        <Button label="Open UNTangle in the browser" onPress={() => void WebBrowser.openBrowserAsync(state.start.verificationUri)} full />
        <Txt variant="meta" tone="ink2">
          This code lasts 10 minutes. Sign-in finishes on its own once you approve, and nothing about it arrives through a link or a scheme.
        </Txt>
        <Button label="Cancel" onPress={auth.cancelSignIn} kind="quiet" full />
      </>
    );
  } else if (state.status === "signed-in") {
    const canWrite = state.scopes.includes("documents:write");
    const countFailed = state.countFailed;
    const retryCount = () => void auth.refreshDocumentCount();
    body = (
      <>
        <Txt variant="body" style={styles.lede}>
          You're signed in. This phone can {canWrite ? "read and change" : "read"} your documents.
        </Txt>
        <View style={styles.note}>
          {state.documentCount === null ? (
            <>
              <Txt variant="bodyStrong">{countFailed ? "Couldn't load your documents." : "Counting your documents…"}</Txt>
              {countFailed ? <Button label="Try again" onPress={retryCount} kind="secondary" /> : null}
            </>
          ) : (
            <Txt variant="bodyStrong">
              Your account has {state.documentCount === 1 ? "1 document" : `${state.documentCount} documents`}.
            </Txt>
          )}
          <Txt variant="meta" tone="ink2">
            Your schedules follow this phone in the next update.
          </Txt>
        </View>
        <Button label="Sign out" onPress={signOut} kind="secondary" full />
        <Button label="Keep exploring" onPress={close} full />
      </>
    );
  } else {
    // restoring and signed-out share the invitation; restoring shows it idle.
    body = (
      <>
        <Txt variant="body" style={styles.lede}>
          You'll approve this phone from UNTangle on the web, and your documents will follow you here.
        </Txt>
        {failure ? (
          <View style={styles.failureBox}>
            <Txt variant="body" tone="danger">
              {failure}
            </Txt>
          </View>
        ) : null}
        <Button label="Sign in with UNTangle" onPress={start} busy={starting} disabled={state.status === "restoring"} full />
        <View style={styles.note}>
          <Txt variant="bodyStrong">Until then, you're a guest.</Txt>
          <Txt variant="meta" tone="ink2">
            The courses and week here belong to a sample student. Changes stay on this phone until you close the app.
          </Txt>
        </View>
        <Button label="Keep exploring" onPress={close} full />
      </>
    );
  }

  return (
    <View style={[styles.sheet, { paddingBottom: insets.bottom + space[6] }]}>
      <View style={styles.head}>
        <Txt variant="h1" accessibilityRole="header" style={styles.flex}>
          Sign in
        </Txt>
        <PressScale onPress={close} style={styles.close} accessibilityLabel="Close sign in" hitSlop={8}>
          <CloseGlyph />
        </PressScale>
      </View>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.paper, paddingHorizontal: layout.gutter + 4, paddingTop: space[6], gap: space[4] },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  flex: { flex: 1 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  lede: { color: color.ink },
  codeBox: {
    alignItems: "center",
    paddingVertical: space[6],
    borderRadius: radius.lg,
    backgroundColor: color.brandSoft,
  },
  code: { color: color.brand, letterSpacing: 2 },
  note: { padding: space[4], borderRadius: radius.md, backgroundColor: color.paper2, gap: 4 },
  failureBox: { padding: space[3], borderRadius: radius.md, backgroundColor: color.dangerSoft },
});
