import { chromium, defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The Chromium to run. Playwright's own build when it is installed; else
 * PLAYWRIGHT_CHROMIUM_EXECUTABLE, or the `chromium_headless_shell` link a
 * preinstalled browsers directory provides (sandboxes whose browsers are a
 * different revision from this Playwright's).
 */
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

/**
 * E2E tests for Lopsy Photos, against the Vite dev server (5174, or
 * VITE_PORT). The server is always started here and never adopted: a dev
 * server left running in another worktree would otherwise be tested in
 * this one's place.
 *
 * Headless Chromium has no GPU: WebGL runs on SwiftShader through ANGLE,
 * with the flags lopsy-web's suite uses (apps/lopsy-web/e2e/gpu-args.ts).
 *
 * The RAF test reads real camera files from LOPSY_RAF_SAMPLES and is
 * skipped when it is unset.
 */
const port = Number(process.env.VITE_PORT ?? 5174);

const gpuArgs = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--enable-webgl2-compute-context',
  '--ignore-gpu-blocklist',
];

export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  use: {
    baseURL: `http://localhost:${port}`,
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
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
