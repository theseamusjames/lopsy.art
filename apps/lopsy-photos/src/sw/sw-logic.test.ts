import { describe, expect, it } from 'vitest';
import { SKIP_WAITING } from './register';
import { cacheName, CACHE_PREFIX, planFetch, SKIP_WAITING_MESSAGE, staleCaches, type PrecacheManifest } from './sw-logic';

const manifest: PrecacheManifest = {
  version: 'abc',
  base: '/photos/',
  files: ['/photos/index.html', '/photos/assets/index-1.js', '/photos/assets/lopsy_wasm_bg-2.wasm'],
};
const origin = 'https://lopsy.art';

function plan(url: string, mode = 'cors', method = 'GET') {
  return planFetch({ url, mode, method }, origin, manifest);
}

describe('the service worker', () => {
  it('serves page loads under its base network-first, falling back to the shell', () => {
    expect(plan('https://lopsy.art/photos/', 'navigate')).toEqual({ kind: 'navigate', fallback: '/photos/index.html' });
    expect(plan('https://lopsy.art/photos/some/deep/link', 'navigate')).toEqual({ kind: 'navigate', fallback: '/photos/index.html' });
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

  it('versions its cache by build and drops older ones only', () => {
    expect(cacheName(manifest)).toBe(`${CACHE_PREFIX}abc`);
    expect(staleCaches([`${CACHE_PREFIX}old`, `${CACHE_PREFIX}abc`, 'lopsy-other'], `${CACHE_PREFIX}abc`)).toEqual([`${CACHE_PREFIX}old`]);
  });

  it('agrees with the page on the skip-waiting message', () => {
    expect(SKIP_WAITING).toBe(SKIP_WAITING_MESSAGE);
  });
});
