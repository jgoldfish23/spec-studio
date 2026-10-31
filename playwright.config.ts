import { defineConfig, devices } from "@playwright/test";

// Where Chromium lives when it was installed outside Playwright's own cache (this repo's dev container sets it).
// In CI it stays unset and `npx playwright install --with-deps chromium` provides the browser.
const chromiumPath = process.env.PW_CHROMIUM_PATH;
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  // The production build, served as static files: what the demo page runs. A fresh build each run, never a reused server.
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
