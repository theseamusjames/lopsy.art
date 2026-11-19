import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Builds Photonamous' service worker (src/sw/service-worker.ts) into
 * `<base>sw.js`, a fixed name so its scope is the app's base, and writes
 * the precache manifest into it once the build is on disk: every file
 * written (the hashed JS and CSS, the engine's wasm, the public fonts,
 * icons and manifest) with the SHA-256 of its bytes. The page itself is
 * precached as the base URL (`/`), since Pages answers `/index.html`
 * with a redirect to it. The cache version is a hash
 * of every name and checksum, so any changed byte gives a new cache, and
 * the worker checks cached bytes against the checksums before serving
 * them (spec 6.13: a script on the same origin could write the cache).
 *
 * Production builds only; the dev server never registers a worker.
 */

const ENTRY = 'src/sw/service-worker.ts';
const WORKER_FILE = 'sw.js';
const PLACEHOLDER = '__PRECACHE_MANIFEST__';
/** Files Pages reads as configuration, and nothing a page loads. */
const SKIPPED = [/^_headers$/, /^_redirects$/, /\.map$/, /^edit-harness\.html$/, /^sw\.js$/];

function filesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(dir, full).split(sep).join('/'));
    }
  };
  walk(dir);
  return files;
}

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'photonamous-service-worker',
    apply: 'build',
    enforce: 'post',
    configResolved(resolved) {
      config = resolved;
    },
    buildStart() {
      this.emitFile({ type: 'chunk', id: join(config.root, ENTRY), fileName: WORKER_FILE });
    },
    generateBundle(_options, bundle) {
      const worker = bundle[WORKER_FILE];
      if (!worker || worker.type !== 'chunk') this.error(`${WORKER_FILE} was not built`);
      if (worker.imports.length > 0 || worker.exports.length > 0) {
        this.error(`${WORKER_FILE} must bundle to a plain script (it imports ${worker.imports.join(', ')})`);
      }
      if (!worker.code.includes(PLACEHOLDER)) this.error(`${WORKER_FILE} lost its manifest placeholder`);
    },
    writeBundle(options) {
      const outDir = options.dir ?? config.build.outDir;
      const base = config.base;
      const hashes: Record<string, string> = {};
      for (const name of filesUnder(outDir).sort()) {
        if (SKIPPED.some((pattern) => pattern.test(name))) continue;
        const path = name === 'index.html' ? base : `${base}${name}`;
        hashes[path] = createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex');
      }
      if (!hashes[base]) this.error('index.html was not written');
      const version = createHash('sha256')
        .update(Object.entries(hashes).map(([path, sha]) => `${path} ${sha}`).join('\n'))
        .digest('hex')
        .slice(0, 16);
      const manifest = JSON.stringify({ version, base, files: Object.keys(hashes), hashes });
      const workerPath = join(outDir, WORKER_FILE);
      writeFileSync(workerPath, readFileSync(workerPath, 'utf8').split(PLACEHOLDER).join(manifest));
    },
  };
}
