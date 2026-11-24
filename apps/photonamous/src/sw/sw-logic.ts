/**
 * The service worker's decisions, as pure functions so they are unit
 * tested (service-worker.ts is the thin part that talks to the browser).
 *
 * The worker serves the app shell offline. It never touches requests to
 * other origins (Google sign-in, the Drive API, the Picker) and never
 * caches Drive content: originals and previews have their own OPFS caches.
 * The Privacy Policy and Terms are documents, not the app: the worker
 * leaves them to the network too, so what is read is always what is
 * published, and offline they fail as any page does instead of showing the
 * app in their place.
 */

export const CACHE_PREFIX = 'photonamous-shell-';

/** What the build writes into the worker: its version, the files to precache (absolute paths) and their SHA-256. */
export interface PrecacheManifest {
  readonly version: string;
  /** The app's base path (`/` on photonamous.com); the page itself is precached under it. */
  readonly base: string;
  readonly files: readonly string[];
  /** Lower-case hex SHA-256 of each file's bytes, by path. */
  readonly hashes: Readonly<Record<string, string>>;
  /** Pages that are not the app (`/privacy`, `/terms`): never precached, never answered by the worker. */
  readonly documents?: readonly string[];
  /**
   * Files of `files` left out of the install: the engine's two wasm builds,
   * of which a page uses one. A page names the one it runs
   * (KEEP_FOR_OFFLINE_MESSAGE) and the worker caches that one then; until
   * it is cached, it comes from the network like any other request.
   */
  readonly onDemand?: readonly string[];
}

export function cacheName(manifest: PrecacheManifest): string {
  return `${CACHE_PREFIX}${manifest.version}`;
}

/** Caches an older build left behind, to delete when this one activates. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((name) => name.startsWith(CACHE_PREFIX) && name !== current);
}

/** Whether a path is one of the build's document pages, however Pages spells it (`/privacy`, `/privacy/`, `/privacy.html`). */
export function isDocumentPage(pathname: string, manifest: PrecacheManifest): boolean {
  const path = pathname.replace(/\.html$/, '').replace(/(.)\/$/, '$1');
  return (manifest.documents ?? []).includes(path);
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
  if (isDocumentPage(url.pathname, manifest)) return { kind: 'pass' };
  if (request.mode === 'navigate') return { kind: 'navigate', fallback: manifest.base };
  if (manifest.files.includes(url.pathname)) return { kind: 'precached', path: url.pathname };
  return { kind: 'pass' };
}

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Whether these are the bytes the build wrote for `path`. Any script on
 * the origin can write to the cache, so a cached file is checked before it
 * is served.
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
export const SKIP_WAITING_MESSAGE = 'photonamous:skip-waiting';

/** The type of the message a page sends to have one of `onDemand` cached: `{ type, path }`. */
export const KEEP_FOR_OFFLINE_MESSAGE = 'photonamous:keep-for-offline';

/** The files the install fetches: every file but those cached on demand. */
export function installPaths(manifest: PrecacheManifest): string[] {
  const onDemand = new Set(manifest.onDemand ?? []);
  return manifest.files.filter((path) => !onDemand.has(path));
}

/**
 * The on-demand file a page's message asks to cache, as a path; null for
 * any other message, a path or URL that is not one of `onDemand`, or a
 * sender that is not one of this app's pages.
 */
export function keepForOfflinePath(
  data: unknown,
  source: { readonly type?: string; readonly url?: string } | null,
  scopeOrigin: string,
  manifest: PrecacheManifest,
): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const { type, path } = data as { type?: unknown; path?: unknown };
  if (type !== KEEP_FOR_OFFLINE_MESSAGE || typeof path !== 'string') return null;
  if (!mayRequestUpdate(source, scopeOrigin, manifest)) return null;
  try {
    const url = new URL(path, scopeOrigin);
    if (url.origin !== scopeOrigin) return null;
    return (manifest.onDemand ?? []).includes(url.pathname) ? url.pathname : null;
  } catch {
    return null;
  }
}
