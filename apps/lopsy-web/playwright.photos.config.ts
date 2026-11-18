import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * The Lopsy Photos handoff specs (e2e/photos-handoff.spec.ts) need a build
 * that ships Photos: Lopsy offers the handoff only when VITE_PHOTOS_URL is
 * set. They run here against a dev server started with it, on the port next
 * to the main suite's so both can run at once.
 *
 *   npm run test:e2e:photos-handoff
 */
const basePort = Number(new URL(String(base.use?.baseURL)).port);
const port = Number(process.env.VITE_PHOTOS_HANDOFF_PORT ?? basePort + 1);

export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: /photos-handoff\.spec\.ts$/,
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  projects: (base.projects ?? []).filter((p) => p.name === 'chromium'),
  webServer: {
    command: `npx vite --port ${port} --strictPort`,
    port,
    reuseExistingServer: false,
    env: { VITE_PHOTOS_URL: 'http://localhost:5174/' },
  },
});
