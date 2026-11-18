import { createHash } from 'node:crypto';
import { readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

/**
 * Builds Lopsy Photos' service worker (src/sw/service-worker.ts) into
 * `<base>sw.js`, a fixed name so its scope is the app's base, and writes
 * the precache manifest into it: index.html, every file of the build (the
 * hashed JS and CSS, the engine's wasm and glue) and the public files
 * (fonts, icons, the manifest). The version is a hash of those names, so
 * every build that changes a file gets a new cache.
 *
 * Production builds only; the dev server never registers a worker.
 */

const ENTRY = 'src/sw/service-worker.ts';
const WORKER_FILE = 'sw.js';
/** Files Pages reads as configuration, and nothing a page loads. */
const SKIPPED = [/^_headers$/, /^_redirects$/, /\.map$/, /^edit-harness\.html$/];

function publicFiles(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push(relative(dir, full).split(sep).join('/'));
    }
  };
  try {
    walk(dir);
  } catch {
    return [];
  }
  return files;
}

export function serviceWorkerPlugin(): Plugin {
  let config: ResolvedConfig;
  return {
    name: 'lopsy-photos-service-worker',
    apply: 'build',
    // After Vite's own plugins, so index.html is in the bundle.
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
      const base = config.base;
      const names = [
        'index.html',
        ...Object.keys(bundle),
        ...(config.publicDir ? publicFiles(config.publicDir) : []),
      ].filter((name) => name !== WORKER_FILE && !SKIPPED.some((pattern) => pattern.test(name)));
      const files = [...new Set(names.map((name) => `${base}${name}`))].sort();
      const hash = createHash('sha256').update(files.join('\n'));
      for (const [name, output] of Object.entries(bundle)) {
        if (name !== WORKER_FILE) hash.update(output.type === 'chunk' ? output.code : output.source);
      }
      const version = hash.digest('hex').slice(0, 16);
      const manifest = JSON.stringify({ version, base, files });
      if (!worker.code.includes('__PRECACHE_MANIFEST__')) this.error(`${WORKER_FILE} lost its manifest placeholder`);
      worker.code = worker.code.replace(/__PRECACHE_MANIFEST__/g, manifest);
    },
  };
}
