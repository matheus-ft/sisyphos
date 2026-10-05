// Browser tests of the app's main flows, at an iPhone's size, against the dev
// server: its dev-only hook (src/main.ts) lets a test seed weeks of sessions
// through the app's own actions instead of tapping them in.
import { defineConfig } from '@playwright/test';

const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: 'e2e',
  // Not `.spec.ts`: Vitest would collect those as unit tests.
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    // Chromium at the size of the lifter's phone. CI installs Playwright's own
    // Chromium; locally the installed Chrome saves a download.
    channel: ci ? undefined : 'chrome',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !ci,
  },
});
