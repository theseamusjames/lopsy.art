import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEditSectionsOpen } from '../playwright.config';
import { hardwareGpuArgs, rendererEnv } from './gpu-args';

/**
 * Makes the site's social preview image (public/og-image.jpg) from the
 * app: a RAW photo in the Edit view's split before and after. Not a test.
 * From apps/photonamous:
 *
 *   OG_RAW=<DSCF8005.RAF> VITE_PORT=5189 npx playwright test -c e2e/og-image.config.ts
 *
 * og-image.record.ts says what it does and what else it reads;
 * docs/photonamous-setup.md has the recipe. Needs Playwright's full
 * Chromium (`npx playwright install chromium`), which draws with the
 * machine's GPU: a 40 MP RAW at full size needs it. OG_WORK moves
 * Playwright's own output (default test-results/og-image-work).
 */

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.VITE_PORT ?? 5189);

export default defineConfig({
  testDir: '.',
  testMatch: 'og-image.record.ts',
  outputDir: process.env.OG_WORK ?? join(here, '../test-results/og-image-work'),
  timeout: 30 * 60_000,
  expect: { timeout: 60_000 },
  workers: 1,
  retries: 0,
  use: { baseURL: `http://localhost:${port}`, headless: true, actionTimeout: 60_000, storageState: withEditSectionsOpen(`http://localhost:${port}`) },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: 1280, height: 800 },
        // Six device pixels to the CSS pixel: with the photograph 400 CSS px wide (og-image.record.ts) the
        // capture is 2400 px wide, twice the card's size, and the split view's divider and labels come out
        // large enough to read on a card 500 px wide.
        deviceScaleFactor: 6,
        // sRGB, what social sites expect: the Edit view then draws for an sRGB display, and the capture is sRGB.
        launchOptions: { args: [...hardwareGpuArgs, '--force-color-profile=srgb'] },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: join(here, '..'),
    port,
    env: rendererEnv,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
