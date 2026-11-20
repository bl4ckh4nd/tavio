import { defineConfig, devices } from '@playwright/test';

const e2ePort = Number(process.env.E2E_PORT ?? 3333);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${e2ePort}`;
const webServerEnv: Record<string, string> = {};
if (process.env.E2E_CONVEX_URL) {
  webServerEnv.VITE_CONVEX_URL = process.env.E2E_CONVEX_URL;
}
if (process.env.E2E_CONVEX_SITE_URL) {
  webServerEnv.VITE_CONVEX_SITE_URL = process.env.E2E_CONVEX_SITE_URL;
}

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  timeout: 30_000,
  use: {
    baseURL,
    trace: 'on-first-retry',
    // ponytail: system Chrome instead of downloaded Chromium — the Playwright CDN is unreachable from this machine
    channel: 'chrome',
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'layout',
      testMatch: /layout\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'media',
      testMatch: /media\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Needs the local stack and the assistant worker; see the top of assistant.spec.ts.
      name: 'assistant',
      testMatch: /assistant\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      // Needs the local stack; see the top of whiteboard.spec.ts.
      name: 'board',
      testMatch: /whiteboard\.spec\.ts|facilitation\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium',
      testIgnore: /layout\.spec\.ts|media\.spec\.ts|assistant\.spec\.ts|whiteboard\.spec\.ts|facilitation\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
  ...(process.env.E2E_BASE_URL ? {} : {
    webServer: {
      command: `npm run dev -- --port ${e2ePort}`,
      port: e2ePort,
      reuseExistingServer: true,
      timeout: 60_000,
      ...(Object.keys(webServerEnv).length > 0 ? { env: webServerEnv } : {}),
    },
  }),
});
