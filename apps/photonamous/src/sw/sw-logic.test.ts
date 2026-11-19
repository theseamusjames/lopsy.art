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

  it('offers an update only when its own worker is active and another waits', () => {
    expect(hasWaitingUpdate({ active: null, waiting: {} })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: null })).toBe(false);
    expect(hasWaitingUpdate({ active: {}, waiting: {} })).toBe(true);
  });
});
