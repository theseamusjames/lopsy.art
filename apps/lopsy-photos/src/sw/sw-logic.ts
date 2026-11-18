/**
 * The service worker's decisions, as pure functions so they are unit
 * tested (service-worker.ts is the thin part that talks to the browser).
 *
 * The worker serves the app shell offline. It never touches requests to
 * other origins (Google sign-in, the Drive API, the Picker) and never
 * caches Drive content: originals and previews have their own OPFS caches.
 */

export const CACHE_PREFIX = 'lopsy-photos-shell-';

/** What the build writes into the worker: its version, the files to precache (absolute paths) and their SHA-256. */
export interface PrecacheManifest {
  readonly version: string;
  /** The app's base path, `/` or `/photos/`; the page itself is precached under it. */
  readonly base: string;
  readonly files: readonly string[];
  /** Lower-case hex SHA-256 of each file's bytes, by path. */
  readonly hashes: Readonly<Record<string, string>>;
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
  /** A page load: the network first, the cached shell (the base URL) when offline. */
  | { readonly kind: 'navigate'; readonly fallback: string }
  /** A precached file: from the cache once its bytes check out, else the network. */
  | { readonly kind: 'precached'; readonly path: string };

export function planFetch(
  request: { readonly method: string; readonly url: string; readonly mode: string },
  scopeOrigin: string,
  manifest: PrecacheManifest,
): FetchPlan {
  if (request.method !== 'GET') return { kind: 'pass' };
  const url = new URL(request.url);
  if (url.origin !== scopeOrigin || !url.pathname.startsWith(manifest.base)) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'navigate', fallback: manifest.base };
  if (manifest.files.includes(url.pathname)) return { kind: 'precached', path: url.pathname };
  return { kind: 'pass' };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether these are the bytes the build wrote for `path`. The cache is
 * shared with everything on the origin (Lopsy too, on lopsy.art), so a
 * cached file is checked before it is served.
 */
export async function matchesBuild(manifest: PrecacheManifest, path: string, bytes: ArrayBuffer): Promise<boolean> {
  const expected = manifest.hashes[path];
  return expected !== undefined && (await sha256Hex(bytes)) === expected;
}

/** Only this app's own pages may tell a waiting worker to take over. */
export function mayRequestUpdate(
  source: { readonly type?: string; readonly url?: string } | null,
  scopeOrigin: string,
  manifest: PrecacheManifest,
): boolean {
  if (!source || source.type !== 'window' || typeof source.url !== 'string') return false;
  try {
    const url = new URL(source.url);
    return url.origin === scopeOrigin && url.pathname.startsWith(manifest.base);
  } catch {
    return false;
  }
}

/** The message the page sends to let a waiting worker take over. */
export const SKIP_WAITING_MESSAGE = 'lopsy-photos:skip-waiting';
