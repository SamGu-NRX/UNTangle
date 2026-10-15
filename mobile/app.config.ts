import type { ExpoConfig } from "expo/config";

/**
 * The EAS Update coordinates come from the environment (EXPO_PUBLIC_EAS_PROJECT_ID
 * and EXPO_PUBLIC_EAS_UPDATE_URL, see docs/mobile/ota.md). Until `eas init` runs,
 * the env is empty and config falls back to a syntactically valid placeholder so
 * every build and test stays green; the publish script and the strict resolver in
 * src/updates/eas-project.ts are where the missing environment becomes a clear
 * error. Placeholder spots are flagged TO-FINALIZE below.
 *
 * The resolution is inlined on purpose: the config file is loaded by plain Node
 * require, which cannot import the TypeScript modules in src/, so
 * app.config.ts imports no local modules. Keep resolveEasPair in step with
 * resolveEasPair in src/updates/eas-project.ts, which tests the same rules and
 * adds the same cross-project URL check.
 */

const PROJECT_ID_ENV = "EXPO_PUBLIC_EAS_PROJECT_ID";
const UPDATE_URL_ENV = "EXPO_PUBLIC_EAS_UPDATE_URL";
const UPDATE_URL_PREFIX = "https://u.expo.dev/";
const PLACEHOLDER_PROJECT_ID = "00000000-0000-0000-0000-000000000000";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function resolveEasPair(): { projectId: string; updateUrl: string } {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() ?? "";
  const updateUrl = process.env.EXPO_PUBLIC_EAS_UPDATE_URL?.trim() ?? "";
  if (projectId === "" && updateUrl === "") {
    return { projectId: PLACEHOLDER_PROJECT_ID, updateUrl: `${UPDATE_URL_PREFIX}${PLACEHOLDER_PROJECT_ID}` };
  }
  if (projectId === "") {
    throw new Error(`${UPDATE_URL_ENV} is set but ${PROJECT_ID_ENV} is not. Set both.`);
  }
  if (updateUrl === "") {
    throw new Error(
      `${PROJECT_ID_ENV} is set but ${UPDATE_URL_ENV} is not. Set it to ${UPDATE_URL_PREFIX}${projectId}.`,
    );
  }
  if (!UUID.test(projectId)) {
    throw new Error(`${PROJECT_ID_ENV} must be the project id UUID that \`eas init\` prints, got "${projectId}".`);
  }
  if (!updateUrl.startsWith(UPDATE_URL_PREFIX)) {
    throw new Error(`${UPDATE_URL_ENV} must start with ${UPDATE_URL_PREFIX}, got "${updateUrl}".`);
  }
  if (updateUrl.slice(UPDATE_URL_PREFIX.length) !== projectId) {
    throw new Error(
      `${UPDATE_URL_ENV} points at a different project than ${PROJECT_ID_ENV}: ` +
        `expected ${UPDATE_URL_PREFIX}${projectId}, got "${updateUrl}".`,
    );
  }
  return { projectId, updateUrl };
}

const eas = resolveEasPair();

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
