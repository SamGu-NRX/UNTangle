import { defineConfig } from "../../../extension/node_modules/@playwright/test/index.js";
import { resolve } from "node:path";
const root = resolve(__dirname, "../../..");
export default defineConfig({
  testDir: __dirname, testMatch: "*.spec.ts", workers: 1, retries: 0, timeout: 60_000,
  outputDir: resolve(root, "extension/test-results"), reporter: "list",
  webServer: [
    { command: "bun tools/mock-myunt/server.ts", cwd: root, url: "http://localhost:4317/health", reuseExistingServer: false, timeout: 30_000 },
    { command: "bun run --cwd frontend dev --hostname 127.0.0.1 --port 3000", cwd: root, url: "http://127.0.0.1:3000/connect", reuseExistingServer: false, timeout: 120_000 },
  ],
});
