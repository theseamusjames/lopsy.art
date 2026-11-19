import { defineConfig, devices } from '@playwright/test';
import { chromiumExecutable } from './playwright.config';

/**
 * Offline start (spec 5.7): the production build of Photos alone, at
 * /photos/ as on lopsy.art, served from dist/photos-site by
 * scripts/serve-site.mjs the way Pages serves it. Lopsy is left out so the
 * run does not build its 900 MB of tutorials. `npm run test:e2e:offline`
 * builds, runs and cleans up.
 */
const port = Number(process.env.OFFLINE_PORT ?? 4190);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'offline.spec.ts',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'],
          executablePath: chromiumExecutable(),
        },
      },
    },
  ],
  webServer: {
    command: `node ../../scripts/serve-site.mjs --dir dist/photos-site --port ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
