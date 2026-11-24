import { defineConfig, devices } from '@playwright/test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withEditSectionsOpen } from '../playwright.config';

/**
 * Records the start screen's demo reel (src/components/DemoReel). Not a
 * test: it directs the app through the trailer's shots and writes the
 * video files the page plays. docs/photonamous-demo-reel.md is the guide.
 * From apps/photonamous:
 *
 *   REEL_PHOTOS=<library folder> REEL_HERO=<DSCF8078.RAF> \
 *     npx playwright test -c e2e/demo-reel.config.ts
 *
 * - REEL_PHOTOS: the JPEGs the library is filled with
 *   (scripts/demo-reel-library.mjs builds the folder from your photos).
 * - REEL_HERO: the RAW file the timelapse edits, the one
 *   e2e/demo-reel-edit.json's steps were made on.
 * - REEL_END: the photograph behind the end card (default demo-reel-end.jpg
 *   beside this file). REEL_MASTER: a path to also write a master to.
 *   REEL_KEEP_FRAMES=1 keeps the captured frames in test-results/demo-reel
 *   (a gigabyte or two: delete them after).
 *
 * Needs macOS (sips), ffmpeg with libsvtav1 and libx264 on the PATH, and
 * Playwright's full Chromium (`npx playwright install chromium`): its new
 * headless mode draws with the machine's GPU, which the engine needs to
 * edit at speed. The app runs on its own dev server with Google Drive
 * served by photos-core's fake Drive, so nothing touches Google.
 */

const here = dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.REEL_PORT ?? 5194);

/** The reel's shape, 6:5: two thirds of a 16:9 window. Captured at twice this and scaled down. */
export const REEL_WIDTH = 1440;
export const REEL_HEIGHT = 1200;

export default defineConfig({
  testDir: '.',
  testMatch: 'demo-reel.record.ts',
  timeout: 45 * 60_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  // A step that cannot be done stops the recording soon, not at the end of its 45 minutes.
  // The Edit panel's sections open, as the film shows them.
  use: { baseURL: `http://localhost:${port}`, headless: true, actionTimeout: 30_000, storageState: withEditSectionsOpen(`http://localhost:${port}`) },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chromium',
        viewport: { width: REEL_WIDTH, height: REEL_HEIGHT },
        deviceScaleFactor: 2,
        launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] },
      },
    },
  ],
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    cwd: join(here, '..'),
    port,
    // Any client ID makes the start screen offer Google sign-in; the recording stubs Google itself.
    env: { VITE_GOOGLE_CLIENT_ID: 'demo-reel.apps.googleusercontent.com', VITE_GOOGLE_API_KEY: '', VITE_GOOGLE_APP_ID: '' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
