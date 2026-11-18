import { defineConfig, devices } from '@playwright/test';
import { chromiumExecutable } from './playwright.config';

/**
 * The assembled lopsy.art site (Lopsy at `/`, Photos at `/photos/`), served
 * from the root dist/ by scripts/serve-site.mjs the way Cloudflare Pages
 * serves it. Build it first: `npm run build:site` (or `build:site:noopt`).
 */
const port = Number(process.env.SITE_PORT ?? 4180);

export default defineConfig({
  testDir: './e2e',
  testMatch: 'site.spec.ts',
  timeout: 120_000,
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
    command: `node ../../scripts/serve-site.mjs --port ${port}`,
    port,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
