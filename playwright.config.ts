import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const port = 4173;
// The cloud dev container ships Chromium at a fixed path; CI installs its own.
const localChromium = '/opt/pw-browsers/chromium';
const launchOptions =
  !process.env.CI && existsSync(localChromium) ? { executablePath: localChromium } : {};

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${port}/`,
    trace: 'retain-on-failure',
    locale: 'he-IL',
  },
  projects: [
    {
      name: 'iphone',
      use: { ...devices['iPhone 14'], browserName: 'chromium', launchOptions },
    },
  ],
  webServer: {
    command: 'pnpm preview --port 4173 --strictPort',
    port,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
