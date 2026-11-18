/**
 * The service worker's decisions, as pure functions so they are unit
 * tested (service-worker.ts is the thin part that talks to the browser).
 *
 * The worker serves the app shell offline. It never touches requests to
 * other origins (Google sign-in, the Drive API, the Picker) and never
 * caches Drive content: originals and previews have their own OPFS caches.
 */

export const CACHE_PREFIX = 'lopsy-photos-shell-';

/** What the build writes into the worker: its version and the files to precache, as absolute paths. */
export interface PrecacheManifest {
  readonly version: string;
  /** The app's base path, `/` or `/photos/`. */
  readonly base: string;
  readonly files: readonly string[];
}

export function cacheName(manifest: PrecacheManifest): string {
  return `${CACHE_PREFIX}${manifest.version}`;
}

/** Caches an older build left behind, to delete when this one activates. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

export type FetchPlan =
  /** Leave it to the network: the worker does not respond. */
  | { readonly kind: 'pass' }
  /** A page load: the network first, the cached shell when offline. */
  | { readonly kind: 'navigate'; readonly fallback: string }
  /** A precached file: from the cache, else the network. */
  | { readonly kind: 'precached'; readonly path: string };

export function planFetch(
  request: { readonly method: string; readonly url: string; readonly mode: string },
  scopeOrigin: string,
  manifest: PrecacheManifest,
): FetchPlan {
  if (request.method !== 'GET') return { kind: 'pass' };
  const url = new URL(request.url);
  if (url.origin !== scopeOrigin || !url.pathname.startsWith(manifest.base)) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'navigate', fallback: `${manifest.base}index.html` };
  if (manifest.files.includes(url.pathname)) return { kind: 'precached', path: url.pathname };
  return { kind: 'pass' };
}

/** The message the page sends to let a waiting worker take over. */
export const SKIP_WAITING_MESSAGE = 'lopsy-photos:skip-waiting';
