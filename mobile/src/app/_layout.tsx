import { DMSans_400Regular } from "@expo-google-fonts/dm-sans/400Regular";
import { DMSans_500Medium } from "@expo-google-fonts/dm-sans/500Medium";
import { DMSans_600SemiBold } from "@expo-google-fonts/dm-sans/600SemiBold";
import { DMSans_700Bold } from "@expo-google-fonts/dm-sans/700Bold";
import { Syne_800ExtraBold } from "@expo-google-fonts/syne/800ExtraBold";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "@/auth/auth-store";
import { PlanProvider } from "@/plan/plan-store";
import { color } from "@/theme/tokens";
import { startUpdateChecks } from "@/updates/start";

SplashScreen.preventAutoHideAsync().catch(() => {});

/**
 * Course detail, Preferences and Sign in are their own routes presented as
 * form sheets: on iOS that is the system sheet (detents, grabber, swipe to
 * dismiss, the dimmed background) rather than one rebuilt in JavaScript.
 */
const sheet = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  sheetCornerRadius: 22,
  headerShown: false,
  contentStyle: { backgroundColor: color.paper },
} as const;

export default function RootLayout() {
  const [loaded, error] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Syne_800ExtraBold,
  });
  useEffect(() => {
    if (loaded || error) SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);
  // Over-the-air updates: check at launch, recheck on a long backgrounding,
  // and restart into a downloaded update only at a safe moment.
  useEffect(() => startUpdateChecks(), []);
  // A failed font load falls back to the system face rather than blocking the app.
  if (!loaded && !error) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PlanProvider>
            <StatusBar style="dark" />
            <Stack screenOptions={{ contentStyle: { backgroundColor: color.ground } }}>
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="course/[code]" options={{ ...sheet, sheetAllowedDetents: [0.6, 0.94] }} />
              <Stack.Screen name="preferences" options={{ ...sheet, sheetAllowedDetents: [0.94] }} />
              <Stack.Screen name="sign-in" options={{ ...sheet, sheetAllowedDetents: [0.6] }} />
            </Stack>
          </PlanProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
