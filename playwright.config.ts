import { defineConfig } from "@playwright/test";

// Next.js allows one dev server per project. If one is already running, point
// the tests at it with PLAYWRIGHT_BASE_URL=http://localhost:3000.
const external = process.env.PLAYWRIGHT_BASE_URL;
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: external || `http://localhost:${PORT}`,
    // Set PLAYWRIGHT_CHANNEL=chrome to use an installed Google Chrome instead
    // of running `npx playwright install chromium`.
    channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
  },
  webServer: external
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
