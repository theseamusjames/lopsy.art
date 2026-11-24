import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Builds Photonamous' service worker (src/sw/service-worker.ts) into
 * `<base>sw.js`, a fixed name so its scope is the app's base, and writes
 * the precache manifest into it once the build is on disk: every file
 * written (the hashed JS and CSS, the engine's wasm, the public fonts,
 * icons and manifest) with the SHA-256 of its bytes. The engine's two
 * wasm builds are listed but cached on demand (ON_DEMAND), not at install. The page itself is
 * precached as the base URL (`/`), since Pages answers `/index.html`
 * with a redirect to it. The cache version is a hash
 * of every name and checksum, so any changed byte gives a new cache, and
 * the worker checks cached bytes against the checksums before serving
 * them (spec 6.13: a script on the same origin could write the cache).
 *
 * The document pages (`documentPages`: the Privacy Policy and Terms) are
 * not part of the shell. They are left out of the precache, so a change to
 * their words is not a new version of the app, and their paths are written
 * into the manifest for the worker to leave to the network.
 *
 * Production builds only; the dev server never registers a worker.
 */

const ENTRY = 'src/sw/service-worker.ts';
const WORKER_FILE = 'sw.js';
const PLACEHOLDER = '__PRECACHE_MANIFEST__';
/**
 * Files Pages reads as configuration, and nothing a page loads; and the
 * start screen's demo reel, megabytes a signed-in user never plays (its
 * poster is precached, so the start screen is whole offline without it).
 */
const SKIPPED = [/^_headers$/, /^_redirects$/, /\.map$/, /^edit-harness\.html$/, /^sw\.js$/, /\.mp4$/];
/**
 * Files in the manifest that the install leaves out: the engine's two wasm
 * builds (WebGL and WebGPU), of which a page runs one. The page asks the
 * worker to keep the one it runs (src/sw/register.ts `keepForOffline`).
 */
const ON_DEMAND = [/(^|\/)lopsy_wasm_bg[^/]*\.wasm$/];

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

export interface ServiceWorkerOptions {
  /** Names of the pages that are documents, not the app: `<name>.html` in the build, `<base><name>` on the site. */
  readonly documentPages?: readonly string[];
}

export function serviceWorkerPlugin(options: ServiceWorkerOptions = {}): Plugin {
  const documentPages = options.documentPages ?? [];
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
    writeBundle(output) {
      const outDir = output.dir ?? config.build.outDir;
      const base = config.base;
      const hashes: Record<string, string> = {};
      for (const name of filesUnder(outDir).sort()) {
        if (SKIPPED.some((pattern) => pattern.test(name))) continue;
        if (documentPages.some((page) => name === `${page}.html`)) continue;
        const path = name === 'index.html' ? base : `${base}${name}`;
        hashes[path] = createHash('sha256').update(readFileSync(join(outDir, name))).digest('hex');
      }
      if (!hashes[base]) this.error('index.html was not written');
      const version = createHash('sha256')
        .update(Object.entries(hashes).map(([path, sha]) => `${path} ${sha}`).join('\n'))
        .digest('hex')
        .slice(0, 16);
      const documents = documentPages.map((page) => `${base}${page}`);
      const files = Object.keys(hashes);
      const onDemand = files.filter((path) => ON_DEMAND.some((pattern) => pattern.test(path)));
      const manifest = JSON.stringify({ version, base, files, hashes, documents, onDemand });
      const workerPath = join(outDir, WORKER_FILE);
      writeFileSync(workerPath, readFileSync(workerPath, 'utf8').split(PLACEHOLDER).join(manifest));
    },
  };
}
