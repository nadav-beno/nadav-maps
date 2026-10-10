import { defineConfig, devices } from '@playwright/test';

// The sandbox has a pre-installed Chromium; CI installs its own.
const executablePath = process.env.PW_CHROMIUM_PATH;
// Several worktrees may run e2e at once: give each its own preview port.
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
  testDir: 'e2e',
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    locale: 'he-IL',
    timezoneId: 'Asia/Jerusalem',
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
    // The service worker would bypass the network stubs.
    serviceWorkers: 'block',
  },
  projects: [
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'] } },
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: `pnpm --filter @nm/web exec vite preview --port ${port} --strictPort`,
    port,
    reuseExistingServer: !process.env.CI,
  },
});
