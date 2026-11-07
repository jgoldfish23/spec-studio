import { defineConfig, devices } from "@playwright/test";

// Where Chromium lives when it was installed outside Playwright's own cache (this repo's dev container sets it).
// In CI it stays unset and `npx playwright install --with-deps chromium` provides the browser.
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;
// The hosted build, made against the fake Supabase that `tests/e2e/fakeSupabase` puts in the browser.
const HOSTED_PORT = 4174;
const HOSTED_URL = `http://localhost:${HOSTED_PORT}`;

const chromium = {
  ...devices["Desktop Chrome"],
  ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
};

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // The HTML report is written on every run, so `npx playwright show-report` works after a local failure as in CI.
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      // The demo build: everything in the browser, no network.
      name: "demo",
      testIgnore: "hosted.spec.ts",
      use: chromium,
    },
    {
      // The hosted build against the fake Supabase. Its specs also open the demo build, at its own address.
      name: "hosted",
      testMatch: "hosted.spec.ts",
      use: { ...chromium, baseURL: HOSTED_URL },
    },
  ],
  // The production builds, served as static files. A fresh build of each every run, never a reused server.
  webServer: [
    {
      // What the demo page runs.
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: BASE_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run build:hosted-test && npx vite preview --outDir dist-hosted --port ${HOSTED_PORT} --strictPort`,
      url: HOSTED_URL,
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
