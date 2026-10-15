import { router } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { color, layout, radius, space } from "@/theme/tokens";
import { CloseGlyph } from "@/ui/glyphs";
import { Button, PressScale } from "@/ui/press";
import { Txt } from "@/ui/text";

/**
 * Sign in is not on the phone yet. It will arrive as device sign-in: the
 * app shows a short code, the student approves it in UNTangle on the web,
 * and the server hands this device its own credential. Until then
 * the app has no account path at all, and says so instead of offering one.
 */
export default function SignInSheet() {
  const insets = useSafeAreaInsets();
  const close = () => (router.canGoBack() ? router.back() : router.replace("/courses"));
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
      <Txt variant="body" style={styles.lede}>
        Signing in on the phone is coming with device sign-in. You'll approve this phone from UNTangle on the web, and your
        schedules will follow you here.
      </Txt>
      <View style={styles.note}>
        <Txt variant="bodyStrong">Until then, you're a guest.</Txt>
        <Txt variant="meta" tone="ink2">
          The courses and week here belong to a sample student. Changes stay on this phone until you close the app.
        </Txt>
      </View>
      <Button label="Keep exploring" onPress={close} full />
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: color.paper, paddingHorizontal: layout.gutter + 4, paddingTop: space[6], gap: space[4] },
  head: { flexDirection: "row", alignItems: "center", gap: space[3] },
  flex: { flex: 1 },
  close: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: color.paper2 },
  lede: { color: color.ink },
  note: { padding: space[4], borderRadius: radius.md, backgroundColor: color.paper2, gap: 4 },
});
