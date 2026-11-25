import { defineConfig } from 'vite';

const harness = decodeURIComponent(new URL('.', import.meta.url).pathname);
const pkg = decodeURIComponent(new URL('../..', import.meta.url).pathname);

/** Serves e2e/harness/ and lets it import photos-core's src/ directly. */
export default defineConfig({
  root: harness,
  logLevel: 'warn',
  server: { fs: { allow: [pkg] } },
});
