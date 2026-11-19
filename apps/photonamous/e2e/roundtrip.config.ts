import { chromium, defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The Photonamous ⇄ Lopsy round trip, with both apps running: Lopsy's dev
 * server on 5173 and Photos' on 5174, the URLs each side's dev defaults
 * point at. Each server is also told the other's URL (VITE_PHOTOS_URL,
 * VITE_LOPSY_URL), so other ports work too. Run from apps/photonamous:
 *
 *   npx playwright test -c e2e/roundtrip.config.ts
 *
 * Both servers are always started here and never adopted, so a server left
 * running from another worktree is never tested in this one's place.
 */

process.env.LOPSY_ROUNDTRIP = '1';

const here = dirname(fileURLToPath(import.meta.url));
/** Override both with ROUNDTRIP_LOPSY_PORT / ROUNDTRIP_PHOTOS_PORT when 5173 or 5174 is taken. */
const lopsyPort = Number(process.env.ROUNDTRIP_LOPSY_PORT ?? 5173);
const photosPort = Number(process.env.ROUNDTRIP_PHOTOS_PORT ?? 5174);
const lopsyUrl = `http://localhost:${lopsyPort}/`;
const photosUrl = `http://localhost:${photosPort}/`;
process.env.ROUNDTRIP_LOPSY_URL = lopsyUrl;

/** The same Chromium fallback as playwright.config.ts. */
function chromiumExecutable(): string | undefined {
  const own = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
  if (own) return own;
  try {
    if (existsSync(chromium.executablePath())) return undefined;
  } catch {
    // No registry entry for this platform; fall through to the shared link.
  }
  const dir = process.env.PLAYWRIGHT_BROWSERS_PATH;
  const link = dir ? join(dir, 'chromium_headless_shell') : '';
  return link && existsSync(link) ? link : undefined;
}

const gpuArgs = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: '.',
  testMatch: 'roundtrip.spec.ts',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: photosUrl,
    headless: true,
    viewport: { width: 1280, height: 800 },
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 800 },
        launchOptions: { args: gpuArgs, executablePath: chromiumExecutable() },
      },
    },
  ],
  webServer: [
    {
      command: `npx vite --port ${lopsyPort} --strictPort`,
      cwd: join(here, '../../lopsy-web'),
      port: lopsyPort,
      env: { VITE_PHOTOS_URL: photosUrl },
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npx vite --port ${photosPort} --strictPort`,
      cwd: join(here, '..'),
      port: photosPort,
      env: { VITE_LOPSY_URL: lopsyUrl },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
