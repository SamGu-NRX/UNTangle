/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["<rootDir>/src/**/*.test.ts"],
  // The expo runtime logs a native-logger warning through a lazy fetch install
  // that can land after the tests finish, which jest treats as a console error
  // and fails the run; failure diffs do not depend on test console output.
  silent: true,
  // The shared frontend modules are compiled by babel-jest but live outside
  // this workspace; their @babel/runtime helpers resolve from here.
  modulePaths: ["<rootDir>/node_modules"],
  moduleNameMapper: {
    "^@/lib/(.*)$": "<rootDir>/../frontend/src/lib/$1",
    "^@/assets/(.*)$": "<rootDir>/assets/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transformIgnorePatterns: [
    // bun's isolated store nests real packages under node_modules/.bun/<pkg>@<hash>/node_modules/<name>/
    // - the .bun allowance lets the regex reach the real package name segment,
    //   mirroring jest-expo's .pnpm allowance
    "/node_modules/(?!((\\.pnpm|\\.bun)|((jest-)?react-native|@react-native(-community)?)|expo(nent)?|@expo(nent)?|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-view|sentry-expo))",
    "/node_modules/react-native-reanimated/plugin/",
    "/node_modules/@react-native/babel-preset/",
  ],
};
