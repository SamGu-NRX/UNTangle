import type { ExpoConfig } from "expo/config";

/**
 * Placeholder for values that need a real EAS project: the iOS bundle id, the
 * OTA updates URL, and the EAS project id. No EAS account exists yet, so these
 * are syntactically valid placeholders that keep every build and test green
 * until `eas init` runs. Each is flagged TO-FINALIZE below and in the PR.
 */
const PLACEHOLDER_EAS_PROJECT_ID = "00000000-0000-0000-0000-000000000000";

const config: ExpoConfig = {
  name: "UNTangle",
  slug: "untangle",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    // TO-FINALIZE: neutral placeholder until the EAS project exists; must be
    // replaced with the final App Store bundle id before distribution.
    bundleIdentifier: "app.untangle.mobile.placeholder",
    supportsTablet: false,
    icon: "./assets/images/icon.png",
  },
  web: {
    bundler: "metro",
    // One page that routes on the client: static pre-rendering cannot know a
    // route's query or params (?d=Tue, /course/CSCE 2100), so React would
    // discard that markup on every such load.
    output: "single",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#ffffff",
      },
    ],
  ],
  updates: {
    // TO-FINALIZE: EAS Update URL placeholder. expo-updates requires a valid
    // URL shape even before an EAS project exists; `eas init` replaces it.
    url: `https://u.expo.dev/${PLACEHOLDER_EAS_PROJECT_ID}`,
    fallbackToCacheTimeout: 0,
  },
  runtimeVersion: { policy: "appVersion" },
  extra: {
    // TO-FINALIZE: the real id once the EAS project is created and linked.
    eas: { projectId: PLACEHOLDER_EAS_PROJECT_ID },
  },
};

export default config;
