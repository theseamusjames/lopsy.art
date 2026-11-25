import { defineConfig, devices } from '@playwright/test';

/** photos-core has no Node types; the config only needs the environment. */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };

const PORT = 5199;
/**
 * Where Playwright's own Chromium is missing or a different build (some CI
 * containers), point PW_CHROMIUM_PATH at a Chromium or headless shell.
 */
const chromiumPath = process.env.PW_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  timeout: 60_000,
  reporter: 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath ? { launchOptions: { executablePath: chromiumPath } } : {}),
      },
    },
  ],
  webServer: {
    command: `npx vite --config e2e/harness/vite.config.ts --port ${PORT} --strictPort`,
    cwd: '..',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
