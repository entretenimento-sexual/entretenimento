import { defineConfig, devices } from '@playwright/test';

const baseURL =
  process.env.PROFILE_VIDEOS_BASE_URL ?? 'http://127.0.0.1:4200';

export default defineConfig({
  testDir: './scripts/tests',
  testMatch: 'profile-videos-browser-smoke.spec.mjs',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    timeout: 30_000,
  },
  reporter: [
    ['line'],
    [
      'html',
      {
        outputFolder: 'artifacts/profile-videos-browser-smoke/report',
        open: 'never',
      },
    ],
  ],
  outputDir: 'artifacts/profile-videos-browser-smoke/results',
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 45_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
