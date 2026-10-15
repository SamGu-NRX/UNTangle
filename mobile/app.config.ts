import type { ExpoConfig } from "expo/config";

import { resolveEasProject } from "./src/updates/eas-project";

/**
 * The EAS Update coordinates come from the environment (EXPO_PUBLIC_EAS_PROJECT_ID
 * and EXPO_PUBLIC_EAS_UPDATE_URL, see docs/mobile/ota.md). Until `eas init` runs,
 * the env is empty and config falls back to a syntactically valid placeholder so
 * every build and test stays green; `resolveEasProject(..., { allowPlaceholder:
 * false })` in the publish script and in the runtime update controller is where
 * the missing environment becomes a clear error. Placeholder spots are flagged
 * TO-FINALIZE below.
 */
const eas = resolveEasProject(process.env, { allowPlaceholder: true });

const config: ExpoConfig = {
  name: "UNTangle",
  slug: "untangle",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "untangle",
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
    url: eas.updateUrl,
    fallbackToCacheTimeout: 0,
  },
  // The fingerprint policy ties the runtime version to everything that can
  // touch the native runtime, so an update can never claim to match a build
  // it does not run on (docs/architecture/README.md, "Mobile"). The price is
  // a new build whenever the fingerprint changes, which the publish script
  // enforces by refusing updates whose fingerprint matches no production
  // build in the stores.
  runtimeVersion: { policy: "fingerprint" },
  extra: {
    eas: { projectId: eas.projectId },
  },
};

export default config;
