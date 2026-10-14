// Lint config for the workspace packages under packages/ and tools/. ESLint
// looks for a config from the directory it runs in upward, so a package's
// `lint` script finds this file, while frontend/ keeps its own config.
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  globalIgnores(["frontend/**", "old/**", "**/node_modules/**"]),
  {
    files: ["packages/**/*.{ts,tsx,mts}", "tools/repo-rules/**/*.ts"],
    extends: [tseslint.configs.recommended],
  },
]);
