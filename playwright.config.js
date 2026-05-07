import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PORT || 3000);
// Explicit IPv4: Node's request client prefers ::1 when "localhost" resolves
// to both, but `vercel dev` only binds 127.0.0.1, so localhost reqs from
// Playwright's apiRequestContext fail with ECONNREFUSED on the v6 attempt.
const BASE_URL = `http://127.0.0.1:${PORT}`;

// vercel dev is slow to boot (~15-20s) and likes a TTY. We default to
// `reuseExistingServer = true` so the recommended flow is "leave vercel
// dev running in another terminal and run tests against it." Playwright
// will fall back to spawning vercel dev if nothing is on the port,
// though that path is brittle and primarily for CI.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,            // tests share the app_data table; run serially
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['json', { outputFile: 'test-results/playwright.json' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: undefined },
    },
  ],
  webServer: {
    command: 'npm run dev:vercel',
    url: BASE_URL,
    timeout: 90_000,
    reuseExistingServer: true,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
