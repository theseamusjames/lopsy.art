/**
 * Photonamous' service worker (spec 5.7, 6.3): the app shell offline.
 * The build emits this file as `<base>sw.js` (scripts/vite-plugin-service-worker.ts)
 * and writes the precache manifest, with each file's SHA-256, into
 * `__PRECACHE_MANIFEST__`. It has no imports left after bundling and no
 * exports, so it runs as a classic worker script in every browser.
 *
 * Any script on the origin can write to CacheStorage, so cached bytes are
 * checked against the build's checksums before they are served (once per
 * file per worker lifetime) and dropped when they do not match. A cache
 * poisoned by an injection bug does not outlive the bug (spec 6.13).
 *
 * A new version installs and then waits; the page shows "New version
 * ready" and posts SKIP_WAITING_MESSAGE when the user chooses to reload.
 */

import {
  cacheName,
  installPaths,
  keepForOfflinePath,
  matchesBuild,
  mayRequestUpdate,
  planFetch,
  SKIP_WAITING_MESSAGE,
  staleCaches,
  type PrecacheManifest,
} from './sw-logic';

declare const __PRECACHE_MANIFEST__: PrecacheManifest;

/** The parts of ServiceWorkerGlobalScope used here (the DOM lib has no worker types). */
interface ExtendableEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchEvent extends ExtendableEvent {
  readonly request: Request;
  respondWith(response: Promise<Response>): void;
}

interface MessageEventLike extends ExtendableEvent {
  readonly data: unknown;
  readonly source: { readonly type?: string; readonly url?: string } | null;
}

interface WorkerScope {
  readonly location: Location;
  readonly clients: { claim(): Promise<void> };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

const scope = self as unknown as WorkerScope;
const manifest = __PRECACHE_MANIFEST__;
const current = cacheName(manifest);
/** Paths whose cached bytes this worker has checked. */
const verified = new Set<string>();

/**
 * Fetches every file past the HTTP cache, checks it against the build, and
 * stores it as a plain 200 response: a redirected response (Pages answers
 * some paths with a 308) cannot be served to a page load.
 */
async function precache(): Promise<void> {
  const cache = await caches.open(current);
  for (const path of installPaths(manifest)) await cacheFile(cache, path);
}

async function cacheFile(cache: Cache, path: string): Promise<void> {
  const response = await fetch(new Request(path, { cache: 'reload' }));
  if (!response.ok) throw new Error(`Could not precache ${path}: ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (!(await matchesBuild(manifest, path, bytes))) throw new Error(`${path} is not the file this build wrote`);
  await cache.put(path, new Response(bytes, { status: 200, headers: response.headers }));
  verified.add(path);
}

/** An on-demand file a page runs: cached now, unless it already is. */
async function keepForOffline(path: string): Promise<void> {
  if (await fromCache(path)) return;
  await cacheFile(await caches.open(current), path);
}

/** The cached file once its bytes match the build; a cached file that does not match is deleted. */
async function fromCache(path: string): Promise<Response | null> {
  const cache = await caches.open(current);
  const hit = await cache.match(path);
  if (!hit) return null;
  if (verified.has(path)) return hit;
  const bytes = await hit.clone().arrayBuffer();
  if (await matchesBuild(manifest, path, bytes)) {
    verified.add(path);
    return hit;
  }
  await cache.delete(path);
  return null;
}

scope.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

scope.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(staleCaches(names, current).map((name) => caches.delete(name))))
      .then(() => scope.clients.claim()),
  );
});

scope.addEventListener('message', (event) => {
  const keep = keepForOfflinePath(event.data, event.source, scope.location.origin, manifest);
  if (keep !== null) {
    event.waitUntil(keepForOffline(keep).catch(() => undefined));
    return;
  }
  if (event.data !== SKIP_WAITING_MESSAGE) return;
  if (!mayRequestUpdate(event.source, scope.location.origin, manifest)) return;
  void scope.skipWaiting();
});

scope.addEventListener('fetch', (event) => {
  const plan = planFetch(event.request, scope.location.origin, manifest);
  if (plan.kind === 'pass') return;
  if (plan.kind === 'navigate') {
    event.respondWith(fetch(event.request).catch(async () => (await fromCache(plan.fallback)) ?? Response.error()));
    return;
  }
  event.respondWith(fromCache(plan.path).then((hit) => hit ?? fetchAndRepair(plan.path, event.request)));
});

/** A precached file missing from the cache (or dropped for not matching): from the network, cached again if it matches. */
async function fetchAndRepair(path: string, request: Request): Promise<Response> {
  const response = await fetch(request);
  if (!response.ok) return response;
  const bytes = await response.clone().arrayBuffer();
  if (await matchesBuild(manifest, path, bytes)) {
    const cache = await caches.open(current);
    await cache.put(path, new Response(bytes, { status: 200, headers: response.headers }));
    verified.add(path);
  }
  return response;
}
