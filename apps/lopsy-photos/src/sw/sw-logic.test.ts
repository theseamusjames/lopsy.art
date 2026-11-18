import { describe, expect, it } from 'vitest';
import { hasWaitingUpdate, SKIP_WAITING } from './register';
import {
  cacheName,
  CACHE_PREFIX,
  matchesBuild,
  mayRequestUpdate,
  planFetch,
  sha256Hex,
  SKIP_WAITING_MESSAGE,
  staleCaches,
  type PrecacheManifest,
} from './sw-logic';

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer as ArrayBuffer;

async function manifestFor(files: Record<string, string>): Promise<PrecacheManifest> {
  const hashes: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) hashes[path] = await sha256Hex(bytes(content));
  return { version: 'abc', base: '/photos/', files: Object.keys(files), hashes };
}

const origin = 'https://lopsy.art';

describe('the service worker', async () => {
  const manifest = await manifestFor({
    '/photos/': '<html>',
    '/photos/assets/index-1.js': 'app',
    '/photos/assets/lopsy_wasm_bg-2.wasm': 'wasm',
  });
  const plan = (url: string, mode = 'cors', method = 'GET') => planFetch({ url, mode, method }, origin, manifest);

  it('serves page loads under its base network-first, falling back to the shell at the base URL', () => {
    expect(plan('https://lopsy.art/photos/', 'navigate')).toEqual({ kind: 'navigate', fallback: '/photos/' });
    expect(plan('https://lopsy.art/photos/some/deep/link', 'navigate')).toEqual({ kind: 'navigate', fallback: '/photos/' });
  });

  it('serves precached files and passes everything else through', () => {
    expect(plan('https://lopsy.art/photos/assets/index-1.js')).toEqual({ kind: 'precached', path: '/photos/assets/index-1.js' });
    expect(plan('https://lopsy.art/photos/assets/other.js')).toEqual({ kind: 'pass' });
    expect(plan('https://lopsy.art/photos/assets/index-1.js', 'cors', 'POST')).toEqual({ kind: 'pass' });
  });

  it('never handles Google or anything outside its base', () => {
    expect(plan('https://www.googleapis.com/drive/v3/files/x?alt=media')).toEqual({ kind: 'pass' });
    expect(plan('https://accounts.google.com/gsi/client')).toEqual({ kind: 'pass' });
    expect(plan('https://www.googleapis.com/photos/', 'navigate')).toEqual({ kind: 'pass' });
    expect(plan('https://lopsy.art/', 'navigate')).toEqual({ kind: 'pass' });
    expect(plan('https://lopsy.art/assets/index-1.js')).toEqual({ kind: 'pass' });
  });

  it('accepts only the bytes the build wrote', async () => {
    expect(await matchesBuild(manifest, '/photos/assets/index-1.js', bytes('app'))).toBe(true);
    expect(await matchesBuild(manifest, '/photos/assets/index-1.js', bytes('evil()'))).toBe(false);
    expect(await matchesBuild(manifest, '/photos/assets/unknown.js', bytes('app'))).toBe(false);
  });

  it('takes an update request only from its own pages', () => {
    expect(mayRequestUpdate({ type: 'window', url: 'https://lopsy.art/photos/library' }, origin, manifest)).toBe(true);
    expect(mayRequestUpdate({ type: 'window', url: 'https://lopsy.art/editor' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate({ type: 'worker', url: 'https://lopsy.art/photos/x.js' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate({ type: 'window', url: 'https://evil.example/photos/' }, origin, manifest)).toBe(false);
    expect(mayRequestUpdate(null, origin, manifest)).toBe(false);
  });

  it('versions its cache by build and drops older ones only', () => {
    expect(cacheName(manifest)).toBe(`${CACHE_PREFIX}abc`);
    expect(staleCaches([`${CACHE_PREFIX}old`, `${CACHE_PREFIX}abc`, 'lopsy-other'], `${CACHE_PREFIX}abc`)).toEqual([`${CACHE_PREFIX}old`]);
  });

  it('agrees with the page on the skip-waiting message', () => {
    expect(SKIP_WAITING).toBe(SKIP_WAITING_MESSAGE);
  });

  it('offers an update only when its own worker is active and another waits', () => {
    expect(hasWaitingUpdate({ active: null, waiting: {} })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: null })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: {} })).toBe(true);
  });
});
