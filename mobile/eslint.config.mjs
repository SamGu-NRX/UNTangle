import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".expo/**",
      ".eas/**",
      "coverage/**",
      ".expo-shared/**",
      "dist/**",
      "web-build/**",
      "expo-env.d.ts",
      // CommonJS tooling configs: babel and jest load them with require.
      "babel.config.js",
      "jest.config.js",
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
