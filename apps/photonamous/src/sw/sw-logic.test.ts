import { describe, expect, it } from 'vitest';
import { hasWaitingUpdate, KEEP_FOR_OFFLINE, SKIP_WAITING } from './register';
import {
  cacheName,
  CACHE_PREFIX,
  isDocumentPage,
  matchesBuild,
  mayRequestUpdate,
  planFetch,
  sha256Hex,
  SKIP_WAITING_MESSAGE,
  KEEP_FOR_OFFLINE_MESSAGE,
  installPaths,
  keepForOfflinePath,
  staleCaches,
  type PrecacheManifest,
} from './sw-logic';

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

async function manifestFor(files: Record<string, string>, base = '/'): Promise<PrecacheManifest> {
  const hashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) hashes[path] = await sha256Hex(bytes(content));
  return { version: 'abc', base, files: Object.keys(files), hashes };
}

const origin = 'https://photonamous.com';

describe('the service worker', async () => {
  const manifest = await manifestFor({
    '/': '<html>',
    '/assets/index-1.js': 'app',
    '/assets/lopsy_wasm_bg-2.wasm': 'wasm',
  });
  const plan = (url: string, mode = 'cors', method = 'GET') => planFetch({ url, mode, method }, origin, manifest);

  it('serves page loads network-first, falling back to the shell at the base URL', () => {
    expect(plan('https://photonamous.com/', 'navigate')).toEqual({ kind: 'navigate', fallback: '/' });
    expect(plan('https://photonamous.com/some/deep/link', 'navigate')).toEqual({ kind: 'navigate', fallback: '/' });
  });

  it('serves precached files and passes everything else through', () => {
    expect(plan('https://photonamous.com/assets/index-1.js')).toEqual({ kind: 'precached', path: '/assets/index-1.js' });
    expect(plan('https://photonamous.com/assets/other.js')).toEqual({ kind: 'pass' });
    expect(plan('https://photonamous.com/assets/index-1.js', 'cors', 'POST')).toEqual({ kind: 'pass' });
  });

  it('never handles Google, Lopsy or any other origin', () => {
    expect(plan('https://www.googleapis.com/drive/v3/files/x?alt=media')).toEqual({ kind: 'pass' });
    expect(plan('https://accounts.google.com/gsi/client')).toEqual({ kind: 'pass' });
    expect(plan('https://www.googleapis.com/', 'navigate')).toEqual({ kind: 'pass' });
    expect(plan('https://lopsy.art/', 'navigate')).toEqual({ kind: 'pass' });
    expect(plan('https://lopsy.art/assets/index-1.js')).toEqual({ kind: 'pass' });
  });

  it('leaves the document pages to the network, however their path is spelled', () => {
    const withDocuments: PrecacheManifest = { ...manifest, documents: ['/privacy', '/terms'] };
    const planPage = (path: string) => planFetch({ url: `https://photonamous.com${path}`, mode: 'navigate', method: 'GET' }, origin, withDocuments);
    for (const path of ['/privacy', '/terms', '/privacy/', '/terms.html', '/privacy?from=start']) {
      expect(planPage(path)).toEqual({ kind: 'pass' });
    }
    // Only those pages: the app's own paths still get the shell.
    expect(planPage('/privacy/elsewhere')).toEqual({ kind: 'navigate', fallback: '/' });
    expect(planPage('/')).toEqual({ kind: 'navigate', fallback: '/' });
    expect(isDocumentPage('/privacy', manifest)).toBe(false);
  });

  it('keeps to its base when that is below the root', async () => {
    const below = await manifestFor({ '/app/': '<html>', '/app/assets/index-1.js': 'app' }, '/app/');
    const planBelow = (url: string, mode = 'cors') => planFetch({ url, mode, method: 'GET' }, origin, below);
    expect(planBelow('https://photonamous.com/app/deep/link', 'navigate')).toEqual({ kind: 'navigate', fallback: '/app/' });
    expect(planBelow('https://photonamous.com/app/assets/index-1.js')).toEqual({ kind: 'precached', path: '/app/assets/index-1.js' });
    expect(planBelow('https://photonamous.com/', 'navigate')).toEqual({ kind: 'pass' });
    expect(planBelow('https://photonamous.com/assets/index-1.js')).toEqual({ kind: 'pass' });
    expect(mayRequestUpdate({ type: 'window', url: 'https://photonamous.com/elsewhere' }, origin, below)).toBe(false);
  });

  it('accepts only the bytes the build wrote', async () => {
    expect(await matchesBuild(manifest, '/assets/index-1.js', bytes('app'))).toBe(true);
    expect(await matchesBuild(manifest, '/assets/index-1.js', bytes('evil()'))).toBe(false);
    expect(await matchesBuild(manifest, '/assets/unknown.js', bytes('app'))).toBe(false);
  });

  it('takes an update request only from its own pages', () => {
    expect(mayRequestUpdate({ type: 'window', url: 'https://photonamous.com/library' }, origin, manifest)).toBe(true);
    expect(mayRequestUpdate({ type: 'window', url: 'https://lopsy.art/' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate({ type: 'worker', url: 'https://photonamous.com/x.js' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate({ type: 'window', url: 'https://evil.example/' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate(null, origin, manifest)).toBe(false);
  });

  it('versions its cache by build and drops older ones only', () => {
    expect(cacheName(manifest)).toBe(`${CACHE_PREFIX}abc`);
    expect(staleCaches([`${CACHE_PREFIX}old`, `${CACHE_PREFIX}abc`, 'lopsy-other'], `${CACHE_PREFIX}abc`)).toEqual([`${CACHE_PREFIX}old`]);
  });

  it('agrees with the page on the skip-waiting message', () => {
    expect(SKIP_WAITING).toBe(SKIP_WAITING_MESSAGE);
  });

  it('agrees with the page on the keep-for-offline message', () => {
    expect(KEEP_FOR_OFFLINE).toBe(KEEP_FOR_OFFLINE_MESSAGE);
  });

  it('offers an update only when its own worker is active and another waits', () => {
    expect(hasWaitingUpdate({ active: null, waiting: {} })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: null })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: {} })).toBe(true);
  });

  describe('the engine wasm, cached on demand', () => {
    const withOnDemand = { ...manifest, onDemand: ['/assets/lopsy_wasm_bg-2.wasm'] };
    const page = { type: 'window', url: 'https://photonamous.com/' };
    const ask = (path: unknown, source: { type?: string; url?: string } | null = page) =>
      keepForOfflinePath({ type: KEEP_FOR_OFFLINE_MESSAGE, path }, source, origin, withOnDemand);

    it('is left out of the install, and still served from the cache once there', () => {
      expect(installPaths(withOnDemand)).toEqual(['/', '/assets/index-1.js']);
      expect(installPaths(manifest)).toEqual(manifest.files);
      expect(planFetch({ url: 'https://photonamous.com/assets/lopsy_wasm_bg-2.wasm', mode: 'cors', method: 'GET' }, origin, withOnDemand)).toEqual({
        kind: 'precached',
        path: '/assets/lopsy_wasm_bg-2.wasm',
      });
    });

    it('is cached when one of the app\'s pages names it', () => {
      expect(ask('/assets/lopsy_wasm_bg-2.wasm')).toBe('/assets/lopsy_wasm_bg-2.wasm');
      expect(ask('https://photonamous.com/assets/lopsy_wasm_bg-2.wasm')).toBe('/assets/lopsy_wasm_bg-2.wasm');
    });

    it('ignores any other file, origin, sender or message', () => {
      expect(ask('/assets/index-1.js')).toBeNull();
      expect(ask('https://example.com/assets/lopsy_wasm_bg-2.wasm')).toBeNull();
      expect(ask(42)).toBeNull();
      expect(ask('/assets/lopsy_wasm_bg-2.wasm', { type: 'window', url: 'https://example.com/' })).toBeNull();
      expect(ask('/assets/lopsy_wasm_bg-2.wasm', null)).toBeNull();
      expect(keepForOfflinePath(SKIP_WAITING_MESSAGE, page, origin, withOnDemand)).toBeNull();
    });
  });
});
