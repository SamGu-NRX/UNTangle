// Playwright runs the broken-state specs serially against a Next dev server
// on port 3100. Reuses an already-running server when present (the sandbox
// keeps one warm under tmux), otherwise starts one.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "bun run dev --port 3100",
    url: "http://127.0.0.1:3100/map",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
